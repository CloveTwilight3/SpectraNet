# Privacy Policy

**Effective Date:** 24th May, 2025 
**Last Updated:** 24tb May 2025

## Introduction

This Privacy Policy describes how our Discord Honeypot Bot ("the Bot", "we", "us", or "our") collects, uses, and protects information when you use our services on Discord. By using the Bot, you agree to the collection and use of information in accordance with this policy.

## Information We Collect

### Automatically Collected Information

**Discord User Data:**
- User ID (unique Discord identifier)
- Username and discriminator
- Server/Guild ID where the Bot operates
- Role assignments and changes
- Message content in monitored channels (immediately deleted)
- Timestamps of user actions

**Moderation Data:**
- Records of timeouts and temporary bans
- Role violations and associated punishments
- Ban duration and expiration dates
- Moderation actions taken by the Bot

### Information We Do NOT Collect

- Personal information outside of Discord (email, phone, real name)
- Private messages or DMs
- Voice chat data
- Payment or financial information
- Messages in non-monitored channels
- User activity outside of Discord

## How We Use Your Information

We use the collected information solely for:

**Moderation Purposes:**
- Detecting honeypot role acquisitions
- Implementing temporary bans and timeouts
- Tracking ban durations and automatic unbanning
- Preventing abuse and maintaining server security

**Bot Functionality:**
- Executing automated moderation actions
- Providing commands like `/ping` and `/tempbans`
- Logging moderation activities for server administrators
- Ensuring proper bot operation and health checks

## Data Storage and Security

### Storage Location
- User data is stored in a secure PostgreSQL database
- Database is hosted on [Your Hosting Provider/Self-hosted]
- All data is encrypted at rest and in transit

### Data Retention
- **Active temporary bans:** Stored until ban expires + 30 days
- **Completed bans:** Automatically deleted after 30 days of inactivity
- **Log data:** Retained for up to 90 days for debugging purposes
- **Permanent bans:** No data stored (handled directly by Discord)

### Security Measures
- Database access restricted to authorized personnel only
- Regular security updates and monitoring
- Encrypted connections between Bot and database
- Automatic data cleanup procedures

## Data Sharing and Disclosure

**We DO NOT share your data with third parties except:**
- When required by law or valid legal process
- To protect our rights, property, or safety
- With Discord (as required for bot functionality)
- With server administrators (moderation logs only)

**We will NEVER:**
- Sell your personal information
- Share data for marketing purposes
- Provide data to data brokers
- Use data for purposes unrelated to moderation

## Your Rights and Choices

### Data Access and Control
- **View your data:** Contact us to request information we have about you
- **Data deletion:** Request removal of your data (subject to legitimate interests)
- **Correction:** Request correction of inaccurate information
- **Portability:** Request a copy of your data in a readable format

### Opt-Out Options
- **Leave the server:** Your data will be automatically deleted per retention policy
- **Contact administrators:** Request removal from honeypot monitoring
- **Data deletion request:** Contact us directly for immediate removal

## Regional Privacy Rights

### European Union (GDPR)
If you are located in the EU, you have additional rights under GDPR:
- Right to access, rectify, erase, restrict, and port your data
- Right to object to processing
- Right to withdraw consent
- Right to lodge a complaint with supervisory authorities

### California (CCPA)
California residents have rights to:
- Know what personal information is collected
- Request deletion of personal information
- Opt-out of sale (we don't sell data)
- Non-discrimination for exercising privacy rights

## Children's Privacy

The Bot is not intended for users under 13 years of age. We do not knowingly collect personal information from children under 13. If you become aware that a child has provided us with personal information, please contact us immediately.

## Changes to This Privacy Policy

We may update this Privacy Policy from time to time. We will notify users of any material changes by:
- Posting the new Privacy Policy on our website/repository
- Announcing changes in Discord servers where the Bot operates
- Updating the "Last Updated" date at the top of this policy

Continued use of the Bot after changes constitutes acceptance of the updated policy.

## Contact Information

For questions, concerns, or requests regarding this Privacy Policy or your data:

**Primary Contact:**
- **Email:** admin@clovetwilight3
- **Discord:** clovetwilight3

**Response Time:** We aim to respond to all privacy inquiries within 30 days.

## Third-Party Services

### Discord
The Bot operates on Discord's platform and is subject to Discord's Privacy Policy and Terms of Service. Visit Discord's website for their privacy practices.

### Hosting Provider
Our database may be hosted by [Provider Name]. Their privacy policy can be found at [Provider Privacy Policy URL].

## Legal Basis for Processing (GDPR)

We process your data based on:
- **Legitimate interests:** Maintaining server security and preventing abuse
- **Contract performance:** Providing bot services as requested
- **Legal obligations:** Complying with applicable laws
- **Consent:** Where explicitly provided for optional features

## Data Processing Activities

| Data Type | Purpose | Legal Basis | Retention Period |
|-----------|---------|-------------|------------------|
| User ID | Moderation enforcement | Legitimate interest | Until ban expires + 30 days |
| Role data | Honeypot detection | Legitimate interest | 30 days after processing |
| Ban records | Temporary ban tracking | Legitimate interest | Until ban expires + 30 days |
| Log data | Debugging and security | Legitimate interest | 90 days |

---

**Note:** This Privacy Policy applies only to the Honeypot Bot and not to any other bots, websites, or services you may encounter.