// src/services/SchedulerService.ts
import { Client, TextChannel } from 'discord.js';
import { LoggingService } from './LoggingService';

export class SchedulerService {
    private dailyReminderInterval: NodeJS.Timeout | null = null;
    private loggingService?: LoggingService;

    constructor(private client: Client) {}

    setLoggingService(service: LoggingService): void {
        this.loggingService = service;
    }

    start(): void {
        this.scheduleDailyReminder();
        console.log('✅ Scheduler service started - Daily reminders enabled');
    }

    stop(): void {
        if (this.dailyReminderInterval) {
            clearInterval(this.dailyReminderInterval);
            this.dailyReminderInterval = null;
            console.log('🛑 Scheduler service stopped');
        }
    }

    private scheduleDailyReminder(): void {
        // Calculate time until next 6 PM GMT
        const scheduleNextReminder = () => {
            const now = new Date();
            const targetTime = new Date();
            
            // Set to 6 PM GMT (18:00)
            targetTime.setUTCHours(18, 0, 0, 0);
            
            // If it's already past 6 PM today, schedule for tomorrow
            if (now.getTime() > targetTime.getTime()) {
                targetTime.setUTCDate(targetTime.getUTCDate() + 1);
            }
            
            const timeUntilNext = targetTime.getTime() - now.getTime();
            
            console.log(`📅 Next daily reminder scheduled for: ${targetTime.toISOString()}`);
            
            // Schedule the reminder
            setTimeout(async () => {
                await this.sendDailyReminder();
                
                // Schedule the next one for tomorrow
                this.dailyReminderInterval = setInterval(async () => {
                    await this.sendDailyReminder();
                }, 24 * 60 * 60 * 1000); // 24 hours
                
            }, timeUntilNext);
        };

        scheduleNextReminder();
    }

    private async sendDailyReminder(): Promise<void> {
        const channelId = '1196101205689118872';
        const message = 'Daily reminder that you are all valid as fuck, you can be who you want to be, I love you and stay strong! 💜';

        try {
            const channel = await this.client.channels.fetch(channelId);
            
            if (channel?.isTextBased() && channel.type === 0) { // GUILD_TEXT = 0
                const textChannel = channel as TextChannel;
                await textChannel.send(message);
                
                console.log(`💜 Daily reminder sent to #${textChannel.name}`);
                await this.loggingService?.logSimple(`💜 Daily reminder sent to #${textChannel.name}`);
            } else {
                console.error('❌ Daily reminder channel is not a text channel');
                await this.loggingService?.logError(
                    'Daily reminder channel is not a text channel',
                    'Daily reminder service'
                );
            }
        } catch (error) {
            console.error('❌ Failed to send daily reminder:', error);
            await this.loggingService?.logError(
                error instanceof Error ? error.message : String(error),
                'Daily reminder service'
            );
        }
    }

    // Manual trigger for testing (can be called from owner commands)
    async triggerDailyReminder(): Promise<boolean> {
        try {
            await this.sendDailyReminder();
            return true;
        } catch (error) {
            console.error('❌ Failed to manually trigger daily reminder:', error);
            return false;
        }
    }
}