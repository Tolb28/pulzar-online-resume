import { TIERS } from '../config/tiers';
import { audit, type Actor } from '../platform/audit';
import { all, one, run } from '../platform/db';
import { mails } from '../platform/mail';
import type { CvRow } from './cvs';
import type { Deps } from './deps';

// CV-10: the holder's own address (Profi, Na míru): jmeno.cz or cv.jmeno.cz.
// Phase 1: the domain's DNS is on the studio's Cloudflare account; the studio adds the
// hostname to the Worker (docs/ops.md) and then marks it active here.

export interface DomainRow {
  hostname: string;
  cv_id: string;
  mode: 'studio_registers' | 'holder_moves_dns';
  status: 'requested' | 'active' | 'removed';
  created_at: number;
  activated_at: number | null;
}

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeHostname(input: string): string | null {
  const h = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
  if (!HOST_RE.test(h)) return null;
  if (h.endsWith('pulzarstudio.cz')) return null;
  return h;
}

export const activeDomainFor = (db: D1Database, cvId: string) =>
  one<DomainRow>(db, `SELECT * FROM domains WHERE cv_id = ? AND status = 'active' ORDER BY activated_at DESC LIMIT 1`, cvId);

export const cvIdForHost = async (db: D1Database, host: string) =>
  (await one<{ cv_id: string }>(db, `SELECT cv_id FROM domains WHERE hostname = ? AND status = 'active'`, host))?.cv_id ?? null;

export const domainsOf = (db: D1Database, cvId: string) => all<DomainRow>(db, `SELECT * FROM domains WHERE cv_id = ? AND status != 'removed' ORDER BY created_at DESC`, cvId);

export async function requestDomain(
  deps: Deps,
  row: CvRow,
  hostname: string,
  mode: DomainRow['mode'],
  holder: Actor & { email: string | null },
): Promise<'ok' | 'tier' | 'taken'> {
  if (!TIERS[row.tier].ownDomain) return 'tier';
  const existing = await one<DomainRow>(deps.db, 'SELECT * FROM domains WHERE hostname = ?', hostname);
  if (existing && existing.status !== 'removed' && existing.cv_id !== row.id) return 'taken';
  const now = deps.now();
  await run(
    deps.db,
    `INSERT INTO domains (hostname, cv_id, mode, status, created_at) VALUES (?, ?, ?, 'requested', ?)
     ON CONFLICT(hostname) DO UPDATE SET cv_id = excluded.cv_id, mode = excluded.mode, status = 'requested', created_at = excluded.created_at, activated_at = NULL`,
    hostname,
    row.id,
    mode,
    now,
  );
  await audit(deps.db, now, holder, 'domain.request', row.id, { hostname, mode });
  for (const a of deps.admins) await deps.mailer.send(mails.domainRequest(a, holder.email ?? row.slug, hostname, mode, `${deps.baseUrl}/admin/domeny`));
  return 'ok';
}

export async function setDomainStatus(deps: Deps, hostname: string, status: 'active' | 'removed', admin: Actor): Promise<void> {
  const now = deps.now();
  await run(deps.db, `UPDATE domains SET status = ?, activated_at = CASE WHEN ? = 'active' THEN ? ELSE activated_at END WHERE hostname = ?`, status, status, now, hostname);
  const d = await one<DomainRow>(deps.db, 'SELECT * FROM domains WHERE hostname = ?', hostname);
  await audit(deps.db, now, admin, `domain.${status}`, d?.cv_id ?? null, { hostname });
}
