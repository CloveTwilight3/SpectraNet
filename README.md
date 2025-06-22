# SpectraNet

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

## License

MIT License - see LICENSE file for details
