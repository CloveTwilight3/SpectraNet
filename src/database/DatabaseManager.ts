import { Pool } from 'pg';
import { CONFIG } from '../config';
import { TempBan } from '../types';

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

            // Create index for faster queries
            await this.pool.query(`
                CREATE INDEX IF NOT EXISTS idx_temp_bans_active_unban 
                ON temp_bans (active, unban_at) 
                WHERE active = true;
            `);

            console.log('✅ Database initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize database:', error);
            throw error;
        }
    }

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

    async close(): Promise<void> {
        await this.pool.end();
    }
}
