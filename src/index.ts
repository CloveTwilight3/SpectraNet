import { Client, GatewayIntentBits, Events, GuildMember, Message, PartialGuildMember, SlashCommandBuilder, ChatInputCommandInteraction, REST, Routes, EmbedBuilder } from 'discord.js';
import { config } from 'dotenv';
import { Pool } from 'pg';

// Load environment variables
config();

// Database configuration
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'honeypot_bot',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
});

// Configuration
const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    
    // Honeypot role IDs and their punishments from environment
    HONEYPOT_ROLES: (() => {
        const roles: { [key: string]: { duration: number; type: 'timeout' | 'tempban' } } = {};
        
        // Parse role configurations from environment
        // Format: ROLE_ID:DURATION_DAYS,ROLE_ID:DURATION_DAYS
        const roleConfig = process.env.HONEYPOT_ROLES_CONFIG || '';
        roleConfig.split(',').forEach(config => {
            const [roleId, durationStr] = config.trim().split(':');
            if (roleId && durationStr) {
                const durationDays = parseInt(durationStr);
                const durationMs = durationDays * 24 * 60 * 60 * 1000;
                
                roles[roleId] = {
                    duration: durationMs,
                    type: durationDays <= 28 ? 'timeout' : 'tempban'
                };
            }
        });
        
        return roles;
    })(),
    
    // Honeypot channel IDs from environment (comma-separated)
    HONEYPOT_CHANNELS: process.env.HONEYPOT_CHANNELS?.split(',').map(id => id.trim()) || [],
    
    // Ban reason messages
    BAN_REASONS: {
        ROLE_TIMEOUT: 'Temporarily timed out for acquiring honeypot role',
        ROLE_TEMPBAN: 'Temporarily banned for acquiring honeypot role',
        CHANNEL: 'Permanently banned for posting in honeypot channel',
    },
};

interface TempBan {
    id: number;
    user_id: string;
    guild_id: string;
    role_id: string;
    banned_at: Date;
    unban_at: Date;
    reason: string;
    active: boolean;
}

class HoneypotBot {
    private client: Client;
    private checkInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });

        this.setupEventListeners();
    }

    private async initializeDatabase(): Promise<void> {
        try {
            // Create temp_bans table if it doesn't exist
            await pool.query(`
                CREATE TABLE IF NOT EXISTS temp_bans (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    role_id VARCHAR(20),
                    banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    unban_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    reason TEXT,
                    active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `);

            // Create index for faster queries
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_temp_bans_active_unban 
                ON temp_bans (active, unban_at) 
                WHERE active = true;
            `);

            console.log('✅ Database initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize database:', error);
            process.exit(1);
        }
    }

    private setupEventListeners(): void {
        // Bot ready event
        this.client.once(Events.ClientReady, async () => {
            console.log(`✅ Bot is ready! Logged in as ${this.client.user?.tag}`);
            console.log(`🔍 Monitoring ${Object.keys(CONFIG.HONEYPOT_ROLES).length} honeypot roles`);
            console.log(`🔍 Monitoring ${CONFIG.HONEYPOT_CHANNELS.length} honeypot channels`);
            
            // Initialize database
            await this.initializeDatabase();
            
            // Register slash commands
            await this.registerCommands();
            
            // Start checking for unbans every minute
            this.startUnbanChecker();
        });

        // Member role update event
        this.client.on(Events.GuildMemberUpdate, async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
            await this.handleRoleUpdate(oldMember, newMember);
        });

        // Message creation event
        this.client.on(Events.MessageCreate, async (message: Message) => {
            await this.handleMessage(message);
        });

        // Slash command interaction
        this.client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            await this.handleSlashCommand(interaction);
        });

        // Error handling
        this.client.on('error', (error) => {
            console.error('❌ Discord client error:', error);
        });

        process.on('unhandledRejection', (error) => {
            console.error('❌ Unhandled promise rejection:', error);
        });
    }

    private async registerCommands(): Promise<void> {
        if (!CONFIG.CLIENT_ID) {
            console.warn('⚠️ CLIENT_ID not provided, slash commands will not be registered');
            return;
        }

        const commands = [
            new SlashCommandBuilder()
                .setName('ping')
                .setDescription('Test command to check if the bot is responsive')
                .toJSON(),
            new SlashCommandBuilder()
                .setName('tempbans')
                .setDescription('View active temporary bans')
                .toJSON(),
        ];

        try {
            const rest = new REST().setToken(CONFIG.TOKEN!);
            
            console.log('🔄 Started refreshing application (/) commands.');

            await rest.put(
                Routes.applicationCommands(CONFIG.CLIENT_ID),
                { body: commands },
            );

            console.log('✅ Successfully reloaded application (/) commands.');
        } catch (error) {
            console.error('❌ Error registering slash commands:', error);
        }
    }

    private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            if (interaction.commandName === 'ping') {
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
            } else if (interaction.commandName === 'tempbans') {
                await this.handleTempBansCommand(interaction);
            }
        } catch (error) {
            console.error('❌ Error handling slash command:', error);
        }
    }

    private async handleTempBansCommand(interaction: ChatInputCommandInteraction): Promise<void> {
        try {
            const result = await pool.query(`
                SELECT user_id, role_id, banned_at, unban_at, reason 
                FROM temp_bans 
                WHERE guild_id = $1 AND active = true 
                ORDER BY unban_at ASC 
                LIMIT 10
            `, [interaction.guildId]);

            if (result.rows.length === 0) {
                await interaction.reply({
                    content: '✅ No active temporary bans found.',
                    ephemeral: true,
                });
                return;
            }

            const bans = result.rows.map(row => {
                const unbanTimestamp = Math.floor(new Date(row.unban_at).getTime() / 1000);
                return `<@${row.user_id}> - Unbans <t:${unbanTimestamp}:R> (Role: <@&${row.role_id}>)`;
            }).join('\n');

            await interaction.reply({
                content: `📋 **Active Temporary Bans:**\n${bans}`,
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
                    await this.timeoutMember(newMember, honeypotRoleAdded, roleConfig.duration);
                } else {
                    await this.tempBanMember(newMember, honeypotRoleAdded, roleConfig.duration);
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
                    await this.banMember(member, CONFIG.BAN_REASONS.CHANNEL);
                }
            }
        } catch (error) {
            console.error('❌ Error handling message:', error);
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
                .setColor(0xFFD6E4) // Red color
                .setTimestamp();

            await member.send({ embeds: [embed] });
            console.log(`📧 Successfully sent ban DM to ${member.user.tag}`);
        } catch (error) {
            console.warn(`⚠️ Failed to send ban DM to ${member.user.tag}:`, error);
            // Don't throw error - DM failure shouldn't prevent the ban
        }
    }

    private async timeoutMember(member: GuildMember, roleId: string, duration: number): Promise<void> {
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

            // Log to database for tracking
            await this.logPunishment(member, roleId, duration, 'timeout');

        } catch (error) {
            console.error(`❌ Failed to timeout ${member.user.tag}:`, error);
        }
    }

    private async tempBanMember(member: GuildMember, roleId: string, duration: number): Promise<void> {
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
            await pool.query(`
                INSERT INTO temp_bans (user_id, guild_id, role_id, unban_at, reason, active)
                VALUES ($1, $2, $3, $4, $5, true)
            `, [member.user.id, member.guild.id, roleId, unbanAt, CONFIG.BAN_REASONS.ROLE_TEMPBAN]);

        } catch (error) {
            console.error(`❌ Failed to temp-ban ${member.user.tag}:`, error);
        }
    }

    private async banMember(member: GuildMember, reason: string): Promise<void> {
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

    private async logPunishment(member: GuildMember, roleId: string, duration: number, type: string): Promise<void> {
        // Optional: Log punishments to database or channel
        console.log(`📊 Punishment logged: ${member.user.tag} - ${type} - ${Math.round(duration / (24 * 60 * 60 * 1000))} days`);
    }

    private startUnbanChecker(): void {
        // Check for unbans every minute
        this.checkInterval = setInterval(async () => {
            try {
                const result = await pool.query(`
                    SELECT * FROM temp_bans 
                    WHERE active = true AND unban_at <= NOW()
                `);

                for (const ban of result.rows) {
                    await this.processUnban(ban);
                }
            } catch (error) {
                console.error('❌ Error checking for unbans:', error);
            }
        }, 60 * 1000); // Check every minute
    }

    private async processUnban(ban: TempBan): Promise<void> {
        try {
            const guild = this.client.guilds.cache.get(ban.guild_id);
            if (!guild) {
                console.warn(`⚠️ Guild ${ban.guild_id} not found for unban`);
                return;
            }

            // Try to unban the user
            try {
                await guild.members.unban(ban.user_id, 'Temporary ban expired');
                console.log(`✅ Successfully unbanned user ${ban.user_id} from guild ${ban.guild_id}`);
            } catch (error) {
                console.warn(`⚠️ Failed to unban user ${ban.user_id}:`, error);
            }

            // Mark as inactive in database
            await pool.query(`
                UPDATE temp_bans 
                SET active = false 
                WHERE id = $1
            `, [ban.id]);

        } catch (error) {
            console.error('❌ Error processing unban:', error);
        }
    }

    public async start(): Promise<void> {
        if (!CONFIG.TOKEN) {
            console.error('❌ DISCORD_TOKEN not found in environment variables');
            process.exit(1);
        }

        if (Object.keys(CONFIG.HONEYPOT_ROLES).length === 0) {
            console.warn('⚠️ No honeypot roles configured');
        }

        if (CONFIG.HONEYPOT_CHANNELS.length === 0) {
            console.warn('⚠️ No honeypot channels configured');
        }

        try {
            await this.client.login(CONFIG.TOKEN);
        } catch (error) {
            console.error('❌ Failed to login:', error);
            process.exit(1);
        }
    }

    public async stop(): Promise<void> {
        console.log('🛑 Shutting down bot...');
        
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
        }
        
        await pool.end();
        await this.client.destroy();
    }
}

// Initialize and start the bot
const bot = new HoneypotBot();

// Graceful shutdown handling
process.on('SIGINT', async () => {
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await bot.stop();
    process.exit(0);
});

// Start the bot
bot.start().catch(console.error);

export default HoneypotBot;