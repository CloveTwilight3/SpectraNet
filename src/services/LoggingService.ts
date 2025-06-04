// src/services/LoggingService.ts
import { Client, EmbedBuilder, TextChannel, GuildMember } from 'discord.js';
import { CONFIG } from '../config';

export class LoggingService {
    private client: Client;
    private logChannel: TextChannel | null = null;

    constructor(client: Client) {
        this.client = client;
    }

    async initialize(): Promise<void> {
        if (!CONFIG.LOG_CHANNEL_ID) {
            console.log('ℹ️ No LOG_CHANNEL_ID configured, Discord logging disabled');
            return;
        }

        try {
            const channel = await this.client.channels.fetch(CONFIG.LOG_CHANNEL_ID);
            if (channel?.isTextBased()) {
                this.logChannel = channel as TextChannel;
                console.log(`✅ Discord logging enabled - Channel: ${channel.name || 'Unknown'}`);
            } else {
                console.warn('⚠️ LOG_CHANNEL_ID is not a text channel');
            }
        } catch (error) {
            console.error('❌ Failed to fetch log channel:', error);
        }
    }

    async logTimeout(member: GuildMember, roleId: string, duration: number): Promise<void> {
        if (!this.logChannel) return;

        const durationDays = Math.round(duration / (24 * 60 * 60 * 1000));
        
        const embed = new EmbedBuilder()
            .setTitle('⏱️ User Timed Out (Honeypot)')
            .setColor(0xFFA500)
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Duration', value: `${durationDays} days`, inline: true },
                { name: 'Role', value: `<@&${roleId}>`, inline: true },
                { name: 'Reason', value: CONFIG.BAN_REASONS.ROLE_TIMEOUT, inline: false }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot Timeout' });

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send timeout log:', error);
        }
    }

    async logTempBan(member: GuildMember, roleId: string, duration: number): Promise<void> {
        if (!this.logChannel) return;

        const durationDays = Math.round(duration / (24 * 60 * 60 * 1000));
        const unbanAt = new Date(Date.now() + duration);
        const unbanTimestamp = Math.floor(unbanAt.getTime() / 1000);
        
        const embed = new EmbedBuilder()
            .setTitle('🔨 User Temporarily Banned (Honeypot)')
            .setColor(0xFF4444)
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Duration', value: `${durationDays} days`, inline: true },
                { name: 'Unban Date', value: `<t:${unbanTimestamp}:F>`, inline: true },
                { name: 'Role', value: `<@&${roleId}>`, inline: true },
                { name: 'Reason', value: CONFIG.BAN_REASONS.ROLE_TEMPBAN, inline: false }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot Temp Ban' });

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send temp ban log:', error);
        }
    }

    async logPermanentBan(member: GuildMember, reason: string): Promise<void> {
        if (!this.logChannel) return;
        
        const embed = new EmbedBuilder()
            .setTitle('🔨 User Permanently Banned (Honeypot)')
            .setColor(0x8B0000)
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Type', value: 'Permanent Ban', inline: true },
                { name: 'Trigger', value: 'Honeypot Channel Message', inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot Permanent Ban' });

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send permanent ban log:', error);
        }
    }

    async logUnban(userId: string, moderatorId: string, reason: string, isAutomatic: boolean = false): Promise<void> {
        if (!this.logChannel) return;

        let user;
        let moderator;
        
        try {
            user = await this.client.users.fetch(userId);
        } catch {
            user = { tag: 'Unknown User', id: userId };
        }

        if (!isAutomatic) {
            try {
                moderator = await this.client.users.fetch(moderatorId);
            } catch {
                moderator = { tag: 'Unknown Moderator', id: moderatorId };
            }
        }
        
        const embed = new EmbedBuilder()
            .setTitle(isAutomatic ? '🔓 Automatic Unban' : '🔓 Manual Unban')
            .setColor(0x00FF00)
            .addFields(
                { name: 'User', value: `${user.tag} (${user.id})`, inline: true },
                { name: 'Type', value: isAutomatic ? 'Automatic' : 'Manual', inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: isAutomatic ? 'Honeypot Bot Auto Unban' : 'Honeypot Bot Manual Unban' });

        if (!isAutomatic && moderator) {
            embed.addFields({ name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: true });
        }

        if (user.displayAvatarURL) {
            embed.setThumbnail(user.displayAvatarURL());
        }

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send unban log:', error);
        }
    }

    async logRoleRemoval(member: GuildMember, removedRoles: string[], moderatorId: string): Promise<void> {
        if (!this.logChannel) return;

        let moderator;
        try {
            moderator = await this.client.users.fetch(moderatorId);
        } catch {
            moderator = { tag: 'Unknown Moderator', id: moderatorId };
        }

        const rolesList = removedRoles.map(roleId => `<@&${roleId}>`).join(', ');
        
        const embed = new EmbedBuilder()
            .setTitle('➖ Honeypot Roles Removed')
            .setColor(0x00AAFF)
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Moderator', value: `${moderator.tag} (${moderator.id})`, inline: true },
                { name: 'Roles Removed', value: rolesList, inline: false }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot Role Removal' });

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send role removal log:', error);
        }
    }

    async logOnboardingComplete(member: GuildMember, hadHoneypotRoles: boolean, honeypotRoles: string[] = []): Promise<void> {
        if (!this.logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('🎯 Onboarding Completed')
            .setColor(hadHoneypotRoles ? 0xFF4444 : 0x00FF00)
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Status', value: hadHoneypotRoles ? '🚨 Had Honeypot Roles' : '✅ Clean', inline: true }
            )
            .setThumbnail(member.user.displayAvatarURL())
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot Onboarding' });

        if (hadHoneypotRoles && honeypotRoles.length > 0) {
            const rolesList = honeypotRoles.map(roleId => `<@&${roleId}>`).join(', ');
            embed.addFields({ name: 'Honeypot Roles Found', value: rolesList, inline: false });
        }

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send onboarding log:', error);
        }
    }

    async logError(error: string, context?: string): Promise<void> {
        if (!this.logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('❌ Bot Error')
            .setColor(0xFF0000)
            .addFields(
                { name: 'Error', value: error.substring(0, 1024), inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot Error' });

        if (context) {
            embed.addFields({ name: 'Context', value: context.substring(0, 1024), inline: false });
        }

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (logError) {
            console.error('❌ Failed to send error log:', logError);
        }
    }

    // Utility method to check if logging is enabled
    public isEnabled(): boolean {
        return this.logChannel !== null;
    }

    // Method to update log channel (useful for admin commands)
    async setLogChannel(channelId: string): Promise<boolean> {
        try {
            const channel = await this.client.channels.fetch(channelId);
            if (channel?.isTextBased()) {
                this.logChannel = channel as TextChannel;
                return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Failed to set log channel:', error);
            return false;
        }
    }
}