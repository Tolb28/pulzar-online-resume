import { beforeEach, describe, expect, it } from 'vitest';
import { DAY } from '../src/platform/db';
import { getCvBySlug } from '../src/services/cvs';
import { runDaily } from '../src/services/lifecycle';
import { computeMetrics } from '../src/services/metrics';
import { Browser, harness, T0, type Harness } from './helpers/env';
import { fillCv } from './helpers/flows';

async function publishedCv(h: Harness, email = 'jana@example.cz', slug = 'jana-novakova') {
  const b = new Browser(h);
  await b.signIn(email);
  await fillCv(b, { slug });
  const pay = await b.post('/ucet/zverejnit');
  await b.post(pay.headers.get('location')!);
  return b;
}

const tags = (h: Harness) => h.mail.sent.map((m) => m.tag);

describe('paid year, expiry and renewal (D3, CV-8)', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('reminds 30 and 7 days ahead, once each, then takes the CV offline', async () => {
    const b = await publishedCv(h);
    const until = (await getCvBySlug(h.deps.db, 'jana-novakova'))!.paid_until!;
    expect(new Date(until).toISOString().slice(0, 10)).toBe('2027-11-24');
    h.mail.sent = [];
    h.clock.now = until - 20 * DAY;
    await runDaily(h.deps);
    await runDaily(h.deps);
    expect(tags(h).filter((t) => t === 'expiring_30')).toHaveLength(1);
    h.clock.now = until - 3 * DAY;
    await runDaily(h.deps);
    expect(tags(h).filter((t) => t === 'expiring_7')).toHaveLength(1);
    expect((await new Browser(h).get('/jana-novakova')).status).toBe(200);
    h.clock.now = until + 1;
    // Offline at once, even before the daily job runs.
    const off = await new Browser(h).get('/jana-novakova');
    expect(off.status).toBe(404);
    expect(await off.text()).toContain('Tento životopis teď není zveřejněný.');
    await runDaily(h.deps);
    expect(tags(h)).toContain('expired');
    // Renewal brings it back on the same link for another year (sessions last 30 days: sign in again).
    await b.signIn('jana@example.cz');
    const ren = await b.post('/ucet/prodlouzit');
    await b.post(ren.headers.get('location')!);
    expect((await new Browser(h).get('/jana-novakova')).status).toBe(200);
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    expect(row.paid_until).toBeGreaterThan(h.clock.now + 364 * DAY);
  });

  it('reactivates a paused CV for free within the paid period, and for the renewal price after it', async () => {
    const b = await publishedCv(h);
    await b.post('/ucet/pozastavit');
    h.clock.now += 100 * DAY;
    // Sessions last 30 days, so a returning holder signs in again.
    expect((await b.post('/ucet/obnovit')).headers.get('location')).toMatch(/^\/prihlaseni/);
    await b.signIn('jana@example.cz');
    expect((await b.post('/ucet/obnovit')).headers.get('location')).toBe('/ucet?ok=obnoveno');
    await b.post('/ucet/pozastavit');
    h.clock.now = T0 + 400 * DAY;
    await b.signIn('jana@example.cz');
    const r = await b.post('/ucet/obnovit');
    expect(r.headers.get('location')).toMatch(/^\/ucet\/platba\/test\//);
    expect(await (await b.get(r.headers.get('location')!)).text()).toContain('390 Kč');
  });
});

describe('retention: "Chcete životopis dál uchovat?" (CV-8)', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it('asks a year after the CV went offline, warns, then deletes after 30 days without an answer', async () => {
    const b = await publishedCv(h);
    await b.post('/ucet/pozastavit');
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    const offline = Math.max(row.paid_until!, row.offline_since!);
    h.clock.now = offline + 300 * DAY;
    await runDaily(h.deps);
    expect(tags(h)).not.toContain('keep_prompt');
    h.clock.now = offline + 366 * DAY;
    await runDaily(h.deps);
    const prompt = h.mail.last('keep_prompt')!;
    expect(prompt.subject).toBe('Chcete životopis dál uchovat?');
    h.clock.now += 23 * DAY;
    await runDaily(h.deps);
    expect(tags(h)).toContain('keep_warning');
    h.clock.now += 7 * DAY;
    await runDaily(h.deps);
    expect(tags(h)).toContain('deleted');
    expect(await getCvBySlug(h.deps.db, 'jana-novakova')).toBeNull();
    expect([...h.r2.objects.keys()].filter((k) => k.startsWith(`cv/${row.id}/`))).toEqual([]);
    const log = await h.deps.db.prepare(`SELECT details FROM audit_log WHERE action = 'cv.delete'`).first<{ details: string }>();
    expect(log!.details).toContain('retention');
  });

  it('keeps the CV when the holder clicks "Ano, uchovat" (no sign-in needed)', async () => {
    const b = await publishedCv(h);
    await b.post('/ucet/pozastavit');
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    h.clock.now = Math.max(row.paid_until!, row.offline_since!) + 366 * DAY;
    await runDaily(h.deps);
    const link = /https:\/\/cv\.test(\/uchovat\/[A-Za-z0-9_-]+)/.exec(h.mail.last('keep_prompt')!.text)![1]!;
    const stranger = new Browser(h);
    expect((await stranger.get(link)).status).toBe(200);
    expect((await stranger.post(link)).status).toBe(200);
    h.clock.now += 40 * DAY;
    await runDaily(h.deps);
    expect(await getCvBySlug(h.deps.db, 'jana-novakova')).not.toBeNull();
    expect(tags(h)).not.toContain('deleted');
  });

  it('counts signing in as an answer', async () => {
    const b = await publishedCv(h);
    await b.post('/ucet/pozastavit');
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    h.clock.now = Math.max(row.paid_until!, row.offline_since!) + 366 * DAY;
    await runDaily(h.deps);
    h.clock.now += 5 * DAY;
    await new Browser(h).signIn('jana@example.cz');
    h.clock.now += 1;
    await runDaily(h.deps);
    h.clock.now += 40 * DAY;
    await runDaily(h.deps);
    expect(await getCvBySlug(h.deps.db, 'jana-novakova')).not.toBeNull();
  });

  it('never asks while the CV is online and paid', async () => {
    await publishedCv(h);
    h.clock.now += 360 * DAY;
    await runDaily(h.deps);
    expect(tags(h)).not.toContain('keep_prompt');
  });
});

describe('§8 privacy scan and metrics', () => {
  it('finds no contact details in any public page, and alerts the studio when it does', async () => {
    const h = harness();
    await publishedCv(h);
    await publishedCv(h, 'petr@example.cz', 'petr-svoboda');
    const r1 = await runDaily(h.deps);
    expect(r1.scanned).toBe(2);
    expect(r1.findings).toBe(0);
    // Simulate a leak that got past validation (e.g. an e-mail inside a link).
    const row = (await getCvBySlug(h.deps.db, 'petr-svoboda'))!;
    const snap = JSON.parse(row.published!);
    snap.doc.profile.headline.cs = 'Pište na petr@example.cz';
    await h.deps.db.prepare('UPDATE cvs SET published = ? WHERE id = ?').bind(JSON.stringify(snap), row.id).run();
    const r2 = await runDaily(h.deps);
    expect(r2.findings).toBe(1);
    expect(h.mail.last('privacy_alert')!.to).toBe('studio@pulzar.test');
    const studio = new Browser(h);
    await studio.signIn('studio@pulzar.test');
    expect(await (await studio.get('/admin/soukromi')).text()).toContain(row.id);
  });

  it('computes the leading and lagging indicators', async () => {
    const h = harness();
    await publishedCv(h);
    h.clock.now += 31 * DAY;
    await new Browser(h).get('/jana-novakova'); // read after 31 days does not count as "within 30"
    const m = await computeMetrics(h.deps.db, h.clock.now);
    expect(m.paidLast6m).toBe(1);
    expect(m.studentShare).toBe(0);
    expect(m.publishedWithin7d).toBe(1);
    expect(m.medianMinutesToPublish).toBeLessThan(1);
    expect(m.readWithin30d).toBe(0);
    const studio = new Browser(h);
    await studio.signIn('studio@pulzar.test');
    const dash = await (await studio.get('/admin')).text();
    expect(dash).toContain('Ukazatele (§8)');
    expect(dash).toContain('100 %');
  });
});
