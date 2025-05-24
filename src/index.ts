import { Client, GatewayIntentBits, Events, GuildMember, Message, PartialGuildMember, SlashCommandBuilder, ChatInputCommandInteraction, REST, Routes } from 'discord.js';
import { config } from 'dotenv';
import pkg from 'pg';
const { Pool } = pkg;

// Load environment variables
config();

// Configuration
const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    
    // Database configuration
    DATABASE: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'honeypot_bot',
        user: process.env.DB_USER || 'honeypot_user',
        password: process.env.DB_PASSWORD || 'honeypot_password',
    },
    
    // Honeypot role IDs from environment (comma-separated)
    HONEYPOT_ROLES: process.env.HONEYPOT_ROLES?.split(',').map(id => id.trim()) || [],
    
    // Honeypot channel IDs from environment (comma-separated)
    HONEYPOT_CHANNELS: process.env.HONEYPOT_CHANNELS?.split(',').map(id => id.trim()) || [],
    
    // Role-specific ban durations (in milliseconds)
    ROLE_BAN_DURATIONS: {
        // Configure specific durations for each role ID
        [process.env.ROLE_3_MONTHS || '']: 3 * 30 * 24 * 60 * 60 * 1000, // 3 months
        [process.env.ROLE_1_YEAR || '']: 365 * 24 * 60 * 60 * 1000, // 1 year
        [process.env.ROLE_6_YEARS || '']: 6 * 365 * 24 * 60 * 60 * 1000, // 6 years
    },
    
    // Ban reason messages
    BAN_REASONS: {
        ROLE: 'Temporarily banned for acquiring honeypot role',
        CHANNEL: 'Permanently banned for posting in honeypot channel',
    },
    
    // Ban check interval (check every hour for expired bans)
    BAN_CHECK_INTERVAL: 60 * 60 * 1000, // 1 hour in milliseconds
};

interface TempBan {
    id: number;
    guild_id: string;
    user_id: string;
    user_tag: string;
    role_id: string;
    banned_at: Date;
    expires_at: Date;
    reason: string;
    active: boolean;
}

class HoneypotBot {
    private client: Client;
    private db: pkg.Pool;
    private banCheckInterval?: NodeJS.Timeout;

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });

        this.db = new Pool(CONFIG.DATABASE);
        this.setupEventListeners();
    }

    private async initializeDatabase(): Promise<void> {
        try {
            // Create temporary bans table
            await this.db.query(`
                CREATE TABLE IF NOT EXISTS temp_bans (
                    id SERIAL PRIMARY KEY,
                    guild_id VARCHAR(20) NOT NULL,
                    user_id VARCHAR(20) NOT NULL,
                    user_tag VARCHAR(100) NOT NULL,
                    role_id VARCHAR(20),
                    banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    reason TEXT NOT NULL,
                    active BOOLEAN DEFAULT TRUE,
                    UNIQUE(guild_id, user_id, active)
                );
            `);

            // Create index for faster queries
            await this.db.query(`
                CREATE INDEX IF NOT EXISTS idx_temp_bans_expires 
                ON temp_bans(expires_at, active) 
                WHERE active = TRUE;
            `);

            console.log('✅ Database initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize database:', error);
            throw error;
        }
    }

    private setupEventListeners(): void {
        // Bot ready event
        this.client.once(Events.ClientReady, async () => {
            console.log(`✅ Bot is ready! Logged in as ${this.client.user?.tag}`);
            console.log(`🔍 Monitoring ${CONFIG.HONEYPOT_ROLES.length} honeypot roles`);
            console.log(`🔍 Monitoring ${CONFIG.HONEYPOT_CHANNELS.length} honeypot channels`);
            
            // Initialize database
            await this.initializeDatabase();
            
            // Register slash commands
            await this.registerCommands();
            
            // Start ban check interval
            this.startBanCheckInterval();
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
                .setDescription('Show active temporary bans')
                .toJSON(),
            new SlashCommandBuilder()
                .setName('unban')
                .setDescription('Manually unban a user')
                .addStringOption(option =>
                    option.setName('userid')
                        .setDescription('User ID to unban')
                        .setRequired(true))
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
                const activeBans = await this.getActiveTempBansCount();
                await interaction.reply({
                    content: `🏓 Pong! Bot latency: ${ping}ms\n` +
                            `📊 Monitoring:\n` +
                            `• ${CONFIG.HONEYPOT_ROLES.length} honeypot roles\n` +
                            `• ${CONFIG.HONEYPOT_CHANNELS.length} honeypot channels\n` +
                            `• ${activeBans} active temporary bans`,
                    ephemeral: true,
                });
            } else if (interaction.commandName === 'tempbans') {
                const bans = await this.getActiveTempBans(interaction.guild!.id);
                if (bans.length === 0) {
                    await interaction.reply({ content: '📝 No active temporary bans', ephemeral: true });
                    return;
                }

                const banList = bans.slice(0, 10).map((ban, i) => 
                    `${i + 1}. <@${ban.user_id}> (${ban.user_tag}) - Expires <t:${Math.floor(ban.expires_at.getTime() / 1000)}:R>`
                ).join('\n');

                await interaction.reply({ 
                    content: `📝 Active temporary bans (${bans.length}):\n${banList}${bans.length > 10 ? '\n... and more' : ''}`, 
                    ephemeral: true 
                });
            } else if (interaction.commandName === 'unban') {
                const userId = interaction.options.getString('userid', true);
                await this.manualUnban(interaction.guild!.id, userId);
                await interaction.reply({ content: `✅ Attempted to unban user ${userId}`, ephemeral: true });
            }
        } catch (error) {
            console.error('❌ Error handling slash command:', error);
            await interaction.reply({ content: '❌ An error occurred', ephemeral: true }).catch(() => {});
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
            const honeypotRoleAdded = addedRoles.find(roleId => CONFIG.HONEYPOT_ROLES.includes(roleId));

            if (honeypotRoleAdded) {
                console.log(`🚨 Honeypot role detected for user: ${newMember.user.tag} (${newMember.id})`);
                await this.tempBanMember(newMember, honeypotRoleAdded);
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
                    await this.permanentBanMember(member, CONFIG.BAN_REASONS.CHANNEL);
                }
            }
        } catch (error) {
            console.error('❌ Error handling message:', error);
        }
    }

    private async tempBanMember(member: GuildMember, roleId: string): Promise<void> {
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

            // Get ban duration for this role
            const banDuration = CONFIG.ROLE_BAN_DURATIONS[roleId];
            if (!banDuration) {
                console.error(`❌ No ban duration configured for role ${roleId}`);
                return;
            }

            const expiresAt = new Date(Date.now() + banDuration);

            // Ban the member
            await member.ban({
                reason: CONFIG.BAN_REASONS.ROLE,
                deleteMessageSeconds: 86400,
            });

            // Store in database
            await this.db.query(`
                INSERT INTO temp_bans (guild_id, user_id, user_tag, role_id, expires_at, reason)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (guild_id, user_id, active) 
                DO UPDATE SET expires_at = $5, role_id = $4
            `, [member.guild.id, member.id, member.user.tag, roleId, expiresAt, CONFIG.BAN_REASONS.ROLE]);

            const durationText = this.formatDuration(banDuration);
            console.log(`⏱️ Successfully temp banned ${member.user.tag} (${member.id}) for ${durationText} - Role: ${roleId}`);

            // Log the ban
            await this.logTempBan(member, expiresAt, roleId, CONFIG.BAN_REASONS.ROLE);

        } catch (error) {
            console.error(`❌ Failed to temp ban ${member.user.tag}:`, error);
        }
    }

    private async permanentBanMember(member: GuildMember, reason: string): Promise<void> {
        try {
            // Check permissions
            if (!member.guild.members.me?.permissions.has('BanMembers')) {
                console.error('❌ Bot does not have permission to ban members');
                return;
            }

            if (!member.bannable) {
                console.error(`❌ Cannot ban ${member.user.tag} - insufficient permissions or higher role`);
                return;
            }

            // Ban the member permanently
            await member.ban({
                reason: reason,
                deleteMessageSeconds: 86400,
            });

            console.log(`🔨 Successfully permanently banned ${member.user.tag} (${member.id}) - Reason: ${reason}`);

            // Log the ban
            await this.logPermanentBan(member, reason);

        } catch (error) {
            console.error(`❌ Failed to permanently ban ${member.user.tag}:`, error);
        }
    }

    private startBanCheckInterval(): void {
        this.banCheckInterval = setInterval(async () => {
            await this.checkExpiredBans();
        }, CONFIG.BAN_CHECK_INTERVAL);

        console.log(`⏰ Started ban check interval (every ${CONFIG.BAN_CHECK_INTERVAL / 60000} minutes)`);
    }

    private async checkExpiredBans(): Promise<void> {
        try {
            const result = await this.db.query(`
                SELECT * FROM temp_bans 
                WHERE active = TRUE AND expires_at <= NOW()
            `);

            const expiredBans: TempBan[] = result.rows;

            for (const ban of expiredBans) {
                await this.unbanUser(ban);
            }

            if (expiredBans.length > 0) {
                console.log(`✅ Processed ${expiredBans.length} expired bans`);
            }
        } catch (error) {
            console.error('❌ Error checking expired bans:', error);
        }
    }

    private async unbanUser(ban: TempBan): Promise<void> {
        try {
            const guild = this.client.guilds.cache.get(ban.guild_id);
            if (!guild) {
                console.warn(`⚠️ Guild ${ban.guild_id} not found for unban`);
                return;
            }

            // Unban the user
            await guild.members.unban(ban.user_id, 'Temporary ban expired');

            // Mark as inactive in database
            await this.db.query(`
                UPDATE temp_bans 
                SET active = FALSE 
                WHERE id = $1
            `, [ban.id]);

            console.log(`✅ Unbanned ${ban.user_tag} (${ban.user_id}) - ban expired`);

            // Log the unban
            await this.logUnban(guild, ban);

        } catch (error) {
            console.error(`❌ Failed to unban ${ban.user_tag}:`, error);
        }
    }

    private async manualUnban(guildId: string, userId: string): Promise<void> {
        try {
            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) return;

            await guild.members.unban(userId, 'Manual unban via command');

            // Mark as inactive in database
            await this.db.query(`
                UPDATE temp_bans 
                SET active = FALSE 
                WHERE guild_id = $1 AND user_id = $2 AND active = TRUE
            `, [guildId, userId]);

            console.log(`✅ Manually unbanned user ${userId}`);
        } catch (error) {
            console.error(`❌ Failed to manually unban ${userId}:`, error);
        }
    }

    private async getActiveTempBansCount(): Promise<number> {
        const result = await this.db.query('SELECT COUNT(*) FROM temp_bans WHERE active = TRUE');
        return parseInt(result.rows[0].count);
    }

    private async getActiveTempBans(guildId: string): Promise<TempBan[]> {
        const result = await this.db.query(`
            SELECT * FROM temp_bans 
            WHERE guild_id = $1 AND active = TRUE 
            ORDER BY expires_at ASC
        `, [guildId]);
        return result.rows;
    }

    private formatDuration(ms: number): string {
        const years = Math.floor(ms / (365 * 24 * 60 * 60 * 1000));
        const months = Math.floor((ms % (365 * 24 * 60 * 60 * 1000)) / (30 * 24 * 60 * 60 * 1000));
        const days = Math.floor((ms % (30 * 24 * 60 * 60 * 1000)) / (24 * 60 * 60 * 1000));

        if (years > 0) return `${years} year${years > 1 ? 's' : ''}`;
        if (months > 0) return `${months} month${months > 1 ? 's' : ''}`;
        return `${days} day${days > 1 ? 's' : ''}`;
    }

    private async logTempBan(member: GuildMember, expiresAt: Date, roleId: string, reason: string): Promise<void> {
        // Optional logging - uncomment if you want to log to a channel
        /*
        const logChannelId = process.env.LOG_CHANNEL_ID;
        if (!logChannelId) return;
        
        const logChannel = member.guild.channels.cache.get(logChannelId);
        if (logChannel && logChannel.isTextBased()) {
            await logChannel.send({
                embeds: [{
                    title: '⏱️ Automatic Temporary Ban',
                    color: 0xffa500,
                    fields: [
                        { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                        { name: 'Role ID', value: roleId, inline: true },
                        { name: 'Expires', value: `<t:${Math.floor(expiresAt.getTime() / 1000)}:F>`, inline: true },
                        { name: 'Reason', value: reason, inline: false },
                    ],
                }],
            });
        }
        */
    }

    private async logPermanentBan(member: GuildMember, reason: string): Promise<void> {
        // Optional logging - uncomment if you want to log to a channel
        /*
        const logChannelId = process.env.LOG_CHANNEL_ID;
        if (!logChannelId) return;
        
        const logChannel = member.guild.channels.cache.get(logChannelId);
        if (logChannel && logChannel.isTextBased()) {
            await logChannel.send({
                embeds: [{
                    title: '🔨 Automatic Permanent Ban',
                    color: 0xff0000,
                    fields: [
                        { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
                        { name: 'Reason', value: reason, inline: true },
                        { name: 'Time', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    ],
                }],
            });
        }
        */
    }

    private async logUnban(guild: any, ban: TempBan): Promise<void> {
        // Optional logging - uncomment if you want to log to a channel
        /*
        const logChannelId = process.env.LOG_CHANNEL_ID;
        if (!logChannelId) return;
        
        const logChannel = guild.channels.cache.get(logChannelId);
        if (logChannel && logChannel.isTextBased()) {
            await logChannel.send({
                embeds: [{
                    title: '✅ Automatic Unban',
                    color: 0x00ff00,
                    fields: [
                        { name: 'User', value: `${ban.user_tag} (${ban.user_id})`, inline: true },
                        { name: 'Original Ban', value: `<t:${Math.floor(ban.banned_at.getTime() / 1000)}:F>`, inline: true },
                        { name: 'Unbanned', value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
                    ],
                }],
            });
        }
        */
    }

    public async start(): Promise<void> {
        if (!CONFIG.TOKEN) {
            console.error('❌ DISCORD_TOKEN not found in environment variables');
            process.exit(1);
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
        if (this.banCheckInterval) {
            clearInterval(this.banCheckInterval);
        }
        await this.db.end();
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