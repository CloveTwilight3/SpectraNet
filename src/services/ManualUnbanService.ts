// src/services/ManualUnbanService.ts
import { Guild, GuildMember, User, EmbedBuilder } from 'discord.js';
import { CONFIG } from '../config';
import { DatabaseManager } from '../database/DatabaseManager';
import { ModerationService } from './ModerationService';

export interface UnbanResult {
    success: boolean;
    wasActuallyBanned: boolean;
    removedFromDatabase: boolean;
    cancelledPendingBan: boolean;
    removedRoles: string[];
    error?: string;
}

export class ManualUnbanService {
    constructor(
        private database: DatabaseManager,
        private moderationService: ModerationService
    ) {}

    async unbanUser(
        guild: Guild, 
        userId: string, 
        moderatorId: string, 
        reason?: string
    ): Promise<UnbanResult> {
        const result: UnbanResult = {
            success: false,
            wasActuallyBanned: false,
            removedFromDatabase: false,
            cancelledPendingBan: false,
            removedRoles: []
        };

        try {
            // 1. Try to unban from Discord
            try {
                await guild.members.unban(userId, reason || 'Manual unban by moderator');
                result.wasActuallyBanned = true;
                console.log(`✅ Successfully unbanned user ${userId} from Discord`);
            } catch (error: any) {
                if (error.code === 10026) { // Unknown Ban - user wasn't banned
                    console.log(`ℹ️ User ${userId} was not actually banned in Discord`);
                } else {
                    console.error(`❌ Failed to unban user ${userId}:`, error);
                    result.error = `Failed to unban from Discord: ${error.message}`;
                    return result;
                }
            }

            // 2. Cancel any pending bans
            const cancelledPending = this.moderationService.cancelPendingBan(userId, guild.id);
            if (cancelledPending) {
                result.cancelledPendingBan = true;
                console.log(`🚫 Cancelled pending ban for user ${userId}`);
            }

            // 3. Remove from temp bans database
            const removedCount = await this.database.deactivateBanByUser(userId, guild.id);
            if (removedCount > 0) {
                result.removedFromDatabase = true;
                console.log(`🗃️ Removed ${removedCount} temp ban record(s) for user ${userId}`);
            }

            // 4. If user is still in server, remove honeypot roles
            try {
                const member = await guild.members.fetch(userId);
                result.removedRoles = await this.removeHoneypotRoles(member);
            } catch (error) {
                // User not in server anymore, that's fine
                console.log(`ℹ️ User ${userId} is not in the server (can't remove roles)`);
            }

            result.success = true;
            
            // Log the action
            console.log(`🔓 Manual unban completed for user ${userId} by moderator ${moderatorId}`);
            
            return result;

        } catch (error: any) {
            console.error(`❌ Error during manual unban for user ${userId}:`, error);
            result.error = error.message;
            return result;
        }
    }

    async removeHoneypotRoles(member: GuildMember): Promise<string[]> {
        const removedRoles: string[] = [];
        const honeypotRoleIds = Object.keys(CONFIG.HONEYPOT_ROLES);

        for (const roleId of honeypotRoleIds) {
            if (member.roles.cache.has(roleId)) {
                try {
                    const role = member.guild.roles.cache.get(roleId);
                    if (role) {
                        await member.roles.remove(role, 'Manual honeypot role removal');
                        removedRoles.push(roleId);
                        console.log(`➖ Removed honeypot role ${role.name} from ${member.user.tag}`);
                    }
                } catch (error) {
                    console.error(`❌ Failed to remove role ${roleId} from ${member.user.tag}:`, error);
                }
            }
        }

        // Cancel any pending bans after role removal
        if (removedRoles.length > 0) {
            this.moderationService.cancelPendingBan(member.user.id, member.guild.id);
        }

        return removedRoles;
    }

    async removeSpecificHoneypotRole(member: GuildMember, roleId: string): Promise<boolean> {
        if (!CONFIG.HONEYPOT_ROLES[roleId]) {
            throw new Error(`Role ${roleId} is not configured as a honeypot role`);
        }

        if (!member.roles.cache.has(roleId)) {
            return false; // User doesn't have this role
        }

        try {
            const role = member.guild.roles.cache.get(roleId);
            if (role) {
                await member.roles.remove(role, 'Manual specific honeypot role removal');
                console.log(`➖ Removed specific honeypot role ${role.name} from ${member.user.tag}`);
                
                // Cancel pending ban if this was the only honeypot role
                const hasOtherHoneypotRoles = Object.keys(CONFIG.HONEYPOT_ROLES)
                    .filter(id => id !== roleId)
                    .some(id => member.roles.cache.has(id));
                
                if (!hasOtherHoneypotRoles) {
                    this.moderationService.cancelPendingBan(member.user.id, member.guild.id);
                }
                
                return true;
            }
            return false;
        } catch (error) {
            console.error(`❌ Failed to remove specific role ${roleId} from ${member.user.tag}:`, error);
            throw error;
        }
    }

    async cleanupExpiredBans(guild: Guild): Promise<{ cleaned: number; errors: string[] }> {
        const errors: string[] = [];
        
        try {
            // Clean up database entries
            const cleanedCount = await this.database.cleanupExpiredBans(guild.id);
            
            console.log(`🧹 Cleaned up ${cleanedCount} expired ban records from database`);
            
            return {
                cleaned: cleanedCount,
                errors
            };
            
        } catch (error: any) {
            console.error('❌ Error cleaning up expired bans:', error);
            errors.push(error.message);
            
            return {
                cleaned: 0,
                errors
            };
        }
    }

    // Helper method to get user info for unban commands
    async parseUserInput(guild: Guild, userInput: string): Promise<{ userId: string; user?: User }> {
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
            throw new Error('Invalid user ID or mention format');
        }

        // Try to fetch the user (optional, for better error messages)
        let user: User | undefined;
        try {
            user = await guild.client.users.fetch(userId);
        } catch (error) {
            // User might not exist anymore, but we can still try to unban by ID
        }

        return { userId, user };
    }
}
