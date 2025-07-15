// src/services/TTSService.ts
import { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus,
    VoiceConnection,
    VoiceConnectionStatus,
    entersState
} from '@discordjs/voice';
import { VoiceChannel, VoiceBasedChannel } from 'discord.js';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';

// Import gtts using require to avoid type issues
const gtts = require('gtts');

export interface TTSOptions {
    language?: string;
    speed?: number;
    voice?: string;
}

export class TTSService {
    private connections: Map<string, VoiceConnection> = new Map();
    private players: Map<string, any> = new Map();
    private messageQueue: Map<string, string[]> = new Map();

    constructor() {
        // Create temp directory for audio files
        const tempDir = path.join(__dirname, '../../temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    }

    /**
     * Join a voice channel and set up TTS
     */
    async joinChannel(channel: VoiceBasedChannel): Promise<boolean> {
        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator as any, // Type assertion to fix compatibility
            });

            // Wait for connection to be ready
            await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

            this.connections.set(channel.guild.id, connection);
            
            // Set up connection event handlers
            connection.on(VoiceConnectionStatus.Disconnected, () => {
                this.cleanup(channel.guild.id);
            });

            console.log(`🔊 Joined voice channel: ${channel.name} in ${channel.guild.name}`);
            return true;

        } catch (error) {
            console.error('❌ Failed to join voice channel:', error);
            return false;
        }
    }

    /**
     * Leave voice channel and cleanup
     */
    async leaveChannel(guildId: string): Promise<void> {
        const connection = this.connections.get(guildId);
        if (connection) {
            connection.destroy();
            this.cleanup(guildId);
            console.log(`🔇 Left voice channel in guild ${guildId}`);
        }
    }

    /**
     * Convert text to speech and play in voice channel
     */
    async speak(guildId: string, text: string, options: TTSOptions = {}): Promise<boolean> {
        const connection = this.connections.get(guildId);
        if (!connection) {
            console.error('❌ No voice connection found for guild:', guildId);
            return false;
        }

        try {
            // Clean and prepare text
            const cleanText = this.sanitizeText(text);
            if (!cleanText) return false;

            // Generate audio
            const audioPath = await this.generateTTS(cleanText, options);
            
            // Create audio resource and play
            const resource = createAudioResource(audioPath);
            const player = createAudioPlayer();

            player.play(resource);
            connection.subscribe(player);

            // Clean up audio file after playing
            player.on(AudioPlayerStatus.Idle, () => {
                fs.unlink(audioPath, (err) => {
                    if (err) console.warn('Failed to delete temp audio file:', err);
                });
            });

            return true;

        } catch (error) {
            console.error('❌ Error playing TTS:', error);
            return false;
        }
    }

    /**
     * Queue multiple messages for TTS
     */
    async queueMessage(guildId: string, text: string): Promise<void> {
        if (!this.messageQueue.has(guildId)) {
            this.messageQueue.set(guildId, []);
        }
        
        const queue = this.messageQueue.get(guildId)!;
        queue.push(text);

        // Process queue if not already processing
        if (queue.length === 1) {
            await this.processQueue(guildId);
        }
    }

    /**
     * Process TTS message queue
     */
    private async processQueue(guildId: string): Promise<void> {
        const queue = this.messageQueue.get(guildId);
        if (!queue || queue.length === 0) return;

        const text = queue.shift()!;
        const success = await this.speak(guildId, text);

        if (success) {
            // Wait a bit before processing next message
            setTimeout(() => {
                this.processQueue(guildId);
            }, 1000);
        } else {
            // Clear queue on error
            this.messageQueue.set(guildId, []);
        }
    }

    /**
     * Generate TTS audio file using Google TTS
     */
    private async generateTTS(text: string, options: TTSOptions = {}): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const ttsInstance = new gtts(text, options.language || 'en');
                const filename = `tts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.mp3`;
                const filepath = path.join(__dirname, '../../temp', filename);

                ttsInstance.save(filepath, (err: any) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(filepath);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Sanitize text for TTS
     */
    private sanitizeText(text: string): string {
        // Remove Discord formatting
        let cleaned = text
            .replace(/<@!?\d+>/g, 'user') // User mentions
            .replace(/<@&\d+>/g, 'role') // Role mentions
            .replace(/<#\d+>/g, 'channel') // Channel mentions
            .replace(/:\w+:/g, '') // Custom emojis
            .replace(/[*_~`|]/g, '') // Discord formatting
            .replace(/https?:\/\/[^\s]+/g, 'link') // URLs
            .trim();

        // Limit length
        if (cleaned.length > 200) {
            cleaned = cleaned.substring(0, 200) + '...';
        }

        return cleaned;
    }

    /**
     * Cleanup resources for a guild
     */
    private cleanup(guildId: string): void {
        this.connections.delete(guildId);
        this.players.delete(guildId);
        this.messageQueue.delete(guildId);
    }

    /**
     * Get connection status
     */
    isConnected(guildId: string): boolean {
        const connection = this.connections.get(guildId);
        return connection?.state.status === VoiceConnectionStatus.Ready;
    }
}