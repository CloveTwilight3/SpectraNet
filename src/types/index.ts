// src/types/index.ts
export interface TempBan {
    id: number;
    user_id: string;
    guild_id: string;
    role_id: string;
    banned_at: Date;
    unban_at: Date;
    reason: string;
    active: boolean;
}

export interface RoleConfig {
    duration: number;
    type: 'timeout' | 'tempban';
}

export interface UserXP {
    id: number;
    user_id: string;
    guild_id: string;
    xp: number;
    level: number;
    total_messages: number;
    last_xp_gain: Date;
    created_at: Date;
    updated_at: Date;
}

export interface LevelRole {
    id: number;
    guild_id: string;
    level: number;
    role_id: string;
    created_at: Date;
}

export interface XPGainResult {
    oldLevel: number;
    newLevel: number;
    leveledUp: boolean;
    newRoles: string[];
}

export interface LeaderboardEntry {
    user_id: string;
    guild_id: string;
    xp: number;
    level: number;
    total_messages: number;
    rank: number;
}

export interface XPConfig {
    baseXP: number;          // Base XP per message
    cooldownMs: number;      // Cooldown between XP gains
    bonusXP: number;         // Bonus XP for longer messages
    bonusThreshold: number;  // Character threshold for bonus
}
