// Discord Ban Bot - TypeScript
// This bot automatically bans users when they receive specific roles
// and sends them a DM with an embedded message

import { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  EmbedBuilder, 
  PermissionsBitField,
  ApplicationCommandOptionType,
  CommandInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  Role
} from 'discord.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Define role IDs and their ban durations in milliseconds
const ROLE_BAN_DURATIONS = {
  '1312878122005168168': 1000 * 60 * 60 * 24 * 30 * 3,    // 3 months
  '1312872484546285630': 1000 * 60 * 60 * 24 * 365,        // 1 year
  '1312877981311565835': 1000 * 60 * 60 * 24 * 365 * 6     // 6 years
};

// Check if testing is enabled
const TESTING_ENABLED = process.env.TESTING_ENABLED === 'true';

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel] // Needed for DMs
});

// Bot ready event
client.once('ready', () => {
  console.log(`Logged in as ${client.user?.tag}`);
  console.log(`Testing mode: ${TESTING_ENABLED ? 'ENABLED' : 'DISABLED'}`);
  
  // Register slash commands
  const guilds = client.guilds.cache;
  
  guilds.forEach(async (guild) => {
    // Always register ping command
    await guild.commands.create({
      name: 'ping',
      description: 'Check the bot\'s latency'
    });
    
    // Register test commands only if testing is enabled
    if (TESTING_ENABLED) {
      await guild.commands.create({
        name: 'testban',
        description: '[TEST] Manually test the ban system on a user',
        options: [
          {
            name: 'user',
            description: 'The user to test ban',
            type: ApplicationCommandOptionType.User,
            required: true
          },
          {
            name: 'reason',
            description: 'Reason for the test ban',
            type: ApplicationCommandOptionType.String,
            required: false
          }
        ]
      });
      
      await guild.commands.create({
        name: 'checkroles',
        description: '[TEST] Check what roles a user has and their ban duration',
        options: [
          {
            name: 'user',
            description: 'The user to check',
            type: ApplicationCommandOptionType.User,
            required: true
          }
        ]
      });
    }
    
    console.log(`Commands registered in guild: ${guild.name}`);
  });
});

// Listen for role updates (when users get new roles)
client.on('guildMemberUpdate', async (oldMember, newMember) => {
  try {
    // Check if any new roles were added
    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    
    if (addedRoles.size > 0) {
      // Check if any of the added roles require a ban
      for (const [roleId] of addedRoles) {
        if (ROLE_BAN_DURATIONS[roleId as keyof typeof ROLE_BAN_DURATIONS]) {
          console.log(`User ${newMember.user.tag} received bannable role ${roleId}`);
          await handleAutomaticBan(newMember, `Automatically banned for receiving role: ${addedRoles.get(roleId)?.name}`);
          break; // Only need to ban once
        }
      }
    }
  } catch (error) {
    console.error('Error in guildMemberUpdate:', error);
  }
});

// Listen for new members joining (in case they already have the roles)
client.on('guildMemberAdd', async (member) => {
  try {
    // Check if the new member already has any bannable roles
    const banDuration = getBanDurationFromRoles(member);
    
    if (banDuration > 0) {
      console.log(`New member ${member.user.tag} joined with bannable roles`);
      await handleAutomaticBan(member, 'Automatically banned for having restricted role upon joining');
    }
  } catch (error) {
    console.error('Error in guildMemberAdd:', error);
  }
});

// Interaction handler for slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  
  const { commandName } = interaction;
  
  if (commandName === 'ping') {
    await handlePingCommand(interaction);
  } else if (commandName === 'testban' && TESTING_ENABLED) {
    await handleTestBanCommand(interaction);
  } else if (commandName === 'checkroles' && TESTING_ENABLED) {
    await handleCheckRolesCommand(interaction);
  }
});

// Function to handle automatic banning
async function handleAutomaticBan(member: GuildMember, reason: string) {
  try {
    // Check if the member can be banned
    if (!member.bannable) {
      console.log(`Cannot ban ${member.user.tag} - insufficient permissions`);
      return;
    }
    
    // Determine ban duration based on roles
    const banDuration = getBanDurationFromRoles(member);
    
    if (banDuration === 0) {
      console.log(`No bannable roles found for ${member.user.tag}`);
      return;
    }
    
    // Calculate unban date
    const unbanDate = new Date(Date.now() + banDuration);
    
    // Create and send DM with embed
    await sendBanDM(member, reason, unbanDate);
    
    // Ban the user
    await member.ban({ reason: `${reason} | Until: ${unbanDate.toLocaleString()}` });
    
    // Log the ban
    const durationText = formatBanDuration(banDuration);
    console.log(`Banned ${member.user.tag} for ${durationText}. Reason: ${reason}`);
    
    // Set timeout to unban the user
    setTimeout(async () => {
      try {
        await member.guild.members.unban(member.user.id, 'Temporary ban expired');
        console.log(`Unbanned user ${member.user.tag} (${member.user.id})`);
      } catch (error) {
        console.error('Error unbanning user:', error);
      }
    }, banDuration);
    
  } catch (error) {
    console.error('Error in automatic ban:', error);
  }
}

// Function to handle the test ban command (only available in testing mode)
async function handleTestBanCommand(interaction: CommandInteraction) {
  // Check if the user has permission to ban
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.BanMembers)) {
    await interaction.reply({ content: 'You do not have permission to ban members!', ephemeral: true });
    return;
  }
  
  if (!interaction.isChatInputCommand()) return;
  
  const targetUser = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'Test ban';
  
  if (!targetUser) {
    await interaction.reply({ content: 'Invalid user specified.', ephemeral: true });
    return;
  }
  
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  try {
    const member = await guild.members.fetch(targetUser.id);
    
    await interaction.reply({ content: `Testing ban system on ${targetUser.tag}...`, ephemeral: true });
    await handleAutomaticBan(member, `[TEST] ${reason}`);
    
  } catch (error) {
    console.error('Error in test ban command:', error);
    await interaction.reply({
      content: 'An error occurred while testing the ban system.',
      ephemeral: true
    });
  }
}

// Function to handle the check roles command (only available in testing mode)
async function handleCheckRolesCommand(interaction: CommandInteraction) {
  if (!interaction.isChatInputCommand()) return;
  
  const targetUser = interaction.options.getUser('user');
  
  if (!targetUser) {
    await interaction.reply({ content: 'Invalid user specified.', ephemeral: true });
    return;
  }
  
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  try {
    const member = await guild.members.fetch(targetUser.id);
    const banDuration = getBanDurationFromRoles(member);
    
    const embed = new EmbedBuilder()
      .setTitle('🔍 Role Check Results')
      .setColor('#0099FF')
      .setDescription(`Role analysis for ${targetUser.tag}`)
      .addFields(
        { name: 'User', value: `${targetUser.tag} (${targetUser.id})` },
        { name: 'Total Roles', value: member.roles.cache.size.toString() },
        { name: 'Ban Duration', value: banDuration > 0 ? formatBanDuration(banDuration) : 'No bannable roles' }
      );
    
    // List bannable roles
    const bannableRoles: string[] = [];
    member.roles.cache.forEach((role: Role) => {
      const duration = ROLE_BAN_DURATIONS[role.id as keyof typeof ROLE_BAN_DURATIONS];
      if (duration) {
        bannableRoles.push(`${role.name} (${formatBanDuration(duration)})`);
      }
    });
    
    if (bannableRoles.length > 0) {
      embed.addFields({ name: 'Bannable Roles', value: bannableRoles.join('\n') });
    }
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
    
  } catch (error) {
    console.error('Error in check roles command:', error);
    await interaction.reply({
      content: 'An error occurred while checking roles.',
      ephemeral: true
    });
  }
}

// Function to get ban duration based on roles
function getBanDurationFromRoles(member: GuildMember): number {
  let maxDuration = 0;
  
  // Check each role the member has
  member.roles.cache.forEach((role: Role) => {
    const duration = ROLE_BAN_DURATIONS[role.id as keyof typeof ROLE_BAN_DURATIONS];
    if (duration && duration > maxDuration) {
      maxDuration = duration;
    }
  });
  
  return maxDuration;
}

// Function to handle the ping command
async function handlePingCommand(interaction: CommandInteraction) {
  try {
    // Check if this is a chat input command
    if (!interaction.isChatInputCommand()) return;
    
    // Initial response
    const initialResponse = await interaction.reply({ 
      content: '📡 Pinging...',
      fetchReply: true
    });
    
    // Calculate different latency metrics
    const apiLatency = Math.round(client.ws.ping); // WebSocket latency
    
    // Calculate round-trip latency (time between command and response)
    const roundTripLatency = initialResponse.createdTimestamp - interaction.createdTimestamp;
    
    // Create an embed with the latency information
    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setColor('#00FF00')
      .addFields(
        { name: 'API Latency', value: `${apiLatency}ms`, inline: true },
        { name: 'Round-trip Latency', value: `${roundTripLatency}ms`, inline: true },
        { name: 'Uptime', value: formatUptime(client.uptime || 0) },
        { name: 'Testing Mode', value: TESTING_ENABLED ? '✅ Enabled' : '❌ Disabled', inline: true }
      )
      .setFooter({ text: 'Bot Status' })
      .setTimestamp();
    
    // Edit the initial response with the embed
    await interaction.editReply({ content: '', embeds: [embed] });
  } catch (error) {
    console.error('Error in ping command:', error);
    await interaction.reply({
      content: 'An error occurred while checking latency.',
      ephemeral: true
    });
  }
}

// Helper function to format uptime
function formatUptime(uptime: number): string {
  const seconds = Math.floor(uptime / 1000) % 60;
  const minutes = Math.floor(uptime / (1000 * 60)) % 60;
  const hours = Math.floor(uptime / (1000 * 60 * 60)) % 24;
  const days = Math.floor(uptime / (1000 * 60 * 60 * 24));
  
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// Function to send a DM with embed to the banned user
async function sendBanDM(member: GuildMember, reason: string, unbanDate: Date) {
  try {
    const embed = new EmbedBuilder()
      .setTitle('🚫 You have been banned')
      .setColor('#FF0000')
      .setDescription(`You have been temporarily banned from ${member.guild.name}`)
      .addFields(
        { name: 'Reason', value: reason },
        { name: 'Ban expires', value: unbanDate.toLocaleString() },
        { name: 'Appeal Information', value: 'If you think this ban has been in error, you can email mods@transgamers.org' }
      )
      .setTimestamp()
      .setFooter({ text: `${member.guild.name} Moderation` });
    
    await member.send({ embeds: [embed] });
  } catch (error) {
    console.error('Could not send DM to banned user:', error);
  }
}

// Helper function to format ban duration for display
function formatBanDuration(duration: number): string {
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(months / 12);
  
  if (years > 0) {
    const remainingMonths = months % 12;
    if (remainingMonths > 0) {
      return `${years} year${years !== 1 ? 's' : ''} and ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
    } else {
      return `${years} year${years !== 1 ? 's' : ''}`;
    }
  } else if (months > 0) {
    return `${months} month${months !== 1 ? 's' : ''}`;
  } else if (days > 0) {
    return `${days} day${days !== 1 ? 's' : ''}`;
  } else if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    return `${seconds} second${seconds !== 1 ? 's' : ''}`;
  }
}

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Login to Discord with the bot token
client.login(process.env.DISCORD_TOKEN);