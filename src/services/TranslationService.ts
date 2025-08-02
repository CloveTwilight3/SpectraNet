// src/services/TranslationService.ts
import { EmbedBuilder, Message, MessageReaction, User } from 'discord.js';
import { CONFIG } from '../config';
import { LoggingService } from './LoggingService';

interface TranslationRequest {
    originalText: string;
    targetLanguage: string;
    isCustomLanguage: boolean;
}

interface TranslationResponse {
    success: boolean;
    translatedText?: string;
    error?: string;
    detectedLanguage?: string;
}

export class TranslationService {
    private loggingService?: LoggingService;

    // Flag emoji to language mapping
    private readonly flagToLanguage: Map<string, string> = new Map([
        // Major languages
        ['🇺🇸', 'English'], ['🇬🇧', 'English'], ['🇦🇺', 'English'], ['🇨🇦', 'English'], ['🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'English'],
        ['🏴󠁧󠁢󠁷󠁬󠁳󠁿', 'Welsh'], ['🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Scottish']
        ['🇪🇸', 'Spanish'], ['🇲🇽', 'Spanish'], ['🇦🇷', 'Spanish'], ['🇨🇴', 'Spanish'],
        ['🇫🇷', 'French'], ['🇨🇦', 'French (Canadian)'],
        ['🇩🇪', 'German'], ['🇦🇹', 'German'], ['🇨🇭', 'German'],
        ['🇮🇹', 'Italian'], ['🇨🇭', 'Italian'],
        ['🇯🇵', 'Japanese'],
        ['🇰🇷', 'Korean'],
        ['🇨🇳', 'Chinese (Simplified)'], ['🇹🇼', 'Chinese (Traditional)'],
        ['🇷🇺', 'Russian'],
        ['🇵🇹', 'Portuguese'], ['🇧🇷', 'Portuguese (Brazilian)'],
        ['🇳🇱', 'Dutch'], ['🇧🇪', 'Dutch'],
        ['🇸🇪', 'Swedish'],
        ['🇳🇴', 'Norwegian'],
        ['🇩🇰', 'Danish'],
        ['🇫🇮', 'Finnish'],
        ['🇵🇱', 'Polish'],
        ['🇹🇷', 'Turkish'],
        ['🇬🇷', 'Greek'],
        ['🇮🇳', 'Hindi'],
        ['🇦🇪', 'Arabic'], ['🇸🇦', 'Arabic'], ['🇪🇬', 'Arabic'],
        ['🇮🇱', 'Hebrew'],
        ['🇹🇭', 'Thai'],
        ['🇻🇳', 'Vietnamese'],
        ['🇮🇩', 'Indonesian'],
        ['🇲🇾', 'Malay'],
        ['🇵🇭', 'Filipino'],
        ['🇭🇺', 'Hungarian'],
        ['🇨🇿', 'Czech'],
        ['🇸🇰', 'Slovak'],
        ['🇷🇴', 'Romanian'],
        ['🇧🇬', 'Bulgarian'],
        ['🇭🇷', 'Croatian'],
        ['🇷🇸', 'Serbian'],
        ['🇺🇦', 'Ukrainian'],
        ['🇱🇹', 'Lithuanian'],
        ['🇱🇻', 'Latvian'],
        ['🇪🇪', 'Estonian'],
        ['🇸🇮', 'Slovenian'],

        // Custom languages with special flags
        ['🏴‍☠️', 'PIRATE'], // Pirate flag for pirate speak
        ['🔮', 'SHAKESPEAREAN'], // Crystal ball for Shakespearean English
        ['🤖', 'ROBOT'], // Robot for robotic speech
        ['👑', 'ROYAL'], // Crown for royal/formal speech
        ['🏳️‍🌈', 'GAY'], // GAY!
        ['🏳️‍⚧️', 'GAY'],
    ]);

    // Custom server emoji mappings (you can extend this)
    private readonly customEmojiMappings: Map<string, string> = new Map([
        ['1327768099373584488', 'UWU']
    ]);

    constructor() { }

    setLoggingService(service: LoggingService): void {
        this.loggingService = service;
    }

    /**
     * Handle message reaction for translation
     */
    async handleTranslationReaction(
        reaction: MessageReaction,
        user: User,
        message: Message
    ): Promise<void> {
        // Don't respond to bot reactions
        if (user.bot) return;

        // Don't translate empty messages
        if (!message.content.trim()) return;

        // Only exclude messages from THIS bot (prevent translation loops)
        // Check if the message author is the same as the bot that received the reaction
        if (message.author.id === reaction.message.client.user?.id) {
            console.log(`🚫 Skipping translation of own message from ${message.author.tag}`);
            return;
        }

        try {
            const targetLanguage = await this.getLanguageFromReaction(reaction);
            if (!targetLanguage) return; // Not a translation emoji

            // Determine message type for better logging
            const isWebhook = message.webhookId !== null;
            const isBot = message.author.bot;
            const messageType = isWebhook ? 'webhook' : 
                              isBot ? 'bot' : 'user';
            
            // Enhanced logging to show what we're translating
            const authorName = isWebhook ? `${message.author.username} (webhook)` : message.author.tag;
            console.log(`🌐 Translation requested (${messageType}): "${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}" -> ${targetLanguage} by ${user.tag} (from ${authorName})`);

            // Check if message is too long
            if (message.content.length > 2000) {
                await this.sendTranslationError(message, user, 'Message too long for translation (max 2000 characters)');
                return;
            }

            // Perform translation
            const translationResult = await this.translateText({
                originalText: message.content,
                targetLanguage,
                isCustomLanguage: this.isCustomLanguage(targetLanguage)
            });

            if (translationResult.success && translationResult.translatedText) {
                await this.sendTranslationResult(
                    message,
                    user,
                    translationResult.translatedText,
                    targetLanguage,
                    translationResult.detectedLanguage,
                    messageType
                );
            } else {
                await this.sendTranslationError(message, user, translationResult.error || 'Translation failed');
            }

        } catch (error) {
            console.error('❌ Error handling translation reaction:', error);
            await this.sendTranslationError(message, user, 'An error occurred during translation');

            await this.loggingService?.logError(
                error instanceof Error ? error.message : String(error),
                `Translation error for user ${user.tag}`
            );
        }
    }

    /**
    * Get target language from reaction emoji
    */
    private async getLanguageFromReaction(reaction: MessageReaction): Promise<string | null> {
        const emoji = reaction.emoji;

        // Check for Unicode flag emojis first
        if (emoji.name && this.flagToLanguage.has(emoji.name)) {
            return this.flagToLanguage.get(emoji.name)!;
        }

        // Check for custom server emojis by ID
        if (emoji.id && this.customEmojiMappings.has(emoji.id)) {
            console.log(`🎭 Custom emoji detected: ${emoji.name} (${emoji.id})`);
            return this.customEmojiMappings.get(emoji.id)!;
        }
        return null;
    }

    /**
     * Check if language is a custom language style
     */
    private isCustomLanguage(language: string): boolean {
        const customLanguages = ['PIRATE', 'UWU', 'OWO', 'BABY_TALK', 'GEN_Z', 'BOOMER',
            'SHAKESPEAREAN', 'ROBOT', 'ROYAL', 'FORMAL', 'CASUAL', 'GAY'];
        return customLanguages.includes(language);
    }

    /**
 * Translate text using OpenAI
 */
    private async translateText(request: TranslationRequest): Promise<TranslationResponse> {
        if (!CONFIG.OPENAI.API_KEY) {
            return {
                success: false,
                error: 'OpenAI API key not configured'
            };
        }

        try {
            const prompt = this.buildTranslationPrompt(request);

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${CONFIG.OPENAI.API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: CONFIG.OPENAI.MODEL,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are a professional translator. Provide accurate translations and detect the source language.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    max_tokens: CONFIG.OPENAI.MAX_TOKENS,
                    temperature: request.isCustomLanguage ? 0.8 : 0.3, // Higher creativity for custom languages
                }),
            });

            if (!response.ok) {
                let errorMessage = 'Unknown error';
                try {
                    const errorData: any = await response.json();
                    errorMessage = errorData.error?.message || 'Unknown error';
                } catch (e) {
                    errorMessage = `HTTP ${response.status}`;
                }
                throw new Error(`OpenAI API error: ${response.status} - ${errorMessage}`);
            }

            const data: any = await response.json();
            const translatedText = data.choices?.[0]?.message?.content?.trim();

            if (!translatedText) {
                throw new Error('Empty response from OpenAI');
            }

            return {
                success: true,
                translatedText,
                detectedLanguage: 'auto-detected' // OpenAI doesn't return detected language directly
            };

        } catch (error) {
            console.error('❌ OpenAI translation error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown translation error'
            };
        }
    }

    /**
     * Build translation prompt for OpenAI
     */
    private buildTranslationPrompt(request: TranslationRequest): string {
        if (request.isCustomLanguage) {
            return this.buildCustomLanguagePrompt(request);
        }

        return `Please translate the following text to ${request.targetLanguage}. 
Only provide the translation, no explanations:

"${request.originalText}"`;
    }

    /**
     * Build custom language style prompts
     */
    private buildCustomLanguagePrompt(request: TranslationRequest): string {
        const prompts = {
            'GAY': `Transform the following text into gay-like speech using authentic gay language, 
terminology, and speech patterns. Use words like "slay", "glam" etcOnly provide the translation, no explanations:

"${request.originalText}"`,
            'PIRATE': `Transform the following text into pirate speak using authentic pirate language, 
terminology, and speech patterns. Use words like "ye", "arr", "matey", "scurvy", etc. Only provide the translation, no explanations:

"${request.originalText}"`,

            'UWU': `Transform the following text into UwU speak by replacing certain letters 
(r/l with w, n with ny, etc.) and adding cute expressions like "uwu", "owo", ">.<" Only provide the translation, no explanations:

"${request.originalText}"`,

            'OWO': `Transform the following text into OwO speak similar to UwU but with "owo" 
expressions and cat-like speech patterns. Only provide the translation, no explanations:

"${request.originalText}"`,

            'BABY_TALK': `Transform the following text into baby talk using simple words, 
repetition, and childlike expressions. Only provide the translation, no explanations:

"${request.originalText}"`,

            'GEN_Z': `Transform the following text into Gen Z slang using terms like "no cap", 
"fr", "slaps", "based", "slay", etc. Only provide the translation, no explanations:

"${request.originalText}"`,

            'BOOMER': `Transform the following text into how a boomer might speak, using 
formal language and boomer expressions. Only provide the translation, no explanations:

"${request.originalText}"`,

            'SHAKESPEAREAN': `Transform the following text into Shakespearean English using 
"thou", "thee", "thy", "hath", etc. Only provide the translation, no explanations:

"${request.originalText}"`,

            'ROBOT': `Transform the following text into robotic speech with technical 
terminology and robotic expressions. Only provide the translation, no explanations:

"${request.originalText}"`,

            'ROYAL': `Transform the following text into royal/formal speech as if spoken 
by royalty with proper etiquette. Only provide the translation, no explanations:

"${request.originalText}"`,

            'FORMAL': `Transform the following text into very formal, professional language. Only provide the translation, no explanations:

"${request.originalText}"`,

            'CASUAL': `Transform the following text into very casual, informal speech. Only provide the translation, no explanations:

"${request.originalText}"`
        };

        return prompts[request.targetLanguage as keyof typeof prompts] ||
            `Transform the text in the style of ${request.targetLanguage}: "${request.originalText}"`;
    }

    /**
     * Send translation result to Discord
     */
    private async sendTranslationResult(
        originalMessage: Message,
        requester: User,
        translation: string,
        targetLanguage: string,
        detectedLanguage?: string,
        messageType?: string
    ): Promise<void> {
        try {
            // Get the original author info, handling webhooks and bots differently
            let authorInfo = originalMessage.author.username;
            
            if (originalMessage.webhookId) {
                authorInfo = `${originalMessage.author.username}`;
            } else if (originalMessage.author.bot && originalMessage.author.id !== originalMessage.client.user?.id) {
                authorInfo = `${originalMessage.author.username}`;
            }

            const embed = new EmbedBuilder()
                .setTitle('🌐 Translation')
                .setColor(0x4A90E2)
                .addFields(
                    {
                        name: `📝 Original (${authorInfo})`,
                        value: originalMessage.content.length > 1000
                            ? originalMessage.content.substring(0, 1000) + '...'
                            : originalMessage.content,
                        inline: false
                    },
                    {
                        name: `🎯 ${targetLanguage}`,
                        value: translation.length > 1000
                            ? translation.substring(0, 1000) + '...'
                            : translation,
                        inline: false
                    }
                )
                .setFooter({
                    text: `Requested by ${requester.username}${messageType ? ` • Source: ${messageType}` : ''}`,
                    iconURL: requester.displayAvatarURL({ size: 32 })
                })
                .setTimestamp();

            await originalMessage.reply({ embeds: [embed] });

            console.log(`✅ Translation sent: ${targetLanguage} for ${messageType} message from ${authorInfo}`);

        } catch (error) {
            console.error('❌ Error sending translation result:', error);
            // Fallback to simple text message
            try {
                await originalMessage.reply(`🌐 **Translation to ${targetLanguage}:**\n${translation}`);
            } catch (fallbackError) {
                console.error('❌ Error sending fallback translation:', fallbackError);
            }
        }
    }

    /**
     * Send translation error message
     */
    private async sendTranslationError(
        originalMessage: Message,
        requester: User,
        errorMessage: string
    ): Promise<void> {
        try {
            const embed = new EmbedBuilder()
                .setTitle('❌ Translation Error')
                .setColor(0xFF4444)
                .setDescription(errorMessage)
                .setFooter({
                    text: `Requested by ${requester.username}`,
                    iconURL: requester.displayAvatarURL({ size: 32 })
                })
                .setTimestamp();

            await originalMessage.reply({ embeds: [embed] });
        } catch (error) {
            console.error('❌ Error sending translation error:', error);
        }
    }

    /**
     * Get list of supported languages for help command
     */
    getSupportedLanguages(): string[] {
        const languages = Array.from(new Set(this.flagToLanguage.values()));
        const customLanguages = Array.from(this.customEmojiMappings.values());
        return [...languages, ...customLanguages].sort();
    }

    /**
     * Get flag emoji for a language (for help display)
     */
    getLanguageFlags(): { [language: string]: string[] } {
        const result: { [language: string]: string[] } = {};

        for (const [flag, language] of this.flagToLanguage.entries()) {
            if (!result[language]) {
                result[language] = [];
            }
            result[language].push(flag);
        }

        return result;
    }
}