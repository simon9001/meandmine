import { supabaseAdmin } from '../config/db.js';
/**
 * Fire-and-forget — never throws, never blocks the caller.
 * Call this from any service to record auditable events.
 */
export function logAudit(payload) {
    supabaseAdmin
        .from('audit_logs') // cast because audit_logs isn't in generated types yet
        .insert({
        actor_id: payload.actorId ?? null,
        actor_email: payload.actorEmail ?? null,
        actor_role: payload.actorRole ?? null,
        action: payload.action,
        resource_type: payload.resourceType ?? null,
        resource_id: payload.resourceId ?? null,
        details: payload.details ?? {},
        ip_address: payload.ipAddress ?? null,
    })
        .then(() => { }, () => { }); // silently ignore DB errors — audit must never break the main flow
}
