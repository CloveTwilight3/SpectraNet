// src/commands/index.ts
import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export const commands = [
    // Basic commands
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

    // Honeypot management commands
    new SlashCommandBuilder()
        .setName('pendingbans')
        .setDescription('View pending honeypot bans (delayed due to onboarding)')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .toJSON(),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Manually unban a user and remove from database')
        .addStringOption(option =>
            option.setName('user')
                .setDescription('User ID or mention to unban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for manual unban')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .toJSON(),

    new SlashCommandBuilder()
        .setName('removehoneypot')
        .setDescription('Remove honeypot role from user and cancel pending bans')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to remove honeypot role from')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Specific honeypot role to remove (optional)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .toJSON(),

    new SlashCommandBuilder()
        .setName('cleantempbans')
        .setDescription('Clean up expired/invalid temp bans from database')
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
        .toJSON(),

    // XP SYSTEM COMMANDS
    new SlashCommandBuilder()
        .setName('usercard')
        .setDescription('View XP and level information for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to view (leave empty for yourself)')
                .setRequired(false))
        .toJSON(),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the XP leaderboard')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of users to show (max 25)')
                .setMinValue(5)
                .setMaxValue(25)
                .setRequired(false))
        .toJSON(),

    new SlashCommandBuilder()
        .setName('addlevelrole')
        .setDescription('Add a role reward for reaching a certain level')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Level required to get the role')
                .setMinValue(1)
                .setMaxValue(1000)
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to assign when level is reached')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .toJSON(),

    new SlashCommandBuilder()
        .setName('removelevelrole')
        .setDescription('Remove a level role reward')
        .addIntegerOption(option =>
            option.setName('level')
                .setDescription('Level to remove role from')
                .setMinValue(1)
                .setMaxValue(1000)
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to remove from level rewards')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .toJSON(),

    new SlashCommandBuilder()
        .setName('levelroles')
        .setDescription('View all configured level role rewards')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .toJSON(),

    new SlashCommandBuilder()
        .setName('addxp')
        .setDescription('Add XP to a user (admin only)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to add XP to')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Amount of XP to add')
                .setMinValue(1)
                .setMaxValue(10000)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .toJSON(),
];
