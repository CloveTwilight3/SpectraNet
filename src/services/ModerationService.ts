import { GuildMember, EmbedBuilder } from 'discord.js';
import { CONFIG } from '../config';
import { DatabaseManager } from '../database/DatabaseManager';

export class ModerationService {
    constructor(private database: DatabaseManager) {}

    async timeoutMember(member: GuildMember, roleId: string, duration: number): Promise<void> {
        try {
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

        } catch (error) {
            console.error(`❌ Failed to timeout ${member.user.tag}:`, error);
        }
    }

    async tempBanMember(member: GuildMember, roleId: string, duration: number): Promise<void> {
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

        } catch (error) {
            console.error(`❌ Failed to temp-ban ${member.user.tag}:`, error);
        }
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
