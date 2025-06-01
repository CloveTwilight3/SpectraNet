import { SlashCommandBuilder } from 'discord.js';

export const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Test command to check if the bot is responsive')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('tempbans')
        .setDescription('View active temporary bans')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('userinfo')
        .setDescription('Get user information from mention or user ID')
        .addStringOption(option =>
            option.setName('user')
                .setDescription('User mention (@user) or User ID (e.g., 123456789012345678)')
                .setRequired(true))
        .toJSON(),
];
