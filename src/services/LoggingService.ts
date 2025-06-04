// src/services/LoggingService.ts
import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { CONFIG } from '../config';

export class LoggingService {
    private client: Client;
    private logChannel: TextChannel | null = null;

    constructor(client: Client) {
        this.client = client;
    }

    async initialize(): Promise<void> {
        if (!CONFIG.LOG_CHANNEL_ID) {
            console.warn('⚠️ LOG_CHANNEL_ID not configured - Discord logging disabled');
            return;
        }

        try {
            const channel = await this.client.channels.fetch(CONFIG.LOG_CHANNEL_ID);
            if (channel?.isTextBased() && channel.type === 0) { // GUILD_TEXT = 0
                this.logChannel = channel as TextChannel;
                console.log(`✅ Logging channel initialized: #${this.logChannel.name}`);
            } else {
                console.error('❌ LOG_CHANNEL_ID is not a text channel');
            }
        } catch (error) {
            console.error('❌ Failed to fetch log channel:', error);
        }
    }

    async logTimeout(member: any, roleId: string, duration: number): Promise<void> {
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
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot - Timeout' });

        // Only set thumbnail if member has displayAvatarURL method
        if (member.user && typeof member.user.displayAvatarURL === 'function') {
            embed.setThumbnail(member.user.displayAvatarURL());
        }

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send timeout log:', error);
        }
    }

    async logTempBan(member: any, roleId: string, duration: number): Promise<void> {
        if (!this.logChannel) return;

        const durationDays = Math.round(duration / (24 * 60 * 60 * 1000));
        
        const embed = new EmbedBuilder()
            .setTitle('🔨 User Temporarily Banned (Honeypot)')
            .setColor(0xFF4444)
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Duration', value: `${durationDays} days`, inline: true },
                { name: 'Role', value: `<@&${roleId}>`, inline: true },
                { name: 'Reason', value: CONFIG.BAN_REASONS.ROLE_TEMPBAN, inline: false },
                { name: 'Unban Date', value: `<t:${Math.floor((Date.now() + duration) / 1000)}:F>`, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot - Temp Ban' });

        // Only set thumbnail if member has displayAvatarURL method
        if (member.user && typeof member.user.displayAvatarURL === 'function') {
            embed.setThumbnail(member.user.displayAvatarURL());
        }

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send temp ban log:', error);
        }
    }

    async logPermanentBan(member: any, reason: string): Promise<void> {
        if (!this.logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('🔨 User Permanently Banned (Honeypot)')
            .setColor(0x000000)
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot - Permanent Ban' });

        // Only set thumbnail if member has displayAvatarURL method
        if (member.user && typeof member.user.displayAvatarURL === 'function') {
            embed.setThumbnail(member.user.displayAvatarURL());
        }

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send permanent ban log:', error);
        }
    }

    async logUnban(userId: string, userName: string, reason: string, moderator: string): Promise<void> {
        if (!this.logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('🔓 User Unbanned')
            .setColor(0x00FF00)
            .addFields(
                { name: 'User', value: `${userName} (${userId})`, inline: true },
                { name: 'Moderator', value: moderator, inline: true },
                { name: 'Reason', value: reason, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot - Manual Unban' });

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send unban log:', error);
        }
    }

    async logAutoUnban(userId: string, userName: string): Promise<void> {
        if (!this.logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('🔓 Temporary Ban Expired')
            .setColor(0x00AA00)
            .addFields(
                { name: 'User', value: `${userName} (${userId})`, inline: true },
                { name: 'Type', value: 'Automatic Unban', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot - Auto Unban' });

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send auto unban log:', error);
        }
    }

    async logOnboardingComplete(member: any, hadHoneypotRoles: boolean, roleNames: string[]): Promise<void> {
        if (!this.logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('✅ User Completed Onboarding')
            .setColor(hadHoneypotRoles ? 0xFF4444 : 0x00FF00)
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Had Honeypot Roles', value: hadHoneypotRoles ? '🚨 Yes' : '✅ No', inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot - Onboarding' });

        // Only set thumbnail if member has displayAvatarURL method
        if (member.user && typeof member.user.displayAvatarURL === 'function') {
            embed.setThumbnail(member.user.displayAvatarURL());
        }

        if (hadHoneypotRoles) {
            embed.addFields({
                name: 'Honeypot Roles Found',
                value: roleNames.join(', '),
                inline: false
            });
        }

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send onboarding log:', error);
        }
    }

    async logRoleRemoval(member: any, removedRoles: string[], moderator: string): Promise<void> {
        if (!this.logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('➖ Honeypot Roles Removed')
            .setColor(0x00AA00)
            .addFields(
                { name: 'User', value: `${member.user.tag} (${member.user.id})`, inline: true },
                { name: 'Moderator', value: moderator, inline: true },
                { name: 'Roles Removed', value: removedRoles.map(id => `<@&${id}>`).join(', '), inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot - Role Removal' });

        // Only set thumbnail if member has displayAvatarURL method
        if (member.user && typeof member.user.displayAvatarURL === 'function') {
            embed.setThumbnail(member.user.displayAvatarURL());
        }

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send role removal log:', error);
        }
    }

    async logError(error: string, context: string): Promise<void> {
        if (!this.logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('❌ Bot Error')
            .setColor(0xFF0000)
            .addFields(
                { name: 'Context', value: context, inline: false },
                { name: 'Error', value: error.substring(0, 1000), inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Honeypot Bot - Error' });

        try {
            await this.logChannel.send({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Failed to send error log:', error);
        }
    }

    // Simple text log for less important events
    async logSimple(message: string): Promise<void> {
        if (!this.logChannel) return;

        try {
            await this.logChannel.send(`📝 ${message}`);
        } catch (error) {
            console.error('❌ Failed to send simple log:', error);
        }
    }
}
