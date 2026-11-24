import type { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Lang } from '../cv/types';
import { checkPin, sha256Hex, signPass, verifyPass } from '../platform/crypto';
import { one } from '../platform/db';
import { hit, peek } from '../platform/ratelimit';
import { bump, isCountable, type StatField } from '../platform/stats';
import { getCvById, getCvBySlug, mediaKeys, publicState, snapshotOf, type CvRow } from '../services/cvs';
import { activeDomainFor } from '../services/domains';
import { renderCvHtml, renderInactiveHtml, renderPinHtml } from '../web/render';
import { clientIp, publicCsp, type AppEnv, type Ctx } from './core';

// The public side: cv.pulzarstudio.cz/<slug> and own domains (CV-10).

const PASS_TTL = 10 * 60_000;
const PIN_TTL = 12 * 3_600_000;

/** Is the visitor the holder or the studio? Their visits are not counted (A8). */
function isInsider(c: Ctx, row: CvRow): boolean {
  const a = c.get('account');
  return !!a && (a.id === row.account_id || c.get('isAdmin'));
}

async function count(c: Ctx, row: CvRow, field: StatField): Promise<void> {
  if (isInsider(c, row) || !isCountable(c.req.raw)) return;
  const deps = c.get('deps');
  await bump(deps.db, row.id, field, deps.now());
}

function publicHeaders(c: Ctx, indexable: boolean): void {
  c.header('Content-Security-Policy', publicCsp(c.get('nonce')));
  // A link-only address must not leak to the sites the CV links to (CV-5).
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cache-Control', 'no-cache');
  if (!indexable) c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
}

/** The PIN cookie is tied to the current PIN: changing the PIN revokes everyone's access. */
async function pinPayload(row: CvRow): Promise<string> {
  return `pin-${row.id}-${(await sha256Hex(row.pin_hash ?? '')).slice(0, 16)}`;
}

async function pinOk(c: Ctx, row: CvRow): Promise<boolean> {
  if (row.visibility !== 'pin') return true;
  if (isInsider(c, row)) return true;
  const deps = c.get('deps');
  const cookie = getCookie(c, `cvpin_${row.id}`);
  return !!cookie && (await verifyPass(deps.env.SESSION_SECRET, cookie, await pinPayload(row), deps.now()));
}

function inactive(c: Ctx, lang: Lang): Response {
  publicHeaders(c, false);
  return c.html(renderInactiveHtml(lang, c.get('nonce')), 404);
}

/** Where the page says it lives: the own domain when one is active. */
async function canonicalFor(c: Ctx, row: CvRow): Promise<{ origin: string; basePath: string }> {
  const deps = c.get('deps');
  const domain = await activeDomainFor(deps.db, row.id);
  return domain ? { origin: `https://${domain.hostname}`, basePath: '' } : { origin: deps.baseUrl, basePath: `/${row.slug}` };
}

export async function servePage(c: Ctx, row: CvRow | null, base: string, langParam: string | undefined): Promise<Response> {
  const deps = c.get('deps');
  const now = deps.now();
  if (!row) return c.notFound();
  const snap = snapshotOf(row);
  const state = publicState(row, now);
  const primary = snap?.doc.langs[0] ?? 'cs';
  if (state === 'draft' || !snap) return c.notFound();
  if (state !== 'online') return inactive(c, primary);
  let lang: Lang = primary;
  if (langParam !== undefined) {
    if (langParam !== 'cs' && langParam !== 'en') return c.notFound();
    if (!snap.doc.langs.includes(langParam)) return c.notFound();
    if (langParam === primary) return c.redirect(base || '/', 301);
    lang = langParam;
  }
  if (!(await pinOk(c, row))) {
    publicHeaders(c, false);
    return c.html(renderPinHtml(lang, c.get('nonce'), `${base}/pin${lang !== primary ? `?lang=${lang}` : ''}`, snap.doc.design.accent), 401);
  }
  const indexable = row.visibility === 'public';
  publicHeaders(c, indexable);
  const origin = new URL(c.req.url).origin;
  const htmlText = renderCvHtml({
    doc: snap.doc,
    lang,
    basePath: base,
    origin,
    visibility: row.visibility,
    siteKey: deps.env.TURNSTILE_SITE_KEY,
    hasPdf: !!snap.pdf[lang],
    salesUrl: deps.env.SALES_URL,
    nonce: c.get('nonce'),
    publishedAt: snap.publishedAt,
    canonical: await canonicalFor(c, row),
  });
  if (c.req.method === 'GET') await count(c, row, 'views');
  return c.html(htmlText);
}

/** CV-4: a valid 10-minute pass, or a Turnstile token that earns one. */
async function proof(c: Ctx, row: CvRow): Promise<string | null> {
  const deps = c.get('deps');
  const now = deps.now();
  const form = await c.req.parseBody();
  const pass = typeof form.pass === 'string' ? form.pass : '';
  const payload = `r-${row.id}`;
  if (pass && (await verifyPass(deps.env.SESSION_SECRET, pass, payload, now))) return pass;
  const token = typeof form.token === 'string' ? form.token : '';
  if (!token) return null;
  // Bots that solve Turnstile still get only a few tries per CV.
  const ip = clientIp(c) ?? 'unknown';
  const limit = await hit(deps.db, `reveal:${row.id}:${ip}`, 20, 3_600_000, now);
  if (!limit.ok) return null;
  if (!(await deps.turnstile.verify(token, clientIp(c)))) return null;
  return signPass(deps.env.SESSION_SECRET, payload, now + PASS_TTL);
}

async function onlineRow(c: Ctx, row: CvRow | null): Promise<CvRow | null> {
  if (!row || publicState(row, c.get('deps').now()) !== 'online' || !(await pinOk(c, row))) return null;
  return row;
}

function noStore(c: Ctx): void {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex');
  c.header('Referrer-Policy', 'no-referrer');
}

export async function serveContact(c: Ctx, rowIn: CvRow | null): Promise<Response> {
  const row = await onlineRow(c, rowIn);
  const snap = row && snapshotOf(row);
  if (!row || !snap || snap.doc.body.layout.hidden.includes('contact')) return c.json({ error: 'not_found' }, 404);
  const pass = await proof(c, row);
  noStore(c);
  if (!pass) return c.json({ error: 'check_failed' }, 403);
  await count(c, row, 'contact_reveals');
  const p = snap.doc.profile;
  return c.json({ email: p.email || null, phone: p.phone || null, pass });
}

export async function servePdfPass(c: Ctx, rowIn: CvRow | null, base: string): Promise<Response> {
  const row = await onlineRow(c, rowIn);
  const snap = row && snapshotOf(row);
  if (!row || !snap) return c.json({ error: 'not_found' }, 404);
  const pass = await proof(c, row);
  noStore(c);
  if (!pass) return c.json({ error: 'check_failed' }, 403);
  const form = await c.req.parseBody();
  const lang = form.lang === 'en' || form.lang === 'cs' ? form.lang : snap.doc.langs[0]!;
  return c.json({ pass, url: `${base}/pdf?lang=${snap.pdf[lang] ? lang : snap.doc.langs[0]}&pass=${encodeURIComponent(pass)}` });
}

export async function servePdfFile(c: Ctx, rowIn: CvRow | null): Promise<Response> {
  const deps = c.get('deps');
  const row = await onlineRow(c, rowIn);
  const snap = row && snapshotOf(row);
  noStore(c);
  if (!row || !snap) return c.text('Not found', 404);
  const pass = c.req.query('pass') ?? '';
  if (!(await verifyPass(deps.env.SESSION_SECRET, pass, `r-${row.id}`, deps.now()))) return c.text('Odkaz vypršel. Klikněte na „Stáhnout PDF“ znovu.', 403);
  const lang = c.req.query('lang') === 'en' ? 'en' : c.req.query('lang') === 'cs' ? 'cs' : snap.doc.langs[0]!;
  const file = snap.pdf[lang];
  if (!file) return c.text('Not found', 404);
  const obj = await deps.media.get(file.key);
  if (!obj) return c.text('Not found', 404);
  await count(c, row, 'pdf_downloads');
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/** CV-14: PIN with rate limits per visitor and per CV (a 4-digit PIN has only 10 000 values). */
export async function servePin(c: Ctx, row: CvRow | null, base: string): Promise<Response> {
  const deps = c.get('deps');
  const now = deps.now();
  if (!row || row.visibility !== 'pin' || !row.pin_hash || publicState(row, now) !== 'online') return c.notFound();
  const snap = snapshotOf(row)!;
  const lang: Lang = c.req.query('lang') === 'en' && snap.doc.langs.includes('en') ? 'en' : snap.doc.langs[0]!;
  const action = `${base}/pin${lang !== snap.doc.langs[0] ? `?lang=${lang}` : ''}`;
  publicHeaders(c, false);
  // Only failed attempts count: 5 per visitor per 15 minutes, 50 per CV per day (a 4-digit PIN
  // has 10 000 values). The per-CV limit can lock everyone out for a day – the price of making
  // guessing from many addresses useless.
  const ip = clientIp(c) ?? 'unknown';
  const visitorKey = `pin:${row.id}:${ip}`;
  const cvKey = `pin:${row.id}`;
  if ((await peek(deps.db, visitorKey, now)) >= 5 || (await peek(deps.db, cvKey, now)) >= 50) {
    return c.html(renderPinHtml(lang, c.get('nonce'), action, snap.doc.design.accent, 'locked'), 429);
  }
  const form = await c.req.parseBody();
  const pin = typeof form.pin === 'string' ? form.pin.trim() : '';
  if (!/^\d{4,6}$/.test(pin) || !(await checkPin(pin, row.pin_hash))) {
    await hit(deps.db, visitorKey, 5, 15 * 60_000, now);
    await hit(deps.db, cvKey, 50, 24 * 3_600_000, now);
    return c.html(renderPinHtml(lang, c.get('nonce'), action, snap.doc.design.accent, 'wrong'), 401);
  }
  setCookie(c, `cvpin_${row.id}`, await signPass(deps.env.SESSION_SECRET, await pinPayload(row), now + PIN_TTL), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: PIN_TTL / 1000,
  });
  return c.redirect(`${base || ''}${lang !== snap.doc.langs[0] ? `/${lang}` : ''}` || '/', 303);
}

const MEDIA_KEY = /^cv\/([A-Za-z0-9_-]{4,32})\/(photo|project|cover)-[A-Za-z0-9_-]{4,32}\.(jpg|png)$/;

/** Images: published ones of an online CV for everyone; drafts for the holder and the studio. */
export async function serveMedia(c: Ctx, key: string, onlyCvId?: string): Promise<Response> {
  const deps = c.get('deps');
  const m = MEDIA_KEY.exec(key);
  if (!m || (onlyCvId && m[1] !== onlyCvId)) return c.notFound();
  const row = await getCvById(deps.db, m[1]!);
  if (!row) return c.notFound();
  const insider = isInsider(c, row);
  let allowed = insider;
  if (!allowed && publicState(row, deps.now()) === 'online' && (await pinOk(c, row))) {
    const snap = snapshotOf(row);
    allowed = !!snap && mediaKeys(snap.doc).includes(key);
  }
  if (!allowed) return c.notFound();
  const obj = await deps.media.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? (key.endsWith('.png') ? 'image/png' : 'image/jpeg'),
      // A PIN-protected CV's images must not sit in a shared cache.
      'Cache-Control': insider ? 'private, no-store' : row.visibility === 'pin' ? 'private, max-age=300' : 'public, max-age=300',
      ETag: obj.httpEtag,
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-site',
    },
  });
}

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!);
}

/** CV-5: only public, online CVs are in the sitemap. */
export async function sitemap(c: Ctx, rows: CvRow[], origin: string, base: (r: CvRow) => string): Promise<Response> {
  const now = c.get('deps').now();
  const urls: string[] = [];
  for (const r of rows) {
    if (r.visibility !== 'public' || publicState(r, now) !== 'online') continue;
    const snap = snapshotOf(r);
    if (!snap) continue;
    const primary = snap.doc.langs[0]!;
    for (const l of snap.doc.langs) {
      const loc = `${origin}${base(r)}${l === primary ? '' : `/${l}`}` || `${origin}/`;
      const alts = snap.doc.langs.length > 1 ? snap.doc.langs.map((a) => `<xhtml:link rel="alternate" hreflang="${a}" href="${xmlEscape(`${origin}${base(r)}${a === primary ? '' : `/${a}`}` || `${origin}/`)}"/>`).join('') : '';
      urls.push(`<url><loc>${xmlEscape(loc)}</loc><lastmod>${new Date(snap.publishedAt).toISOString().slice(0, 10)}</lastmod>${alts}</url>`);
    }
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>`;
  return c.body(body, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
}

export function registerPublic(app: Hono<AppEnv>): void {
  app.get('/', (c) => c.redirect(c.get('deps').env.SALES_URL, 302));
  app.get('/robots.txt', (c) =>
    c.text(
      `User-agent: *\nDisallow: /ucet/\nDisallow: /admin/\nDisallow: /prihlaseni\nDisallow: /auth/\nDisallow: /uchovat/\nAllow: /\n\nSitemap: ${c.get('deps').baseUrl}/sitemap.xml\n`,
    ),
  );
  app.get('/sitemap.xml', async (c) => {
    const deps = c.get('deps');
    const rows = (await deps.db.prepare(`SELECT * FROM cvs WHERE visibility = 'public' AND status = 'live' AND published IS NOT NULL AND paid_until > ? AND id NOT IN (SELECT cv_id FROM domains WHERE status = 'active')`).bind(deps.now()).all<CvRow>()).results ?? [];
    return sitemap(c, rows, deps.baseUrl, (r) => `/${r.slug}`);
  });
  app.get('/media/:key{.+}', (c) => serveMedia(c, c.req.param('key')));

  const bySlug = (c: Ctx) => getCvBySlug(c.get('deps').db, c.req.param('slug') ?? '');
  /** An old address of a CV that changed its address redirects to the current one. */
  const page = async (c: Ctx, lang: string | undefined) => {
    const row = await bySlug(c);
    if (!row) {
      const moved = await one<{ slug: string }>(
        c.get('deps').db,
        'SELECT c.slug FROM slug_history h JOIN cvs c ON c.id = h.cv_id WHERE h.slug = ?',
        c.req.param('slug') ?? '',
      );
      if (moved) return c.redirect(`/${moved.slug}${lang ? `/${lang}` : ''}`, 301);
    }
    return servePage(c, row, `/${c.req.param('slug')}`, lang);
  };
  app.on(['GET', 'HEAD'], '/:slug{[a-z0-9-]{3,50}}', (c) => page(c, undefined));
  app.on(['GET', 'HEAD'], '/:slug{[a-z0-9-]{3,50}}/:lang{cs|en}', (c) => page(c, c.req.param('lang')));
  app.post('/:slug{[a-z0-9-]{3,50}}/kontakt', async (c) => serveContact(c, await bySlug(c)));
  app.post('/:slug{[a-z0-9-]{3,50}}/pdf', async (c) => servePdfPass(c, await bySlug(c), `/${c.req.param('slug')}`));
  app.get('/:slug{[a-z0-9-]{3,50}}/pdf', async (c) => servePdfFile(c, await bySlug(c)));
  app.post('/:slug{[a-z0-9-]{3,50}}/pin', async (c) => servePin(c, await bySlug(c), `/${c.req.param('slug')}`));
}

/** Routes on a holder's own domain: the CV lives at "/". */
export function registerDomain(app: Hono<AppEnv>, cvIdOf: (c: Ctx) => Promise<string | null>): void {
  const row = async (c: Ctx) => {
    const id = await cvIdOf(c);
    return id ? getCvById(c.get('deps').db, id) : null;
  };
  app.get('/robots.txt', (c) => c.text(`User-agent: *\nAllow: /\n\nSitemap: ${new URL(c.req.url).origin}/sitemap.xml\n`));
  app.get('/sitemap.xml', async (c) => {
    const r = await row(c);
    return sitemap(c, r ? [r] : [], new URL(c.req.url).origin, () => '');
  });
  app.get('/media/:key{.+}', async (c) => serveMedia(c, c.req.param('key'), (await cvIdOf(c)) ?? '-'));
  app.on(['GET', 'HEAD'], '/', async (c) => servePage(c, await row(c), '', undefined));
  app.on(['GET', 'HEAD'], '/:lang{cs|en}', async (c) => servePage(c, await row(c), '', c.req.param('lang')));
  app.post('/kontakt', async (c) => serveContact(c, await row(c)));
  app.post('/pdf', async (c) => servePdfPass(c, await row(c), ''));
  app.get('/pdf', async (c) => servePdfFile(c, await row(c)));
  app.post('/pin', async (c) => servePin(c, await row(c), ''));
}

