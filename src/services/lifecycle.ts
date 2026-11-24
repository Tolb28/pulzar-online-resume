import { audit, SYSTEM } from '../platform/audit';
import { issueToken } from '../platform/auth';
import { randomToken } from '../platform/crypto';
import { all, DAY, run } from '../platform/db';
import { mails } from '../platform/mail';
import { contactLeaks, renderCvHtml } from '../web/render';
import { deleteCv, getCvById, publicState, RETENTION, snapshotOf, type CvRow } from './cvs';
import type { Deps } from './deps';

// The daily job (cron): expiry reminders, expiry, retention (CV-8) and the privacy scan (§8).

export interface DailyReport {
  reminders: number;
  expired: number;
  prompted: number;
  warned: number;
  deleted: number;
  scanned: number;
  findings: number;
}

type Row = CvRow & { email: string; last_login_at: number | null };

/** Send an e-mail at most once per (cv, kind, ref). */
async function once(deps: Deps, cvId: string, kind: string, ref: string, send: () => Promise<void>): Promise<boolean> {
  const inserted = await run(deps.db, 'INSERT OR IGNORE INTO notifications (cv_id, kind, ref, sent_at) VALUES (?, ?, ?, ?)', cvId, kind, ref, deps.now());
  if (!inserted) return false;
  try {
    await send();
    return true;
  } catch (e) {
    // Try again tomorrow.
    await run(deps.db, 'DELETE FROM notifications WHERE cv_id = ? AND kind = ? AND ref = ?', cvId, kind, ref);
    console.error('notification failed', kind, cvId, e);
    return false;
  }
}

async function rows(deps: Deps, where: string, ...params: unknown[]): Promise<Row[]> {
  return all<Row>(deps.db, `SELECT c.*, a.email, a.last_login_at FROM cvs c JOIN accounts a ON a.id = c.account_id WHERE ${where}`, ...params);
}

export async function expiryReminders(deps: Deps, report: DailyReport): Promise<void> {
  const now = deps.now();
  for (const days of [30, 7]) {
    const lower = days === 30 ? now + 7 * DAY : now;
    for (const r of await rows(deps, 'c.paid_until > ? AND c.paid_until <= ?', lower, now + days * DAY)) {
      const sent = await once(deps, r.id, `expiring_${days}`, String(r.paid_until), () =>
        deps.mailer.send(mails.expiring(r.email, days, r.paid_until!, `${deps.baseUrl}/ucet`)),
      );
      if (sent) report.reminders++;
    }
  }
}

export async function markExpired(deps: Deps, report: DailyReport): Promise<void> {
  const now = deps.now();
  for (const r of await rows(deps, `c.status = 'live' AND c.published IS NOT NULL AND c.paid_until <= ? AND c.offline_since IS NULL`, now)) {
    await run(deps.db, 'UPDATE cvs SET offline_since = ? WHERE id = ?', r.paid_until, r.id);
    await audit(deps.db, now, SYSTEM, 'cv.expired', r.id);
    await once(deps, r.id, 'expired', String(r.paid_until), () => deps.mailer.send(mails.expired(r.email, `${deps.baseUrl}/ucet`)));
    report.expired++;
  }
}

/**
 * CV-8: an offline CV (paused, expired or never published) gets "Chcete životopis dál
 * uchovat?" a year after it went offline or its paid time ended, whichever is later. Any sign
 * of life – the keep link, signing in, editing, paying – counts as an answer. No answer in 30
 * days: a warning at day 23, deletion at day 30.
 */
export async function retention(deps: Deps, report: DailyReport): Promise<void> {
  const now = deps.now();
  const candidates = await rows(deps, `NOT (c.status = 'live' AND c.published IS NOT NULL AND c.paid_until > ?)`, now);
  for (const r of candidates) {
    const lastSign = Math.max(r.offline_since ?? 0, r.paid_until ?? 0, r.retention_confirmed_at ?? 0, r.last_login_at ?? 0, r.draft_updated_at, r.created_at);
    if (!r.retention_prompted_at) {
      if (now < lastSign + RETENTION.promptAfter) continue;
      const deleteOn = now + RETENTION.deleteAfter;
      const token = await issueToken(deps.db, now, 'keep', { accountId: r.account_id, data: { cvId: r.id } });
      const sent = await once(deps, r.id, 'keep_prompt', String(Math.floor(now / DAY)), () =>
        deps.mailer.send(mails.keepPrompt(r.email, `${deps.baseUrl}/uchovat/${token}`, deleteOn)),
      );
      if (sent) {
        await run(deps.db, 'UPDATE cvs SET retention_prompted_at = ?, retention_warned_at = NULL WHERE id = ?', now, r.id);
        report.prompted++;
      }
      continue;
    }
    if (lastSign > r.retention_prompted_at) {
      // Answered (signed in, kept, edited or paid) – start the year again.
      await run(deps.db, 'UPDATE cvs SET retention_prompted_at = NULL, retention_warned_at = NULL WHERE id = ?', r.id);
      continue;
    }
    if (now >= r.retention_prompted_at + RETENTION.deleteAfter) {
      const fresh = await getCvById(deps.db, r.id);
      if (!fresh) continue;
      await deleteCv(deps, fresh, SYSTEM, 'retention: no answer in 30 days');
      await deps.mailer.send(mails.deleted(r.email));
      report.deleted++;
    } else if (!r.retention_warned_at && now >= r.retention_prompted_at + RETENTION.warnAfter) {
      const token = await issueToken(deps.db, now, 'keep', { accountId: r.account_id, data: { cvId: r.id } });
      await deps.mailer.send(mails.keepWarning(r.email, `${deps.baseUrl}/uchovat/${token}`, r.retention_prompted_at + RETENTION.deleteAfter));
      await run(deps.db, 'UPDATE cvs SET retention_warned_at = ? WHERE id = ?', now, r.id);
      report.warned++;
    }
  }
}

/** §8: "E-mail addresses found in public HTML – 0, always." Renders every public page and checks. */
export async function privacyScan(deps: Deps, report: DailyReport): Promise<{ pages: number; findings: { cvId: string; lang: string; what: string[] }[] }> {
  const now = deps.now();
  const findings: { cvId: string; lang: string; what: string[] }[] = [];
  let pages = 0;
  for (const r of await rows(deps, `c.status = 'live' AND c.published IS NOT NULL AND c.paid_until > ?`, now)) {
    if (publicState(r, now) !== 'online') continue;
    const snap = snapshotOf(r);
    if (!snap) continue;
    for (const lang of snap.doc.langs) {
      const html = renderCvHtml({
        doc: snap.doc,
        lang,
        basePath: `/${r.slug}`,
        origin: deps.baseUrl,
        visibility: r.visibility,
        siteKey: deps.env.TURNSTILE_SITE_KEY,
        hasPdf: !!snap.pdf[lang],
        salesUrl: deps.env.SALES_URL,
        nonce: randomToken(12),
        publishedAt: snap.publishedAt,
      });
      pages++;
      const what = contactLeaks(html, snap.doc.profile.email, snap.doc.profile.phone);
      if (what.length) findings.push({ cvId: r.id, lang, what });
    }
  }
  await run(deps.db, 'INSERT INTO privacy_scans (at, pages, findings) VALUES (?, ?, ?)', now, pages, JSON.stringify(findings));
  if (findings.length) for (const a of deps.admins) await deps.mailer.send(mails.privacyAlert(a, findings.length, `${deps.baseUrl}/admin`));
  report.scanned += pages;
  report.findings += findings.length;
  return { pages, findings };
}

export async function cleanup(deps: Deps): Promise<void> {
  const now = deps.now();
  await deps.db.batch([
    deps.db.prepare('DELETE FROM tokens WHERE expires_at < ?').bind(now - 7 * DAY),
    deps.db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    deps.db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(now),
    deps.db.prepare('DELETE FROM imports WHERE created_at < ?').bind(now - 2 * DAY),
  ]);
}

export async function runDaily(deps: Deps): Promise<DailyReport> {
  const report: DailyReport = { reminders: 0, expired: 0, prompted: 0, warned: 0, deleted: 0, scanned: 0, findings: 0 };
  await expiryReminders(deps, report);
  await markExpired(deps, report);
  await retention(deps, report);
  await privacyScan(deps, report);
  await cleanup(deps);
  await audit(deps.db, deps.now(), SYSTEM, 'cron.daily', null, report);
  return report;
}
