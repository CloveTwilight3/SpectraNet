import { ChatInputCommandInteraction, EmbedBuilder, User, GuildMember } from 'discord.js';
import { CONFIG } from '../config';
import { DatabaseManager } from '../database/DatabaseManager';

export class CommandHandler {
    constructor(private client: any, private database: DatabaseManager) {}

    async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            switch (interaction.commandName) {
                case 'ping':
                    await this.handlePingCommand(interaction);
                    break;
                case 'tempbans':
                    await this.handleTempBansCommand(interaction);
                    break;
                case 'userinfo':
                    await this.handleUserInfoCommand(interaction);
                    break;
            }
        } catch (error) {
            console.error('❌ Error handling slash command:', error);
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
}
