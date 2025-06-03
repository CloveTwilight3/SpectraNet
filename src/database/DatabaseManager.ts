// src/database/DatabaseManager.ts
import { Pool } from 'pg';
import { CONFIG } from '../config';
import { TempBan, UserXP, LevelRole, LeaderboardEntry } from '../types';

export class DatabaseManager {
    private pool: Pool;

    constructor() {
        this.pool = new Pool({
            host: CONFIG.DATABASE.HOST,
            port: CONFIG.DATABASE.PORT,
            database: CONFIG.DATABASE.NAME,
            user: CONFIG.DATABASE.USER,
            password: CONFIG.DATABASE.PASSWORD,
        });
    }

    async initialize(): Promise<void> {
        try {
            // Create temp_bans table if it doesn't exist
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS temp_bans (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    role_id VARCHAR(20),
                    banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    unban_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    reason TEXT,
                    active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `);

            // Create XP system tables
            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS user_xp (
                    id SERIAL PRIMARY KEY,
                    user_id VARCHAR(20) NOT NULL,
                    guild_id VARCHAR(20) NOT NULL,
                    xp BIGINT DEFAULT 0,
                    level INTEGER DEFAULT 0,
                    total_messages INTEGER DEFAULT 0,
                    last_xp_gain TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    UNIQUE(user_id, guild_id)
                );
            `);

            await this.pool.query(`
                CREATE TABLE IF NOT EXISTS level_roles (
                    id SERIAL PRIMARY KEY,
                    guild_id VARCHAR(20) NOT NULL,
                    level INTEGER NOT NULL,
                    role_id VARCHAR(20) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    UNIQUE(guild_id, level, role_id)
                );
            `);

            // Create indexes for better performance
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_temp_bans_active_unban 
                ON temp_bans (active, unban_at) 
                WHERE active = true;
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_xp_guild_level 
                ON user_xp (guild_id, level DESC);
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_user_xp_user_guild 
                ON user_xp (user_id, guild_id);
            `);

            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_level_roles_guild_level 
                ON level_roles (guild_id, level);
            `);

            console.log('✅ Database initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize database:', error);
            throw error;
        }
    }

    // TEMP BAN METHODS
    async addTempBan(userId: string, guildId: string, roleId: string, unbanAt: Date, reason: string): Promise<void> {
        await this.pool.query(`
            INSERT INTO temp_bans (user_id, guild_id, role_id, unban_at, reason, active)
            VALUES ($1, $2, $3, $4, $5, true)
        `, [userId, guildId, roleId, unbanAt, reason]);
    }

    async getActiveTempBans(guildId: string): Promise<TempBan[]> {
        const result = await this.pool.query(`
            SELECT user_id, role_id, banned_at, unban_at, reason 
            FROM temp_bans 
            WHERE guild_id = $1 AND active = true 
            ORDER BY unban_at ASC 
            LIMIT 10
        `, [guildId]);

        return result.rows;
    }

    async getExpiredBans(): Promise<TempBan[]> {
        const result = await this.pool.query(`
            SELECT * FROM temp_bans 
            WHERE active = true AND unban_at <= NOW()
        `);

        return result.rows;
    }

    async deactivateBan(banId: number): Promise<void> {
        await this.pool.query(`
            UPDATE temp_bans 
            SET active = false 
            WHERE id = $1
        `, [banId]);
    }

    // XP SYSTEM METHODS
    async getUserXP(userId: string, guildId: string): Promise<UserXP | null> {
        const result = await this.pool.query(`
            SELECT * FROM user_xp 
            WHERE user_id = $1 AND guild_id = $2
        `, [userId, guildId]);

        return result.rows[0] || null;
    }

    async addUserXP(userId: string, guildId: string, xpAmount: number): Promise<UserXP> {
        const result = await this.pool.query(`
            INSERT INTO user_xp (user_id, guild_id, xp, total_messages, last_xp_gain)
            VALUES ($1, $2, $3, 1, NOW())
            ON CONFLICT (user_id, guild_id)
            DO UPDATE SET
                xp = user_xp.xp + $3,
                total_messages = user_xp.total_messages + 1,
                last_xp_gain = NOW(),
                updated_at = NOW()
            RETURNING *
        `, [userId, guildId, xpAmount]);

        // Update level separately to trigger our function
        const newXP = result.rows[0].xp;
        const newLevel = Math.floor(Math.sqrt(newXP / 100));
        
        await this.pool.query(`
            UPDATE user_xp 
            SET level = $1 
            WHERE user_id = $2 AND guild_id = $3
        `, [newLevel, userId, guildId]);

        return { ...result.rows[0], level: newLevel };
    }

    async getLastXPGain(userId: string, guildId: string): Promise<Date | null> {
        const result = await this.pool.query(`
            SELECT last_xp_gain FROM user_xp 
            WHERE user_id = $1 AND guild_id = $2
        `, [userId, guildId]);

        return result.rows[0]?.last_xp_gain || null;
    }

    async getXPLeaderboard(guildId: string, limit: number = 10): Promise<LeaderboardEntry[]> {
        const result = await this.pool.query(`
            SELECT 
                user_id,
                guild_id,
                xp,
                level,
                total_messages,
                ROW_NUMBER() OVER (ORDER BY xp DESC) as rank
            FROM user_xp 
            WHERE guild_id = $1 
            ORDER BY xp DESC 
            LIMIT $2
        `, [guildId, limit]);

        return result.rows;
    }

    async getLevelRoles(guildId: string, level: number): Promise<LevelRole[]> {
        const result = await this.pool.query(`
            SELECT * FROM level_roles 
            WHERE guild_id = $1 AND level <= $2
            ORDER BY level DESC
        `, [guildId, level]);

        return result.rows;
    }

    async addLevelRole(guildId: string, level: number, roleId: string): Promise<void> {
        await this.pool.query(`
            INSERT INTO level_roles (guild_id, level, role_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (guild_id, level, role_id) DO NOTHING
        `, [guildId, level, roleId]);
    }

    async removeLevelRole(guildId: string, level: number, roleId: string): Promise<boolean> {
        const result = await this.pool.query(`
            DELETE FROM level_roles 
            WHERE guild_id = $1 AND level = $2 AND role_id = $3
        `, [guildId, level, roleId]);

        return result.rowCount > 0;
    }

    async getAllLevelRoles(guildId: string): Promise<LevelRole[]> {
        const result = await this.pool.query(`
            SELECT * FROM level_roles 
            WHERE guild_id = $1 
            ORDER BY level ASC
        `, [guildId]);

        return result.rows;
    }

    async close(): Promise<void> {
        await this.pool.end();
    }
}
