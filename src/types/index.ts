export interface TempBan {
    id: number;
    user_id: string;
    guild_id: string;
    role_id: string;
    banned_at: Date;
    unban_at: Date;
    reason: string;
    active: boolean;
}

export interface RoleConfig {
    duration: number;
    type: 'timeout' | 'tempban';
}
