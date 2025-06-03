// src/services/XPService.ts
import { GuildMember, Message } from 'discord.js';
import { DatabaseManager } from '../database/DatabaseManager';
import { UserXP, XPGainResult, XPConfig } from '../types';

export class XPService {
    private config: XPConfig = {
        baseXP: 15,          // Base XP per message
        cooldownMs: 60000,   // 1 minute cooldown
        bonusXP: 5,          // Bonus XP for longer messages
        bonusThreshold: 100, // Characters needed for bonus
    };

    constructor(private database: DatabaseManager) {}

    async processMessage(message: Message): Promise<void> {
        // Don't give XP to bots
        if (message.author.bot) return;
        
        // Don't give XP in honeypot channels
        if (process.env.HONEYPOT_CHANNELS?.split(',').includes(message.channel.id)) return;

        const member = message.member;
        if (!member || !message.guild) return;

        try {
            const result = await this.addXP(member, message.content.length);
            
            if (result.leveledUp) {
                await this.handleLevelUp(member, result);
            }
        } catch (error) {
            console.error('❌ Error processing XP for message:', error);
        }
    }

    async addXP(member: GuildMember, messageLength: number = 0): Promise<XPGainResult> {
        const userId = member.user.id;
        const guildId = member.guild.id;

        // Check cooldown
        const lastGain = await this.database.getLastXPGain(userId, guildId);
        const now = new Date();
        
        if (lastGain && (now.getTime() - lastGain.getTime()) < this.config.cooldownMs) {
            return {
                oldLevel: 0,
                newLevel: 0,
                leveledUp: false,
                newRoles: []
            };
        }

        // Calculate XP gain
        let xpGain = this.config.baseXP;
        if (messageLength > this.config.bonusThreshold) {
            xpGain += this.config.bonusXP;
        }
        
        // Add small random factor (±25%)
        const randomFactor = 0.75 + (Math.random() * 0.5);
        xpGain = Math.floor(xpGain * randomFactor);

        // Get current XP data
        const currentData = await this.database.getUserXP(userId, guildId);
        const oldLevel = currentData?.level || 0;
        
        // Add XP to database
        const newData = await this.database.addUserXP(userId, guildId, xpGain);
        const newLevel = this.calculateLevel(newData.xp);

        const leveledUp = newLevel > oldLevel;
        let newRoles: string[] = [];

        if (leveledUp) {
            newRoles = await this.assignLevelRoles(member, newLevel);
        }

        return {
            oldLevel,
            newLevel,
            leveledUp,
            newRoles
        };
    }

    async handleLevelUp(member: GuildMember, result: XPGainResult): Promise<void> {
        console.log(`🎉 ${member.user.tag} leveled up to level ${result.newLevel}!`);

        // Just assign roles silently, no announcements
        if (result.newRoles.length > 0) {
            console.log(`✅ Assigned ${result.newRoles.length} role(s) to ${member.user.tag} for reaching level ${result.newLevel}`);
        }
    }

    async assignLevelRoles(member: GuildMember, level: number): Promise<string[]> {
        try {
            // Only assign role at level 5, ignore all other levels
            if (level !== 5) {
                return [];
            }

            const levelRoles = await this.database.getLevelRoles(member.guild.id, level);
            const assignedRoles: string[] = [];

            for (const levelRole of levelRoles) {
                try {
                    const role = member.guild.roles.cache.get(levelRole.role_id);
                    if (role && !member.roles.cache.has(role.id)) {
                        await member.roles.add(role, `Reached level ${level}`);
                        assignedRoles.push(role.id);
                        console.log(`✅ Assigned role ${role.name} to ${member.user.tag} for reaching level ${level}`);
                    }
                } catch (error) {
                    console.error(`❌ Failed to assign role ${levelRole.role_id}:`, error);
                }
            }

            return assignedRoles;
        } catch (error) {
            console.error('❌ Error assigning level roles:', error);
            return [];
        }
    }

    calculateLevel(xp: number): number {
        // Level formula: level = floor(sqrt(xp / 100))
        return Math.floor(Math.sqrt(xp / 100));
    }

    calculateXPForLevel(level: number): number {
        // XP needed for a level = (level^2) * 100
        return level * level * 100;
    }

    calculateXPForNextLevel(currentXP: number): { currentLevel: number; nextLevel: number; xpNeeded: number; progress: number } {
        const currentLevel = this.calculateLevel(currentXP);
        const nextLevel = currentLevel + 1;
        const xpForNext = this.calculateXPForLevel(nextLevel);
        const xpForCurrent = this.calculateXPForLevel(currentLevel);
        const xpNeeded = xpForNext - currentXP;
        const progress = ((currentXP - xpForCurrent) / (xpForNext - xpForCurrent)) * 100;

        return {
            currentLevel,
            nextLevel,
            xpNeeded,
            progress: Math.max(0, Math.min(100, progress))
        };
    }

    async getUserCard(userId: string, guildId: string): Promise<UserXP | null> {
        return await this.database.getUserXP(userId, guildId);
    }

    async getLeaderboard(guildId: string, limit: number = 10): Promise<any[]> {
        return await this.database.getXPLeaderboard(guildId, limit);
    }
}
