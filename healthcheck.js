const { Client, GatewayIntentBits } = require('discord.js');

// Simple health check script
async function healthCheck() {
    try {
        // Check if bot token exists
        if (!process.env.DISCORD_TOKEN) {
            console.error('Health check failed: DISCORD_TOKEN not found');
            process.exit(1);
        }

        // Create a minimal client for health check
        const client = new Client({
            intents: [GatewayIntentBits.Guilds],
        });

        // Set a timeout for the health check
        const timeout = setTimeout(() => {
            console.error('Health check failed: Connection timeout');
            client.destroy();
            process.exit(1);
        }, 10000); // 10 second timeout

        client.once('ready', () => {
            clearTimeout(timeout);
            console.log('Health check passed: Bot is responsive');
            client.destroy();
            process.exit(0);
        });

        client.once('error', (error) => {
            clearTimeout(timeout);
            console.error('Health check failed:', error.message);
            client.destroy();
            process.exit(1);
        });

        // Attempt to login
        await client.login(process.env.DISCORD_TOKEN);

    } catch (error) {
        console.error('Health check failed:', error.message);
        process.exit(1);
    }
}

// Run health check
healthCheck();
