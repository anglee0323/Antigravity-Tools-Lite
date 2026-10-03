export type AutoSwitchMode = 'wait' | 'stop';
export type AutoSwitchStrategy = 'round_robin' | 'priority';
export interface AutoSwitchConfig {
    enabled: boolean;
    mode: AutoSwitchMode;
    strategy?: AutoSwitchStrategy;
    reserve_percentage: number;
    candidate_min_percentage: number;
    monitored_model: string;
    candidate_account_ids: string[];
    target: 'app';
}
export interface AutoSwitchStatus {
    phase: 'disabled' | 'monitoring' | 'blocked' | 'pending' | 'canceled' | 'switching' | 'completed';
    reason: string | null;
    source_account_id: string | null;
    source_email: string | null;
    target_account_id: string | null;
    target_email: string | null;
    remaining_percentage: number | null;
    pending_id: string | null;
    mode: AutoSwitchMode;
    process_state: 'closed' | 'running' | 'unknown';
    last_checked: number | null;
}
