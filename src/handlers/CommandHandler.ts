// src/handlers/CommandHandler.ts
import { ChatInputCommandInteraction, EmbedBuilder, User, GuildMember } from 'discord.js';
import { CONFIG } from '../config';
import { DatabaseManager } from '../database/DatabaseManager';
import { XPService } from '../services/XPService';

export class CommandHandler {
    private xpService: XPService;

    constructor(private client: any, private database: DatabaseManager) {
        this.xpService = new XPService(database);
    }

    async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            switch (interaction.commandName) {
                // Existing commands
                case 'ping':
                    await this.handlePingCommand(interaction);
                    break;
                case 'tempbans':
                    await this.handleTempBansCommand(interaction);
                    break;
                case 'userinfo':
                    await this.handleUserInfoCommand(interaction);
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

        await interaction.reply({
            content: `🏓 Pong! Bot latency: ${ping}ms\n` +
                    `📊 Monitoring:\n` +
                    `• ${Object.keys(CONFIG.HONEYPOT_ROLES).length} honeypot roles\n` +
                    `• ${CONFIG.HONEYPOT_CHANNELS.length} honeypot channels\n\n` +
                    `⚙️ Role Configurations:\n${roleConfigs || 'None configured'}`,
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
}
