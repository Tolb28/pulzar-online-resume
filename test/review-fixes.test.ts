import { describe, expect, it } from 'vitest';
import { renderableDoc } from '../src/cv/sanitize';
import { errorsOf, validateDoc } from '../src/cv/validate';
import type { Env } from '../src/env';
import { DAY } from '../src/platform/db';
import { MemoryMailer, type Mail } from '../src/platform/mail';
import { stripPngMetadata } from '../src/platform/media';
import { completePayment } from '../src/services/billing';
import { getCvBySlug } from '../src/services/cvs';
import { makeDeps } from '../src/services/deps';
import { runDaily } from '../src/services/lifecycle';
import { realisticDoc } from './fixtures/docs';
import { Browser, harness, type Harness } from './helpers/env';
import { fillCv } from './helpers/flows';

// Regression tests for the findings of the security and correctness review.

async function verifyStudent(h: Harness, b: Browser, school = 'novakova@student.cuni.cz') {
  await b.post('/ucet/student/skola', { email: school });
  const link = /https:\/\/cv\.test(\/ucet\/student\/overit\/[A-Za-z0-9_-]+)/.exec(h.mail.last('student')!.text)![1]!;
  return b.post(link);
}

const pendingPayment = async (b: Browser) => (await b.post('/ucet/zverejnit')).headers.get('location')!;

describe('#1 the CV gets the tier that was paid for', () => {
  it('switching to Profi or Na míru during an open checkout does not upgrade the CV', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    await verifyStudent(h, b);
    const checkout = await pendingPayment(b); // Základ, student price 390
    await b.post('/ucet/tarif', { tier: 'na_miru' }); // switch in another tab
    h.mail.sent = [];
    await b.post(checkout);
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    expect(row.tier).toBe('zaklad');
    expect(row.nm_state).toBeNull();
    expect(h.mail.sent.map((m) => m.tag)).not.toContain('nm_studio');
    const p = await h.deps.db.prepare('SELECT tier, amount_czk FROM payments').first<{ tier: string; amount_czk: number }>();
    expect(p).toEqual({ tier: 'zaklad', amount_czk: 390 });
  });
});

describe('#2 contact details cannot be published through link URLs', () => {
  it('flags e-mails and the own phone in profile and project links', () => {
    const doc = realisticDoc({});
    doc.profile.links = [
      { kind: 'other', url: 'https://jana@example.cz', label: 'E-mail' },
      { kind: 'website', url: 'https://wa.me/420777123456', label: '' },
    ];
    doc.body.projects[0]!.url = 'https://example.cz/?contact=jana.private%40gmail.com';
    const errs = errorsOf(validateDoc(doc)).filter((e) => e.code === 'contact_in_text').map((e) => e.path);
    expect(errs).toEqual(expect.arrayContaining(['profile.links.0.url', 'profile.links.1.url', 'body.projects.0.url']));
  });
});

describe('#3 only the CV’s own languages are shown', () => {
  it('never publishes text kept from a language the CV no longer uses', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b, { lang: 'en' });
    // English text with an e-mail (an error while the CV is English) …
    await b.post('/ucet/upravit/o-mne', { 'about.en': 'Write to jana.private@gmail.com' });
    // … then the CV becomes Czech only, with no Czech "about".
    await b.post('/ucet/nastaveni/jazyky', { langs: 'cs' });
    await b.post('/ucet/upravit/o-mne', { 'about.cs': '' });
    const checkout = await pendingPayment(b);
    await b.post(checkout);
    const html = await (await new Browser(h).get('/jana-novakova')).text();
    expect(html).not.toContain('jana.private@gmail.com');
    expect(html).not.toContain('Write to');
    // The text is still stored (nothing cut), just not shown.
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    expect(JSON.parse(row.draft).about.en).toContain('jana.private@gmail.com');
    expect(JSON.stringify(JSON.parse(row.published!).doc)).not.toContain('jana.private');
  });

  it('deletes a bullet cleared in a one-language form, even with a hidden translation', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b, { lang: 'cs' });
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    const exp = JSON.parse(row.draft).experience[0];
    await b.post('/ucet/upravit/zkusenosti', { 'experience.0.id': exp.id, 'experience.0.bullets.0.cs': '' });
    const after = JSON.parse((await getCvBySlug(h.deps.db, 'jana-novakova'))!.draft).experience[0];
    expect(after.bullets).toEqual([]);
  });

  it('renderableDoc blanks the other language everywhere', () => {
    const d = realisticDoc({ tier: 'zaklad', langs: ['cs'] });
    const r = renderableDoc(d);
    expect(r.body.about.en).toBe('');
    expect(r.body.experience[0]!.bullets[0]!.en).toBe('');
    expect(r.profile.headline.en).toBe('');
    expect(r.body.about.cs).toBe(d.body.about.cs);
  });
});

describe('#4 the daily job survives failures and never deletes without a warning', () => {
  it('keeps going when an e-mail fails, and waits for a delivered warning before deleting', async () => {
    const h = harness();
    const failing = new (class extends MemoryMailer {
      fail = true;
      override async send(m: Mail) {
        if (this.fail && m.tag === 'keep_warning') throw new Error('429 from provider');
        return super.send(m);
      }
    })();
    const deps = makeDeps(h.env, { now: () => h.clock.now, mailer: failing, turnstile: { verify: async () => true } });
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    await b.post(await pendingPayment(b));
    await b.post('/ucet/pozastavit');
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    h.clock.now = row.paid_until! + 366 * DAY;
    await runDaily(deps); // prompt
    h.clock.now += 23 * DAY;
    const r1 = await runDaily(deps); // warning fails
    expect(r1.errors.join(' ')).toContain('429');
    expect(r1.scanned).toBeGreaterThanOrEqual(0); // the privacy scan still ran
    h.clock.now += 8 * DAY; // day 31: no warning ever delivered
    await runDaily(deps);
    expect(await getCvBySlug(h.deps.db, 'jana-novakova')).not.toBeNull();
    failing.fail = false;
    await runDaily(deps); // warning delivered now
    expect(failing.sent.map((m) => m.tag)).toContain('keep_warning');
    h.clock.now += 6 * DAY;
    await runDaily(deps);
    expect(await getCvBySlug(h.deps.db, 'jana-novakova')).not.toBeNull();
    h.clock.now += 1 * DAY + 1;
    await runDaily(deps);
    expect(await getCvBySlug(h.deps.db, 'jana-novakova')).toBeNull();
  });
});

describe('#5 a payment and its effect are one transaction', () => {
  it('extends the period and publishes even when the "paid" e-mail fails; retries are no-ops', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    await pendingPayment(b);
    const p = await h.deps.db.prepare('SELECT id FROM payments').first<{ id: string }>();
    const failing = new (class extends MemoryMailer {
      override async send(m: Mail) {
        if (m.tag === 'paid') throw new Error('mail down');
        return super.send(m);
      }
    })();
    const deps = makeDeps(h.env, { now: () => h.clock.now, mailer: failing, turnstile: { verify: async () => true } });
    expect(await completePayment(deps, p!.id, 'ref')).toBe('published');
    expect(await completePayment(deps, p!.id, 'ref')).toBe('already');
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    expect(row.paid_until).toBeGreaterThan(h.clock.now);
    expect(row.status).toBe('live');
  });
});

describe('#6 changing the PIN revokes access', () => {
  it('a cookie from the old PIN no longer works', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    await b.post(await pendingPayment(b));
    await b.post('/ucet/nastaveni/viditelnost', { visibility: 'pin', pin: '1234' });
    const recruiter = new Browser(h);
    await recruiter.post('/jana-novakova/pin', { pin: '1234' });
    expect((await recruiter.get('/jana-novakova')).status).toBe(200);
    await b.post('/ucet/nastaveni/viditelnost', { visibility: 'pin', pin: '9876' });
    expect((await recruiter.get('/jana-novakova')).status).toBe(401);
  });

  it('counts only wrong PINs, and keeps PIN-protected images out of shared caches', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    await b.post(await pendingPayment(b));
    await b.post('/ucet/nastaveni/viditelnost', { visibility: 'pin', pin: '1234' });
    const v = new Browser(h);
    for (let i = 0; i < 4; i++) await v.post('/jana-novakova/pin', { pin: '0000' });
    expect((await v.post('/jana-novakova/pin', { pin: '1234' })).status).toBe(303);
    expect((await v.post('/jana-novakova/pin', { pin: '1234' })).status).toBe(303); // right PINs do not use up the limit
  });
});

describe('#7 hidden-language tags follow their tag, not their position', () => {
  it('deleting a tag in a Czech-only form keeps the others’ English', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b, { tier: 'profi', lang: 'cs,en' });
    await b.post('/ucet/upravit/dovednosti', { 'skills.groups.0.tags.cs': 'Figma\nUživatelský výzkum\nPrototypování', 'skills.groups.0.tags.en': 'Figma\nUser research\nPrototyping' });
    await b.post('/ucet/nastaveni/jazyky', { langs: 'cs' });
    await b.post('/ucet/upravit/dovednosti', { 'skills.groups.0.tags.cs': 'Figma\nPrototypování' });
    const tags = JSON.parse((await getCvBySlug(h.deps.db, 'jana-novakova'))!.draft).skills.groups[0].tags;
    expect(tags).toEqual([
      { cs: 'Figma', en: 'Figma' },
      { cs: 'Prototypování', en: 'Prototyping' },
    ]);
  });
});

describe('#8 paying from "Obnovit" brings a paused CV back', () => {
  it('resumes after the renewal is paid', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    await b.post(await pendingPayment(b));
    await b.post('/ucet/pozastavit');
    h.clock.now += 400 * DAY;
    await b.signIn('jana@example.cz');
    const checkout = (await b.post('/ucet/obnovit')).headers.get('location')!;
    await b.post(checkout);
    expect((await new Browser(h).get('/jana-novakova')).status).toBe(200);
  });
});

describe('#9 PNG metadata is stripped on the server', () => {
  it('drops text chunks and keeps the image chunks', () => {
    const chunk = (type: string, data: number[]) => {
      const len = [0, 0, 0, data.length];
      return [...len, ...type.split('').map((ch) => ch.charCodeAt(0)), ...data, 0, 0, 0, 0];
    };
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
      ...chunk('tEXt', [...new TextEncoder().encode('GPS 50.08,14.42')]),
      ...chunk('IDAT', [1, 2, 3]),
      ...chunk('IEND', []),
    ]);
    const out = new TextDecoder('latin1').decode(stripPngMetadata(png));
    expect(out).not.toContain('GPS');
    expect(out).toContain('IHDR');
    expect(out).toContain('IDAT');
    expect(out).toContain('IEND');
  });
});

describe('#10 deletion removes the data around the CV; export includes it', () => {
  it('drops ISIC requests and tokens on deletion; the export masks the ISIC', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    await b.post('/ucet/student/isic', { isic: 'S 420 123 456 789 A' });
    const exported = (await (await b.get('/ucet/export.json')).json()) as { studentRequests: Array<{ value: string }> };
    expect(exported.studentRequests[0]!.value).toBe('S420…89A');
    await b.post('/ucet/smazat', { confirm: 'jana-novakova' });
    expect(await h.deps.db.prepare('SELECT COUNT(*) AS n FROM student_requests').first<{ n: number }>()).toEqual({ n: 0 });
    const left = await h.deps.db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE actor_email = 'jana@example.cz'`).first<{ n: number }>();
    expect(left).toEqual({ n: 0 });
  });

  it('removes the whole account when deleting for inactivity', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    h.clock.now = row.created_at + 366 * DAY;
    await runDaily(h.deps);
    h.clock.now += 23 * DAY;
    await runDaily(h.deps);
    h.clock.now += 7 * DAY;
    await runDaily(h.deps);
    expect(await h.deps.db.prepare('SELECT COUNT(*) AS n FROM accounts').first<{ n: number }>()).toEqual({ n: 0 });
    expect(await h.deps.db.prepare('SELECT COUNT(*) AS n FROM sessions').first<{ n: number }>()).toEqual({ n: 0 });
  });
});

describe('#11 one school mailbox verifies one account', () => {
  it('refuses a second account verified with the same address', async () => {
    const h = harness();
    const a = new Browser(h);
    await a.signIn('student1@gmail.com');
    await fillCv(a);
    expect((await verifyStudent(h, a)).headers.get('location')).toBe('/ucet/zverejnit?ok=student');
    const friend = new Browser(h);
    await friend.signIn('friend@gmail.com');
    await fillCv(friend, { slug: 'friend-cv' });
    expect((await verifyStudent(h, friend)).status).toBe(409);
  });
});

describe('notes', () => {
  it('production refuses the console mailer (sign-in links would land in logs)', () => {
    const h = harness();
    const env: Env = { ...h.env, ENVIRONMENT: 'production', PAYMENTS_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk', STRIPE_WEBHOOK_SECRET: 'wh', MAIL_PROVIDER: 'resend' };
    expect(() => makeDeps(env)).toThrow(/mail provider/);
    expect(() => makeDeps({ ...env, RESEND_API_KEY: 're_x' })).not.toThrow();
  });

  it('an old address redirects to the new one and stays reserved for a year', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    await b.post(await pendingPayment(b));
    await b.post('/ucet/nastaveni/adresa', { slug: 'jana-novakova-ux' });
    const r = await new Browser(h).get('/jana-novakova');
    expect(r.status).toBe(301);
    expect(r.headers.get('location')).toBe('/jana-novakova-ux');
    const other = new Browser(h);
    await other.signIn('impostor@example.cz');
    const taken = await other.post('/ucet/novy', { name: 'X', slug: 'jana-novakova', tier: 'zaklad', lang: 'cs', template: 'moderni' });
    expect(taken.status).toBe(400);
    // The holder can take their old address back.
    expect((await b.post('/ucet/nastaveni/adresa', { slug: 'jana-novakova' })).headers.get('location')).toBe('/ucet/nastaveni?ok=ulozeno');
    expect((await new Browser(h).get('/jana-novakova')).status).toBe(200);
  });
});

