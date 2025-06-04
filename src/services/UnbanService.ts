// src/services/UnbanService.ts
import { Client } from 'discord.js';
import { DatabaseManager } from '../database/DatabaseManager';
import { TempBan } from '../types';
import { LoggingService } from './LoggingService';

export class UnbanService {
    private checkInterval: NodeJS.Timeout | null = null;

    constructor(
        private client: Client, 
        private database: DatabaseManager,
        private loggingService?: LoggingService
    ) {}

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
                await this.loggingService?.logError(`Error checking for unbans: ${error}`);
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

            // Try to unban the user
            try {
                await guild.members.unban(ban.user_id, 'Temporary ban expired');
                console.log(`✅ Successfully unbanned user ${ban.user_id} from guild ${ban.guild_id}`);
                
                // Log the automatic unban
                await this.loggingService?.logUnban(
                    ban.user_id,
                    this.client.user?.id || 'system',
                    'Temporary ban expired',
                    true // isAutomatic = true
                );
                
            } catch (error) {
                console.warn(`⚠️ Failed to unban user ${ban.user_id}:`, error);
            }

            // Mark as inactive in database
            await this.database.deactivateBan(ban.id);

        } catch (error) {
            console.error('❌ Error processing unban:', error);
            await this.loggingService?.logError(
                `Error processing unban: ${error}`,
                `User: ${ban.user_id}, Guild: ${ban.guild_id}`
            );
        }
    }
}