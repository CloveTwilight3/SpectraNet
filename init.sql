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

-- Create the user_xp table for tracking XP and levels
CREATE TABLE IF NOT EXISTS user_xp (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    guild_id VARCHAR(20) NOT NULL,
    xp BIGINT DEFAULT 0,
    level INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_xp_gain TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, guild_id)
);

-- Create the level_roles table for role rewards
CREATE TABLE IF NOT EXISTS level_roles (
    id SERIAL PRIMARY KEY,
    guild_id VARCHAR(20) NOT NULL,
    level INTEGER NOT NULL,
    role_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(guild_id, level, role_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_temp_bans_active_unban 
ON temp_bans (active, unban_at) 
WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_temp_bans_user_guild 
ON temp_bans (user_id, guild_id);

CREATE INDEX IF NOT EXISTS idx_temp_bans_created_at 
ON temp_bans (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_xp_guild_level 
ON user_xp (guild_id, level DESC);

CREATE INDEX IF NOT EXISTS idx_user_xp_user_guild 
ON user_xp (user_id, guild_id);

CREATE INDEX IF NOT EXISTS idx_level_roles_guild_level 
ON level_roles (guild_id, level);

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

-- Create a view for leaderboard queries
CREATE OR REPLACE VIEW xp_leaderboard AS
SELECT 
    user_id,
    guild_id,
    xp,
    level,
    total_messages,
    ROW_NUMBER() OVER (PARTITION BY guild_id ORDER BY xp DESC) as rank
FROM user_xp 
ORDER BY guild_id, xp DESC;

-- Create a function to calculate level from XP
CREATE OR REPLACE FUNCTION calculate_level(user_xp BIGINT)
RETURNS INTEGER AS $$
BEGIN
    -- XP formula: level = floor(sqrt(xp / 100))
    -- This means level 1 = 100 XP, level 2 = 400 XP, level 3 = 900 XP, etc.
    RETURN FLOOR(SQRT(user_xp / 100.0))::INTEGER;
END;
$$ LANGUAGE plpgsql;

-- Create a function to calculate XP needed for next level
CREATE OR REPLACE FUNCTION xp_for_level(target_level INTEGER)
RETURNS BIGINT AS $$
BEGIN
    -- XP needed for a level = (level^2) * 100
    RETURN (target_level * target_level * 100)::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- Create a function to update user level when XP changes
CREATE OR REPLACE FUNCTION update_user_level()
RETURNS TRIGGER AS $$
DECLARE
    new_level INTEGER;
BEGIN
    -- Calculate new level based on XP
    new_level := calculate_level(NEW.xp);
    
    -- Update the level if it changed
    IF new_level != NEW.level THEN
        NEW.level := new_level;
        NEW.updated_at := NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update levels
DROP TRIGGER IF EXISTS trigger_update_user_level ON user_xp;
CREATE TRIGGER trigger_update_user_level
    BEFORE UPDATE OF xp ON user_xp
    FOR EACH ROW
    EXECUTE FUNCTION update_user_level();

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

-- Sample level role configuration for level 5 only
-- Uncomment and modify the guild_id and role_id values for your server
/*
INSERT INTO level_roles (guild_id, level, role_id) VALUES 
    ('YOUR_GUILD_ID', 5, 'YOUR_LEVEL_5_ROLE_ID')
ON CONFLICT (guild_id, level, role_id) DO NOTHING;
*/

-- Log the initialization
DO $$
BEGIN
    RAISE NOTICE 'Honeypot bot database initialized successfully at %', NOW();
    RAISE NOTICE 'XP leveling system initialized successfully at %', NOW();
END $$;
