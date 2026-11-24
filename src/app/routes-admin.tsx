import type { Hono } from 'hono';
import { isTierId, TIERS } from '../config/tiers';
import { auditFor, type AuditRow } from '../platform/audit';
import { all, one } from '../platform/db';
import { decideIsic, type PaymentRow } from '../services/billing';
import { getCvById, publicState, publicUrl, updateCv, type CvRow } from '../services/cvs';
import { domainsOf, setDomainStatus, type DomainRow } from '../services/domains';
import { runDaily } from '../services/lifecycle';
import { computeMetrics } from '../services/metrics';
import { markSessionBooked, sendForApproval } from '../services/namiru';
import { adminActor, errorPage, page, type AppEnv, type Ctx } from './core';
import { editorGet, editorPost, mediaPost, previewHtml, previewPdf, type EditorTarget } from './routes-account';
import { AdminCvListView, AdminCvView, AdminDashboardView, AdminDomainsView, AdminPrivacyView, AdminStudentsView, AuditTable } from './views/admin';

// The studio's admin (CV-11, CV-12, CV-10, PL-11). Admin rights come from ADMIN_EMAILS.
// There is no route here that publishes a CV: only the holder can (CV-11 AC).

export function registerAdmin(app: Hono<AppEnv>): void {
  const guard = async (c: Ctx, next: () => Promise<void>) => {
    if (!c.get('account')) return c.redirect(`/prihlaseni?dalsi=${encodeURIComponent(c.req.path)}`, 303);
    if (!c.get('isAdmin')) return errorPage(c, 403, 'Sem má přístup jen studio.');
    await next();
  };
  app.use('/admin', guard);
  app.use('/admin/*', guard);
  app.get('/admin', async (c) => {
    const deps = c.get('deps');
    const nm = await all<CvRow & { email: string }>(
      deps.db,
      `SELECT c.*, a.email FROM cvs c JOIN accounts a ON a.id = c.account_id WHERE c.tier = 'na_miru' AND c.nm_state IN ('awaiting_session', 'in_progress', 'awaiting_approval') ORDER BY c.updated_at`,
    );
    const isic = await all<{ id: string; email: string; value: string; created_at: number }>(
      deps.db,
      `SELECT r.id, a.email, r.value, r.created_at FROM student_requests r JOIN accounts a ON a.id = r.account_id WHERE r.status = 'pending' ORDER BY r.created_at`,
    );
    const domains = await all<DomainRow & { slug: string }>(deps.db, `SELECT d.*, c.slug FROM domains d JOIN cvs c ON c.id = d.cv_id WHERE d.status = 'requested'`);
    const scan = await one<{ at: number; pages: number; findings: string }>(deps.db, 'SELECT at, pages, findings FROM privacy_scans ORDER BY id DESC LIMIT 1');
    return page(c, 'Přehled', <AdminDashboardView m={await computeMetrics(deps.db, deps.now())} nm={nm} isic={isic} domains={domains} scan={scan} />, { admin: true, wide: true });
  });
  app.post('/admin/cron', async (c) => {
    await runDaily(c.get('deps'));
    return c.redirect('/admin?ok=hotovo', 303);
  });
  app.get('/admin/cv', async (c) => {
    const deps = c.get('deps');
    const q = (c.req.query('q') ?? '').trim().toLowerCase();
    const rows = await all<CvRow & { email: string }>(
      deps.db,
      `SELECT c.*, a.email FROM cvs c JOIN accounts a ON a.id = c.account_id WHERE (? = '' OR a.email LIKE ? OR c.slug LIKE ?) ORDER BY c.updated_at DESC LIMIT 200`,
      q,
      `%${q}%`,
      `%${q}%`,
    );
    return page(c, 'Životopisy', <AdminCvListView q={q} rows={rows.map((r) => ({ ...r, state: publicState(r, deps.now()) }))} />, { admin: true, wide: true });
  });

  const target = async (c: Ctx): Promise<{ row: CvRow; email: string } | null> => {
    const deps = c.get('deps');
    const row = await getCvById(deps.db, c.req.param('id') ?? '');
    if (!row) return null;
    const a = await one<{ email: string }>(deps.db, 'SELECT email FROM accounts WHERE id = ?', row.account_id);
    return { row, email: a?.email ?? '' };
  };
  const editorTarget = (c: Ctx, row: CvRow): EditorTarget => ({
    row,
    actor: adminActor(c.get('account')!),
    base: `/admin/cv/${row.id}/upravit`,
    mediaAction: `/admin/cv/${row.id}/media`,
    previewHref: `/admin/cv/${row.id}/nahled`,
    admin: true,
  });

  app.get('/admin/cv/:id', async (c) => {
    const deps = c.get('deps');
    const t = await target(c);
    if (!t) return errorPage(c, 404, 'Životopis nenalezen.');
    const payments = await all<PaymentRow>(deps.db, 'SELECT * FROM payments WHERE cv_id = ? ORDER BY created_at DESC', t.row.id);
    const audit: AuditRow[] = await auditFor(deps.db, t.row.id, 100);
    return page(
      c,
      t.row.slug,
      <AdminCvView row={t.row} email={t.email} state={publicState(t.row, deps.now())} payments={payments} audit={audit} domains={await domainsOf(deps.db, t.row.id)} url={publicUrl(deps, t.row)} />,
      { admin: true, wide: true },
    );
  });
  app.get('/admin/cv/:id/upravit/:section', async (c) => {
    const t = await target(c);
    return t ? editorGet(c, editorTarget(c, t.row), c.req.param('section')) : errorPage(c, 404, 'Životopis nenalezen.');
  });
  app.post('/admin/cv/:id/upravit/:section', async (c) => {
    const t = await target(c);
    return t ? editorPost(c, editorTarget(c, t.row), c.req.param('section')) : errorPage(c, 404, 'Životopis nenalezen.');
  });
  app.post('/admin/cv/:id/media', async (c) => {
    const t = await target(c);
    return t ? mediaPost(c, editorTarget(c, t.row)) : errorPage(c, 404, 'Životopis nenalezen.');
  });
  app.get('/admin/cv/:id/nahled', async (c) => {
    const t = await target(c);
    return t ? previewHtml(c, t.row) : errorPage(c, 404, 'Životopis nenalezen.');
  });
  app.get('/admin/cv/:id/nahled.pdf', async (c) => {
    const t = await target(c);
    return t ? previewPdf(c, t.row) : errorPage(c, 404, 'Životopis nenalezen.');
  });
  app.post('/admin/cv/:id/namiru/sezeni', async (c) => {
    const t = await target(c);
    if (!t) return errorPage(c, 404, 'Životopis nenalezen.');
    const form = await c.req.parseBody();
    const at = typeof form.at === 'string' && form.at ? Date.parse(`${form.at}:00+01:00`) : NaN;
    await markSessionBooked(c.get('deps'), t.row, Number.isFinite(at) ? at : null, String(form.notes ?? ''), adminActor(c.get('account')!));
    return c.redirect(`/admin/cv/${t.row.id}?ok=sezeni`, 303);
  });
  app.post('/admin/cv/:id/namiru/schvaleni', async (c) => {
    const t = await target(c);
    if (!t) return errorPage(c, 404, 'Životopis nenalezen.');
    await sendForApproval(c.get('deps'), t.row, adminActor(c.get('account')!));
    return c.redirect(`/admin/cv/${t.row.id}?ok=odeslano_ke_schvaleni`, 303);
  });
  app.post('/admin/cv/:id/tarif', async (c) => {
    const t = await target(c);
    if (!t) return errorPage(c, 404, 'Životopis nenalezen.');
    const tier = (await c.req.parseBody()).tier;
    if (isTierId(tier)) {
      const langs = (JSON.parse(t.row.langs) as Array<'cs' | 'en'>).slice(0, TIERS[tier].maxLangs);
      await updateCv(c.get('deps'), t.row, { tier, langs }, adminActor(c.get('account')!));
    }
    return c.redirect(`/admin/cv/${t.row.id}?ok=ulozeno`, 303);
  });

  app.get('/admin/studenti', async (c) => {
    const rows = await all<{ id: string; email: string; value: string; created_at: number }>(
      c.get('deps').db,
      `SELECT r.id, a.email, r.value, r.created_at FROM student_requests r JOIN accounts a ON a.id = r.account_id WHERE r.status = 'pending' ORDER BY r.created_at`,
    );
    return page(c, 'Studenti', <AdminStudentsView rows={rows} />, { admin: true });
  });
  app.post('/admin/studenti/:id', async (c) => {
    const decision = (await c.req.parseBody()).decision;
    await decideIsic(c.get('deps'), c.req.param('id'), decision === 'approve', adminActor(c.get('account')!));
    return c.redirect('/admin/studenti?ok=hotovo', 303);
  });

  app.get('/admin/domeny', async (c) => {
    const rows = await all<DomainRow & { slug: string }>(c.get('deps').db, `SELECT d.*, c.slug FROM domains d JOIN cvs c ON c.id = d.cv_id ORDER BY d.created_at DESC`);
    return page(c, 'Domény', <AdminDomainsView rows={rows} />, { admin: true, wide: true });
  });
  app.post('/admin/domeny/:host', async (c) => {
    const status = (await c.req.parseBody()).status;
    if (status === 'active' || status === 'removed') await setDomainStatus(c.get('deps'), decodeURIComponent(c.req.param('host')), status, adminActor(c.get('account')!));
    return c.redirect('/admin/domeny?ok=hotovo', 303);
  });

  app.get('/admin/audit', async (c) => page(c, 'Log', <AuditTable rows={await auditFor(c.get('deps').db, null, 300)} />, { admin: true, wide: true }));
  app.get('/admin/soukromi', async (c) => {
    const scans = await all<{ at: number; pages: number; findings: string }>(c.get('deps').db, 'SELECT at, pages, findings FROM privacy_scans ORDER BY id DESC LIMIT 60');
    return page(c, 'Kontrola soukromí', <AdminPrivacyView scans={scans} />, { admin: true });
  });
}
