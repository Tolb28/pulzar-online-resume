import { beforeEach, describe, expect, it } from 'vitest';
import { auditFor } from '../src/platform/audit';
import { getCvBySlug, publish, snapshotOf } from '../src/services/cvs';
import { fillCv } from './helpers/flows';
import { Browser, harness, type Harness } from './helpers/env';

async function payAndPublish(b: Browser) {
  const pay = await b.post('/ucet/zverejnit');
  const out = await b.post(pay.headers.get('location')!);
  return out.headers.get('location')!;
}

describe('CV-12 student price', () => {
  let h: Harness;
  let b: Browser;
  beforeEach(async () => {
    h = harness();
    b = new Browser(h);
    await b.signIn('student@gmail.com');
    await fillCv(b);
  });

  it('verifies a school e-mail by magic link and charges 390 Kč for the first year only', async () => {
    expect((await b.post('/ucet/student/skola', { email: 'jana@gmail.com' })).status).toBe(400);
    expect((await b.post('/ucet/student/skola', { email: 'novakova@student.cuni.cz' })).headers.get('location')).toBe('/ucet/student?ok=odeslano');
    const mail = h.mail.last('student')!;
    expect(mail.to).toBe('novakova@student.cuni.cz');
    const link = /https:\/\/cv\.test(\/ucet\/student\/overit\/[A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    // Another account cannot use the link.
    const other = new Browser(h);
    await other.signIn('someone@example.cz');
    expect((await other.post(link)).status).toBe(410);
    expect((await b.post(link)).headers.get('location')).toBe('/ucet/zverejnit?ok=student');
    const pay = await b.post('/ucet/zverejnit');
    expect(await (await b.get(pay.headers.get('location')!)).text()).toContain('390 Kč');
    await b.post(pay.headers.get('location')!);
    const p = await h.deps.db.prepare(`SELECT amount_czk, student FROM payments WHERE kind = 'initial'`).first<{ amount_czk: number; student: number }>();
    expect(p).toEqual({ amount_czk: 390, student: 1 });
    // Renewal is at the normal renewal price.
    const ren = await b.post('/ucet/prodlouzit');
    expect(await (await b.get(ren.headers.get('location')!)).text()).toContain('390 Kč');
    const r = await h.deps.db.prepare(`SELECT student FROM payments WHERE kind = 'renewal'`).first<{ student: number }>();
    expect(r!.student).toBe(0);
  });

  it('applies to Základ only', async () => {
    await b.post('/ucet/student/skola', { email: 'novakova@vse.cz' });
    const link = /https:\/\/cv\.test(\/ucet\/student\/overit\/[A-Za-z0-9_-]+)/.exec(h.mail.last('student')!.text)![1]!;
    await b.post(link);
    await b.post('/ucet/tarif', { tier: 'profi' });
    const pay = await b.post('/ucet/zverejnit');
    expect(await (await b.get(pay.headers.get('location')!)).text()).toContain('1 490 Kč');
  });

  it('lets the studio check an ISIC number', async () => {
    expect((await b.post('/ucet/student/isic', { isic: '123' })).status).toBe(400);
    expect((await b.post('/ucet/student/isic', { isic: 'S 420 123 456 789 A' })).headers.get('location')).toBe('/ucet/student?ok=isic');
    const studio = new Browser(h);
    await studio.signIn('studio@pulzar.test');
    const list = await (await studio.get('/admin/studenti')).text();
    expect(list).toContain('S420123456789A');
    const id = /action="\/admin\/studenti\/([^"]+)"/.exec(list)![1]!;
    await studio.post(`/admin/studenti/${id}`, { decision: 'approve' });
    expect(h.mail.last('student_ok')!.to).toBe('student@gmail.com');
    const pay = await b.post('/ucet/zverejnit');
    expect(await (await b.get(pay.headers.get('location')!)).text()).toContain('390 Kč');
    const log = await auditFor(h.deps.db, null);
    expect(log.some((l) => l.action === 'student.verified' && l.actor_email === 'studio@pulzar.test')).toBe(true);
  });
});

describe('CV-11 Na míru', () => {
  it('runs pay → session → studio fills in (logged) → holder approves; the studio cannot publish', async () => {
    const h = harness();
    const client = new Browser(h);
    await client.signIn('klient@example.cz');
    await fillCv(client, { tier: 'na_miru', lang: 'cs,en' });
    const done = await payAndPublish(client);
    expect(done).toContain('v=na_miru');
    expect(h.mail.last('nm_booking')!.to).toBe('klient@example.cz');
    expect(h.mail.last('nm_studio')!.to).toBe('studio@pulzar.test');
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    expect(row.nm_state).toBe('awaiting_session');
    expect(row.published).toBeNull(); // nothing goes live without the holder

    const studio = new Browser(h);
    await studio.signIn('studio@pulzar.test');
    expect(await (await studio.get('/admin')).text()).toContain('Domluvit sezení');
    await studio.post(`/admin/cv/${row.id}/namiru/sezeni`, { at: '2026-11-26T10:00', notes: 'Video, 60 min' });
    expect((await studio.post(`/admin/cv/${row.id}/upravit/o-mne`, { 'about.cs': 'Text napsaný se studiem.', 'about.en': 'Written with the studio.' })).status).toBe(303);
    await studio.post(`/admin/cv/${row.id}/namiru/schvaleni`);
    expect(h.mail.last('nm_ready')!.subject).toBe('Váš životopis je připravený ke schválení');

    // PL-11: every studio action is in the log.
    const log = (await auditFor(h.deps.db, row.id)).map((l) => `${l.actor_email}:${l.action}`);
    expect(log).toEqual(expect.arrayContaining(['studio@pulzar.test:namiru.session', 'studio@pulzar.test:draft.save', 'studio@pulzar.test:namiru.sent_for_approval']));

    // CV-11 AC: the studio cannot publish – no route, and the service refuses an admin actor.
    expect((await studio.post(`/admin/cv/${row.id}/zverejnit`)).status).toBe(404);
    expect((await studio.post('/ucet/zverejnit')).headers.get('location')).toBe('/ucet/novy');
    const fresh = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    const viaService = await publish(h.deps, fresh, { id: 'studio', email: 'studio@pulzar.test', role: 'admin' });
    expect(viaService).toEqual({ ok: false, reason: 'not_owner' });
    expect((await new Browser(h).get('/jana-novakova')).status).toBe(404);

    // The holder sees the banner and publishes.
    expect(await (await client.get('/ucet')).text()).toContain('Studio připravilo váš životopis');
    expect((await client.post('/ucet/zverejnit')).headers.get('location')).toBe('/ucet?ok=zverejneno');
    const live = await (await new Browser(h).get('/jana-novakova')).text();
    expect(live).toContain('Text napsaný se studiem.');
    expect((await getCvBySlug(h.deps.db, 'jana-novakova'))!.nm_state).toBe('approved');
  });

  it('keeps non-admins out of the admin', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    expect((await b.get('/admin')).status).toBe(403);
    expect((await b.get('/admin/cv')).status).toBe(403);
    expect((await new Browser(h).get('/admin')).status).toBe(303);
  });
});

describe('CV-5 visibility, CV-14 PIN, CV-16 schema.org', () => {
  let h: Harness;
  let b: Browser;
  beforeEach(async () => {
    h = harness();
    b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    await payAndPublish(b);
  });

  it('is link-only by default and not in the sitemap; public opts in', async () => {
    const v = new Browser(h);
    expect(await (await v.get('/sitemap.xml')).text()).not.toContain('jana-novakova');
    expect(await (await v.get('/jana-novakova')).text()).not.toContain('application/ld+json');
    await b.post('/ucet/nastaveni/viditelnost', { visibility: 'public' });
    const page = await v.get('/jana-novakova');
    expect(page.headers.get('x-robots-tag')).toBeNull();
    expect(await page.text()).toContain('"@type":"ProfilePage"');
    expect(await (await v.get('/sitemap.xml')).text()).toContain('<loc>https://cv.test/jana-novakova</loc>');
    const robots = await (await v.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /ucet/');
    expect(robots).not.toMatch(/Disallow: \/\n/);
  });

  it('asks for a PIN, rate-limits guesses, and remembers a correct PIN', async () => {
    expect((await b.post('/ucet/nastaveni/viditelnost', { visibility: 'pin' })).status).toBe(400); // needs a PIN
    await b.post('/ucet/nastaveni/viditelnost', { visibility: 'pin', pin: '4821' });
    const v = new Browser(h);
    const gate = await v.get('/jana-novakova');
    expect(gate.status).toBe(401);
    const gateHtml = await gate.text();
    expect(gateHtml).toContain('chráněný PINem');
    expect(gateHtml).not.toContain('UX designérka');
    expect((await v.post('/jana-novakova/kontakt', { token: 'good-token' })).status).toBe(404);
    expect((await v.post('/jana-novakova/pin', { pin: '0000' })).status).toBe(401);
    const ok = await v.post('/jana-novakova/pin', { pin: '4821' });
    expect(ok.status).toBe(303);
    expect(await (await v.get('/jana-novakova')).text()).toContain('UX designérka');
    // Brute force: five tries per visitor per 15 minutes.
    const attacker = new Browser(h);
    for (let i = 0; i < 5; i++) await attacker.post('/jana-novakova/pin', { pin: String(1000 + i) });
    expect((await attacker.post('/jana-novakova/pin', { pin: '4821' })).status).toBe(429);
  });
});

describe('CV-10 own domain', () => {
  it('serves the CV at the root of an activated domain, with the canonical there', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b, { tier: 'profi', lang: 'cs,en' });
    await payAndPublish(b);
    expect((await b.post('/ucet/nastaveni/domena', { hostname: 'https://JanaNovakova.cz/', mode: 'studio_registers' })).headers.get('location')).toBe('/ucet/nastaveni?ok=domena');
    expect(h.mail.last('domain_request')!.text).toContain('jananovakova.cz');
    const visitor = new Browser(h, 'https://jananovakova.cz');
    expect((await visitor.get('/')).status).toBe(404); // not active yet
    const studio = new Browser(h);
    await studio.signIn('studio@pulzar.test');
    await studio.post('/admin/domeny/jananovakova.cz', { status: 'active' });
    const page = await visitor.get('/');
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('<link rel="canonical" href="https://jananovakova.cz/"/>');
    expect(html).toContain('data-cv=""');
    expect((await visitor.get('/en')).status).toBe(200);
    const reveal = await visitor.post('/kontakt', { token: 'good-token' });
    expect(((await reveal.json()) as { email: string }).email).toBe('jana@example.cz');
    // The account and admin are not reachable on an own domain.
    expect((await visitor.get('/ucet')).status).toBe(404);
    expect((await visitor.get('/admin')).status).toBe(404);
    // The cv. address keeps working, pointing to the own domain as canonical.
    expect(await (await new Browser(h).get('/jana-novakova')).text()).toContain('href="https://jananovakova.cz/"');
  });

  it('is not offered in Základ', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    expect((await b.post('/ucet/nastaveni/domena', { hostname: 'jana.cz', mode: 'studio_registers' })).status).toBe(400);
  });
});

describe('payments webhook', () => {
  it('completes a Stripe payment only with a valid signature, once', async () => {
    const { StripePayments, hmacHex } = await import('../src/platform/payments');
    const h = harness();
    const stripe = new StripePayments('sk_test', 'whsec_test', () => h.clock.now);
    const { createApp } = await import('../src/app/app');
    const app = createApp({ now: () => h.clock.now, mailer: h.mail, payments: stripe, turnstile: { verify: async () => true } });
    const b = new Browser({ ...h, app });
    await b.signIn('jana@example.cz');
    await fillCv(b);
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    await h.deps.db.prepare(`INSERT INTO payments (id, account_id, cv_id, kind, tier, student, amount_czk, provider, status, created_at) VALUES ('pay1', ?, ?, 'initial', 'zaklad', 0, 690, 'stripe', 'pending', ?)`).bind(row.account_id, row.id, h.clock.now).run();
    const event = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { payment_id: 'pay1' } } } });
    const t = Math.floor(h.clock.now / 1000);
    const send = async (sig: string) => app.fetch(new Request('https://cv.test/webhooks/platby', { method: 'POST', body: event, headers: { 'stripe-signature': sig } }), h.env);
    expect((await send(`t=${t},v1=deadbeef`)).status).toBe(400);
    const good = `t=${t},v1=${await hmacHex('whsec_test', `${t}.${event}`)}`;
    expect((await send(good)).status).toBe(200);
    expect((await send(good)).status).toBe(200); // idempotent
    expect((await getCvBySlug(h.deps.db, 'jana-novakova'))!.status).toBe('live');
    expect(await h.deps.db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'payment.paid'`).first<{ n: number }>()).toEqual({ n: 1 });
    expect(snapshotOf((await getCvBySlug(h.deps.db, 'jana-novakova'))!)).not.toBeNull();
  });
});
