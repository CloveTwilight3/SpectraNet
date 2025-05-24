# Discord Honeypot Bot

A sophisticated Discord moderation bot that automatically punishes users for interacting with honeypot roles and channels. Built with TypeScript, Discord.js v14, and PostgreSQL.

## Features

- **🎭 Honeypot Roles**: Automatically timeout/ban users who pick up designated roles
- **🕳️ Honeypot Channels**: Permanently ban users who send messages in designated channels
- **⏱️ Smart Punishment System**: 
  - ≤28 days: Discord timeout (user muted but stays in server)
  - >28 days: Temporary ban (tracked in database, automatic unban)
- **📊 Database Integration**: PostgreSQL tracks all temporary bans
- **🔄 Automatic Unbanning**: Bot checks every minute and unbans expired temporary bans
- **🏓 Health Monitoring**: Built-in health checks and status commands
- **🐳 Docker Ready**: Complete Docker setup with database

## Quick Start

### 1. Clone and Setup
```bash
git clone <your-repo>
cd discord-honeypot-bot
cp .env.example .env
```

### 2. Configure Environment
Edit `.env` file with your Discord bot token and role/channel IDs:
```bash
DISCORD_TOKEN=your_actual_bot_token
CLIENT_ID=your_bot_client_id
HONEYPOT_ROLES_CONFIG=role_id_1:90,role_id_2:365,role_id_3:2190
HONEYPOT_CHANNELS=channel_id_1,channel_id_2
```

### 3. Start with Docker
```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f discord_bot

# Start with database admin (optional)
docker-compose --profile admin up -d
```

### 4. Invite Bot to Server
Bot needs these permissions:
- Ban Members
- Moderate Members  
- Manage Messages
- Use Slash Commands
- View Channels
- Read Message History

## Configuration

### Role Durations
Configure role-specific punishments in your `.env`:
```bash
# Format: ROLE_ID:DURATION_IN_DAYS
HONEYPOT_ROLES_CONFIG=123456789:30,987654321:365,555666777:2190
```

**Duration Examples:**
- `7` = 7 days (Discord timeout)
- `30` = 30 days (temporary ban)
- `90` = 3 months (temporary ban)
- `365` = 1 year (temporary ban)
- `2190` = 6 years (temporary ban)

### Channel Configuration
Channels result in permanent bans:
```bash
HONEYPOT_CHANNELS=channel_id_1,channel_id_2,channel_id_3
```

## Commands

- `/ping` - Test bot responsiveness and view configuration
- `/tempbans` - View active temporary bans and expiration times

## Development

### Local Development
```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build TypeScript
npm run build

# Run production build
npm start
```

### Database Management
```bash
# Access pgAdmin (if started with --profile admin)
# Visit: http://localhost:8080
# Email: admin@honeypot.local
# Password: admin123

# Reset database
npm run db:reset

# View database logs
docker-compose logs postgres
```

### Docker Commands
```bash
# Build containers
npm run docker:build

# Start services
npm run docker:up

# Stop services  
npm run docker:down

# View bot logs
npm run docker:logs
```

## How It Works

### Role Punishment Logic
1. User picks up a honeypot role (via reaction roles, etc.)
2. Bot detects the role change
3. Based on configured duration:
   - **≤28 days**: Discord timeout (user can't send messages)
   - **>28 days**: Temporary ban (user removed, tracked in database)
4. For temporary bans, bot automatically unbans when time expires

### Channel Punishment Logic
1. User sends message in honeypot channel
2. Bot immediately deletes the message
3. Bot permanently bans the user (no automatic unban)

### Database Schema
```sql
temp_bans (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(20),
    guild_id VARCHAR(20), 
    role_id VARCHAR(20),
    banned_at TIMESTAMP,
    unban_at TIMESTAMP,
    reason TEXT,
    active BOOLEAN
)
```

## Monitoring

### Health Checks
- Docker health checks every 30 seconds
- Bot checks for expired bans every minute
- Logs all actions to console and optionally to Discord channel

### Logging
Enable Discord logging by:
1. Set `LOG_CHANNEL_ID` in `.env`
2. Uncomment logging sections in the code
3. Restart the bot

## Security Notes

- Never commit your `.env` file
- Use strong database passwords
- Restrict bot permissions to minimum required
- Monitor bot logs for suspicious activity
- Keep dependencies updated

## Troubleshooting

### Common Issues
- **Bot won't start**: Check `DISCORD_TOKEN` in `.env`
- **Database connection failed**: Ensure PostgreSQL is running
- **Permissions error**: Verify bot has required permissions in Discord
- **Roles not working**: Double-check role IDs in configuration

### Debug Commands
```bash
# Check bot status
docker-compose ps

# View all logs
docker-compose logs

# Restart bot only
docker-compose restart discord_bot

# Check database connection
docker-compose exec postgres psql -U postgres -d honeypot_bot -c "SELECT COUNT(*) FROM temp_bans;"
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details