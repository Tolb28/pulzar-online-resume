// Fixed-window rate limits in D1 (sign-in e-mails, contact reveals, PIN attempts).

export async function hit(db: D1Database, key: string, limit: number, windowMs: number, now: number): Promise<{ ok: boolean; count: number; resetAt: number }> {
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
       RETURNING count, reset_at`,
    )
    .bind(key, now + windowMs, now)
    .first<{ count: number; reset_at: number }>();
  const count = row?.count ?? 1;
  return { ok: count <= limit, count, resetAt: row?.reset_at ?? now + windowMs };
}

/** Read a counter without adding to it. */
export async function peek(db: D1Database, key: string, now: number): Promise<number> {
  const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first<{ count: number; reset_at: number }>();
  return row && row.reset_at > now ? row.count : 0;
}

export async function clear(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}
