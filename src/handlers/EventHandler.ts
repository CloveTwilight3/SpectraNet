// src/handlers/EventHandler.ts
import { Events, GuildMember, PartialGuildMember, Message } from 'discord.js';
import { CONFIG } from '../config';
import { ModerationService } from '../services/ModerationService';
import { XPService } from '../services/XPService';

export class EventHandler {
    private xpService: XPService;

    constructor(private moderationService: ModerationService, xpService: XPService) {
        this.xpService = xpService;
    }

    setupEventListeners(client: any): void {
        // Member role update event
        client.on(Events.GuildMemberUpdate, async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
            await this.handleRoleUpdate(oldMember, newMember);
        });

        // Message creation event - handle honeypot channels FIRST, then XP
        client.on(Events.MessageCreate, async (message: Message) => {
            // Ignore bot messages
            if (message.author.bot || !message.guild) return;
            
            // Check if message is in a honeypot channel FIRST
            if (CONFIG.HONEYPOT_CHANNELS.includes(message.channel.id)) {
                console.log(`🚨 Message in honeypot channel from user: ${message.author.tag} (${message.author.id})`);
                
                // Get the guild member
                const member = message.guild?.members.cache.get(message.author.id);
                
                if (member) {
                    // Delete the message first
                    try {
                        await message.delete();
                        console.log(`🗑️ Deleted honeypot message from ${message.author.tag}`);
                    } catch (deleteError) {
                        console.error('❌ Failed to delete message:', deleteError);
                    }

                    // Then permanently ban the member (honeypot channels are immediate bans)
                    await this.moderationService.banMember(member, CONFIG.BAN_REASONS.CHANNEL);
                }
                
                // Don't process XP for honeypot messages - user is getting banned
                return;
            }
            
            // Only process XP for non-honeypot messages
            await this.handleXPGain(message);
        });

        // Error handling
        client.on('error', (error: Error) => {
            console.error('❌ Discord client error:', error);
        });

        process.on('unhandledRejection', (error) => {
            console.error('❌ Unhandled promise rejection:', error);
        });
    }

    private async handleRoleUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
        try {
            // Get old and new role IDs
            const oldRoles = oldMember.roles.cache.map(role => role.id);
            const newRoles = newMember.roles.cache.map(role => role.id);

            // Find newly added roles
            const addedRoles = newRoles.filter(roleId => !oldRoles.includes(roleId));
            // Find removed roles
            const removedRoles = oldRoles.filter(roleId => !newRoles.includes(roleId));

            // Check if any removed role was a honeypot role (cancel pending ban)
            const honeypotRoleRemoved = removedRoles.find(roleId => CONFIG.HONEYPOT_ROLES[roleId]);
            if (honeypotRoleRemoved) {
                console.log(`✅ Honeypot role removed from user: ${newMember.user.tag} (${newMember.id}) - Role: ${honeypotRoleRemoved}`);
                // Cancel any pending ban for this user
                this.moderationService.cancelPendingBan(newMember.user.id, newMember.guild.id);
            }

            // Check if any added role is a honeypot role
            const honeypotRoleAdded = addedRoles.find(roleId => CONFIG.HONEYPOT_ROLES[roleId]);
            if (honeypotRoleAdded) {
                console.log(`🚨 Honeypot role detected for user: ${newMember.user.tag} (${newMember.id}) - Role: ${honeypotRoleAdded}`);
                const roleConfig = CONFIG.HONEYPOT_ROLES[honeypotRoleAdded];
                
                if (roleConfig.type === 'timeout') {
                    await this.moderationService.timeoutMember(newMember, honeypotRoleAdded, roleConfig.duration);
                } else {
                    await this.moderationService.tempBanMember(newMember, honeypotRoleAdded, roleConfig.duration);
                }
            }
        } catch (error) {
            console.error('❌ Error handling role update:', error);
        }
    }

    private async handleXPGain(message: Message): Promise<void> {
        try {
            // Only process XP for non-bot messages in guilds
            if (message.author.bot || !message.guild) return;

            // Double-check: Don't give XP in honeypot channels (should already be handled above)
            if (CONFIG.HONEYPOT_CHANNELS.includes(message.channel.id)) return;

            // Check if TTS is enabled for this channel
                    const ttsChannelId = this.getTTSChannel(message.guild.id);
                    if (ttsChannelId === message.channel.id && this.ttsService?.isConnected(message.guild.id)) {
                        await this.ttsService.queueMessage(message.guild.id, `${message.author.displayName}: ${message.content}`);
        }

            // Process XP gain
            await this.xpService.processMessage(message);

        } catch (error) {
            console.error('❌ Error processing XP gain:', error);
        }
    }
}
