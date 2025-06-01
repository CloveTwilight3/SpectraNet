import { config } from 'dotenv';

// Load environment variables
config();

export const CONFIG = {
    TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    
    // Database configuration
    DATABASE: {
        HOST: process.env.DB_HOST || 'localhost',
        PORT: parseInt(process.env.DB_PORT || '5432'),
        NAME: process.env.DB_NAME || 'honeypot_bot',
        USER: process.env.DB_USER || 'postgres',
        PASSWORD: process.env.DB_PASSWORD || 'password',
    },
    
    // Honeypot role IDs and their punishments from environment
    HONEYPOT_ROLES: (() => {
        const roles: { [key: string]: { duration: number; type: 'timeout' | 'tempban' } } = {};
        
        // Parse role configurations from environment
        // Format: ROLE_ID:DURATION_DAYS,ROLE_ID:DURATION_DAYS
        const roleConfig = process.env.HONEYPOT_ROLES_CONFIG || '';
        roleConfig.split(',').forEach(config => {
            const [roleId, durationStr] = config.trim().split(':');
            if (roleId && durationStr) {
                const durationDays = parseInt(durationStr);
                const durationMs = durationDays * 24 * 60 * 60 * 1000;
                
                roles[roleId] = {
                    duration: durationMs,
                    type: durationDays <= 28 ? 'timeout' : 'tempban'
                };
            }
        });
        
        return roles;
    })(),
    
    // Honeypot channel IDs from environment (comma-separated)
    HONEYPOT_CHANNELS: process.env.HONEYPOT_CHANNELS?.split(',').map(id => id.trim()) || [],
    
    // Ban reason messages
    BAN_REASONS: {
        ROLE_TIMEOUT: 'Temporarily timed out for acquiring honeypot role',
        ROLE_TEMPBAN: 'Temporarily banned for acquiring honeypot role',
        CHANNEL: 'Permanently banned for posting in honeypot channel',
    },
    
    // Optional: Logging Channel ID
    LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID,
};

// Export individual parts if needed
export default CONFIG;
