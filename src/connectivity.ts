export type ConnectivityStatus = { configured: boolean; instance: string; state: string; stateError: string; code: string; provisionAvailable: boolean; serverUrl: string; configurationSource: string };
export type DeliverySource = { kind: 'travel' | 'rtp' | 'document'; id: string; label: string; scholarId?: string | null };
export type DeliveryHistory = { id: string; file_name: string; source_kind: string; format: string; source_version: number | null; status: string; recipient: string; created_at: string };
