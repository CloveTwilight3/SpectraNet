import { HoneypotBot } from './bot/HoneypotBot';

// Initialize and start the bot
const bot = new HoneypotBot();

// Graceful shutdown handling
process.on('SIGINT', async () => {
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await bot.stop();
    process.exit(0);
});

// Start the bot
bot.start().catch(console.error);
