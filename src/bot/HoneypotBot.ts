// src/bot/HoneypotBot.ts
import { 
    Client, 
    GatewayIntentBits, 
    Events, 
    REST, 
    Routes 
} from 'discord.js';
import { CONFIG } from '../config';
import { DatabaseManager } from '../database/DatabaseManager';
import { CommandHandler } from '../handlers/CommandHandler';
import { EventHandler } from '../handlers/EventHandler';
import { ModerationService } from '../services/ModerationService';
import { ManualUnbanService } from '../services/ManualUnbanService';
import { UnbanService } from '../services/UnbanService';
import { XPService } from '../services/XPService';
import { OnboardingDetectionService } from '../services/OnboardingDetectionService';
import { LoggingService } from '../services/LoggingService';
import { TTSService } from '../services/TTSService';
import { SchedulerService } from '../services/SchedulerService';
import { commands } from '../commands';
import { ownerCommands, ErrorLogger } from '../commands/owner/OwnerCommands';
import { EmailService } from '../services/EmailService';

export class HoneypotBot {
    private client: Client;
    private database!: DatabaseManager;
    private commandHandler!: CommandHandler;
    private eventHandler!: EventHandler;
    private moderationService!: ModerationService;
    private manualUnbanService!: ManualUnbanService;
    private unbanService!: UnbanService;
    private xpService!: XPService;
    private onboardingService!: OnboardingDetectionService;
    private loggingService!: LoggingService;
    private schedulerService!: SchedulerService;
    private ttsService!: TTSService;
    private emailService!: EmailService;

    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildVoiceStates, // Added for voice channel detection
            ],
        });

        this.initializeServices();
        this.connectServices();
        this.setupEventListeners();
    }

    private initializeServices(): void {
        console.log('🔧 Initializing services...');
        
        this.database = new DatabaseManager();
        this.loggingService = new LoggingService(this.client);
        this.moderationService = new ModerationService(this.database);
        this.manualUnbanService = new ManualUnbanService(this.database, this.moderationService);
        this.xpService = new XPService(this.database);
        this.onboardingService = new OnboardingDetectionService(this.client);
        this.unbanService = new UnbanService(this.client, this.database);
        this.schedulerService = new SchedulerService(this.client);
        this.ttsService = new TTSService();
        this.emailService = new EmailService(this.client);
        
        // Initialize handlers after all services are created
        this.commandHandler = new CommandHandler(
            this.client,
            this.database,
            this.moderationService,
            this.ttsService,
            this.emailService
        );
        this.eventHandler = new EventHandler(this.moderationService, this.xpService);
        
        console.log('✅ All services initialized');
    }

    private connectServices(): void {
        console.log('🔗 Connecting services...');
        
        // Connect core services
        this.onboardingService.setModerationService(this.moderationService);
        this.onboardingService.setLoggingService(this.loggingService);
        this.moderationService.setOnboardingService(this.onboardingService);
        this.moderationService.setLoggingService(this.loggingService);
        this.unbanService.setLoggingService(this.loggingService);
        this.schedulerService.setLoggingService(this.loggingService);
        this.emailService.setLoggingService(this.loggingService);
        
        // Connect TTS to EventHandler
        this.eventHandler.setTTSService(this.ttsService, this.commandHandler.getTTSChannels);
        
        console.log('✅ All services connected');
    }

    private setupEventListeners(): void {
        console.log('📡 Setting up event listeners...');
        
        this.client.once(Events.ClientReady, async () => {
            await this.onBotReady();
        });

        this.eventHandler.setupEventListeners(this.client);

        this.client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            await this.handleInteraction(interaction);
        });
        
        console.log('✅ Event listeners configured');
    }

    private async onBotReady(): Promise<void> {
        console.log(`✅ Bot is ready! Logged in as ${this.client.user?.tag}`);
        console.log(`🔍 Monitoring ${Object.keys(CONFIG.HONEYPOT_ROLES).length} honeypot roles`);
        console.log(`🔍 Monitoring ${CONFIG.HONEYPOT_CHANNELS.length} honeypot channels`);
        console.log(`✨ XP system enabled`);
        console.log(`🎯 Onboarding detection enabled (rules agreement)`);
        console.log(`🔊 TTS system enabled`);
        console.log(`🛠️ Owner commands loaded (${ownerCommands.length} commands)`);
        
        // Initialize database and services
        await this.database.initialize();
        await this.loggingService.initialize();
        await this.registerCommands();
        await this.emailService.initialize();
        
        // Start background services
        this.onboardingService.setupOnboardingDetection();
        this.unbanService.start();
        this.schedulerService.start();

        // Log startup to Discord
        const honeypotRoleCount = Object.keys(CONFIG.HONEYPOT_ROLES).length;
        const honeypotChannelCount = CONFIG.HONEYPOT_CHANNELS.length;
        await this.loggingService.logSimple(
            `🤖 Honeypot Bot started successfully! Monitoring ${honeypotRoleCount} honeypot roles and ${honeypotChannelCount} channels. TTS system ready.`
        );
    }

    private async handleInteraction(interaction: any): Promise<void> {
        const ownerCommand = ownerCommands.find(cmd => cmd.data.name === interaction.commandName);
        
        if (ownerCommand) {
            try {
                await ownerCommand.execute(interaction, this.database, this.xpService);
            } catch (error) {
                console.error(`Error executing owner command ${interaction.commandName}:`, error);
                ErrorLogger.logError(error);
                
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ 
                        content: '❌ Error occurred while executing this command.', 
                        ephemeral: true 
                    });
                }
            }
            return;
        }
        
        await this.commandHandler.handleSlashCommand(interaction);
    }

    private async registerCommands(): Promise<void> {
        if (!CONFIG.CLIENT_ID) {
            console.warn('⚠️ CLIENT_ID not provided, slash commands will not be registered');
            return;
        }

        try {
            const rest = new REST().setToken(CONFIG.TOKEN!);
            
            console.log('🔄 Started refreshing application (/) commands.');

            const allCommands = [
                ...commands,
                ...ownerCommands.map(cmd => cmd.data.toJSON())
            ];

            await rest.put(
                Routes.applicationCommands(CONFIG.CLIENT_ID),
                { body: allCommands }
            );

            console.log('✅ Successfully reloaded application (/) commands.');
            console.log(`📊 Registered ${commands.length} regular commands and ${ownerCommands.length} owner commands.`);
        } catch (error) {
            console.error('❌ Error registering slash commands:', error);
            ErrorLogger.logError(error);
        }
    }

    public async start(): Promise<void> {
        console.log('🚀 Starting Honeypot Bot...');
        
        this.validateConfiguration();

        try {
            await this.client.login(CONFIG.TOKEN);
        } catch (error) {
            console.error('❌ Failed to login:', error);
            ErrorLogger.logError(error);
            process.exit(1);
        }
    }

    private validateConfiguration(): void {
        console.log('🔍 Validating configuration...');
        
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
        
        console.log('✅ Configuration validation complete');
    }

    public async stop(): Promise<void> {
        console.log('🛑 Shutting down bot...');
        
        await this.loggingService.logSimple('🛑 Honeypot Bot shutting down...');
        
        // Stop background services
        this.unbanService.stop();
        this.moderationService.cleanup();
        this.schedulerService.stop();
        this.emailService.stop();
        
        // Close database connection
        await this.database.close();
        
        // Destroy Discord client
        await this.client.destroy();
        
        console.log('✅ Bot shut down successfully');
    }

    // Getter methods for accessing services (useful for debugging/testing)
    public getDatabase(): DatabaseManager {
        return this.database;
    }

    public getClient(): Client {
        return this.client;
    }

    public getTTSService(): TTSService {
        return this.ttsService;
    }

    public getModerationService(): ModerationService {
        return this.moderationService;
    }
}