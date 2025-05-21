// Discord Ban Bot - TypeScript
// This bot bans users for specific durations based on their roles
// and sends them a DM with an embedded message

import { 
  Client, 
  GatewayIntentBits, 
  Partials, 
  EmbedBuilder, 
  PermissionsBitField,
  ApplicationCommandOptionType,
  CommandInteraction,
  GuildMember,
  Role
} from 'discord.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Define role IDs and their ban durations in milliseconds
const ROLE_BAN_DURATIONS = {
  // Replace these with your actual role IDs
  'ROLE_ID_1': 1000 * 60 * 60 * 24 * 30 * 6,     // 6 months
  'ROLE_ID_2': 1000 * 60 * 60 * 24 * 365,         // 1 year
  'ROLE_ID_3': 1000 * 60 * 60 * 24 * 365 * 6      // 6 years
};

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
  
  // Register slash commands
  const guilds = client.guilds.cache;
  
  guilds.forEach(async (guild) => {
    // Register tempban command
    await guild.commands.create({
      name: 'tempban',
      description: 'Temporarily ban a user based on their role',
      options: [
        {
          name: 'user',
          description: 'The user to ban',
          type: ApplicationCommandOptionType.User,
          required: true
        },
        {
          name: 'reason',
          description: 'Reason for the ban',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    });
    
    // Register ping command
    await guild.commands.create({
      name: 'ping',
      description: 'Check the bot\'s latency'
    });
    
    console.log(`Commands registered in guild: ${guild.name}`);
  });
});

// Interaction handler for slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  
  const { commandName } = interaction;
  
  if (commandName === 'tempban') {
    await handleTempBanCommand(interaction);
  } else if (commandName === 'ping') {
    await handlePingCommand(interaction);
  }
});

// Function to handle the tempban command
async function handleTempBanCommand(interaction: CommandInteraction) {
  // Check if the user has permission to ban
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.BanMembers)) {
    await interaction.reply({ content: 'You do not have permission to ban members!', ephemeral: true });
    return;
  }
  
  // Get the target user
  const targetUser = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  
  if (!targetUser) {
    await interaction.reply({ content: 'Invalid user specified.', ephemeral: true });
    return;
  }
  
  // Get the guild member for the target user
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }
  
  try {
    const member = await guild.members.fetch(targetUser.id);
    
    // Check if the member can be banned
    if (!member.bannable) {
      await interaction.reply({ content: 'I cannot ban this user. They may have higher permissions than me.', ephemeral: true });
      return;
    }
    
    // Determine ban duration based on roles
    const banDuration = getBanDurationFromRoles(member);
    
    if (banDuration === 0) {
      await interaction.reply({ content: 'This user does not have any roles that qualify for a temporary ban.', ephemeral: true });
      return;
    }
    
    // Calculate unban date
    const unbanDate = new Date(Date.now() + banDuration);
    
    // Create and send DM with embed
    await sendBanDM(member, reason, unbanDate);
    
    // Ban the user
    await member.ban({ reason: `${reason} | Until: ${unbanDate.toLocaleString()}` });
    
    // Set timeout to unban the user
    setTimeout(async () => {
      try {
        await guild.members.unban(targetUser.id, 'Temporary ban expired');
        console.log(`Unbanned user ${targetUser.tag} (${targetUser.id})`);
      } catch (error) {
        console.error('Error unbanning user:', error);
      }
    }, banDuration);
    
    // Format ban duration for display
    const durationText = formatBanDuration(banDuration);
    
    await interaction.reply({
      content: `Banned ${targetUser.tag} for ${durationText}. Reason: ${reason}`,
      ephemeral: false
    });
    
  } catch (error) {
    console.error('Error in tempban command:', error);
    await interaction.reply({
      content: 'An error occurred while trying to ban the user.',
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
        { name: 'Uptime', value: formatUptime(client.uptime || 0) }
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
