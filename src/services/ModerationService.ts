import { GuildMember, EmbedBuilder } from 'discord.js';
import { CONFIG } from '../config';
import { DatabaseManager } from '../database/DatabaseManager';

interface PendingBan {
    userId: string;
    guildId: string;
    roleId: string;
    memberJoinedAt: Date;
    scheduledAt: Date;
    timeout: NodeJS.Timeout;
    type: 'timeout' | 'tempban';
    duration: number;
}

export class ModerationService {
    private pendingBans: Map<string, PendingBan> = new Map();
    
    constructor(private database: DatabaseManager) {}

    async timeoutMember(member: GuildMember, roleId: string, duration: number): Promise<void> {
        try {
            // Check if member joined recently (within last 10 minutes for onboarding)
            const memberJoinedAt = member.joinedAt;
            const now = new Date();
            const timeSinceJoin = memberJoinedAt ? now.getTime() - memberJoinedAt.getTime() : Infinity;
            const onboardingWindowMs = 10 * 60 * 1000; // 10 minutes
            
            // If member joined recently, delay the timeout
            if (timeSinceJoin < onboardingWindowMs) {
                const delayMs = onboardingWindowMs - timeSinceJoin + (30 * 1000); // Add 30 second buffer
                console.log(`⏳ Delaying timeout for ${member.user.tag} by ${Math.round(delayMs / 1000)} seconds (onboarding window)`);
                
                this.scheduleDelayedTimeout(member, roleId, duration, delayMs);
                return;
            }

            // Proceed with immediate timeout if not in onboarding window
            await this.executeTimeout(member, roleId, duration);

        } catch (error) {
            console.error(`❌ Failed to timeout ${member.user.tag}:`, error);
        }
    }

    async tempBanMember(member: GuildMember, roleId: string, duration: number): Promise<void> {
        try {
            // Check if member joined recently (within last 10 minutes for onboarding)
            const memberJoinedAt = member.joinedAt;
            const now = new Date();
            const timeSinceJoin = memberJoinedAt ? now.getTime() - memberJoinedAt.getTime() : Infinity;
            const onboardingWindowMs = 10 * 60 * 1000; // 10 minutes
            
            // If member joined recently, delay the ban
            if (timeSinceJoin < onboardingWindowMs) {
                const delayMs = onboardingWindowMs - timeSinceJoin + (30 * 1000); // Add 30 second buffer
                console.log(`⏳ Delaying temp ban for ${member.user.tag} by ${Math.round(delayMs / 1000)} seconds (onboarding window)`);
                
                this.scheduleDelayedTempBan(member, roleId, duration, delayMs);
                return;
            }

            // Proceed with immediate ban if not in onboarding window
            await this.executeTempBan(member, roleId, duration);

        } catch (error) {
            console.error(`❌ Failed to temp-ban ${member.user.tag}:`, error);
        }
    }

    private scheduleDelayedTimeout(member: GuildMember, roleId: string, duration: number, delayMs: number): void {
        const pendingKey = `${member.user.id}_${member.guild.id}`;
        
        // Cancel any existing pending ban for this user
        this.cancelPendingBanInternal(pendingKey);
        
        const timeout = setTimeout(async () => {
            try {
                // Re-fetch member to ensure they're still in the server
                const currentMember = await member.guild.members.fetch(member.user.id);
                
                // Check if they still have the honeypot role
                if (currentMember.roles.cache.has(roleId)) {
                    console.log(`⏰ Executing delayed timeout for ${currentMember.user.tag}`);
                    await this.executeTimeout(currentMember, roleId, duration);
                } else {
                    console.log(`✅ ${member.user.tag} removed honeypot role before timeout - cancelling punishment`);
                }
                
                // Clean up
                this.pendingBans.delete(pendingKey);
                
            } catch (error) {
                console.error(`❌ Error executing delayed timeout for ${member.user.tag}:`, error);
                this.pendingBans.delete(pendingKey);
            }
        }, delayMs);

        // Store the pending ban
        this.pendingBans.set(pendingKey, {
            userId: member.user.id,
            guildId: member.guild.id,
            roleId,
            memberJoinedAt: member.joinedAt || new Date(),
            scheduledAt: new Date(Date.now() + delayMs),
            timeout,
            type: 'timeout',
            duration
        });
    }

    private scheduleDelayedTempBan(member: GuildMember, roleId: string, duration: number, delayMs: number): void {
        const pendingKey = `${member.user.id}_${member.guild.id}`;
        
        // Cancel any existing pending ban for this user
        this.cancelPendingBanInternal(pendingKey);
        
        const timeout = setTimeout(async () => {
            try {
                // Re-fetch member to ensure they're still in the server
                const currentMember = await member.guild.members.fetch(member.user.id);
                
                // Check if they still have the honeypot role
                if (currentMember.roles.cache.has(roleId)) {
                    console.log(`⏰ Executing delayed temp ban for ${currentMember.user.tag}`);
                    await this.executeTempBan(currentMember, roleId, duration);
                } else {
                    console.log(`✅ ${member.user.tag} removed honeypot role before ban - cancelling punishment`);
                }
                
                // Clean up
                this.pendingBans.delete(pendingKey);
                
            } catch (error) {
                console.error(`❌ Error executing delayed temp ban for ${member.user.tag}:`, error);
                this.pendingBans.delete(pendingKey);
            }
        }, delayMs);

        // Store the pending ban
        this.pendingBans.set(pendingKey, {
            userId: member.user.id,
            guildId: member.guild.id,
            roleId,
            memberJoinedAt: member.joinedAt || new Date(),
            scheduledAt: new Date(Date.now() + delayMs),
            timeout,
            type: 'tempban',
            duration
        });
    }

    private async executeTimeout(member: GuildMember, roleId: string, duration: number): Promise<void> {
        // Check if the bot has permission to timeout members
        if (!member.guild.members.me?.permissions.has('ModerateMembers')) {
            console.error('❌ Bot does not have permission to timeout members');
            return;
        }

        // Check if the member is moderatable
        if (!member.moderatable) {
            console.error(`❌ Cannot timeout ${member.user.tag} - insufficient permissions or higher role`);
            return;
        }

        // Timeout the member
        await member.timeout(duration, CONFIG.BAN_REASONS.ROLE_TIMEOUT);

        const durationDays = Math.round(duration / (24 * 60 * 60 * 1000));
        console.log(`⏱️ Successfully timed out ${member.user.tag} (${member.id}) for ${durationDays} days - Role: ${roleId}`);
    }

    private async executeTempBan(member: GuildMember, roleId: string, duration: number): Promise<void> {
        // Check if the bot has permission to ban
        if (!member.guild.members.me?.permissions.has('BanMembers')) {
            console.error('❌ Bot does not have permission to ban members');
            return;
        }

        // Check if the member is bannable
        if (!member.bannable) {
            console.error(`❌ Cannot ban ${member.user.tag} - insufficient permissions or higher role`);
            return;
        }

        // Send DM before banning
        await this.sendBanDM(member, CONFIG.BAN_REASONS.ROLE_TEMPBAN);

        // Ban the member
        await member.ban({
            reason: CONFIG.BAN_REASONS.ROLE_TEMPBAN,
            deleteMessageSeconds: 86400,
        });

        const durationDays = Math.round(duration / (24 * 60 * 60 * 1000));
        console.log(`🔨 Successfully temp-banned ${member.user.tag} (${member.id}) for ${durationDays} days - Role: ${roleId}`);

        // Add to database for tracking
        const unbanAt = new Date(Date.now() + duration);
        await this.database.addTempBan(member.user.id, member.guild.id, roleId, unbanAt, CONFIG.BAN_REASONS.ROLE_TEMPBAN);
    }

    async banMember(member: GuildMember, reason: string): Promise<void> {
        try {
            // Check if the bot has permission to ban
            if (!member.guild.members.me?.permissions.has('BanMembers')) {
                console.error('❌ Bot does not have permission to ban members');
                return;
            }

            // Check if the member is bannable
            if (!member.bannable) {
                console.error(`❌ Cannot ban ${member.user.tag} - insufficient permissions or higher role`);
                return;
            }

            // Send DM before banning
            await this.sendBanDM(member, reason);

            // Ban the member permanently
            await member.ban({
                reason: reason,
                deleteMessageSeconds: 86400,
            });

            console.log(`🔨 Successfully banned ${member.user.tag} (${member.id}) - Reason: ${reason}`);

        } catch (error) {
            console.error(`❌ Failed to ban ${member.user.tag}:`, error);
        }
    }

    // Method to cancel a pending ban (useful if user removes the role)
    public cancelPendingBan(userId: string, guildId: string): boolean {
        const pendingKey = `${userId}_${guildId}`;
        return this.cancelPendingBanInternal(pendingKey);
    }

    private cancelPendingBanInternal(pendingKey: string): boolean {
        const pending = this.pendingBans.get(pendingKey);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingBans.delete(pendingKey);
            console.log(`🚫 Cancelled pending ban for user ${pending.userId}`);
            return true;
        }
        return false;
    }

    // Get pending bans for a guild (useful for admin commands)
    public getPendingBans(guildId: string): PendingBan[] {
        return Array.from(this.pendingBans.values()).filter(ban => ban.guildId === guildId);
    }

    // Clean up method for graceful shutdown
    public cleanup(): void {
        console.log(`🧹 Cleaning up ${this.pendingBans.size} pending bans...`);
        for (const [key, pending] of this.pendingBans) {
            clearTimeout(pending.timeout);
        }
        this.pendingBans.clear();
    }

    private async sendBanDM(member: GuildMember, reason: string): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setTitle('You were banned from TransGamers')
                .setDescription('If you feel this ban was in error, please send an email to **appeals@transgamers.org** to appeal your ban')
                .addFields({
                    name: 'Reason:',
                    value: reason,
                    inline: false
                })
                .setColor(0xFFD6E4)
                .setTimestamp();

            await member.send({ embeds: [embed] });
            console.log(`📧 Successfully sent ban DM to ${member.user.tag}`);
        } catch (error) {
            console.warn(`⚠️ Failed to send ban DM to ${member.user.tag}:`, error);
        }
    }
}
