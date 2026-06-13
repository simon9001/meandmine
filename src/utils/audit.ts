import { supabaseAdmin } from '../config/db.js';
import { logger } from '../config/logger.js';
import type { UserRole } from '../types/index.js';

interface AuditEntry {
  actorId?: string;
  actorRole?: UserRole;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  const { error } = await supabaseAdmin.from('audit_logs').insert({
    actor_id:    entry.actorId,
    actor_role:  entry.actorRole,
    action:      entry.action,
    entity_type: entry.entityType,
    entity_id:   entry.entityId,
    old_value:   entry.oldValue,
    new_value:   entry.newValue,
    ip_address:  entry.ipAddress,
    user_agent:  entry.userAgent,
  });

  if (error) logger.error('Audit log write failed', { error: error.message, action: entry.action });
}
