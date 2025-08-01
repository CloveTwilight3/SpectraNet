// src/services/HighlightsService.ts
import { Client, User, Message, EmbedBuilder, GuildMember } from 'discord.js';
import { DatabaseManager, Highlight } from '../database/DatabaseManager';
import { LoggingService } from './LoggingService';

interface HighlightNotification {
    user: User;
    keyword: string;
    message: Message;
    timestamp: number;
}

export class HighlightsService {
    private notificationCooldowns: Map<string, number> = new Map();
    private readonly COOLDOWN_DURATION = 5 * 60 * 1000; // 5 minutes
    private readonly MAX_KEYWORDS_PER_USER = 50;
    private loggingService?: LoggingService;

    constructor(
        private client: Client,
        private database: DatabaseManager
    ) {}

    setLoggingService(service: LoggingService): void {
        this.loggingService = service;
    }

    /**
     * Add a highlight keyword for a user
     */
    async addHighlight(userId: string, guildId: string, keyword: string): Promise<{
        success: boolean;
        error?: string;
    }> {
        // Validate keyword
        if (!keyword || keyword.trim().length === 0) {
            return { success: false, error: 'Keyword cannot be empty' };
        }

        keyword = keyword.trim();

        if (keyword.length > 100) {
            return { success: false, error: 'Keyword too long (max 100 characters)' };
        }

        if (keyword.length < 3) {
            return { success: false, error: 'Keyword too short (min 3 characters)' };
        }

        // Check if user has too many highlights
        const userHighlights = await this.database.getUserHighlights(userId, guildId);
        if (userHighlights.length >= this.MAX_KEYWORDS_PER_USER) {
            return { 
                success: false, 
                error: `Maximum ${this.MAX_KEYWORDS_PER_USER} highlights per user` 
            };
        }

        // Check if highlight already exists
        if (userHighlights.some(h => h.keyword.toLowerCase() === keyword.toLowerCase())) {
            return { success: false, error: 'You already have this highlight' };
        }

        const success = await this.database.addHighlight(userId, guildId, keyword);
        
        if (success) {
            console.log(`✅ Added highlight "${keyword}" for user ${userId} in guild ${guildId}`);
            return { success: true };
        } else {
            return { success: false, error: 'Failed to add highlight' };
        }
    }

    /**
     * Remove a highlight keyword for a user
     */
    async removeHighlight(userId: string, guildId: string, keyword: string): Promise<boolean> {
        const success = await this.database.removeHighlight(userId, guildId, keyword.trim());
        
        if (success) {
            console.log(`✅ Removed highlight "${keyword}" for user ${userId} in guild ${guildId}`);
        }
        
        return success;
    }

    /**
     * Get all highlights for a user
     */
    async getUserHighlights(userId: string, guildId: string): Promise<Highlight[]> {
        return await this.database.getUserHighlights(userId, guildId);
    }

    /**
     * Clear all highlights for a user
     */
    async clearUserHighlights(userId: string, guildId: string): Promise<number> {
        const count = await this.database.clearUserHighlights(userId, guildId);
        
        if (count > 0) {
            console.log(`✅ Cleared ${count} highlights for user ${userId} in guild ${guildId}`);
        }
        
        return count;
    }

    /**
     * Process a message for highlights
     */
    async processMessage(message: Message): Promise<void> {
        // Don't process bot messages or DMs
        if (message.author.bot || !message.guild) return;

        // Don't process highlights in honeypot channels
        const honeypotChannels = process.env.HONEYPOT_CHANNELS?.split(',') || [];
        if (honeypotChannels.includes(message.channel.id)) return;

        try {
            const messageContent = message.content.toLowerCase();
            
            // Get all highlights that might match this message
            const highlights = await this.database.getHighlightsForMessage(
                message.guild.id, 
                messageContent
            );

            if (highlights.length === 0) return;

            // Group highlights by user
            const userHighlights = new Map<string, string[]>();
            
            for (const highlight of highlights) {
                // Don't highlight the message author's own messages
                if (highlight.user_id === message.author.id) continue;

                // Check if keyword actually matches (database query is case-insensitive but we need exact word matching)
                if (this.matchesKeyword(messageContent, highlight.keyword)) {
                    if (!userHighlights.has(highlight.user_id)) {
                        userHighlights.set(highlight.user_id, []);
                    }
                    userHighlights.get(highlight.user_id)!.push(highlight.keyword);
                }
            }

            // Send notifications
            for (const [userId, keywords] of userHighlights) {
                await this.sendHighlightNotification(userId, keywords, message);
            }

        } catch (error) {
            console.error('❌ Error processing highlights for message:', error);
            await this.loggingService?.logError(
                error instanceof Error ? error.message : String(error),
                'Highlights processing'
            );
        }
    }

    /**
     * Check if message content matches a keyword
     */
    private matchesKeyword(messageContent: string, keyword: string): boolean {
        const lowerKeyword = keyword.toLowerCase();
        const lowerContent = messageContent.toLowerCase();

        // Simple contains check first
        if (!lowerContent.includes(lowerKeyword)) return false;

        // Word boundary check - ensure it's a complete word match
        const wordBoundaryRegex = new RegExp(`\\b${this.escapeRegex(lowerKeyword)}\\b`, 'i');
        return wordBoundaryRegex.test(lowerContent);
    }

    /**
     * Escape special regex characters
     */
    private escapeRegex(string: string): string {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * Send highlight notification to user
     */
    private async sendHighlightNotification(
        userId: string, 
        keywords: string[], 
        message: Message
    ): Promise<void> {
        try {
            // Check cooldown
            const cooldownKey = `${userId}_${message.guild!.id}`;
            const now = Date.now();
            const lastNotification = this.notificationCooldowns.get(cooldownKey) || 0;

            if (now - lastNotification < this.COOLDOWN_DURATION) {
                return; // Still in cooldown
            }

            // Check if user can see the channel
            const member = await message.guild!.members.fetch(userId).catch(() => null);
            if (!member) return; // User not in guild

            const channel = message.channel;
            if ('permissionsFor' in channel) {
                const permissions = channel.permissionsFor(member);
                if (!permissions?.has('ViewChannel') || !permissions?.has('ReadMessageHistory')) {
                    return; // User can't see this channel
                }
            }

            // Get user and send DM
            const user = await this.client.users.fetch(userId).catch(() => null);
            if (!user) return;

            const embed = new EmbedBuilder()
                .setTitle('🔔 Highlight Notification')
                .setColor(0xFFD700)
                .addFields(
                    {
                        name: '📝 Message',
                        value: message.content.length > 1000 
                            ? message.content.substring(0, 1000) + '...' 
                            : message.content,
                        inline: false
                    },
                    {
                        name: '👤 Author',
                        value: message.author.toString(),
                        inline: true
                    },
                    {
                        name: '📍 Channel',
                        value: message.channel.toString(),
                        inline: true
                    },
                    {
                        name: '🔍 Keywords',
                        value: keywords.map(k => `\`${k}\``).join(', '),
                        inline: true
                    },
                    {
                        name: '🔗 Jump to Message',
                        value: `[Click here](${message.url})`,
                        inline: false
                    }
                )
                .setTimestamp(message.createdAt)
                .setFooter({
                    text: `${message.guild!.name} • Use /highlight remove to stop notifications`,
                    iconURL: message.guild!.iconURL() || undefined
                });

            await user.send({ embeds: [embed] });

            // Update cooldown
            this.notificationCooldowns.set(cooldownKey, now);

            console.log(`🔔 Sent highlight notification to ${user.tag} for keywords: ${keywords.join(', ')}`);

        } catch (error) {
            console.error(`❌ Failed to send highlight notification to user ${userId}:`, error);
        }
    }

    /**
     * Get highlight statistics for a guild
     */
    async getStats(guildId: string): Promise<{ totalHighlights: number; activeUsers: number }> {
        return await this.database.getHighlightStats(guildId);
    }

    /**
     * Cleanup old cooldowns (call periodically)
     */
    cleanupCooldowns(): void {
        const now = Date.now();
        for (const [key, timestamp] of this.notificationCooldowns.entries()) {
            if (now - timestamp > this.COOLDOWN_DURATION * 2) {
                this.notificationCooldowns.delete(key);
            }
        }
    }
}