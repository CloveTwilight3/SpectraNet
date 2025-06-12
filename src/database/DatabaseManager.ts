// src/database/DatabaseManager.ts
import { Pool } from 'pg';
import { CONFIG } from '../config';

export interface TempBan {
    id: number;
    user_id: string;
    guild_id: string;
    role_id: string;
    unban_at: Date;
    reason: string;
    active: boolean;
    created_at: Date;
    banned_at: Date; // Added for compatibility
}

export interface UserXP {
    id: number;
    user_id: string;
    guild_id: string;
    xp: number;
    level: number;
    total_messages: number;
    last_message_at: Date;
    last_xp_gain: Date;
    created_at: Date;
    updated_at: Date;
}

export interface LevelRole {
    guild_id: string;
    level: number;
    role_id: string;
    created_at: Date;
}

export class DatabaseManager {
    private pool: Pool;

    constructor() {
        // Determine SSL configuration
        let sslConfig;
        
        if (process.env.DATABASE_SSL === 'true') {
            sslConfig = { rejectUnauthorized: false };
        } else if (process.env.DATABASE_SSL === 'false') {
            sslConfig = false;
        } else if (process.env.DATABASE_SSL === 'require') {
            sslConfig = { rejectUnauthorized: true };
        } else if (process.env.NODE_ENV === 'production') {
            // For production, try SSL with self-signed certificates allowed
            sslConfig = { rejectUnauthorized: false };
        } else {
            // For development, disable SSL by default
            sslConfig = false;
        }

        // Use individual connection parameters for better control
        this.pool = new Pool({
            host: CONFIG.DATABASE.HOST,
            port: CONFIG.DATABASE.PORT,
            database: CONFIG.DATABASE.NAME,
            user: CONFIG.DATABASE.USER,
            password: CONFIG.DATABASE.PASSWORD,
            ssl: sslConfig,
            // Connection settings
            connectionTimeoutMillis: 5000,
            idleTimeoutMillis: 30000,
            max: 10, // Maximum number of connections
            statement_timeout: 30000, // 30 second query timeout
        });
    }

    async initialize(): Promise<void> {
        try {
            // Test connection
            await this.pool.query('SELECT NOW()');
            console.log('✅ Database connected successfully');

            // Create tables if they don't exist
            await this.createTables();
            console.log('✅ Database tables verified');
        } catch (error) {
            console.error('❌ Database connection failed:', error);
            throw error;
        }
    }

    private async createTables(): Promise<void> {
        // Create temp_bans table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS temp_bans (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(20) NOT NULL,
                guild_id VARCHAR(20) NOT NULL,
                role_id VARCHAR(20) NOT NULL,
                unban_at TIMESTAMP WITH TIME ZONE NOT NULL,
                reason TEXT NOT NULL,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                banned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        `);

        // Create index for temp_bans
        await this.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_temp_bans_active_unban 
            ON temp_bans (active, unban_at) 
            WHERE active = true
        `);

        // Create user_xp table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS user_xp (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(20) NOT NULL,
                guild_id VARCHAR(20) NOT NULL,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                total_messages INTEGER DEFAULT 0,
                last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                last_xp_gain TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(user_id, guild_id)
            )
        `);

        // Create level_roles table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS level_roles (
                guild_id VARCHAR(20) NOT NULL,
                level INTEGER NOT NULL,
                role_id VARCHAR(20) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                PRIMARY KEY (guild_id, level, role_id)
            )
        `);

        console.log('✅ Database tables created/verified');
    }

    // ==================== TEMP BAN METHODS ====================

    async query(sql: string, params: any[] = []): Promise<any[]> {
        try {
            const result = await this.pool.query(sql, params);
            return result.rows;
        } catch (error) {
            console.error('Database query error:', error);
            throw error;
        }
    }
    
    async addTempBan(userId: string, guildId: string, roleId: string, unbanAt: Date, reason: string): Promise<void> {
        await this.pool.query(`
            INSERT INTO temp_bans (user_id, guild_id, role_id, unban_at, reason)
            VALUES ($1, $2, $3, $4, $5)
        `, [userId, guildId, roleId, unbanAt, reason]);
    }

    async getActiveTempBans(guildId: string): Promise<TempBan[]> {
        const result = await this.pool.query(`
            SELECT * FROM temp_bans 
            WHERE guild_id = $1 AND active = true 
            ORDER BY unban_at ASC
        `, [guildId]);

        return result.rows;
    }

    async getExpiredBans(): Promise<TempBan[]> {
        const result = await this.pool.query(`
            SELECT * FROM temp_bans 
            WHERE active = true AND unban_at <= NOW()
            ORDER BY unban_at ASC
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

    async deactivateBanByUser(userId: string, guildId: string): Promise<number> {
        const result = await this.pool.query(`
            UPDATE temp_bans 
            SET active = false 
            WHERE user_id = $1 AND guild_id = $2 AND active = true
        `, [userId, guildId]);

        return result.rowCount || 0;
    }

    async getTempBanByUser(userId: string, guildId: string): Promise<TempBan | null> {
        const result = await this.pool.query(`
            SELECT * FROM temp_bans 
            WHERE user_id = $1 AND guild_id = $2 AND active = true
            ORDER BY created_at DESC
            LIMIT 1
        `, [userId, guildId]);

        return result.rows[0] || null;
    }

    async getAllTempBans(guildId: string): Promise<TempBan[]> {
        const result = await this.pool.query(`
            SELECT * FROM temp_bans 
            WHERE guild_id = $1 AND active = true
            ORDER BY unban_at ASC
        `, [guildId]);

        return result.rows;
    }

    async cleanupExpiredBans(guildId: string): Promise<number> {
        const result = await this.pool.query(`
            UPDATE temp_bans 
            SET active = false 
            WHERE guild_id = $1 AND active = true AND unban_at <= NOW()
        `, [guildId]);

        return result.rowCount || 0;
    }

    // ==================== XP SYSTEM METHODS ====================

    async getUserXP(userId: string, guildId: string): Promise<UserXP | null> {
        const result = await this.pool.query(`
            SELECT * FROM user_xp 
            WHERE user_id = $1 AND guild_id = $2
        `, [userId, guildId]);

        return result.rows[0] || null;
    }

    async addUserXP(userId: string, guildId: string, xpAmount: number): Promise<UserXP> {
        const result = await this.pool.query(`
            INSERT INTO user_xp (user_id, guild_id, xp, total_messages, last_message_at, last_xp_gain, updated_at)
            VALUES ($1, $2, $3, 1, NOW(), NOW(), NOW())
            ON CONFLICT (user_id, guild_id)
            DO UPDATE SET 
                xp = user_xp.xp + $3,
                total_messages = user_xp.total_messages + 1,
                last_message_at = NOW(),
                last_xp_gain = NOW(),
                updated_at = NOW()
            RETURNING *
        `, [userId, guildId, xpAmount]);

        return result.rows[0];
    }

    async getLastXPGain(userId: string, guildId: string): Promise<Date | null> {
        const result = await this.pool.query(`
            SELECT last_xp_gain FROM user_xp 
            WHERE user_id = $1 AND guild_id = $2
        `, [userId, guildId]);

        return result.rows[0]?.last_xp_gain || null;
    }

    async updateUserLevel(userId: string, guildId: string, newLevel: number): Promise<void> {
        await this.pool.query(`
            UPDATE user_xp 
            SET level = $3 
            WHERE user_id = $1 AND guild_id = $2
        `, [userId, guildId, newLevel]);
    }

    async getXPLeaderboard(guildId: string, limit: number = 10): Promise<UserXP[]> {
        const result = await this.pool.query(`
            SELECT * FROM user_xp 
            WHERE guild_id = $1 
            ORDER BY xp DESC 
            LIMIT $2
        `, [guildId, limit]);

        return result.rows;
    }

    async getUserRank(userId: string, guildId: string): Promise<number> {
        const result = await this.pool.query(`
            SELECT COUNT(*) + 1 as rank
            FROM user_xp 
            WHERE guild_id = $2 AND xp > (
                SELECT xp FROM user_xp 
                WHERE user_id = $1 AND guild_id = $2
            )
        `, [userId, guildId]);

        return parseInt(result.rows[0]?.rank || '0');
    }

    // ==================== LEVEL ROLES METHODS ====================

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

        return (result.rowCount || 0) > 0;
    }

    async getLevelRoles(guildId: string, level: number): Promise<LevelRole[]> {
        const result = await this.pool.query(`
            SELECT * FROM level_roles 
            WHERE guild_id = $1 AND level = $2
            ORDER BY created_at ASC
        `, [guildId, level]);

        return result.rows;
    }

    async getAllLevelRoles(guildId: string): Promise<LevelRole[]> {
        const result = await this.pool.query(`
            SELECT * FROM level_roles 
            WHERE guild_id = $1 
            ORDER BY level ASC, created_at ASC
        `, [guildId]);

        return result.rows;
    }

    async getUserEligibleRoles(guildId: string, userLevel: number): Promise<LevelRole[]> {
        const result = await this.pool.query(`
            SELECT * FROM level_roles 
            WHERE guild_id = $1 AND level <= $2
            ORDER BY level ASC
        `, [guildId, userLevel]);

        return result.rows;
    }

    // ==================== UTILITY METHODS ====================

    async getStats(guildId: string): Promise<{
        totalUsers: number;
        totalXP: number;
        averageLevel: number;
        activeBans: number;
    }> {
        const userStats = await this.pool.query(`
            SELECT 
                COUNT(*) as total_users,
                COALESCE(SUM(xp), 0) as total_xp,
                COALESCE(AVG(level), 0) as average_level
            FROM user_xp 
            WHERE guild_id = $1
        `, [guildId]);

        const banStats = await this.pool.query(`
            SELECT COUNT(*) as active_bans
            FROM temp_bans 
            WHERE guild_id = $1 AND active = true
        `, [guildId]);

        return {
            totalUsers: parseInt(userStats.rows[0]?.total_users || '0'),
            totalXP: parseInt(userStats.rows[0]?.total_xp || '0'),
            averageLevel: parseFloat(userStats.rows[0]?.average_level || '0'),
            activeBans: parseInt(banStats.rows[0]?.active_bans || '0')
        };
    }

    async cleanupOldData(daysOld: number = 90): Promise<{
        expiredBans: number;
        inactiveUsers: number;
    }> {
        // Clean up old expired bans
        const expiredBansResult = await this.pool.query(`
            DELETE FROM temp_bans 
            WHERE active = false AND created_at < NOW() - INTERVAL '${daysOld} days'
        `);

        // Clean up very old inactive users (no messages in X days)
        const inactiveUsersResult = await this.pool.query(`
            DELETE FROM user_xp 
            WHERE last_message_at < NOW() - INTERVAL '${daysOld} days' AND total_messages < 5
        `);

        return {
            expiredBans: expiredBansResult.rowCount || 0,
            inactiveUsers: inactiveUsersResult.rowCount || 0
        };
    }

    // ==================== CONNECTION MANAGEMENT ====================

    async testConnection(): Promise<boolean> {
        try {
            await this.pool.query('SELECT 1');
            return true;
        } catch (error) {
            console.error('❌ Database connection test failed:', error);
            return false;
        }
    }

    async close(): Promise<void> {
        try {
            await this.pool.end();
            console.log('✅ Database connection closed');
        } catch (error) {
            console.error('❌ Error closing database connection:', error);
        }
    }

    // ==================== MIGRATION HELPERS ====================

    async runMigration(sql: string, description: string): Promise<void> {
        try {
            await this.pool.query(sql);
            console.log(`✅ Migration completed: ${description}`);
        } catch (error) {
            console.error(`❌ Migration failed (${description}):`, error);
            throw error;
        }
    }

    async backupTable(tableName: string): Promise<void> {
        const backupTableName = `${tableName}_backup_${Date.now()}`;
        await this.pool.query(`
            CREATE TABLE ${backupTableName} AS 
            SELECT * FROM ${tableName}
        `);
        console.log(`✅ Table ${tableName} backed up to ${backupTableName}`);
    }
}
