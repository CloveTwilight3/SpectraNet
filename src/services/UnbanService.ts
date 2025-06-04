// src/services/UnbanService.ts
import { Client } from 'discord.js';
import { DatabaseManager } from '../database/DatabaseManager';
import { LoggingService } from './LoggingService';
import { TempBan } from '../types';

export class UnbanService {
    private checkInterval: NodeJS.Timeout | null = null;
    private loggingService?: LoggingService;

    constructor(
        private client: Client, 
        private database: DatabaseManager
    ) {}

    setLoggingService(service: LoggingService): void {
        this.loggingService = service;
    }

    start(): void {
        // Check for unbans every minute
        this.checkInterval = setInterval(async () => {
            try {
                const expiredBans = await this.database.getExpiredBans();

                for (const ban of expiredBans) {
                    await this.processUnban(ban);
                }
            } catch (error) {
                console.error('❌ Error checking for unbans:', error);
            }
        }, 60 * 1000); // Check every minute
    }

    stop(): void {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    private async processUnban(ban: TempBan): Promise<void> {
        try {
            const guild = this.client.guilds.cache.get(ban.guild_id);
            if (!guild) {
                console.warn(`⚠️ Guild ${ban.guild_id} not found for unban`);
                return;
            }

            let userName = `User ID: ${ban.user_id}`;

            // Try to unban the user
            try {
                await guild.members.unban(ban.user_id, 'Temporary ban expired');
                console.log(`✅ Successfully unbanned user ${ban.user_id} from guild ${ban.guild_id}`);

                // Try to get user name for logging
                try {
                    const user = await this.client.users.fetch(ban.user_id);
                    userName = user.tag;
                } catch (error) {
                    // User might be deleted, use ID
                }

                // Log the auto unban
                await this.loggingService?.logAutoUnban(ban.user_id, userName);

            } catch (error) {
                console.warn(`⚠️ Failed to unban user ${ban.user_id}:`, error);
            }

            // Mark as inactive in database
            await this.database.deactivateBan(ban.id);

        } catch (error) {
            console.error('❌ Error processing unban:', error);
        }
    }
}
