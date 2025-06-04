// src/services/OnboardingDetectionService.ts
import { GuildMember, Events, Client } from 'discord.js';
import { CONFIG } from '../config';
import { LoggingService } from './LoggingService';

interface OnboardingUser {
    joinedAt: Date;
    rulesAccepted: boolean;
}

export class OnboardingDetectionService {
    private onboardingUsers: Map<string, OnboardingUser> = new Map();
    private moderationService: any; // Will be set later
    private loggingService?: LoggingService; // Will be set later

    constructor(private client: Client) {}

    setModerationService(moderationService: any): void {
        this.moderationService = moderationService;
    }

    setLoggingService(service: LoggingService): void {
        this.loggingService = service;
    }

    setupOnboardingDetection(): void {
        // Track when users join
        this.client.on(Events.GuildMemberAdd, async (member) => {
            this.onboardingUsers.set(member.user.id, {
                joinedAt: new Date(),
                rulesAccepted: false
            });
            console.log(`👋 ${member.user.tag} joined - pending rules agreement (pending: ${member.pending})`);
        });

        // PRIMARY METHOD: Rules agreement completion
        this.client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
            // Check if member just completed rules agreement
            if (oldMember.pending && !newMember.pending) {
                console.log(`✅ ${newMember.user.tag} completed rules agreement - onboarding done!`);
                
                const userData = this.onboardingUsers.get(newMember.user.id);
                if (userData) {
                    userData.rulesAccepted = true;
                }
                
                // Small delay to ensure Discord has processed everything
                setTimeout(() => {
                    this.onOnboardingComplete(newMember);
                }, 5 * 1000); // 5 second delay after rules acceptance
                
                return; // Don't process other role changes if this was rules acceptance
            }

            // SECONDARY: Check for role changes during onboarding
            const userData = this.onboardingUsers.get(newMember.user.id);
            if (userData && !userData.rulesAccepted) {
                // User is still in onboarding, check if they got honeypot roles
                const newRoles = newMember.roles.cache.filter(role => 
                    !oldMember.roles.cache.has(role.id)
                );

                const honeypotRoleIds = Object.keys(CONFIG.HONEYPOT_ROLES);
                const gotHoneypotRole = newRoles.some(role => 
                    honeypotRoleIds.includes(role.id)
                );

                if (gotHoneypotRole) {
                    console.log(`🚨 ${newMember.user.tag} got honeypot role during onboarding - will punish after rules agreement`);
                    // Don't punish yet - wait for rules agreement
                }
            }
        });

        // BACKUP METHOD: First message (in case pending status doesn't work as expected)
        this.client.on(Events.MessageCreate, async (message) => {
            if (message.author.bot || !message.guild || !message.member) return;
            
            const userData = this.onboardingUsers.get(message.author.id);
            if (userData && !userData.rulesAccepted) {
                console.log(`💬 ${message.author.tag} sent first message - assuming rules accepted`);
                userData.rulesAccepted = true;
                
                setTimeout(() => {
                    this.onOnboardingComplete(message.member!);
                }, 10 * 1000); // 10 second delay after first message
            }
        });

        // CLEANUP: Remove tracking after reasonable time
        setInterval(() => {
            const now = new Date();
            for (const [userId, userData] of this.onboardingUsers.entries()) {
                const timeSinceJoin = now.getTime() - userData.joinedAt.getTime();
                
                // Clean up old tracking data after 15 minutes
                if (timeSinceJoin > 15 * 60 * 1000) {
                    this.onboardingUsers.delete(userId);
                }
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
    }

    private async onOnboardingComplete(member: GuildMember): Promise<void> {
        console.log(`🎯 Checking ${member.user.tag} for honeypot roles after onboarding completion...`);
        
        // Remove from tracking
        this.onboardingUsers.delete(member.user.id);
        
        // Check for honeypot roles
        const honeypotRoles = CONFIG.HONEYPOT_ROLES;
        const memberHoneypotRoles = member.roles.cache.filter(role => 
            honeypotRoles[role.id]
        );

        const hadHoneypotRoles = memberHoneypotRoles.size > 0;
        const roleNames = memberHoneypotRoles.map(role => role.name);

        // Log onboarding completion
        await this.loggingService?.logOnboardingComplete(member, hadHoneypotRoles, roleNames);

        if (hadHoneypotRoles) {
            const roleList = memberHoneypotRoles.map(role => role.name).join(', ');
            console.log(`🚨 ${member.user.tag} has honeypot role(s) after onboarding: ${roleList}`);
            
            // Trigger punishment for each honeypot role
            for (const [roleId, role] of memberHoneypotRoles) {
                await this.triggerHoneypotPunishment(member, roleId);
            }
        } else {
            console.log(`✅ ${member.user.tag} completed onboarding without honeypot roles`);
        }
    }

    private async triggerHoneypotPunishment(member: GuildMember, roleId: string): Promise<void> {
        console.log(`⚡ Triggering immediate punishment for ${member.user.tag} - Role: ${roleId}`);
        
        if (!this.moderationService) {
            console.error('❌ ModerationService not set in OnboardingDetectionService');
            return;
        }

        const roleConfig = CONFIG.HONEYPOT_ROLES[roleId];
        if (!roleConfig) {
            console.error(`❌ No config found for honeypot role ${roleId}`);
            return;
        }

        try {
            if (roleConfig.type === 'timeout') {
                await this.moderationService.executeTimeout(member, roleId, roleConfig.duration);
            } else {
                await this.moderationService.executeTempBan(member, roleId, roleConfig.duration);
            }
        } catch (error) {
            console.error(`❌ Error punishing ${member.user.tag}:`, error);
            await this.loggingService?.logError(
                error instanceof Error ? error.message : String(error),
                `Honeypot punishment for ${member.user.tag} (${member.user.id}) - Role: ${roleId}`
            );
        }
    }

    // Public method to check if user is still onboarding
    public isUserOnboarding(userId: string): boolean {
        const userData = this.onboardingUsers.get(userId);
        return userData ? !userData.rulesAccepted : false;
    }

    // Public method to mark onboarding complete (for manual override)
    public completeOnboarding(userId: string): void {
        this.onboardingUsers.delete(userId);
    }

    // Get count of users currently onboarding (for admin commands)
    public getOnboardingCount(): number {
        return this.onboardingUsers.size;
    }

    // Get list of users currently onboarding (for admin commands)
    public getOnboardingUsers(): { userId: string; joinedAt: Date; rulesAccepted: boolean }[] {
        return Array.from(this.onboardingUsers.entries()).map(([userId, data]) => ({
            userId,
            joinedAt: data.joinedAt,
            rulesAccepted: data.rulesAccepted
        }));
    }
}
