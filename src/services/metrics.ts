import { all, DAY, one, pragueDay } from '../platform/db';

// §8 success metrics, computed from the platform's own database (no cookies, no third party).

export interface Metrics {
  /** CVs started ≥ 7 days ago that were published within 7 days. */
  publishedWithin7d: number | null;
  /** Median minutes from starting a CV to its first publish (those published within 7 days). */
  medianMinutesToPublish: number | null;
  /** CVs first published ≥ 30 days ago that someone other than the holder read within 30 days. */
  readWithin30d: number | null;
  paidLast6m: number;
  studentShare: number | null;
  /** CVs whose paid year ended that were paused, renewed or kept rather than deleted. */
  keptAtYearEnd: number | null;
  naMiruLast6m: number;
}

const share = (n: number, d: number) => (d ? n / d : null);

export async function computeMetrics(db: D1Database, now: number): Promise<Metrics> {
  const started = await all<{ created_at: number; first_published_at: number | null }>(
    db,
    'SELECT created_at, first_published_at FROM cvs WHERE created_at <= ?',
    now - 7 * DAY,
  );
  const quick = started.filter((r) => r.first_published_at && r.first_published_at - r.created_at <= 7 * DAY);
  const minutes = quick.map((r) => (r.first_published_at! - r.created_at) / 60_000).sort((a, b) => a - b);
  const median = minutes.length ? (minutes.length % 2 ? minutes[(minutes.length - 1) / 2]! : (minutes[minutes.length / 2 - 1]! + minutes[minutes.length / 2]!) / 2) : null;

  const published = await all<{ id: string; first_published_at: number }>(
    db,
    'SELECT id, first_published_at FROM cvs WHERE first_published_at IS NOT NULL AND first_published_at <= ?',
    now - 30 * DAY,
  );
  let read = 0;
  for (const r of published) {
    const v = await one<{ n: number }>(
      db,
      'SELECT COALESCE(SUM(views), 0) AS n FROM stats_daily WHERE cv_id = ? AND day >= ? AND day <= ?',
      r.id,
      pragueDay(r.first_published_at),
      pragueDay(r.first_published_at + 30 * DAY),
    );
    if ((v?.n ?? 0) > 0) read++;
  }

  const since = now - 182 * DAY;
  const paid = await all<{ tier: string; student: number }>(db, `SELECT tier, student FROM payments WHERE kind = 'initial' AND status = 'paid' AND paid_at >= ?`, since);

  const ended = await all<{ id: string; status: string; renewed: number }>(
    db,
    `SELECT c.id, c.status, (SELECT COUNT(*) FROM payments p WHERE p.cv_id = c.id AND p.kind = 'renewal' AND p.status = 'paid') AS renewed
     FROM cvs c WHERE c.paid_until IS NOT NULL AND (c.paid_until <= ? OR EXISTS (SELECT 1 FROM payments p WHERE p.cv_id = c.id AND p.kind = 'renewal' AND p.status = 'paid'))`,
    now,
  );
  const deleted = await one<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT target) AS n FROM audit_log WHERE action = 'cv.delete' AND target IN (SELECT cv_id FROM payments WHERE status = 'paid')`,
  );

  return {
    publishedWithin7d: share(quick.length, started.length),
    medianMinutesToPublish: median,
    readWithin30d: share(read, published.length),
    paidLast6m: paid.length,
    studentShare: share(paid.filter((p) => p.student).length, paid.length),
    keptAtYearEnd: share(ended.length, ended.length + (deleted?.n ?? 0)),
    naMiruLast6m: paid.filter((p) => p.tier === 'na_miru').length,
  };
}
