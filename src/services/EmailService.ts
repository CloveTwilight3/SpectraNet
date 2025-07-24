// src/services/EmailService.ts
import { ConfidentialClientApplication } from '@azure/msal-node';
import axios from 'axios';
import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { CONFIG } from '../config';
import { LoggingService } from './LoggingService';

interface EmailMessage {
    id: string;
    subject: string;
    from: {
        emailAddress: {
            name: string;
            address: string;
        };
    };
    receivedDateTime: string;
    bodyPreview: string;
    body: {
        content: string;
        contentType: string;
    };
    hasAttachments: boolean;
    importance: string;
    isRead: boolean;
}

export class EmailService {
    private msalClient: ConfidentialClientApplication | null = null;
    private accessToken: string | null = null;
    private pollInterval: NodeJS.Timeout | null = null;
    private lastCheckTime: Date = new Date();
    private forwardChannel: TextChannel | null = null;
    private loggingService?: LoggingService;

    constructor(private discordClient: Client) {
        this.initializeMSAL();
    }

    setLoggingService(service: LoggingService): void {
        this.loggingService = service;
    }

    private initializeMSAL(): void {
        if (!CONFIG.EMAIL.CLIENT_ID || !CONFIG.EMAIL.CLIENT_SECRET || !CONFIG.EMAIL.TENANT_ID) {
            console.warn('⚠️ Email forwarding disabled - Missing Microsoft Graph credentials');
            return;
        }

        const clientConfig = {
            auth: {
                clientId: CONFIG.EMAIL.CLIENT_ID,
                clientSecret: CONFIG.EMAIL.CLIENT_SECRET,
                authority: `https://login.microsoftonline.com/${CONFIG.EMAIL.TENANT_ID}`,
            },
        };

        this.msalClient = new ConfidentialClientApplication(clientConfig);
        console.log('✅ Microsoft Graph client initialized');
    }

    async initialize(): Promise<void> {
        if (!this.msalClient || !CONFIG.EMAIL.FORWARD_CHANNEL_ID) {
            console.warn('⚠️ Email service not initialized - Missing configuration');
            return;
        }

        try {
            // Get access token
            await this.getAccessToken();

            // Get Discord channel
            const channel = await this.discordClient.channels.fetch(CONFIG.EMAIL.FORWARD_CHANNEL_ID);
            if (channel?.isTextBased() && channel.type === 0) {
                this.forwardChannel = channel as TextChannel;
                console.log(`✅ Email forwarding channel set: #${this.forwardChannel.name}`);
            } else {
                throw new Error('Forward channel is not a text channel');
            }

            // Start polling for emails
            this.startPolling();

            console.log('✅ Email service initialized successfully');
            await this.loggingService?.logSimple('📧 Email forwarding system started');

        } catch (error) {
            console.error('❌ Failed to initialize email service:', error);
            await this.loggingService?.logError(
                error instanceof Error ? error.message : String(error),
                'Email service initialization'
            );
        }
    }

    private async getAccessToken(): Promise<void> {
        if (!this.msalClient) throw new Error('MSAL client not initialized');

        try {
            const clientCredentialRequest = {
                scopes: ['https://graph.microsoft.com/.default'],
            };

            const response = await this.msalClient.acquireTokenByClientCredential(clientCredentialRequest);

            if (!response?.accessToken) {
                throw new Error('Failed to acquire access token');
            }

            this.accessToken = response.accessToken;
            console.log('✅ Access token acquired');

        } catch (error) {
            console.error('❌ Failed to get access token:', error);
            throw error;
        }
    }

    private startPolling(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }

        const intervalMs = CONFIG.EMAIL.POLL_INTERVAL * 60 * 1000; // Convert minutes to milliseconds

        this.pollInterval = setInterval(async () => {
            try {
                await this.checkForNewEmails();
            } catch (error) {
                console.error('❌ Error checking emails:', error);
                await this.loggingService?.logError(
                    error instanceof Error ? error.message : String(error),
                    'Email polling'
                );
            }
        }, intervalMs);

        console.log(`📧 Email polling started (every ${CONFIG.EMAIL.POLL_INTERVAL} minutes)`);
    }

    private async checkForNewEmails(): Promise<void> {
        if (!this.accessToken || !this.forwardChannel) return;

        try {
            // Format the last check time for Microsoft Graph API
            const lastCheckISO = this.lastCheckTime.toISOString();

            // Build filter query
            const filters = [`receivedDateTime ge ${lastCheckISO}`];

            // Add sender filter if configured
            if (CONFIG.EMAIL.FORWARD_FROM_ADDRESSES.length > 0) {
                const fromFilters = CONFIG.EMAIL.FORWARD_FROM_ADDRESSES
                    .map(email => `from/emailAddress/address eq '${email}'`)
                    .join(' or ');
                filters.push(`(${fromFilters})`);
            }

            // Add subject filter if configured
            if (CONFIG.EMAIL.FORWARD_SUBJECT_CONTAINS.length > 0) {
                const subjectFilters = CONFIG.EMAIL.FORWARD_SUBJECT_CONTAINS
                    .map(keyword => `contains(subject,'${keyword}')`)
                    .join(' or ');
                filters.push(`(${subjectFilters})`);
            }

            const filterQuery = filters.join(' and ');

            const response = await axios.get(
                `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filterQuery)}&$select=id,subject,from,receivedDateTime,bodyPreview,body,hasAttachments,importance,isRead&$orderby=receivedDateTime desc&$top=50`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            const emails: EmailMessage[] = response.data.value;

            if (emails.length > 0) {
                console.log(`📧 Found ${emails.length} new email(s) to forward`);

                // Process emails in reverse order (oldest first)
                for (const email of emails.reverse()) {
                    await this.forwardEmail(email);
                }
            }

            this.lastCheckTime = new Date();

        } catch (error: any) {
            console.error('❌ Error checking for emails:', error);

            // If token expired, try to get a new one
            if (error.response?.status === 401) {
                console.log('🔄 Access token expired, refreshing...');
                await this.getAccessToken();
            }

            throw error;
        }
    }

    private async forwardEmail(email: EmailMessage): Promise<void> {
        if (!this.forwardChannel) return;

        try {
            // Extract text from HTML body
            const bodyText = this.extractTextFromHTML(email.body.content);
            const truncatedBody = bodyText.length > CONFIG.EMAIL.MAX_BODY_LENGTH
                ? bodyText.substring(0, CONFIG.EMAIL.MAX_BODY_LENGTH) + '...'
                : bodyText;

            // Create embed
            const embed = new EmbedBuilder()
                .setTitle(`📧 New Email: ${email.subject}`)
                .setColor(email.isRead ? 0x808080 : 0x0078D4) // Gray if read, blue if unread
                .addFields(
                    {
                        name: '👤 From',
                        value: `${email.from.emailAddress.name || 'Unknown'} <${email.from.emailAddress.address}>`,
                        inline: false
                    },
                    {
                        name: '📅 Received',
                        value: `<t:${Math.floor(new Date(email.receivedDateTime).getTime() / 1000)}:f>`,
                        inline: true
                    },
                    {
                        name: '🔗 ID',
                        value: `\`${email.id.substring(0, 20)}...\``,
                        inline: true
                    }
                )
                .setTimestamp(new Date(email.receivedDateTime));

            // Add importance indicator
            if (email.importance === 'high') {
                embed.addFields({
                    name: '⚠️ Priority',
                    value: 'High',
                    inline: true
                });
            }

            // Add attachments indicator
            if (email.hasAttachments) {
                embed.addFields({
                    name: '📎 Attachments',
                    value: 'Yes',
                    inline: true
                });
            }

            // Add body preview
            if (truncatedBody.trim()) {
                embed.addFields({
                    name: '📄 Preview',
                    value: truncatedBody.substring(0, 1024), // Discord field limit
                    inline: false
                });
            }

            await this.forwardChannel.send({ embeds: [embed] });

            console.log(`📧 Forwarded email: ${email.subject} from ${email.from.emailAddress.address}`);

        } catch (error) {
            console.error('❌ Error forwarding email:', error);
            await this.loggingService?.logError(
                error instanceof Error ? error.message : String(error),
                `Forwarding email: ${email.subject}`
            );
        }
    }

    private extractTextFromHTML(html: string): string {
        // Simple HTML to text conversion
        return html
            .replace(/<style[^>]*>.*?<\/style>/gi, '') // Remove style tags
            .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remove script tags
            .replace(/<[^>]+>/g, '') // Remove HTML tags
            .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
            .replace(/&amp;/g, '&') // Replace &amp; with &
            .replace(/&lt;/g, '<') // Replace &lt; with 
            .replace(/&gt;/g, '>') // Replace &gt; with >
            .replace(/&quot;/g, '"') // Replace &quot; with "
            .replace(/&#39;/g, "'") // Replace &#39; with '
            .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
            .trim();
    }

    async markEmailAsRead(emailId: string): Promise<boolean> {
        if (!this.accessToken) return false;

        try {
            await axios.patch(
                `https://graph.microsoft.com/v1.0/me/messages/${emailId}`,
                { isRead: true },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            return true;
        } catch (error) {
            console.error('❌ Error marking email as read:', error);
            return false;
        }
    }

    async testConnection(): Promise<boolean> {
        if (!this.accessToken) {
            try {
                await this.getAccessToken();
            } catch (error) {
                return false;
            }
        }

        try {
            const response = await axios.get(
                'https://graph.microsoft.com/v1.0/me',
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }
            );

            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    stop(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
            console.log('🛑 Email polling stopped');
        }
    }

    // Get service status for admin commands
    getStatus(): {
        isRunning: boolean;
        lastCheck: Date;
        channelName: string | null;
        pollInterval: number;
    } {
        return {
            isRunning: this.pollInterval !== null,
            lastCheck: this.lastCheckTime,
            channelName: this.forwardChannel?.name || null,
            pollInterval: CONFIG.EMAIL.POLL_INTERVAL,
        };
    }
}