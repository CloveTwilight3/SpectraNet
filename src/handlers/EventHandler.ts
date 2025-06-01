import { Events, GuildMember, PartialGuildMember, Message } from 'discord.js';
import { CONFIG } from '../config';
import { ModerationService } from '../services/ModerationService';

export class EventHandler {
    constructor(private moderationService: ModerationService) {}

    setupEventListeners(client: any): void {
        // Member role update event
        client.on(Events.GuildMemberUpdate, async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
            await this.handleRoleUpdate(oldMember, newMember);
        });

        // Message creation event
        client.on(Events.MessageCreate, async (message: Message) => {
            await this.handleMessage(message);
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

            // Check if any added role is a honeypot role
            const honeypotRoleAdded = addedRoles.find(roleId => CONFIG.HONEYPOT_ROLES[roleId]);

            if (honeypotRoleAdded) {
                console.log(`🚨 Honeypot role detected for user: ${newMember.user.tag} (${newMember.id})`);
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

    private async handleMessage(message: Message): Promise<void> {
        try {
            // Ignore bot messages
            if (message.author.bot) return;

            // Check if message is in a honeypot channel
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

                    // Then permanently ban the member
                    await this.moderationService.banMember(member, CONFIG.BAN_REASONS.CHANNEL);
                }
            }
        } catch (error) {
            console.error('❌ Error handling message:', error);
        }
    }
}
