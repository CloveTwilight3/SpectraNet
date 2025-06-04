// src/services/ModerationService.ts
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
    private onboardingService?: any; // Will be set by OnboardingDetectionService
    
    constructor(private database: DatabaseManager) {}

    setOnboardingService(service: any): void {
        this.onboardingService = service;
    }

    async timeoutMember(member: GuildMember, roleId: string, duration: number): Promise<void> {
        try {
            // Check if user is still onboarding
            if (this.onboardingService?.isUserOnboarding(member.user.id)) {
                console.log(`⏳ User ${member.user.tag} still onboarding - waiting for rules agreement`);
                // Don't schedule anything - the onboarding service will handle it
                return;
            }

            // User has completed onboarding, proceed immediately
            await this.executeTimeout(member, roleId, duration);

        } catch (error) {
            console.error(`❌ Failed to timeout ${member.user.tag}:`, error);
        }
    }

    async tempBanMember(member: GuildMember, roleId: string, duration: number): Promise<void> {
        try {
            // Check if user is still onboarding
            if (this.onboardingService?.isUserOnboarding(member.user.id)) {
                console.log(`⏳ User ${member.user.tag} still onboarding - waiting for rules agreement`);
                // Don't schedule anything - the onboarding service will handle it
                return;
            }

            // User has completed onboarding, proceed immediately
            await this.executeTempBan(member, roleId, duration);

        } catch (error) {
            console.error(`❌ Failed to temp-ban ${member.user.tag}:`, error);
        }
    }

    // Made public so OnboardingDetectionService can call it directly
    public async executeTimeout(member: GuildMember, roleId: string, duration: number): Promise<void> {
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

    // Made public so OnboardingDetectionService can call it directly
    public async executeTempBan(member: GuildMember, roleId: string, duration: number): Promise<void> {
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
