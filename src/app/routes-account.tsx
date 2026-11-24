import type { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { normalizeIsic } from '../config/schools';
import { isTemplateId } from '../config/templates';
import { isTierId, TIERS } from '../config/tiers';
import { coerceDesign, hardCapProblem, renderableDoc } from '../cv/sanitize';
import { randomId, slugify, slugProblem } from '../cv/text';
import type { CvDoc, Lang, TierId } from '../cv/types';
import { validateDoc } from '../cv/validate';
import { renderPdf } from '../pdf/render';
import { audit } from '../platform/audit';
import { consumeToken, createSession, destroySession, findOrCreateAccount, issueToken, normalizeEmail, peekToken, SESSION_COOKIE, SESSION_TTL, type AccountRow } from '../platform/auth';
import { hashPin } from '../platform/crypto';
import { all, one, run } from '../platform/db';
import { mails } from '../platform/mail';
import { checkImage, stripJpegMetadata, stripPngMetadata, type MediaKind } from '../platform/media';
import { hit } from '../platform/ratelimit';
import { statsFor } from '../platform/stats';
import { completePayment, markStudent, quote, requestIsic, requestSchoolEmail, startCheckout, studentEligible, type PaymentRow } from '../services/billing';
import {
  createCv,
  deleteCv,
  draftDoc,
  getCvByAccount,
  hasUnpublishedChanges,
  isPaid,
  langsOf,
  pause,
  publicState,
  publicUrl,
  publish,
  resume,
  saveBody,
  saveProfile,
  slugAvailable,
  updateCv,
  type CvActor,
  type CvRow,
} from '../services/cvs';
import { activeDomainFor, domainsOf, normalizeHostname, requestDomain } from '../services/domains';
import { applySection, parseForm } from './editor-apply';
import { clientIp, errorPage, holderActor, page, publicCsp, type AppEnv, type Ctx } from './core';
import { ConfirmView, DashboardView, LinkedInHelpView, LoginView, NewCvView, PaymentDoneView, PublishView, SettingsView, StatsView, StudentView, TestPaymentView } from './views/account';
import { EditorView, sectionByKey } from './views/editor';
import { renderCvHtml } from '../web/render';
import { registerImport } from './routes-import';

function requireAccount(c: Ctx): AccountRow | null {
  return c.get('account');
}

function toLogin(c: Ctx): Response {
  return c.redirect(`/prihlaseni?dalsi=${encodeURIComponent(c.req.path)}`, 303);
}

// ---------- shared editor handlers (holder and admin) ----------

export interface EditorTarget {
  row: CvRow;
  actor: CvActor;
  base: string;
  mediaAction: string;
  previewHref: string;
  admin: boolean;
}

export async function editorGet(c: Ctx, t: EditorTarget, sectionKey: string, saveProblem?: string, override?: CvDoc): Promise<Response> {
  if (!sectionByKey(sectionKey)) return errorPage(c, 404, 'Taková sekce v životopisu není.');
  const deps = c.get('deps');
  const doc = override ?? (await draftDoc(deps.db, t.row));
  const problem = saveProblem ?? (c.req.query('chyba') ? decodeProblem(c.req.query('chyba')!) : undefined);
  return page(
    c,
    `Upravit – ${sectionByKey(sectionKey)!.label}`,
    <EditorView doc={doc} issues={validateDoc(doc)} sectionKey={sectionKey} base={t.base} mediaAction={t.mediaAction} previewHref={t.previewHref} mode={t.admin ? 'admin' : 'holder'} saveProblem={problem} />,
    { wide: true, status: saveProblem ? 400 : 200, admin: t.admin },
  );
}

const PROBLEMS: Record<string, string> = {
  'photo-format': 'Fotka musí být ve formátu JPEG.',
  'photo-size': 'Fotka je moc velká (nejvíc 300 kB). Editor ji při nahrání sám zmenší, pokud máte zapnutý JavaScript.',
  'photo-dimensions': 'Fotka může mít nejvíc 1200 px na delší straně.',
  'project-format': 'Obrázek musí být JPEG nebo PNG.',
  'project-size': 'Obrázek je moc velký (nejvíc 600 kB).',
  'project-dimensions': 'Obrázek může mít nejvíc 2000 px na delší straně.',
  'cover-format': 'Obrázek musí být JPEG nebo PNG.',
  'cover-size': 'Obrázek je moc velký (nejvíc 800 kB).',
  'cover-dimensions': 'Obrázek může mít nejvíc 2400 px na delší straně.',
  'no-file': 'Vyberte prosím soubor.',
  tier: 'Tohle váš balíček nezahrnuje.',
};
const decodeProblem = (code: string) => PROBLEMS[code];

export async function editorPost(c: Ctx, t: EditorTarget, sectionKey: string): Promise<Response> {
  if (!sectionByKey(sectionKey)) return errorPage(c, 404, 'Taková sekce v životopisu není.');
  const deps = c.get('deps');
  const fd = await c.req.raw.formData();
  const form = parseForm(fd.entries() as Iterable<[string, unknown]>);
  const op = typeof form.op === 'string' ? form.op : null;
  const doc = await draftDoc(deps.db, t.row);
  const applied = applySection(sectionKey, doc, form, op);
  const profile = applied.profile ?? doc.profile;
  const body = applied.body ?? doc.body;
  // Refuse only new runaway text; content already stored (e.g. from an import) never blocks a save.
  const problem = hardCapProblem(profile, body) && !hardCapProblem(doc.profile, doc.body) ? hardCapProblem(profile, body) : null;
  if (problem) {
    return editorGet(c, t, sectionKey, problem, { ...doc, profile, body, design: { ...doc.design, ...applied.design } });
  }
  if (applied.profile) await saveProfile(deps, t.row.account_id, applied.profile, t.actor, t.row.id);
  if (applied.body) await saveBody(deps, t.row, applied.body, t.actor);
  if (applied.design) await updateCv(deps, t.row, applied.design, t.actor);
  const anchor = op && /^(add|preset)/.test(op) ? '#konec' : '';
  return c.redirect(`${t.base}/${sectionKey}?ok=ulozeno${anchor}`, 303);
}

/** Image upload (photo, project image, Na míru cover): checked by content, metadata removed. */
export async function mediaPost(c: Ctx, t: EditorTarget): Promise<Response> {
  const deps = c.get('deps');
  const form = await c.req.parseBody();
  const kind = form.kind as MediaKind;
  const back = (section: string, code?: string) => c.redirect(`${t.base}/${section}${code ? `?chyba=${code}` : '?ok=ulozeno'}`, 303);
  const section = kind === 'photo' ? 'hlavicka' : kind === 'project' ? 'projekty' : 'vzhled';
  if (!['photo', 'project', 'cover'].includes(kind)) return errorPage(c, 400, 'Neznámý typ obrázku.');
  const tier = TIERS[t.row.tier];
  if ((kind === 'project' && !tier.projectImages) || (kind === 'cover' && (!tier.studioDesign || !t.admin))) return back(section, 'tier');
  const file = form.file;
  if (!(file instanceof File) || file.size === 0) return back(section, 'no-file');
  let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
  const check = checkImage(kind, bytes);
  if (!check.ok) return back(section, `${kind}-${check.problem}`);
  // Metadata (EXIF location, text chunks) goes, whatever the browser did.
  bytes = check.info.format === 'jpeg' ? stripJpegMetadata(bytes) : stripPngMetadata(bytes);
  const ext = check.info.format === 'png' ? 'png' : 'jpg';
  const key = `cv/${t.row.id}/${kind}-${randomId()}.${ext}`;
  await deps.media.put(key, bytes, { httpMetadata: { contentType: `image/${check.info.format}` } });
  await run(deps.db, 'INSERT INTO media (key, cv_id, kind, bytes, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', key, t.row.id, kind, bytes.length, check.info.width, check.info.height, deps.now());
  const ref = { key, width: check.info.width, height: check.info.height };
  const doc = await draftDoc(deps.db, t.row);
  if (kind === 'photo') await saveProfile(deps, t.row.account_id, { ...doc.profile, photo: ref }, t.actor, t.row.id);
  else if (kind === 'cover') await updateCv(deps, t.row, { cover: ref }, t.actor);
  else {
    const target = String(form.target ?? '');
    const projects = doc.body.projects.map((p) => (p.id === target ? { ...p, image: ref } : p));
    await saveBody(deps, t.row, { ...doc.body, projects }, t.actor);
  }
  return back(section);
}

export async function previewHtml(c: Ctx, row: CvRow): Promise<Response> {
  const deps = c.get('deps');
  const doc = renderableDoc(await draftDoc(deps.db, row));
  const q = c.req.query('lang');
  const lang: Lang = (q === 'cs' || q === 'en') && doc.langs.includes(q) ? q : doc.langs[0]!;
  c.header('Content-Security-Policy', publicCsp(c.get('nonce')));
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Robots-Tag', 'noindex');
  return c.html(
    renderCvHtml({
      doc,
      lang,
      basePath: `/${row.slug}`,
      origin: new URL(c.req.url).origin,
      visibility: 'link',
      siteKey: deps.env.TURNSTILE_SITE_KEY,
      hasPdf: true,
      salesUrl: deps.env.SALES_URL,
      nonce: c.get('nonce'),
      preview: true,
    }),
  );
}

export async function previewPdf(c: Ctx, row: CvRow): Promise<Response> {
  const deps = c.get('deps');
  const doc = renderableDoc(await draftDoc(deps.db, row));
  const q = c.req.query('lang');
  const lang: Lang = (q === 'cs' || q === 'en') && doc.langs.includes(q) ? q : doc.langs[0]!;
  let photo: Uint8Array | null = null;
  if (doc.profile.photo) {
    const obj = await deps.media.get(doc.profile.photo.key);
    photo = obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    if (!photo) doc.profile.photo = null;
  }
  const out = await renderPdf({ doc, lang, photo, date: new Date(deps.now()) });
  return new Response(out.bytes, {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${out.filename}"`, 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  });
}

// ---------- routes ----------

export function registerAccount(app: Hono<AppEnv>): void {
  // Sign-in (A2)
  app.get('/prihlaseni', (c) => (c.get('account') ? c.redirect('/ucet', 303) : page(c, 'Přihlášení', <LoginView src={c.req.query('src')} />)));
  app.post('/prihlaseni', async (c) => {
    const deps = c.get('deps');
    const now = deps.now();
    const form = await c.req.parseBody();
    const email = normalizeEmail(String(form.email ?? ''));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return page(c, 'Přihlášení', <LoginView error="Zkontrolujte prosím e-mail." />, { status: 400 });
    const perEmail = await hit(deps.db, `login:${email}`, 5, 3_600_000, now);
    const perIp = await hit(deps.db, `login-ip:${clientIp(c) ?? 'unknown'}`, 30, 3_600_000, now);
    if (perEmail.ok && perIp.ok) {
      const src = typeof form.src === 'string' ? form.src.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : undefined;
      const token = await issueToken(deps.db, now, 'login', { email, data: src ? { src } : undefined });
      await deps.mailer.send(mails.login(email, `${deps.baseUrl}/auth/${token}`));
    }
    // Same answer either way: no hint whether an account exists or a limit was hit.
    return page(c, 'Zkontrolujte e-mail', <LoginView sent />);
  });
  // E-mail scanners open links; the token is used only by this POST.
  app.get('/auth/:token', async (c) => {
    const deps = c.get('deps');
    const t = await peekToken(deps.db, 'login', c.req.param('token'), deps.now());
    if (!t) return errorPage(c, 410, 'Odkaz pro přihlášení už neplatí. Nechte si poslat nový.');
    return page(c, 'Přihlášení', <ConfirmView title="Přihlásit se" text={`Přihlašujete se jako ${t.email}.`} action={`/auth/${c.req.param('token')}`} button="Přihlásit se" />);
  });
  app.post('/auth/:token', async (c) => {
    const deps = c.get('deps');
    const now = deps.now();
    const t = await consumeToken(deps.db, 'login', c.req.param('token'), now);
    if (!t || !t.email) return errorPage(c, 410, 'Odkaz pro přihlášení už neplatí. Nechte si poslat nový.');
    const src = t.data ? (JSON.parse(t.data) as { src?: string }).src : undefined;
    const account = await findOrCreateAccount(deps.db, t.email, now, src);
    const sid = await createSession(deps.db, account.id, now);
    // Signing in answers the yearly "keep my CV?" question (CV-8).
    await run(deps.db, 'UPDATE cvs SET retention_confirmed_at = ? WHERE account_id = ?', now, account.id);
    setCookie(c, SESSION_COOKIE, sid, { httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: SESSION_TTL / 1000 });
    return c.redirect(deps.admins.includes(account.email) ? '/admin' : '/ucet', 303);
  });
  app.post('/odhlaseni', async (c) => {
    await destroySession(c.get('deps').db, c.get('sessionId'));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.redirect('/prihlaseni', 303);
  });

  // Everything under /ucet needs a signed-in holder.
  const guard = async (c: Ctx, next: () => Promise<void>) => {
    if (!requireAccount(c)) return toLogin(c);
    await next();
  };
  app.use('/ucet', guard);
  app.use('/ucet/*', guard);
  app.get('/ucet', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    const doc = await draftDoc(deps.db, row);
    const domain = await activeDomainFor(deps.db, row.id);
    const stats = TIERS[row.tier].stats ? (await statsFor(deps.db, row.id, deps.now())).total : null;
    return page(
      c,
      'Můj životopis',
      <DashboardView
        account={account}
        row={row}
        doc={doc}
        issues={validateDoc(doc)}
        state={publicState(row, deps.now())}
        url={publicUrl(deps, row)}
        ownUrl={domain ? `https://${domain.hostname}` : null}
        unpublished={hasUnpublishedChanges(row, doc)}
        paid={isPaid(row, deps.now())}
        stats={stats}
      />,
    );
  });

  // New CV
  app.get('/ucet/novy', async (c) => {
    const deps = c.get('deps');
    if (await getCvByAccount(deps.db, c.get('account')!.id)) return c.redirect('/ucet', 303);
    const tier = isTierId(c.req.query('balicek')) ? (c.req.query('balicek') as TierId) : 'zaklad';
    return page(c, 'Nový životopis', <NewCvView name="" slug="" tier={tier} />);
  });
  app.post('/ucet/novy', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    if (await getCvByAccount(deps.db, account.id)) return c.redirect('/ucet', 303);
    const form = await c.req.parseBody();
    const name = String(form.name ?? '').trim().slice(0, 100);
    const slug = (String(form.slug ?? '').trim().toLowerCase() || slugify(name)).slice(0, 50);
    const tier: TierId = isTierId(form.tier) ? form.tier : 'zaklad';
    const langs = (String(form.lang ?? 'cs').split(',').filter((l) => l === 'cs' || l === 'en') as Lang[]).slice(0, TIERS[tier].maxLangs);
    const again = (error: string) => page(c, 'Nový životopis', <NewCvView name={name} slug={slug} tier={tier} error={error} />, { status: 400 });
    const problem = slugProblem(slug);
    if (problem) return again(problem);
    if (!(await slugAvailable(deps.db, slug, account.id, deps.now()))) return again('Tuto adresu už někdo má. Zkuste třeba přidat druhé jméno nebo obor.');
    await createCv(deps, account.id, {
      slug,
      tier,
      langs: langs.length ? langs : ['cs'],
      template: isTemplateId(form.template) ? form.template : 'moderni',
      graduate: form.graduate === '1',
      name,
    });
    return c.redirect('/ucet/upravit/hlavicka', 303);
  });

  // Editor
  const holderTarget = async (c: Ctx): Promise<EditorTarget | null> => {
    const account = c.get('account')!;
    const row = await getCvByAccount(c.get('deps').db, account.id);
    return row ? { row, actor: holderActor(account), base: '/ucet/upravit', mediaAction: '/ucet/media', previewHref: '/ucet/nahled', admin: false } : null;
  };
  app.get('/ucet/upravit', (c) => c.redirect('/ucet/upravit/hlavicka', 303));
  app.get('/ucet/upravit/:section', async (c) => {
    const t = await holderTarget(c);
    return t ? editorGet(c, t, c.req.param('section')) : c.redirect('/ucet/novy', 303);
  });
  app.post('/ucet/upravit/:section', async (c) => {
    const t = await holderTarget(c);
    return t ? editorPost(c, t, c.req.param('section')) : c.redirect('/ucet/novy', 303);
  });
  app.post('/ucet/media', async (c) => {
    const t = await holderTarget(c);
    return t ? mediaPost(c, t) : c.redirect('/ucet/novy', 303);
  });
  app.get('/ucet/nahled', async (c) => {
    const t = await holderTarget(c);
    return t ? previewHtml(c, t.row) : c.redirect('/ucet/novy', 303);
  });
  app.get('/ucet/nahled.pdf', async (c) => {
    const t = await holderTarget(c);
    return t ? previewPdf(c, t.row) : c.redirect('/ucet/novy', 303);
  });

  // Publish and pay (D3)
  app.get('/ucet/zverejnit', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    const q = quote(account, row);
    return page(
      c,
      'Zveřejnit',
      <PublishView
        account={account}
        row={row}
        issues={validateDoc(await draftDoc(deps.db, row))}
        paid={isPaid(row, deps.now())}
        amount={q.amount}
        studentEligible={q.student}
        canStudent={!!account.student_verified_at && !row.paid_until}
        cancelled={c.req.query('zruseno') === '1'}
      />,
    );
  });
  app.post('/ucet/tarif', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    const form = await c.req.parseBody();
    if (row && !row.paid_until && isTierId(form.tier)) {
      const langs = langsOf(row).slice(0, TIERS[form.tier].maxLangs);
      const patch: Parameters<typeof updateCv>[2] = { tier: form.tier, langs };
      // Základ picks from the palette: keep the accent if it is one, otherwise reset (CV-2).
      if (!TIERS[form.tier].ownAccent) patch.accent = coerceDesign({ accent: row.accent }).accent;
      await updateCv(deps, row, patch, holderActor(account));
    }
    return c.redirect('/ucet/zverejnit', 303);
  });
  app.post('/ucet/zverejnit', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    if (!isPaid(row, deps.now())) {
      if (row.paid_until) return c.redirect('/ucet', 303); // expired: renew from the dashboard
      const checkout = await startCheckout(deps, account, row);
      return c.redirect(checkout.url, 303);
    }
    const r = await publish(deps, row, holderActor(account));
    if (r.ok) {
      if (!row.published) await deps.mailer.send(mails.published(account.email, publicUrl(deps, row)));
      return c.redirect('/ucet?ok=zverejneno', 303);
    }
    if (r.reason === 'photo_missing') return errorPage(c, 409, 'Fotku se nepodařilo načíst. Nahrajte ji prosím znovu.');
    return c.redirect('/ucet/zverejnit', 303);
  });
  app.post('/ucet/prodlouzit', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row || !row.paid_until) return c.redirect('/ucet/zverejnit', 303);
    const checkout = await startCheckout(deps, account, row);
    return c.redirect(checkout.url, 303);
  });
  app.post('/ucet/pozastavit', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (row && row.status === 'live') await pause(deps, row, holderActor(account));
    return c.redirect('/ucet?ok=pozastaveno', 303);
  });
  app.post('/ucet/obnovit', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet', 303);
    const r = await resume(deps, row, holderActor(account));
    if (r === 'online') return c.redirect('/ucet?ok=obnoveno', 303);
    if (r === 'unpaid') {
      // Paid from "Obnovit": once paid, the CV comes back online too.
      const checkout = await startCheckout(deps, account, row, { resume: true });
      return c.redirect(checkout.url, 303);
    }
    return c.redirect('/ucet/zverejnit', 303);
  });

  // Dev payment provider
  app.get('/ucet/platba/test/:id', async (c) => {
    const deps = c.get('deps');
    if (deps.payments.id !== 'dev') return c.notFound();
    const p = await one<PaymentRow>(deps.db, 'SELECT * FROM payments WHERE id = ? AND account_id = ?', c.req.param('id'), c.get('account')!.id);
    if (!p) return c.notFound();
    return page(c, 'Testovací platba', <TestPaymentView id={p.id} amount={p.amount_czk} label={`${p.kind === 'renewal' ? 'Prodloužení' : TIERS[p.tier].name}${p.student ? ' (student)' : ''}`} />);
  });
  app.post('/ucet/platba/test/:id', async (c) => {
    const deps = c.get('deps');
    if (deps.payments.id !== 'dev') return c.notFound();
    const p = await one<PaymentRow>(deps.db, 'SELECT * FROM payments WHERE id = ? AND account_id = ?', c.req.param('id'), c.get('account')!.id);
    if (!p) return c.notFound();
    const outcome = await completePayment(deps, p.id, `dev_${p.id}`);
    return c.redirect(`/ucet/platba/hotovo?p=${p.id}&v=${outcome}`, 303);
  });
  app.get('/ucet/platba/hotovo', async (c) => {
    const deps = c.get('deps');
    const p = await one<PaymentRow>(deps.db, 'SELECT * FROM payments WHERE id = ? AND account_id = ?', c.req.query('p') ?? '', c.get('account')!.id);
    if (!p) return c.redirect('/ucet', 303);
    return page(c, 'Platba', <PaymentDoneView status={p.status} outcome={c.req.query('v')} />);
  });

  // Settings
  const settings = async (c: Ctx, extra: { slugError?: string; problem?: string } = {}, status = 200) => {
    const deps = c.get('deps');
    const row = await getCvByAccount(deps.db, c.get('account')!.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    return page(c, 'Nastavení', <SettingsView row={row} langs={langsOf(row)} domains={await domainsOf(deps.db, row.id)} pinSet={!!row.pin_hash} {...extra} />, { status });
  };
  app.get('/ucet/nastaveni', (c) => settings(c));
  app.post('/ucet/nastaveni/viditelnost', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    const form = await c.req.parseBody();
    const v = form.visibility === 'public' || form.visibility === 'pin' ? form.visibility : 'link';
    const pin = String(form.pin ?? '').trim();
    if (pin && !/^\d{4,6}$/.test(pin)) return settings(c, { problem: 'PIN musí mít 4 až 6 číslic.' }, 400);
    if (v === 'pin' && !pin && !row.pin_hash) return settings(c, { problem: 'Pro ochranu PINem zadejte PIN.' }, 400);
    await updateCv(deps, row, { visibility: v, ...(pin ? { pinHash: await hashPin(pin) } : {}) }, holderActor(account));
    return c.redirect('/ucet/nastaveni?ok=ulozeno', 303);
  });
  app.post('/ucet/nastaveni/jazyky', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    const form = await c.req.parseBody();
    const langs = (String(form.langs ?? '').split(',').filter((l) => l === 'cs' || l === 'en') as Lang[]).slice(0, TIERS[row.tier].maxLangs);
    if (langs.length) await updateCv(deps, row, { langs: [...new Set(langs)] }, holderActor(account));
    return c.redirect('/ucet/nastaveni?ok=ulozeno', 303);
  });
  app.post('/ucet/nastaveni/adresa', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    const slug = String((await c.req.parseBody()).slug ?? '').trim().toLowerCase();
    if (slug === row.slug) return c.redirect('/ucet/nastaveni', 303);
    const problem = slugProblem(slug);
    if (problem) return settings(c, { slugError: problem }, 400);
    if (!(await slugAvailable(deps.db, slug, account.id, deps.now()))) return settings(c, { slugError: 'Tuto adresu už někdo má.' }, 400);
    await updateCv(deps, row, { slug }, holderActor(account));
    return c.redirect('/ucet/nastaveni?ok=ulozeno', 303);
  });
  app.post('/ucet/nastaveni/domena', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    const form = await c.req.parseBody();
    const host = normalizeHostname(String(form.hostname ?? ''));
    if (!host) return settings(c, { problem: 'Zadejte doménu, např. jananovakova.cz.' }, 400);
    const mode = form.mode === 'holder_moves_dns' ? 'holder_moves_dns' : 'studio_registers';
    const r = await requestDomain(deps, row, host, mode, holderActor(account));
    if (r === 'tier') return settings(c, { problem: 'Vlastní doménu má Profi a Na míru.' }, 400);
    if (r === 'taken') return settings(c, { problem: 'Tuto doménu už používá jiný životopis.' }, 400);
    return c.redirect('/ucet/nastaveni?ok=domena', 303);
  });
  app.post('/ucet/smazat', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet', 303);
    if (String((await c.req.parseBody()).confirm ?? '').trim() !== row.slug) return settings(c, { problem: 'Pro smazání napište přesně adresu životopisu.' }, 400);
    await deleteCv(deps, row, holderActor(account), 'holder request');
    return c.redirect('/ucet/novy?ok=smazano', 303);
  });
  app.get('/ucet/export.json', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    const data = {
      exportedAt: new Date(deps.now()).toISOString(),
      account: { email: account.email, createdAt: new Date(account.created_at).toISOString(), student: account.student_verified_at ? account.student_method : null },
      cv: row ? { slug: row.slug, tier: row.tier, visibility: row.visibility, status: row.status, paidUntil: row.paid_until, draft: await draftDoc(deps.db, row), published: row.published ? JSON.parse(row.published) : null } : null,
      payments: await all(deps.db, 'SELECT kind, tier, student, amount_czk, status, created_at, paid_at FROM payments WHERE account_id = ?', account.id),
      studentRequests: (await all<{ method: string; value: string; status: string; created_at: number }>(deps.db, 'SELECT method, value, status, created_at FROM student_requests WHERE account_id = ?', account.id)).map((r) => ({
        ...r,
        value: `${r.value.slice(0, 4)}…${r.value.slice(-3)}`,
      })),
      statistics: row ? await all(deps.db, 'SELECT day, views, pdf_downloads, contact_reveals FROM stats_daily WHERE cv_id = ? ORDER BY day', row.id) : [],
    };
    return c.body(JSON.stringify(data, null, 2), 200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="pulzar-cv-data.json"', 'Cache-Control': 'no-store' });
  });

  // Student price (CV-12)
  const student = async (c: Ctx, problem?: string, status = 200) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const pending = !!(await one(deps.db, `SELECT 1 FROM student_requests WHERE account_id = ? AND status = 'pending'`, account.id));
    return page(c, 'Studentská cena', <StudentView account={account} pending={pending} problem={problem} />, { status });
  };
  app.get('/ucet/student', (c) => student(c));
  app.post('/ucet/student/skola', async (c) => {
    const deps = c.get('deps');
    const limit = await hit(deps.db, `student:${c.get('account')!.id}`, 5, 3_600_000, deps.now());
    if (!limit.ok) return student(c, 'Příliš mnoho pokusů. Zkuste to prosím za hodinu.', 429);
    const r = await requestSchoolEmail(deps, c.get('account')!, String((await c.req.parseBody()).email ?? ''));
    if (r === 'not_school') return student(c, 'Tuhle adresu neznáme jako školní. Zkuste ISIC, nebo nám napište.', 400);
    return c.redirect('/ucet/student?ok=odeslano', 303);
  });
  app.get('/ucet/student/overit/:token', async (c) => {
    const deps = c.get('deps');
    const t = await peekToken(deps.db, 'student', c.req.param('token'), deps.now());
    if (!t || t.account_id !== c.get('account')!.id) return errorPage(c, 410, 'Odkaz neplatí nebo patří k jinému účtu. Přihlaste se účtem, ze kterého jste o ověření žádali.');
    return page(c, 'Studentská cena', <ConfirmView title="Ověřit školní e-mail" text={`Potvrďte adresu ${t.email}.`} action={`/ucet/student/overit/${c.req.param('token')}`} button="Ověřit" />);
  });
  app.post('/ucet/student/overit/:token', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    // Check whose link it is before using it up, so a wrong account cannot burn it.
    const peeked = await peekToken(deps.db, 'student', c.req.param('token'), deps.now());
    if (!peeked || peeked.account_id !== account.id) return errorPage(c, 410, 'Odkaz neplatí nebo patří k jinému účtu.');
    const t = await consumeToken(deps.db, 'student', c.req.param('token'), deps.now());
    if (!t) return errorPage(c, 410, 'Odkaz už neplatí.');
    const domain = t.data ? (JSON.parse(t.data) as { domain: string }).domain : '';
    const r = await markStudent(deps, account.id, 'school_email', domain, holderActor(account), t.email ?? undefined);
    if (r === 'mailbox_used') return student(c, 'Tahle školní adresa už ověřila jiný účet. Pokud jde o omyl, napište nám.', 409);
    return c.redirect('/ucet/zverejnit?ok=student', 303);
  });
  app.post('/ucet/student/isic', async (c) => {
    const deps = c.get('deps');
    const isic = normalizeIsic(String((await c.req.parseBody()).isic ?? ''));
    if (!isic) return student(c, 'Číslo ISIC má tvar písmeno, 12 číslic a písmeno, např. S 420 123 456 789 A.', 400);
    await requestIsic(deps, c.get('account')!, isic);
    return c.redirect('/ucet/student?ok=isic', 303);
  });

  // Help and statistics
  app.get('/ucet/napoveda/linkedin', async (c) => {
    const deps = c.get('deps');
    const row = await getCvByAccount(deps.db, c.get('account')!.id);
    return page(c, 'Odkaz v LinkedInu', <LinkedInHelpView url={row ? publicUrl(deps, row) : `${deps.baseUrl}/vase-jmeno`} />);
  });
  app.get('/ucet/statistiky', async (c) => {
    const deps = c.get('deps');
    const row = await getCvByAccount(deps.db, c.get('account')!.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    if (!TIERS[row.tier].stats) return errorPage(c, 403, 'Statistiky jsou v Profi a Na míru.');
    const s = await statsFor(deps.db, row.id, deps.now());
    return page(c, 'Statistiky', <StatsView days={s.days} total={s.total} />);
  });

  registerImport(app);

  // "Chcete životopis dál uchovat?" (CV-8) – works without signing in.
  app.get('/uchovat/:token', async (c) => {
    const deps = c.get('deps');
    const t = await peekToken(deps.db, 'keep', c.req.param('token'), deps.now());
    if (!t) return errorPage(c, 410, 'Odkaz už neplatí. Přihlaste se – přihlášení se počítá jako odpověď.');
    return page(c, 'Uchovat životopis', <ConfirmView title="Chcete životopis dál uchovat?" text="Data uchováme zdarma a odkaz zůstane stejný." action={`/uchovat/${c.req.param('token')}`} button="Ano, uchovat" />);
  });
  app.post('/uchovat/:token', async (c) => {
    const deps = c.get('deps');
    const now = deps.now();
    const t = await consumeToken(deps.db, 'keep', c.req.param('token'), now);
    if (!t || !t.account_id) return errorPage(c, 410, 'Odkaz už neplatí.');
    await run(deps.db, 'UPDATE cvs SET retention_confirmed_at = ?, retention_prompted_at = NULL, retention_warned_at = NULL WHERE account_id = ?', now, t.account_id);
    await audit(deps.db, now, { id: t.account_id, email: t.email }, 'retention.keep', null);
    return page(
      c,
      'Děkujeme',
      <div class="narrow">
        <h1>Děkujeme, životopis uchováme</h1>
        <p>Zeptáme se znovu za rok. Kdykoli ho můžete vrátit online na stejném odkazu.</p>
        <p>
          <a class="btn" href="/ucet">
            Na můj účet
          </a>
        </p>
      </div>,
    );
  });

  // Payment provider webhook (Stripe)
  app.post('/webhooks/platby', async (c) => {
    const deps = c.get('deps');
    const r = await deps.payments.parseWebhook(c.req.raw);
    if (!r) return c.text('ignored', 400);
    if (r.paid) await completePayment(deps, r.paymentId, r.ref);
    return c.text('ok');
  });

}
