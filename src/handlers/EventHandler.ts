// src/handlers/EventHandler.ts
import { Events, GuildMember, PartialGuildMember, Message } from 'discord.js';
import { CONFIG } from '../config';
import { ModerationService } from '../services/ModerationService';
import { XPService } from '../services/XPService';
import { TTSService } from '../services/TTSService';
import { TranslationService } from '../services/TranslationService';

export class EventHandler {
    private xpService: XPService;
    private ttsService?: TTSService;
    private ttsChannels?: Map<string, string>;
    private translationService?: TranslationService;

    constructor(private moderationService: ModerationService, xpService: XPService) {
        this.xpService = xpService;
    }

    // Method to set TTS service and channels (called from HoneypotBot)
    setTTSService(ttsService: TTSService, ttsChannels: Map<string, string>): void {
        this.ttsService = ttsService;
        this.ttsChannels = ttsChannels;
    }

    setupEventListeners(client: any): void {
        // Member role update event
        client.on(Events.GuildMemberUpdate, async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
            await this.handleRoleUpdate(oldMember, newMember);
        });

        // Message creation event - handle honeypot channels FIRST, then XP and TTS
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
                
                // Don't process XP or TTS for honeypot messages - user is getting banned
                return;
            }
            
            // Process XP and TTS for non-honeypot messages
            await this.handleXPGain(message);
        });

        // Add message reaction event listener for translations
        client.on(Events.MessageReactionAdd, async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
            await this.handleMessageReaction(reaction, user);
        });

        // Error handling
        client.on('error', (error: Error) => {
            console.error('❌ Discord client error:', error);
        });

        process.on('unhandledRejection', (error) => {
            console.error('❌ Unhandled promise rejection:', error);
        });
    }

    private async handleMessageReaction(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<void> {
        try {
            // Fetch partial objects if needed
            if (reaction.partial) {
                try {
                    await reaction.fetch();
                } catch (error) {
                    console.error('Failed to fetch reaction:', error);
                    return;
                }
            }

            if (user.partial) {
                try {
                    await user.fetch();
                } catch (error) {
                    console.error('Failed to fetch user:', error);
                    return;
                }
            }

            // Get the message
            const message = reaction.message;
            if (message.partial) {
                try {
                    await message.fetch();
                } catch (error) {
                    console.error('Failed to fetch message:', error);
                    return;
                }
            }

            // Handle translation if service is available
            if (this.translationService && message instanceof Message && user instanceof User) {
                await this.translationService.handleTranslationReaction(
                    reaction as MessageReaction, 
                    user, 
                    message
                );
            }

        } catch (error) {
            console.error('❌ Error handling message reaction:', error);
        }
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

            // Check if TTS is enabled for this channel/VC
            if (this.ttsService && this.ttsChannels) {
                const ttsChannelId = this.ttsChannels.get(message.guild.id);
                
                if (ttsChannelId && this.ttsService.isConnected(message.guild.id)) {
                    // Handle different channel types for TTS
                    let shouldReadMessage = false;
                    
                    // Direct channel match (text channel or VC side channel)
                    if (ttsChannelId === message.channel.id) {
                        shouldReadMessage = true;
                    }
                    
                    // Voice channel side chat (thread-like channels)
                    else if (message.channel.type === 11 && ttsChannelId === message.channel.parentId) { // 11 = GUILD_PUBLIC_THREAD
                        shouldReadMessage = true;
                    }
                    
                    // Voice channel associated text channel (if VC ID matches)
                    else if (message.channel.type === 0) { // 0 = GUILD_TEXT
                        // Check if this text channel is associated with the voice channel
                        const guild = message.guild;
                        const voiceChannel = guild.channels.cache.get(ttsChannelId);
                        
                        if (voiceChannel && voiceChannel.type === 2) { // 2 = GUILD_VOICE
                            // Check if text channel name matches or is in same category
                            const textChannel = message.channel;
                            
                            // Same name pattern (e.g., "general" VC and "general" text)
                            if (voiceChannel.name.toLowerCase() === textChannel.name.toLowerCase()) {
                                shouldReadMessage = true;
                            }
                            
                            // Same category
                            else if (voiceChannel.parentId && voiceChannel.parentId === textChannel.parentId) {
                                // Additional checks can be added here for more sophisticated matching
                                const voiceName = voiceChannel.name.toLowerCase();
                                const textName = textChannel.name.toLowerCase();
                                
                                // Check if text channel has "chat" or similar suffix/prefix
                                if (textName.includes(voiceName) || voiceName.includes(textName)) {
                                    shouldReadMessage = true;
                                }
                            }
                        }
                    }

                    if (shouldReadMessage) {
                        // Clean the message content for TTS
                        let messageContent = message.content;
                        
                        // Don't read empty messages or just attachments
                        if (!messageContent.trim()) {
                            if (message.attachments.size > 0) {
                                messageContent = "sent an attachment";
                            } else if (message.embeds.length > 0) {
                                messageContent = "sent an embed";
                            } else {
                                return; // Skip empty messages
                            }
                        }
                        
                        // Limit message length for TTS
                        if (messageContent.length > 200) {
                            messageContent = messageContent.substring(0, 200) + "... message truncated";
                        }
                        
                        const messageToRead = `${message.author.displayName}: ${messageContent}`;
                        await this.ttsService.queueMessage(message.guild.id, messageToRead);
                        
                        // console.log(`🔊 Queued TTS message from ${message.author.displayName} in ${message.channel.name}`);
                        const channelName = 'name' in message.channel ? message.channel.name : 'DM';
                        console.log(`🔊 Queued TTS message from ${message.author.displayName} in ${channelName}`);
                    }
                }
            }

            // Process XP gain
            await this.xpService.processMessage(message);

        } catch (error) {
            console.error('❌ Error processing XP gain:', error);
        }
    }
}