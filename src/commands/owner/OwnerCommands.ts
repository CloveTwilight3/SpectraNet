// src/commands/owner/OwnerCommands.ts
import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { DatabaseManager } from '../../database/DatabaseManager';
import { XPService } from '../../services/XPService';

const OWNER_ID = '1025770042245251122';

// Console error storage for debug command
class ErrorLogger {
    private static errors: Array<{ timestamp: Date; error: string; stack?: string }> = [];
    private static maxErrors = 50;

    static logError(error: any): void {
        this.errors.push({
            timestamp: new Date(),
            error: error.toString(),
            stack: error.stack
        });

        if (this.errors.length > this.maxErrors) {
            this.errors = this.errors.slice(-this.maxErrors);
        }
    }

    static getRecentErrors(count: number = 10): Array<{ timestamp: Date; error: string; stack?: string }> {
        return this.errors.slice(-count);
    }

    static clearErrors(): void {
        this.errors = [];
    }
}

// Override console.error to capture errors
const originalConsoleError = console.error;
console.error = (...args: any[]): void => {
    originalConsoleError(...args);
    ErrorLogger.logError(args.join(' '));
};

// Utility function to check if user is owner
function isOwner(userId: string): boolean {
    return userId === OWNER_ID;
}

// Echo command
export const echoCommand = {
    data: new SlashCommandBuilder()
        .setName('echo')
        .setDescription('[OWNER ONLY] Send message as bot')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Message to send')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('reply_to')
                .setDescription('Message ID to reply to (optional)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction, database: DatabaseManager): Promise<void> {
        if (!isOwner(interaction.user.id)) {
            await interaction.reply({ 
                content: '❌ This command is restricted to bot owner.', 
                ephemeral: true 
            });
            return;
        }

        const message = interaction.options.getString('message', true);
        const replyToId = interaction.options.getString('reply_to');

        try {
            await interaction.reply({ 
                content: '✅ Message sent!', 
                ephemeral: true 
            });

            if (replyToId) {
                try {
                    const targetMessage = await interaction.channel?.messages.fetch(replyToId);
                    if (targetMessage) {
                        await targetMessage.reply(message);
                    } else {
                        await interaction.followUp({ 
                            content: '❌ Could not find message with that ID.', 
                            ephemeral: true 
                        });
                    }
                } catch (error) {
                    await interaction.followUp({ 
                        content: '❌ Could not find message with that ID.', 
                        ephemeral: true 
                    });
                }
            } else {
                if (interaction.channel && 'send' in interaction.channel) {
                    await interaction.channel.send(message);
                }
            }
        } catch (error) {
            console.error('Error in echo command:', error);
            await interaction.followUp({ 
                content: '❌ Failed to send message.', 
                ephemeral: true 
            });
        }
    }
};

// Debug command (no changes needed)
export const debugCommand = {
    data: new SlashCommandBuilder()
        .setName('debug')
        .setDescription('[OWNER ONLY] Get recent console errors via DM')
        .addIntegerOption(option =>
            option.setName('count')
                .setDescription('Number of recent errors to retrieve (default: 10, max: 25)')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false)
        )
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction, database: DatabaseManager): Promise<void> {
        if (!isOwner(interaction.user.id)) {
            await interaction.reply({ 
                content: '❌ This command is restricted to bot owner.', 
                ephemeral: true 
            });
            return;
        }

        const count = interaction.options.getInteger('count') || 10;
        const recentErrors = ErrorLogger.getRecentErrors(count);

        try {
            await interaction.reply({ 
                content: '✅ Sending debug info to your DMs...', 
                ephemeral: true 
            });

            const user = await interaction.client.users.fetch(OWNER_ID);
            
            if (recentErrors.length === 0) {
                const embed = new EmbedBuilder()
                    .setTitle('🐛 Debug Report')
                    .setDescription('No recent errors found!')
                    .setColor(0x00ff00)
                    .setTimestamp();

                await user.send({ embeds: [embed] });
            } else {
                const chunks = [];
                let currentChunk = '';
                
                for (const error of recentErrors) {
                    const errorText = `**${error.timestamp.toISOString()}**\n\`\`\`\n${error.error}\n\`\`\`\n`;
                    
                    if (currentChunk.length + errorText.length > 1800) {
                        if (currentChunk) chunks.push(currentChunk);
                        currentChunk = errorText;
                    } else {
                        currentChunk += errorText;
                    }
                }
                if (currentChunk) chunks.push(currentChunk);

                const headerEmbed = new EmbedBuilder()
                    .setTitle('🐛 Debug Report')
                    .setDescription(`Found ${recentErrors.length} recent errors:`)
                    .setColor(0xff0000)
                    .setTimestamp();

                await user.send({ embeds: [headerEmbed] });

                for (const chunk of chunks) {
                    await user.send(chunk);
                }
            }
        } catch (error) {
            console.error('Error in debug command:', error);
            await interaction.followUp({ 
                content: '❌ Failed to send debug info.', 
                ephemeral: true 
            });
        }
    }
};

// Database command - Updated for PostgreSQL
export const dbCommand = {
    data: new SlashCommandBuilder()
        .setName('db')
        .setDescription('[OWNER ONLY] Get database contents via DM')
        .addStringOption(option =>
            option.setName('table')
                .setDescription('Specific table to query (optional)')
                .setRequired(false)
        )
        .setDefaultMemberPermissions(null),

    async execute(interaction: ChatInputCommandInteraction, database: DatabaseManager): Promise<void> {
        if (!isOwner(interaction.user.id)) {
            await interaction.reply({ 
                content: '❌ This command is restricted to bot owner.', 
                ephemeral: true 
            });
            return;
        }

        const specificTable = interaction.options.getString('table');

        try {
            await interaction.reply({ 
                content: '✅ Gathering database info and sending to your DMs...', 
                ephemeral: true 
            });

            const user = await interaction.client.users.fetch(OWNER_ID);
            
            if (specificTable) {
                // Validate table name to prevent SQL injection
                const validTables = ['temp_bans', 'user_xp', 'level_roles'];
                if (!validTables.includes(specificTable)) {
                    await user.send('❌ Invalid table name. Valid tables: ' + validTables.join(', '));
                    return;
                }

                const results = await database.query(`SELECT * FROM ${specificTable} LIMIT 50`);
                
                const embed = new EmbedBuilder()
                    .setTitle(`📊 Database: ${specificTable}`)
                    .setDescription(`Showing up to 50 rows from ${specificTable}`)
                    .setColor(0x0099ff)
                    .setTimestamp();

                await user.send({ embeds: [embed] });

                if (results.length > 0) {
                    const dataStr = JSON.stringify(results, null, 2);
                    
                    if (dataStr.length > 1800) {
                        const chunks = dataStr.match(/.{1,1800}/g) || [];
                        for (const chunk of chunks) {
                            await user.send(`\`\`\`json\n${chunk}\n\`\`\``);
                        }
                    } else {
                        await user.send(`\`\`\`json\n${dataStr}\n\`\`\``);
                    }
                } else {
                    await user.send('No data found in this table.');
                }
            } else {
                // Get all tables overview using PostgreSQL system tables
                const tables = await database.query(`
                    SELECT table_name as name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                `);

                const embed = new EmbedBuilder()
                    .setTitle('📊 Database Overview')
                    .setColor(0x0099ff)
                    .setTimestamp();

                for (const table of tables) {
                    const count = await database.query(`SELECT COUNT(*) as count FROM ${table.name}`);
                    embed.addFields({
                        name: table.name,
                        value: `${count[0].count} rows`,
                        inline: true
                    });
                }

                await user.send({ embeds: [embed] });

                // Send sample data from each table
                for (const table of tables) {
                    const sampleData = await database.query(`SELECT * FROM ${table.name} LIMIT 5`);
                    if (sampleData.length > 0) {
                        const dataStr = JSON.stringify(sampleData, null, 2);
                        await user.send(`**${table.name} (sample):**\n\`\`\`json\n${dataStr.substring(0, 1800)}\n\`\`\``);
                    }
                }
            }
        } catch (error) {
            console.error('Error in db command:', error);
            await interaction.followUp({ 
                content: '❌ Failed to retrieve database info.', 
                ephemeral: true 
            });
        }
    }
};

// Level top command - Updated for PostgreSQL
export const leveltopCommand = {
    data: new SlashCommandBuilder()
        .setName('leveltop')
        .setDescription('[OWNER ONLY] Set your XP to be just above current leader')
        .setDefaultMemberPermissions(null),

    async execute(
        interaction: ChatInputCommandInteraction, 
        database: DatabaseManager, 
        xpService: XPService
    ): Promise<void> {
        if (!isOwner(interaction.user.id)) {
            await interaction.reply({ 
                content: '❌ This command is restricted to bot owner.', 
                ephemeral: true 
            });
            return;
        }

        try {
            const topUsers = await database.query(`
                SELECT user_id, xp, level 
                FROM user_xp 
                WHERE guild_id = $1 
                ORDER BY xp DESC 
                LIMIT 5
            `, [interaction.guildId]);

            if (topUsers.length === 0) {
                await interaction.reply({ 
                    content: '❌ No users found in XP database.', 
                    ephemeral: true 
                });
                return;
            }

            const currentLeader = topUsers[0];

            if (currentLeader.user_id === OWNER_ID) {
                await interaction.reply({ 
                    content: `✅ You're already top user with **${currentLeader.xp}** XP (Level ${currentLeader.level})!`, 
                    ephemeral: true 
                });
                return;
            }

            const newXP = currentLeader.xp + 100;
            const newLevel = xpService.calculateLevel(newXP);

            // Use PostgreSQL UPSERT syntax
            await database.query(`
                INSERT INTO user_xp (user_id, guild_id, xp, level, last_message_at, last_xp_gain, updated_at)
                VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())
                ON CONFLICT (user_id, guild_id)
                DO UPDATE SET 
                    xp = $3,
                    level = $4,
                    updated_at = NOW()
            `, [OWNER_ID, interaction.guildId, newXP, newLevel]);

            const embed = new EmbedBuilder()
                .setTitle('🏆 Level Boost Complete!')
                .setDescription('You are now top user!')
                .addFields(
                    { 
                        name: 'Previous Leader', 
                        value: `<@${currentLeader.user_id}>\n**${currentLeader.xp}** XP (Level ${currentLeader.level})`, 
                        inline: true 
                    },
                    { 
                        name: 'Your New Stats', 
                        value: `<@${OWNER_ID}>\n**${newXP}** XP (Level ${newLevel})`, 
                        inline: true 
                    }
                )
                .setColor(0xffd700)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Error in leveltop command:', error);
            await interaction.reply({ 
                content: '❌ Failed to update your level.', 
                ephemeral: true 
            });
        }
    }
};

export const ownerCommands = [
    echoCommand,
    debugCommand,
    dbCommand,
    leveltopCommand
];

export { ErrorLogger };