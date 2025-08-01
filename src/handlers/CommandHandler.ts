// src/handlers/CommandHandler.ts
import { ChatInputCommandInteraction, EmbedBuilder, User, GuildMember } from 'discord.js';
import { CONFIG } from '../config';
import { DatabaseManager } from '../database/DatabaseManager';
import { ModerationService } from '../services/ModerationService';
import { ManualUnbanService } from '../services/ManualUnbanService';
import { XPService } from '../services/XPService';
import { TTSService } from '../services/TTSService';
import { EmailService } from '../services/EmailService';
import { TranslationService } from '../services/TranslationService';
import { HighlightsService } from '../services/HighlightsService';

export class CommandHandler {
    private ttsChannels: Map<string, string> = new Map(); // guild -> channel mapping
    private xpService: XPService;
    private unbanService: ManualUnbanService;
    private emailService: EmailService;
    private highlightsService: HighlightsService;

    constructor(
        private client: any,
        private database: DatabaseManager,
        private moderationService: ModerationService,
        private ttsService: TTSService,
        emailService: EmailService,
        highlightsService: HighlightsService
    ) {
        this.xpService = new XPService(database);
        this.unbanService = new ManualUnbanService(database, moderationService);
        this.emailService = emailService;
        this.highlightsService = highlightsService;
    }

    // Getter for TTS channels (so EventHandler can access it)
    get getTTSChannels(): Map<string, string> {
        return this.ttsChannels;
    }

    async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            switch (interaction.commandName) {
                // Basic commands
                case 'ping':
                    await this.handlePingCommand(interaction);
                    break;
                case 'tempbans':
                    await this.handleTempBansCommand(interaction);
                    break;
                case 'userinfo':
                    await this.handleUserInfoCommand(interaction);
                    break;
                case 'onboarding':
                    await this.handleOnboardingCommand(interaction);
                    break;

                // Honeypot management commands
                case 'pendingbans':
                    await this.handlePendingBansCommand(interaction);
                    break;
                case 'unban':
                    await this.handleUnbanCommand(interaction);
                    break;
                case 'removehoneypot':
                    await this.handleRemoveHoneypotCommand(interaction);
                    break;
                case 'cleantempbans':
                    await this.handleCleanTempBansCommand(interaction);
                    break;

                // XP COMMANDS
                case 'usercard':
                    await this.handleUserCardCommand(interaction);
                    break;
                case 'leaderboard':
                    await this.handleLeaderboardCommand(interaction);
                    break;
                case 'addlevelrole':
                    await this.handleAddLevelRoleCommand(interaction);
                    break;
                case 'removelevelrole':
                    await this.handleRemoveLevelRoleCommand(interaction);
                    break;
                case 'levelroles':
                    await this.handleLevelRolesCommand(interaction);
                    break;
                case 'addxp':
                    await this.handleAddXPCommand(interaction);
                    break;

                // TTS Commands
                case 'join':
                    await this.handleJoinCommand(interaction);
                    break;
                case 'leave':
                    await this.handleLeaveCommand(interaction);
                    break;
                case 'speak':
                    await this.handleSpeakCommand(interaction);
                    break;
                case 'tts':
                    await this.handleTTSToggleCommand(interaction);
                    break;

                // Email Commands
                case 'emailstatus':
                    await this.handleEmailStatusCommand(interaction);
                    break;
                case 'emailtest':
                    await this.handleEmailTestCommand(interaction);
                    break;
                case 'emailrestart':
                    await this.handleEmailRestartCommand(interaction);
                    break;

                //Translate
                case 'translate':
                    await this.handleTranslateInfoCommand(interaction);
                    break;

                // Highlights
                case 'highlight':
                    await this.handleHighlightCommand(interaction);
                    break;
                case 'highlightstats':
                    await this.handleHighlightStatsCommand(interaction);
                    break;

            }
        } catch (error) {
            console.error('❌ Error handling slash command:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ An error occurred while processing the command.',
                    ephemeral: true,
                });
            }
        }
    }

    private async handlePingCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const ping = this.client.ws.ping;
        const roleConfigs = Object.entries(CONFIG.HONEYPOT_ROLES)
            .map(([roleId, config]) => `<@&${roleId}>: ${Math.round(config.duration / (24 * 60 * 60 * 1000))}d (${config.type})`)
            .join('\n');

        // Get onboarding stats if the service is available
        let onboardingInfo = '';
        if ((this.moderationService as any).onboardingService) {
            const onboardingCount = (this.moderationService as any).onboardingService.getOnboardingCount();
            onboardingInfo = `• ${onboardingCount} users onboarding\n`;
        }

        const pendingBansCount = this.moderationService.getPendingBans(interaction.guildId!).length;

        await interaction.reply({
            content: `🏓 Pong! Bot latency: ${ping}ms\n` +
                `📊 Monitoring:\n` +
                `• ${Object.keys(CONFIG.HONEYPOT_ROLES).length} honeypot roles\n` +
                `• ${CONFIG.HONEYPOT_CHANNELS.length} honeypot channels\n` +
                `${onboardingInfo}` +
                `• ${pendingBansCount} pending bans\n\n` +
                `⚙️ Role Configurations:\n${roleConfigs || 'None configured'}\n\n` +
                `🎯 Onboarding Detection: Rules Agreement (5s delay)`,
            ephemeral: true,
        });
    }

    private async handleTempBansCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const bans = await this.database.getActiveTempBans(interaction.guildId!);

            if (bans.length === 0) {
                await interaction.reply({
                    content: '✅ No active temporary bans found.',
                    ephemeral: true,
                });
                return;
            }

            const banList = bans.map(row => {
                const unbanTimestamp = Math.floor(new Date(row.unban_at).getTime() / 1000);
                return `<@${row.user_id}> - Unbans <t:${unbanTimestamp}:R> (Role: <@&${row.role_id}>)`;
            }).join('\n');

            await interaction.reply({
                content: `📋 **Active Temporary Bans:**\n${banList}`,
                ephemeral: true,
            });
        } catch (error) {
            console.error('❌ Error handling tempbans command:', error);
            await interaction.reply({
                content: '❌ Error retrieving temporary bans.',
                ephemeral: true,
            });
        }
    }

    private async handleOnboardingCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            // Get onboarding users
            const onboardingUsers = (this.moderationService as any).onboardingService?.getOnboardingUsers() || [];

            if (onboardingUsers.length === 0) {
                await interaction.reply({
                    content: '✅ No users currently onboarding.',
                    ephemeral: true,
                });
                return;
            }

            const usersList = await Promise.all(
                onboardingUsers.slice(0, 10).map(async (userData: any) => {
                    try {
                        const user = await this.client.users.fetch(userData.userId);
                        const joinedTimestamp = Math.floor(userData.joinedAt.getTime() / 1000);
                        const status = userData.rulesAccepted ? '✅ Rules Accepted' : '⏳ Pending Rules';
                        return `${user.tag} - Joined <t:${joinedTimestamp}:R> - ${status}`;
                    } catch {
                        return `Unknown User (${userData.userId}) - Joined <t:${Math.floor(userData.joinedAt.getTime() / 1000)}:R>`;
                    }
                })
            );

            const embed = new EmbedBuilder()
                .setTitle('👋 Users Currently Onboarding')
                .setDescription(usersList.join('\n'))
                .setColor(0x00AE86)
                .setTimestamp()
                .setFooter({ text: `${onboardingUsers.length} total onboarding users` });

            if (onboardingUsers.length > 10) {
                embed.addFields({
                    name: 'ℹ️ Note',
                    value: `Showing first 10 of ${onboardingUsers.length} onboarding users`,
                    inline: false
                });
            }

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('❌ Error handling onboarding command:', error);
            await interaction.reply({
                content: '❌ Error retrieving onboarding users.',
                ephemeral: true,
            });
        }
    }

    private async handlePendingBansCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const pendingBans = this.moderationService.getPendingBans(interaction.guildId!);

            if (pendingBans.length === 0) {
                await interaction.reply({
                    content: '✅ No pending bans found.',
                    ephemeral: true,
                });
                return;
            }

            const pendingList = pendingBans.map(ban => {
                const scheduledTimestamp = Math.floor(ban.scheduledAt.getTime() / 1000);
                const joinedTimestamp = Math.floor(ban.memberJoinedAt.getTime() / 1000);
                return `<@${ban.userId}> - ${ban.type} scheduled <t:${scheduledTimestamp}:R>\n` +
                    `  └ Joined: <t:${joinedTimestamp}:R> | Role: <@&${ban.roleId}>`;
            }).join('\n\n');

            const embed = new EmbedBuilder()
                .setTitle('⏳ Pending Honeypot Bans')
                .setDescription(pendingList)
                .setColor(0xFFA500)
                .addFields({
                    name: 'ℹ️ Info',
                    value: 'These users got honeypot roles during their onboarding window (first 10 minutes). ' +
                        'They will be automatically banned unless they remove the role.',
                    inline: false
                })
                .setTimestamp()
                .setFooter({ text: `${pendingBans.length} pending ban(s)` });

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('❌ Error handling pendingbans command:', error);
            await interaction.reply({
                content: '❌ Error retrieving pending bans.',
                ephemeral: true,
            });
        }
    }

    private async handleUnbanCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const userInput = interaction.options.getString('user', true);
        const reason = interaction.options.getString('reason') || 'Manual unban by moderator';

        try {
            await interaction.deferReply({ ephemeral: true });

            const { userId, user } = await this.unbanService.parseUserInput(interaction.guild!, userInput);

            const result = await this.unbanService.unbanUser(
                interaction.guild!,
                userId,
                interaction.user.id,
                reason
            );

            if (!result.success) {
                await interaction.editReply({
                    content: `❌ Failed to unban user: ${result.error}`,
                });
                return;
            }

            const userName = user?.tag || `User ID: ${userId}`;

            const embed = new EmbedBuilder()
                .setTitle('✅ Manual Unban Completed')
                .setDescription(`Successfully processed unban for **${userName}**`)
                .addFields(
                    { name: 'Discord Unban', value: result.wasActuallyBanned ? '✅ Unbanned' : '⚠️ Not banned', inline: true },
                    { name: 'Database Cleanup', value: result.removedFromDatabase ? '✅ Removed' : '⚠️ No records', inline: true },
                    { name: 'Pending Ban', value: result.cancelledPendingBan ? '✅ Cancelled' : '⚠️ None pending', inline: true },
                    { name: 'Honeypot Roles', value: result.removedRoles.length > 0 ? `✅ Removed ${result.removedRoles.length} role(s)` : '⚠️ None found', inline: true },
                    { name: 'Reason', value: reason, inline: false }
                )
                .setColor(0x00FF00)
                .setTimestamp()
                .setFooter({ text: `Action by ${interaction.user.username}` });

            await interaction.editReply({ embeds: [embed] });

            console.log(`🔓 Manual unban completed for ${userName} by ${interaction.user.tag}`);

        } catch (error: any) {
            console.error('❌ Error in unban command:', error);
            await interaction.editReply({
                content: `❌ Error processing unban: ${error.message}`,
            });
        }
    }

    private async handleRemoveHoneypotCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const targetUser = interaction.options.getUser('user', true);
        const specificRole = interaction.options.getRole('role');

        try {
            const member = await interaction.guild!.members.fetch(targetUser.id);

            let removedRoles: string[];

            if (specificRole) {
                // Remove specific role
                const success = await this.unbanService.removeSpecificHoneypotRole(member, specificRole.id);
                removedRoles = success ? [specificRole.id] : [];
            } else {
                // Remove all honeypot roles
                removedRoles = await this.unbanService.removeHoneypotRoles(member);
            }

            if (removedRoles.length === 0) {
                await interaction.reply({
                    content: `⚠️ ${targetUser.tag} doesn't have any${specificRole ? ` ${specificRole.name}` : ''} honeypot roles.`,
                    ephemeral: true,
                });
                return;
            }

            const rolesList = removedRoles.map(roleId => `<@&${roleId}>`).join(', ');

            const embed = new EmbedBuilder()
                .setTitle('✅ Honeypot Roles Removed')
                .setDescription(`Successfully removed honeypot roles from **${targetUser.tag}**`)
                .addFields(
                    { name: 'User', value: targetUser.toString(), inline: true },
                    { name: 'Roles Removed', value: rolesList, inline: true },
                    { name: 'Pending Ban', value: 'Automatically cancelled', inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp()
                .setFooter({ text: `Action by ${interaction.user.username}` });

            await interaction.reply({ embeds: [embed], ephemeral: true });

            console.log(`➖ Removed honeypot roles from ${targetUser.tag} by ${interaction.user.tag}`);

        } catch (error: any) {
            console.error('❌ Error removing honeypot roles:', error);

            if (error.message.includes('not configured as a honeypot role')) {
                await interaction.reply({
                    content: `❌ The specified role is not configured as a honeypot role.`,
                    ephemeral: true,
                });
            } else if (error.message.includes('Unknown Member')) {
                await interaction.reply({
                    content: `❌ User ${targetUser.tag} is not in this server.`,
                    ephemeral: true,
                });
            } else {
                await interaction.reply({
                    content: `❌ Error removing honeypot roles: ${error.message}`,
                    ephemeral: true,
                });
            }
        }
    }

    private async handleCleanTempBansCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            await interaction.deferReply({ ephemeral: true });

            const result = await this.unbanService.cleanupExpiredBans(interaction.guild!);

            if (result.errors.length > 0) {
                await interaction.editReply({
                    content: `⚠️ Cleanup completed with errors:\n• Cleaned: ${result.cleaned} records\n• Errors: ${result.errors.join(', ')}`,
                });
            } else {
                await interaction.editReply({
                    content: `✅ Successfully cleaned up **${result.cleaned}** expired ban records from the database.`,
                });
            }

            console.log(`🧹 Temp bans cleanup completed by ${interaction.user.tag}: ${result.cleaned} cleaned`);

        } catch (error: any) {
            console.error('❌ Error in clean temp bans command:', error);
            await interaction.editReply({
                content: `❌ Error during cleanup: ${error.message}`,
            });
        }
    }

    private async handleUserInfoCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const userInput = interaction.options.getString('user', true);
            let userId: string;

            // Extract user ID from mention or use as-is if it's already an ID
            if (userInput.startsWith('<@') && userInput.endsWith('>')) {
                userId = userInput.slice(2, -1);
                if (userId.startsWith('!')) {
                    userId = userId.slice(1);
                }
            } else {
                userId = userInput;
            }

            // Validate that the extracted ID is a valid Discord snowflake
            if (!/^\d{17,19}$/.test(userId)) {
                await interaction.reply({
                    content: '❌ Invalid user ID or mention format. Please provide a valid user mention (@user) or user ID.',
                    ephemeral: true,
                });
                return;
            }

            // Try to fetch the user
            let user: User;
            try {
                user = await this.client.users.fetch(userId);
            } catch (error) {
                await interaction.reply({
                    content: '❌ User not found. Please check the user ID or mention and try again.',
                    ephemeral: true,
                });
                return;
            }

            // Get guild member if they're in the server
            let member: GuildMember | null = null;
            if (interaction.guild) {
                try {
                    member = await interaction.guild.members.fetch(userId);
                } catch (error) {
                    // User is not in the server, that's okay
                }
            }

            // Format the response: {display_name} | {username} | {UUID}
            const displayName = member?.displayName || user.displayName || user.username;
            const username = user.username;
            const uuid = user.id;

            const formattedInfo = `${displayName} | ${username} | ${uuid}`;

            // Create an embed for better formatting
            const embed = new EmbedBuilder()
                .setTitle('👤 User Information')
                .setDescription(`\`\`\`${formattedInfo}\`\`\``)
                .addFields(
                    { name: 'Display Name', value: displayName, inline: true },
                    { name: 'Username', value: username, inline: true },
                    { name: 'User ID', value: uuid, inline: true },
                    { name: 'In Server', value: member ? '✅ Yes' : '❌ No', inline: true }
                )
                .setThumbnail(user.displayAvatarURL({ size: 256 }))
                .setColor(0x00AE86)
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.username}` });

            // Add member-specific info if they're in the server
            if (member) {
                const joinedAt = member.joinedAt;
                if (joinedAt) {
                    const joinTimestamp = Math.floor(joinedAt.getTime() / 1000);
                    embed.addFields({
                        name: 'Joined Server',
                        value: `<t:${joinTimestamp}:R>`,
                        inline: true
                    });
                }

                const roles = member.roles.cache
                    .filter(role => role.id !== interaction.guild!.id)
                    .sort((a, b) => b.position - a.position)
                    .map(role => role.toString())
                    .slice(0, 10);

                if (roles.length > 0) {
                    embed.addFields({
                        name: `Roles (${member.roles.cache.size - 1})`,
                        value: roles.join(', ') + (member.roles.cache.size > 11 ? '...' : ''),
                        inline: false
                    });
                }
            }

            await interaction.reply({
                embeds: [embed],
                ephemeral: true,
            });

            console.log(`📋 User info requested for ${user.username} (${user.id}) by ${interaction.user.username}`);

        } catch (error) {
            console.error('❌ Error handling userinfo command:', error);
            await interaction.reply({
                content: '❌ An error occurred while fetching user information.',
                ephemeral: true,
            });
        }
    }

    private async handleUserCardCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const guildId = interaction.guildId!;

        try {
            const userXP = await this.database.getUserXP(targetUser.id, guildId);

            if (!userXP) {
                await interaction.reply({
                    content: `📊 ${targetUser.username} hasn't earned any XP yet!`,
                    ephemeral: true,
                });
                return;
            }

            const progressData = this.xpService.calculateXPForNextLevel(userXP.xp);
            const progressBar = this.createProgressBar(progressData.progress);

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${targetUser.displayName}'s User Card`)
                .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
                .setColor(0x7289DA)
                .addFields(
                    {
                        name: '🎚️ Level',
                        value: `**${userXP.level}**`,
                        inline: true
                    },
                    {
                        name: '✨ Total XP',
                        value: `**${userXP.xp.toLocaleString()}**`,
                        inline: true
                    },
                    {
                        name: '💬 Messages',
                        value: `**${userXP.total_messages.toLocaleString()}**`,
                        inline: true
                    },
                    {
                        name: `📈 Progress to Level ${progressData.nextLevel}`,
                        value: `${progressBar}\n**${progressData.xpNeeded.toLocaleString()}** XP needed`,
                        inline: false
                    }
                )
                .setTimestamp()
                .setFooter({ text: `Requested by ${interaction.user.username}` });

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('❌ Error handling usercard command:', error);
            await interaction.reply({
                content: '❌ Error retrieving user XP data.',
                ephemeral: true,
            });
        }
    }

    private async handleLeaderboardCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const limit = interaction.options.getInteger('limit') || 10;
        const guildId = interaction.guildId!;

        try {
            const leaderboard = await this.database.getXPLeaderboard(guildId, limit);

            if (leaderboard.length === 0) {
                await interaction.reply({
                    content: '📊 No XP data found for this server yet!',
                    ephemeral: true,
                });
                return;
            }

            const leaderboardText = await Promise.all(
                leaderboard.map(async (entry, index) => {
                    try {
                        const user = await this.client.users.fetch(entry.user_id);
                        const medal = index < 3 ? ['🥇', '🥈', '🥉'][index] : `${index + 1}.`;
                        return `${medal} **${user.displayName}** - Level ${entry.level} (${entry.xp.toLocaleString()} XP)`;
                    } catch {
                        return `${index + 1}. Unknown User - Level ${entry.level} (${entry.xp.toLocaleString()} XP)`;
                    }
                })
            );

            const embed = new EmbedBuilder()
                .setTitle('🏆 XP Leaderboard')
                .setDescription(leaderboardText.join('\n'))
                .setColor(0xFFD700)
                .setTimestamp()
                .setFooter({ text: `Showing top ${leaderboard.length} users` });

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('❌ Error handling leaderboard command:', error);
            await interaction.reply({
                content: '❌ Error retrieving leaderboard data.',
                ephemeral: true,
            });
        }
    }

    private async handleAddLevelRoleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const level = interaction.options.getInteger('level', true);
        const role = interaction.options.getRole('role', true);
        const guildId = interaction.guildId!;

        try {
            await this.database.addLevelRole(guildId, level, role.id);

            await interaction.reply({
                content: `✅ Successfully added ${role.toString()} as a reward for reaching level **${level}**!`,
                ephemeral: true,
            });

            console.log(`➕ Added level role: Level ${level} -> ${role.name} in guild ${guildId}`);

        } catch (error) {
            console.error('❌ Error adding level role:', error);
            await interaction.reply({
                content: '❌ Error adding level role. It might already exist.',
                ephemeral: true,
            });
        }
    }

    private async handleRemoveLevelRoleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const level = interaction.options.getInteger('level', true);
        const role = interaction.options.getRole('role', true);
        const guildId = interaction.guildId!;

        try {
            const removed = await this.database.removeLevelRole(guildId, level, role.id);

            if (removed) {
                await interaction.reply({
                    content: `✅ Successfully removed ${role.toString()} from level **${level}** rewards.`,
                    ephemeral: true,
                });
                console.log(`➖ Removed level role: Level ${level} -> ${role.name} in guild ${guildId}`);
            } else {
                await interaction.reply({
                    content: `❌ No level role found for ${role.toString()} at level **${level}**.`,
                    ephemeral: true,
                });
            }

        } catch (error) {
            console.error('❌ Error removing level role:', error);
            await interaction.reply({
                content: '❌ Error removing level role.',
                ephemeral: true,
            });
        }
    }

    private async handleLevelRolesCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const guildId = interaction.guildId!;

        try {
            const levelRoles = await this.database.getAllLevelRoles(guildId);

            if (levelRoles.length === 0) {
                await interaction.reply({
                    content: '📋 No level roles configured for this server.',
                    ephemeral: true,
                });
                return;
            }

            const rolesList = levelRoles.map(lr =>
                `Level **${lr.level}** → <@&${lr.role_id}>`
            ).join('\n');

            const embed = new EmbedBuilder()
                .setTitle('🎯 Level Role Rewards')
                .setDescription(rolesList)
                .setColor(0x5865F2)
                .setTimestamp()
                .setFooter({ text: `${levelRoles.length} level roles configured` });

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('❌ Error retrieving level roles:', error);
            await interaction.reply({
                content: '❌ Error retrieving level roles.',
                ephemeral: true,
            });
        }
    }

    private async handleAddXPCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const targetUser = interaction.options.getUser('user', true);
        const amount = interaction.options.getInteger('amount', true);
        const guildId = interaction.guildId!;

        try {
            const member = await interaction.guild!.members.fetch(targetUser.id);
            const result = await this.xpService.addXP(member, 0); // Don't consider message length for manual addition

            // Add additional XP directly
            await this.database.addUserXP(targetUser.id, guildId, amount - 15); // Subtract the automatic XP gain

            await interaction.reply({
                content: `✅ Added **${amount.toLocaleString()} XP** to ${targetUser.toString()}!`,
                ephemeral: true,
            });

            console.log(`➕ ${interaction.user.tag} added ${amount} XP to ${targetUser.tag}`);

        } catch (error) {
            console.error('❌ Error adding XP:', error);
            await interaction.reply({
                content: '❌ Error adding XP to user.',
                ephemeral: true,
            });
        }
    }

    private createProgressBar(percentage: number, length: number = 20): string {
        const filled = Math.round((percentage / 100) * length);
        const empty = length - filled;

        const progressBar = '█'.repeat(filled) + '░'.repeat(empty);
        return `[${progressBar}] ${percentage.toFixed(1)}%`;
    }

    // TTS COMMANDS
    private async handleJoinCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            // Get the member properly
            const member = await interaction.guild!.members.fetch(interaction.user.id);
            const voiceChannel = member.voice.channel;

            if (!voiceChannel) {
                await interaction.reply({
                    content: '❌ You need to be in a voice channel first!',
                    ephemeral: true,
                });
                return;
            }

            const success = await this.ttsService.joinChannel(voiceChannel);

            if (success) {
                // Automatically enable TTS for this VC's side channel if it exists
                // Voice channels in Discord can have associated text channels
                const sideChannelId = voiceChannel.id; // Use the same ID for side channel detection
                this.ttsChannels.set(interaction.guildId!, sideChannelId);

                await interaction.reply({
                    content: `✅ Joined **${voiceChannel.name}** for TTS! Side channel monitoring enabled.`,
                    ephemeral: true,
                });

                console.log(`🔊 Bot joined ${voiceChannel.name} and enabled TTS for VC side channel`);
            } else {
                await interaction.reply({
                    content: '❌ Failed to join voice channel. Check permissions.',
                    ephemeral: true,
                });
            }
        } catch (error) {
            console.error('❌ Error joining voice channel:', error);
            await interaction.reply({
                content: '❌ An error occurred while joining the voice channel.',
                ephemeral: true,
            });
        }
    }

    private async handleLeaveCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            await this.ttsService.leaveChannel(interaction.guildId!);
            this.ttsChannels.delete(interaction.guildId!);

            await interaction.reply({
                content: '✅ Left voice channel and disabled TTS.',
                ephemeral: true,
            });

            console.log(`🔇 Bot left voice channel and disabled TTS in guild ${interaction.guildId}`);
        } catch (error) {
            console.error('❌ Error leaving voice channel:', error);
            await interaction.reply({
                content: '❌ An error occurred while leaving the voice channel.',
                ephemeral: true,
            });
        }
    }

    private async handleSpeakCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const text = interaction.options.getString('text', true);
        const language = interaction.options.getString('language') || 'en';

        try {
            if (!this.ttsService.isConnected(interaction.guildId!)) {
                await interaction.reply({
                    content: '❌ Bot is not connected to a voice channel. Use `/join` first.',
                    ephemeral: true,
                });
                return;
            }

            const success = await this.ttsService.speak(interaction.guildId!, text, { language });

            if (success) {
                await interaction.reply({
                    content: `🔊 Speaking: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`,
                    ephemeral: true,
                });
            } else {
                await interaction.reply({
                    content: '❌ Failed to generate TTS.',
                    ephemeral: true,
                });
            }
        } catch (error) {
            console.error('❌ Error in speak command:', error);
            await interaction.reply({
                content: '❌ An error occurred while generating speech.',
                ephemeral: true,
            });
        }
    }

    private async handleTTSToggleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const channel = interaction.options.getChannel('channel', true);

        try {
            // Accept both text channels and voice channels (for side chat)
            if (channel.type !== 0 && channel.type !== 2) { // 0 = GUILD_TEXT, 2 = GUILD_VOICE
                await interaction.reply({
                    content: '❌ Please select a text channel or voice channel.',
                    ephemeral: true,
                });
                return;
            }

            this.ttsChannels.set(interaction.guildId!, channel.id);

            await interaction.reply({
                content: `✅ TTS enabled for ${channel.toString()}. Messages will be read aloud when bot is in voice channel.`,
                ephemeral: true,
            });

            console.log(`🔧 TTS enabled for channel ${channel.name} in guild ${interaction.guildId}`);
        } catch (error) {
            console.error('❌ Error in TTS toggle command:', error);
            await interaction.reply({
                content: '❌ An error occurred while setting up TTS.',
                ephemeral: true,
            });
        }
    }

    // Helper method to get TTS channel
    private getTTSChannel(guildId: string): string | undefined {
        return this.ttsChannels.get(guildId);
    }

    private async handleEmailStatusCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            // You'll need to pass emailService to CommandHandler
            const status = (this as any).emailService?.getStatus() || {
                isRunning: false,
                lastCheck: new Date(0),
                channelName: null,
                pollInterval: 0
            };

            const embed = new EmbedBuilder()
                .setTitle('📧 Email Forwarding Status')
                .setColor(status.isRunning ? 0x00FF00 : 0xFF0000)
                .addFields(
                    {
                        name: '🔄 Status',
                        value: status.isRunning ? '✅ Running' : '❌ Stopped',
                        inline: true
                    },
                    {
                        name: '📅 Last Check',
                        value: status.lastCheck.getTime() > 0
                            ? `<t:${Math.floor(status.lastCheck.getTime() / 1000)}:R>`
                            : 'Never',
                        inline: true
                    },
                    {
                        name: '📢 Channel',
                        value: status.channelName ? `#${status.channelName}` : 'Not set',
                        inline: true
                    },
                    {
                        name: '⏱️ Poll Interval',
                        value: `${status.pollInterval} minutes`,
                        inline: true
                    }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('❌ Error in email status command:', error);
            await interaction.reply({
                content: '❌ Error retrieving email status.',
                ephemeral: true,
            });
        }
    }

    private async handleEmailTestCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            await interaction.deferReply({ ephemeral: true });

            const testResult = await (this as any).emailService?.testConnection();

            if (testResult) {
                await interaction.editReply({
                    content: '✅ Email connection test successful! Microsoft Graph API is working.',
                });
            } else {
                await interaction.editReply({
                    content: '❌ Email connection test failed. Check configuration and credentials.',
                });
            }

        } catch (error) {
            console.error('❌ Error in email test command:', error);
            await interaction.editReply({
                content: '❌ Error testing email connection.',
            });
        }
    }

    private async handleEmailRestartCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            await interaction.deferReply({ ephemeral: true });

            // Restart email service
            (this as any).emailService?.stop();
            await (this as any).emailService?.initialize();

            await interaction.editReply({
                content: '✅ Email forwarding service restarted successfully!',
            });

            console.log(`🔄 Email service restarted by ${interaction.user.tag}`);

        } catch (error) {
            console.error('❌ Error restarting email service:', error);
            await interaction.editReply({
                content: '❌ Error restarting email service.',
            });
        }
    }

    // Translations

    private async handleTranslateInfoCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setTitle('🌐 Translation System')
                .setDescription('React to any message with a flag emoji to translate it!')
                .setColor(0x4A90E2)
                .addFields(
                    {
                        name: '🏴 How to Use',
                        value: '1. Find a message you want translated\n2. React with a flag emoji (🇺🇸, 🇪🇸, 🇫🇷, etc.)\n3. The bot will translate and reply!',
                        inline: false
                    },
                    {
                        name: '🎭 Special Languages',
                        value: '🏴‍☠️ Pirate Speak\n🔮 Shakespearean\n🤖 Robot Speak\n👑 Royal Speech\n' +
                            '**Custom Emojis:** :uwu:',
                        inline: false
                    },
                    {
                        name: '🌍 Popular Flags',
                        value: '🇺🇸 English • 🇪🇸 Spanish • 🇫🇷 French • 🇩🇪 German\n' +
                            '🇮🇹 Italian • 🇯🇵 Japanese • 🇰🇷 Korean • 🇨🇳 Chinese\n' +
                            '🇷🇺 Russian • 🇵🇹 Portuguese • 🇳🇱 Dutch • 🇸🇪 Swedish',
                        inline: false
                    },
                    {
                        name: '⚡ Features',
                        value: '• Auto-detects source language\n• Supports 40+ languages\n• Fun custom language styles\n• Powered by OpenAI',
                        inline: false
                    }
                )
                .setFooter({ text: 'Translation results may vary • Powered by OpenAI' })
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error('❌ Error handling translate info command:', error);
            await interaction.reply({
                content: '❌ Error retrieving translation information.',
                ephemeral: true,
            });
        }
    }

    // Highlights
    private async handleHighlightCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        const subcommand = interaction.options.getSubcommand();
        const userId = interaction.user.id;
        const guildId = interaction.guildId!;

        try {
            switch (subcommand) {
                case 'add':
                    await this.handleHighlightAdd(interaction, userId, guildId);
                    break;
                case 'remove':
                    await this.handleHighlightRemove(interaction, userId, guildId);
                    break;
                case 'list':
                    await this.handleHighlightList(interaction, userId, guildId);
                    break;
                case 'clear':
                    await this.handleHighlightClear(interaction, userId, guildId);
                    break;
            }
        } catch (error) {
            console.error('❌ Error handling highlight command:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ An error occurred while processing the highlight command.',
                    ephemeral: true,
                });
            }
        }
    }

    private async handleHighlightAdd(
        interaction: ChatInputCommandInteraction,
        userId: string,
        guildId: string
    ): Promise<void> {
        const keyword = interaction.options.getString('keyword', true);

        const result = await this.highlightsService.addHighlight(userId, guildId, keyword);

        if (result.success) {
            await interaction.reply({
                content: `✅ Added highlight for \`${keyword}\`. You'll be notified when this word is mentioned!`,
                ephemeral: true,
            });
        } else {
            await interaction.reply({
                content: `❌ ${result.error}`,
                ephemeral: true,
            });
        }
    }

    private async handleHighlightRemove(
        interaction: ChatInputCommandInteraction,
        userId: string,
        guildId: string
    ): Promise<void> {
        const keyword = interaction.options.getString('keyword', true);

        const success = await this.highlightsService.removeHighlight(userId, guildId, keyword);

        if (success) {
            await interaction.reply({
                content: `✅ Removed highlight for \`${keyword}\`.`,
                ephemeral: true,
            });
        } else {
            await interaction.reply({
                content: `❌ You don't have a highlight for \`${keyword}\`.`,
                ephemeral: true,
            });
        }
    }

    private async handleHighlightList(
        interaction: ChatInputCommandInteraction,
        userId: string,
        guildId: string
    ): Promise<void> {
        const highlights = await this.highlightsService.getUserHighlights(userId, guildId);

        if (highlights.length === 0) {
            await interaction.reply({
                content: '📝 You don\'t have any highlights set up. Use `/highlight add` to add some!',
                ephemeral: true,
            });
            return;
        }

        const keywordsList = highlights
            .map((h, index) => `${index + 1}. \`${h.keyword}\``)
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle('🔍 Your Highlights')
            .setDescription(keywordsList)
            .setColor(0x00AE86)
            .setFooter({
                text: `${highlights.length}/50 highlights • Use /highlight remove to remove keywords`,
            })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    private async handleHighlightClear(
        interaction: ChatInputCommandInteraction,
        userId: string,
        guildId: string
    ): Promise<void> {
        const count = await this.highlightsService.clearUserHighlights(userId, guildId);

        if (count > 0) {
            await interaction.reply({
                content: `✅ Cleared all ${count} highlight keywords.`,
                ephemeral: true,
            });
        } else {
            await interaction.reply({
                content: '📝 You don\'t have any highlights to clear.',
                ephemeral: true,
            });
        }
    }

    private async handleHighlightStatsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const stats = await this.highlightsService.getStats(interaction.guildId!);

            const embed = new EmbedBuilder()
                .setTitle('📊 Highlight System Statistics')
                .setColor(0x5865F2)
                .addFields(
                    {
                        name: '🔍 Total Highlights',
                        value: stats.totalHighlights.toLocaleString(),
                        inline: true
                    },
                    {
                        name: '👥 Active Users',
                        value: stats.activeUsers.toLocaleString(),
                        inline: true
                    },
                    {
                        name: '📈 Average per User',
                        value: stats.activeUsers > 0
                            ? (stats.totalHighlights / stats.activeUsers).toFixed(1)
                            : '0',
                        inline: true
                    }
                )
                .setTimestamp()
                .setFooter({ text: 'Highlight System Statistics' });

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('❌ Error handling highlight stats command:', error);
            await interaction.reply({
                content: '❌ Error retrieving highlight statistics.',
                ephemeral: true,
            });
        }
    }
}