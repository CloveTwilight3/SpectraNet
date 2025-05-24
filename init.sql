-- Initialize honeypot bot database
-- This script runs automatically when the PostgreSQL container starts for the first time

-- Create the temp_bans table
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

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_temp_bans_active_unban 
ON temp_bans (active, unban_at) 
WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_temp_bans_user_guild 
ON temp_bans (user_id, guild_id);

CREATE INDEX IF NOT EXISTS idx_temp_bans_created_at 
ON temp_bans (created_at DESC);

-- Optional: Create a view for active bans
CREATE OR REPLACE VIEW active_temp_bans AS
SELECT 
    id,
    user_id,
    guild_id,
    role_id,
    banned_at,
    unban_at,
    reason,
    EXTRACT(EPOCH FROM (unban_at - NOW())) / 3600 AS hours_remaining
FROM temp_bans 
WHERE active = true 
ORDER BY unban_at ASC;

-- Create a function to clean up old inactive bans (optional)
CREATE OR REPLACE FUNCTION cleanup_old_bans()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Delete inactive bans older than 30 days
    DELETE FROM temp_bans 
    WHERE active = false 
    AND created_at < NOW() - INTERVAL '30 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Log the initialization
DO $$
BEGIN
    RAISE NOTICE 'Honeypot bot database initialized successfully at %', NOW();
END $$;