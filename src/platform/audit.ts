import { all, run } from './db';

// PL-11: the admin logs what the studio does (and the system jobs log what they change).

export interface Actor {
  id: string;
  email: string | null;
}

export const SYSTEM: Actor = { id: 'system', email: null };

export async function audit(db: D1Database, now: number, actor: Actor, action: string, target: string | null, details?: unknown): Promise<void> {
  await run(
    db,
    'INSERT INTO audit_log (at, actor, actor_email, action, target, details) VALUES (?, ?, ?, ?, ?, ?)',
    now,
    actor.id,
    actor.email,
    action,
    target,
    details === undefined ? null : JSON.stringify(details),
  );
}

export interface AuditRow {
  id: number;
  at: number;
  actor: string;
  actor_email: string | null;
  action: string;
  target: string | null;
  details: string | null;
}

export function auditFor(db: D1Database, target: string | null, limit = 100): Promise<AuditRow[]> {
  return target
    ? all<AuditRow>(db, 'SELECT * FROM audit_log WHERE target = ? ORDER BY id DESC LIMIT ?', target, limit)
    : all<AuditRow>(db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit);
}
