import { Client, GatewayIntentBits, Events, REST, Routes } from 'discord.js';
import { CONFIG } from '../config';
import { DatabaseManager } from '../database/DatabaseManager';
import { CommandHandler } from '../handlers/CommandHandler';
import { EventHandler } from '../handlers/EventHandler';
import { ModerationService } from '../services/ModerationService';
import { UnbanService } from '../services/UnbanService';
import { commands } from '../commands';

export class HoneypotBot {
    private client: Client;
    private database: DatabaseManager;
    private commandHandler: CommandHandler;
    private eventHandler: EventHandler;
    private moderationService: ModerationService;
    private unbanService: UnbanService;

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });

        // Initialize services
        this.database = new DatabaseManager();
        this.moderationService = new ModerationService(this.database);
        this.commandHandler = new CommandHandler(this.client, this.database);
        this.eventHandler = new EventHandler(this.moderationService);
        this.unbanService = new UnbanService(this.client, this.database);

        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Bot ready event
        this.client.once(Events.ClientReady, async () => {
            console.log(`✅ Bot is ready! Logged in as ${this.client.user?.tag}`);
            console.log(`🔍 Monitoring ${Object.keys(CONFIG.HONEYPOT_ROLES).length} honeypot roles`);
            console.log(`🔍 Monitoring ${CONFIG.HONEYPOT_CHANNELS.length} honeypot channels`);
            
            // Initialize database
            await this.database.initialize();
            
            // Register slash commands
            await this.registerCommands();
            
            // Start unban checker
            this.unbanService.start();
        });

        // Setup event handlers
        this.eventHandler.setupEventListeners(this.client);

        // Slash command interaction
        this.client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            await this.commandHandler.handleSlashCommand(interaction);
        });
    }

    private async registerCommands(): Promise<void> {
        if (!CONFIG.CLIENT_ID) {
            console.warn('⚠️ CLIENT_ID not provided, slash commands will not be registered');
            return;
        }

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
        
        this.unbanService.stop();
        await this.database.close();
        await this.client.destroy();
    }
}
