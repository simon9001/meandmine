import { supabaseAdmin } from '../config/db.js';

export interface AuditPayload {
  actorId?:    string | null;
  actorEmail?: string | null;
  actorRole?:  string | null;
  action:      string;           // e.g. 'user.role_changed', 'order.status_updated'
  resourceType?: string | null;  // e.g. 'user', 'order', 'product'
  resourceId?:   string | null;
  details?:      Record<string, unknown>;
  ipAddress?:    string | null;
}

/**
 * Fire-and-forget — never throws, never blocks the caller.
 * Call this from any service to record auditable events.
 */
export function logAudit(payload: AuditPayload): void {
  supabaseAdmin
    .from('audit_logs' as 'orders')   // cast because audit_logs isn't in generated types yet
    .insert({
      actor_id:      payload.actorId      ?? null,
      actor_email:   payload.actorEmail   ?? null,
      actor_role:    payload.actorRole    ?? null,
      action:        payload.action,
      resource_type: payload.resourceType ?? null,
      resource_id:   payload.resourceId   ?? null,
      details:       payload.details      ?? {},
      ip_address:    payload.ipAddress    ?? null,
    } as Record<string, unknown>)
    .then(() => {}, () => {});  // silently ignore DB errors — audit must never break the main flow
}
