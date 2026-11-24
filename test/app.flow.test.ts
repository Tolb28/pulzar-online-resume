import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCvByAccount, snapshotOf } from '../src/services/cvs';
import { Browser, harness, type Harness } from './helpers/env';
import { fillCv } from './helpers/flows';
import { textOf } from './fixtures/docs';

const PHOTO = readFileSync(join(__dirname, 'fixtures/photo.jpg'));

describe('holder journey: sign in → edit → pay → publish → read', () => {
  let h: Harness;
  let jana: Browser;
  beforeEach(async () => {
    h = harness();
    jana = new Browser(h);
    await jana.signIn('jana@example.cz');
  });

  it('signs in with a one-time magic link that e-mail scanners cannot use up', async () => {
    const other = new Browser(h);
    await other.post('/prihlaseni', { email: 'petr@example.cz' });
    const link = /https:\/\/cv\.test(\/auth\/[A-Za-z0-9_-]+)/.exec(h.mail.last('login')!.text)![1]!;
    expect((await other.get(link)).status).toBe(200); // a scanner GET does not log in
    expect((await other.get('/ucet')).status).toBe(303);
    expect((await other.post(link)).status).toBe(303);
    expect((await other.get('/ucet')).headers.get('location')).toBe('/ucet/novy');
    expect((await new Browser(h).post(link)).status).toBe(410); // used once
  });

  it('refuses cross-site form posts (CSRF)', async () => {
    const r = await jana.request('POST', '/ucet/novy', { form: { name: 'X' }, origin: 'https://evil.example' });
    expect(r.status).toBe(403);
  });

  it('keeps over-limit drafts, shows what is over, and cuts nothing (CV-1 AC)', async () => {
    await fillCv(jana);
    const long = textOf(645);
    await jana.post('/ucet/upravit/o-mne', { 'about.cs': long });
    const page = await (await jana.get('/ucet/upravit/o-mne')).text();
    expect(page).toContain('645 / 600');
    expect(page).toContain('Zkraťte o 45');
    const row = (await getCvByAccount(h.deps.db, (await h.deps.db.prepare('SELECT id FROM accounts WHERE email = ?').bind('jana@example.cz').first<{ id: string }>())!.id))!;
    expect(JSON.parse(row.draft).about.cs).toBe(long);
    // Publishing is blocked while something is over.
    const pub = await (await jana.get('/ucet/zverejnit')).text();
    expect(pub).toContain('Zkraťte o 45');
  });

  it('keeps the other language when a one-language form is saved', async () => {
    await fillCv(jana, { tier: 'zaklad', lang: 'cs' });
    // The CS-only form posts only .cs, the stored .en must survive.
    await jana.post('/ucet/upravit/o-mne', { 'about.cs': 'Nový text.' });
    const acc = await h.deps.db.prepare('SELECT id FROM accounts WHERE email = ?').bind('jana@example.cz').first<{ id: string }>();
    const row = (await getCvByAccount(h.deps.db, acc!.id))!;
    expect(JSON.parse(row.draft).about).toEqual({ cs: 'Nový text.', en: 'I design clear interfaces.' });
  });

  it('reorders, removes and adds entries through the editor', async () => {
    await fillCv(jana);
    await jana.post('/ucet/upravit/zkusenosti', { op: 'add' });
    const acc = await h.deps.db.prepare('SELECT id FROM accounts WHERE email = ?').bind('jana@example.cz').first<{ id: string }>();
    let row = (await getCvByAccount(h.deps.db, acc!.id))!;
    const ids = JSON.parse(row.draft).experience.map((e: { id: string }) => e.id);
    expect(ids).toHaveLength(2);
    await jana.post('/ucet/upravit/zkusenosti', { 'experience.0.id': ids[0], 'experience.1.id': ids[1], op: 'down:0' });
    row = (await getCvByAccount(h.deps.db, acc!.id))!;
    expect(JSON.parse(row.draft).experience.map((e: { id: string }) => e.id)).toEqual([ids[1], ids[0]]);
    await jana.post('/ucet/upravit/zkusenosti', { 'experience.0.id': ids[1], 'experience.1.id': ids[0], op: 'del:0' });
    row = (await getCvByAccount(h.deps.db, acc!.id))!;
    const exp = JSON.parse(row.draft).experience;
    expect(exp).toHaveLength(1);
    expect(exp[0].role.cs).toBe('UX designérka');
    expect(exp[0].to).toBeNull();
  });

  it('pays (dev provider), publishes automatically and serves the page without contact details', async () => {
    await fillCv(jana);
    const pay = await jana.post('/ucet/zverejnit');
    expect(pay.status).toBe(303);
    const checkout = pay.headers.get('location')!;
    expect(checkout).toMatch(/^\/ucet\/platba\/test\//);
    expect(await (await jana.get(checkout)).text()).toContain('690 Kč');
    const done = await jana.post(checkout);
    expect(done.headers.get('location')).toContain('v=published');
    expect(h.mail.last('paid')!.text).toContain('690');
    expect(h.mail.last('published')!.text).toContain('https://cv.test/jana-novakova');

    const recruiter = new Browser(h);
    const res = await recruiter.get('/jana-novakova');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Jana Nováková');
    expect(html).toContain('UX designérka');
    expect(html).not.toContain('jana@example.cz');
    expect(html.replace(/\s/g, '')).not.toContain('777123456');
    expect(res.headers.get('x-robots-tag')).toContain('noindex'); // CV-5 default
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('content-security-policy')).toContain('https://challenges.cloudflare.com');

    // CV-4: no proof → no contact.
    expect((await recruiter.post('/jana-novakova/kontakt', { token: 'bad' })).status).toBe(403);
    const ok = await recruiter.post('/jana-novakova/kontakt', { token: 'good-token', lang: 'cs' });
    expect(ok.status).toBe(200);
    const contact = (await ok.json()) as { email: string; phone: string; pass: string };
    expect(contact.email).toBe('jana@example.cz');
    expect(contact.phone).toBe('+420 777 123 456');
    // The pass serves the PDF without a second challenge.
    const pdfPass = await recruiter.post('/jana-novakova/pdf', { pass: contact.pass, lang: 'cs' });
    const { url } = (await pdfPass.json()) as { url: string };
    const pdf = await recruiter.get(url);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toBe('attachment; filename="Jana-Novakova-CV.pdf"');
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    expect(h.turnstileCalls).toEqual(['bad', 'good-token']);
    // A forged or expired pass does not work.
    expect((await recruiter.get('/jana-novakova/pdf?lang=cs&pass=x.1.y')).status).toBe(403);
    h.clock.now += 11 * 60_000;
    expect((await recruiter.get(url)).status).toBe(403);
  });

  it('counts views, PDF downloads and reveals – but not bots or the holder (CV-15)', async () => {
    await fillCv(jana, { tier: 'profi', lang: 'cs,en' });
    const pay = await jana.post('/ucet/zverejnit');
    await jana.post(pay.headers.get('location')!);
    const visitor = new Browser(h);
    await visitor.get('/jana-novakova');
    await visitor.get('/jana-novakova/en');
    await new Browser(h, 'https://cv.test', 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient)').get('/jana-novakova');
    await new Browser(h, 'https://cv.test', 'Mozilla/5.0 (iPhone) Mobile/15E148 [LinkedInApp]').get('/jana-novakova');
    await jana.get('/jana-novakova');
    await visitor.post('/jana-novakova/kontakt', { token: 'good-token' });
    const stats = await (await jana.get('/ucet/statistiky')).text();
    expect(stats).toMatch(/<strong>3<\/strong> zobrazení/);
    expect(stats).toMatch(/<strong>1<\/strong> zobrazení kontaktu/);
  });

  it('serves both languages for Profi, each with its own PDF (CV-9)', async () => {
    await fillCv(jana, { tier: 'profi', lang: 'cs,en' });
    const pay = await jana.post('/ucet/zverejnit');
    expect(await (await jana.get(pay.headers.get('location')!)).text()).toContain('1 490 Kč');
    await jana.post(pay.headers.get('location')!);
    const v = new Browser(h);
    const en = await (await v.get('/jana-novakova/en')).text();
    expect(en).toContain('UX designer');
    expect(en).toContain('Download PDF');
    expect((await v.get('/jana-novakova/cs')).status).toBe(301);
    const { pass } = (await (await v.post('/jana-novakova/kontakt', { token: 'good-token' })).json()) as { pass: string };
    const { url } = (await (await v.post('/jana-novakova/pdf', { pass, lang: 'en' })).json()) as { url: string };
    const pdf = await v.get(url);
    expect(pdf.headers.get('content-disposition')).toContain('Jana-Novakova-CV-EN.pdf');
  });

  it('pauses at once and comes back with the same link (CV-8)', async () => {
    await fillCv(jana);
    const pay = await jana.post('/ucet/zverejnit');
    await jana.post(pay.headers.get('location')!);
    await jana.post('/ucet/pozastavit');
    const v = new Browser(h);
    const paused = await v.get('/jana-novakova');
    expect(paused.status).toBe(404);
    expect(await paused.text()).toContain('Tento životopis teď není zveřejněný.');
    expect((await v.post('/jana-novakova/kontakt', { token: 'good-token' })).status).toBe(404);
    expect((await jana.post('/ucet/obnovit')).headers.get('location')).toBe('/ucet?ok=obnoveno');
    expect((await v.get('/jana-novakova')).status).toBe(200);
  });

  it('uploads a photo, strips EXIF, shows it to the holder only until published', async () => {
    await fillCv(jana);
    // A JPEG with an EXIF (APP1) segment inserted after SOI.
    const exif = new Uint8Array([0xff, 0xe1, 0x00, 0x10, ...new TextEncoder().encode('Exif\0\0GPS-DATA')]);
    const withExif = new Uint8Array([...PHOTO.subarray(0, 2), ...exif, ...PHOTO.subarray(2)]);
    const fd = new FormData();
    fd.append('kind', 'photo');
    fd.append('file', new File([withExif], 'me.jpg', { type: 'image/jpeg' }));
    const up = await jana.request('POST', '/ucet/media', { body: fd });
    expect(up.headers.get('location')).toBe('/ucet/upravit/hlavicka?ok=ulozeno');
    const [key, stored] = [...h.r2.objects.entries()].find(([k]) => k.includes('/photo-'))!;
    expect(new TextDecoder('latin1').decode(stored.bytes)).not.toContain('GPS-DATA');
    expect(stored.bytes.length).toBe(PHOTO.length);
    expect((await jana.get(`/media/${key}`)).status).toBe(200);
    expect((await new Browser(h).get(`/media/${key}`)).status).toBe(404);
    const pay = await jana.post('/ucet/zverejnit');
    await jana.post(pay.headers.get('location')!);
    expect((await new Browser(h).get(`/media/${key}`)).status).toBe(200);
    // A PNG is not accepted as the photo (the PDF needs a JPEG).
    const png = new FormData();
    png.append('kind', 'photo');
    png.append('file', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10, 8, 2])], 'x.png', { type: 'image/png' }));
    expect((await jana.request('POST', '/ucet/media', { body: png })).headers.get('location')).toBe('/ucet/upravit/hlavicka?chyba=photo-format');
  });

  it('exports all data and deletes the CV on request', async () => {
    await fillCv(jana);
    const exp = await jana.get('/ucet/export.json');
    expect(exp.headers.get('content-disposition')).toContain('pulzar-cv-data.json');
    const data = (await exp.json()) as { account: { email: string }; cv: { slug: string } };
    expect(data.account.email).toBe('jana@example.cz');
    expect(data.cv.slug).toBe('jana-novakova');
    expect((await jana.post('/ucet/smazat', { confirm: 'wrong' })).status).toBe(400);
    expect((await jana.post('/ucet/smazat', { confirm: 'jana-novakova' })).status).toBe(303);
    expect(await h.deps.db.prepare('SELECT COUNT(*) AS n FROM cvs').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('rejects taken and reserved addresses', async () => {
    const r1 = await jana.post('/ucet/novy', { name: 'Jana', slug: 'ucet', tier: 'zaklad', lang: 'cs', template: 'moderni' });
    expect(r1.status).toBe(400);
    await fillCv(jana);
    const petr = new Browser(h);
    await petr.signIn('petr@example.cz');
    const r2 = await petr.post('/ucet/novy', { name: 'Petr', slug: 'jana-novakova', tier: 'zaklad', lang: 'cs', template: 'moderni' });
    expect(r2.status).toBe(400);
    expect(await r2.text()).toContain('Tuto adresu už někdo má');
  });

  it('publishes a snapshot: later edits do not change the live page until republished (G2)', async () => {
    await fillCv(jana);
    const pay = await jana.post('/ucet/zverejnit');
    await jana.post(pay.headers.get('location')!);
    await jana.post('/ucet/upravit/o-mne', { 'about.cs': 'Úplně nový text.' });
    expect(await (await new Browser(h).get('/jana-novakova')).text()).not.toContain('Úplně nový text.');
    expect(await (await jana.get('/ucet')).text()).toContain('Zveřejnit změny');
    await jana.post('/ucet/zverejnit');
    expect(await (await new Browser(h).get('/jana-novakova')).text()).toContain('Úplně nový text.');
    const acc = await h.deps.db.prepare('SELECT id FROM accounts WHERE email = ?').bind('jana@example.cz').first<{ id: string }>();
    const row = (await getCvByAccount(h.deps.db, acc!.id))!;
    // Only the current PDFs are kept.
    expect([...h.r2.objects.keys()].filter((k) => k.includes('/pdf/'))).toEqual([snapshotOf(row)!.pdf.cs!.key]);
  });
});
