// End-to-end smoke test against a running `npm run dev` (workerd, local D1/R2), in Chromium.
//   node scripts/e2e-smoke.mjs [baseUrl] [wranglerLogFile] [outDir]
// Needs Playwright (`npm i -D playwright && npx playwright install chromium`). The magic link
// is read from the dev server's log (MAIL_PROVIDER=console prints e-mails).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.argv[2] ?? 'http://localhost:8787';
const LOG = process.argv[3] ?? '.wrangler/dev.log';
const OUT = process.argv[4] ?? 'test-results/e2e';
mkdirSync(OUT, { recursive: true });
const unique = Date.now().toString(36);
const email = `jana.${unique}@example.cz`;
const slug = `jana-${unique}`;

const step = (s) => console.log(`• ${s}`);
const fail = (s) => {
  console.error(`✗ ${s}`);
  process.exit(1);
};

async function magicLink(to) {
  for (let i = 0; i < 40; i++) {
    const log = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '';
    const block = log.split('[mail]').reverse().find((b) => b.includes(`to=${to}`) && b.includes('tag=login'));
    const m = block && /(https?:\/\/\S+\/auth\/[A-Za-z0-9_-]+)/.exec(block);
    if (m) return m[1].replace(/^https?:\/\/[^/]+/, BASE);
    await new Promise((r) => setTimeout(r, 250));
  }
  fail(`no login e-mail for ${to} in ${LOG}`);
}

async function signIn(page, who) {
  await page.goto(`${BASE}/prihlaseni`);
  await page.fill('#email', who);
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Zkontrolujte e-mail');
  await page.goto(await magicLink(who));
  await page.click('button:has-text("Přihlásit se")');
  await page.waitForLoadState('networkidle');
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`page error: ${e.message}`));

  step('sign in by magic link');
  await signIn(page, email);
  if (!page.url().includes('/ucet/novy')) fail(`expected /ucet/novy, got ${page.url()}`);

  step('create a Profi CV in Czech and English');
  await page.fill('#name', 'Jana Nováková');
  await page.fill('#slug', slug);
  await page.check('input[name=tier][value=profi]');
  await page.check('input[name=lang][value="cs,en"]');
  await page.click('button:has-text("Založit životopis")');
  await page.waitForURL('**/ucet/upravit/hlavicka');

  step('fill the header and upload a photo (resized in the browser)');
  await page.fill('input[name="headline.cs"]', 'Produktová designérka');
  await page.fill('input[name="headline.en"]', 'Product designer');
  await page.fill('input[name="location.cs"]', 'Praha');
  await page.fill('input[name="links.linkedin.url"]', 'linkedin.com/in/jana-novakova');
  await page.click('.save-bar button[type=submit]');
  await page.waitForSelector('text=Uloženo.');
  await page.setInputFiles('input[type=file][form=up-photo]', join(process.cwd(), 'test/fixtures/photo.jpg'));
  await page.click('button[form=up-photo]');
  await page.waitForSelector('img.thumb');

  step('contact, about, one experience');
  await page.goto(`${BASE}/ucet/upravit/kontakt`);
  await page.fill('input[name=email]', 'jana@example.cz');
  await page.fill('input[name=phone]', '+420 777 123 456');
  await page.click('.save-bar button[type=submit]');
  await page.goto(`${BASE}/ucet/upravit/o-mne`);
  await page.fill('textarea[name="about.cs"]', 'Navrhuji přehledná rozhraní a ověřuji je s lidmi.');
  await page.fill('textarea[name="about.en"]', 'I design clear interfaces and test them with people.');
  // Live counter (CV-1)
  const counter = await page.textContent('.field:has(textarea[name="about.cs"]) [data-count]');
  if (!counter.includes('/ 600')) fail(`counter: ${counter}`);
  await page.click('.save-bar button[type=submit]');
  await page.goto(`${BASE}/ucet/upravit/zkusenosti`);
  await page.click('button[value=add]');
  await page.fill('input[name="experience.0.role.cs"]', 'UX designérka');
  await page.fill('input[name="experience.0.role.en"]', 'UX designer');
  await page.fill('input[name="experience.0.employer"]', 'Alza.cz');
  await page.fill('input[name="experience.0.from"]', '2019-03');
  await page.check('input[name="experience.0.present"]');
  await page.fill('input[name="experience.0.bullets.0.cs"]', 'Navrhla jsem nový filtr produktů.');
  await page.fill('input[name="experience.0.bullets.0.en"]', 'I designed the new product filter.');
  await page.click('.save-bar button[type=submit]');
  await page.waitForSelector('text=Uloženo.');
  await page.screenshot({ path: join(OUT, 'editor.png'), fullPage: true });

  step('pay (dev provider) and publish');
  await page.goto(`${BASE}/ucet/zverejnit`);
  await page.click('form[action="/ucet/zverejnit"] button[type=submit]');
  await page.click('button:has-text("Zaplatit (test)")');
  await page.waitForSelector('text=Životopis je zveřejněný.');

  step('a recruiter opens the CV on a phone, reveals the contact and downloads the PDF');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
  const r = await phone.newPage();
  r.on('pageerror', (e) => fail(`public page error: ${e.message}`));
  const res = await r.goto(`${BASE}/${slug}`);
  if (res.status() !== 200) fail(`public page ${res.status()}`);
  const htmlSource = await res.text();
  if (htmlSource.includes('jana@example.cz') || htmlSource.includes('777 123 456')) fail('contact details in the HTML source');
  await r.screenshot({ path: join(OUT, 'public-mobile.png') });
  await r.click('button[data-act=contact]');
  await r.waitForSelector('#cv-contact a[href^="mailto:"]');
  const shown = await r.textContent('#cv-contact');
  if (!shown.includes('jana@example.cz') || !shown.includes('+420 777 123 456')) fail(`contact: ${shown}`);
  await r.screenshot({ path: join(OUT, 'public-contact.png') });
  const [download] = await Promise.all([r.waitForEvent('download'), r.click('button[data-act=pdf]')]);
  if (download.suggestedFilename() !== 'Jana-Novakova-CV.pdf') fail(`pdf name ${download.suggestedFilename()}`);
  const pdfPath = join(OUT, download.suggestedFilename());
  await download.saveAs(pdfPath);
  const text = execFileSync('pdftotext', ['-enc', 'UTF-8', pdfPath, '-'], { encoding: 'utf8' });
  if (!text.includes('Jana Nováková') || !text.includes('UX designérka')) fail('pdf text');
  step('English version');
  await r.goto(`${BASE}/${slug}/en`);
  await r.waitForSelector('text=Show contact');

  step('pause takes it offline at once');
  await page.goto(`${BASE}/ucet`);
  page.once('dialog', (d) => d.accept());
  await page.click('button:has-text("Pozastavit")');
  const off = await r.goto(`${BASE}/${slug}`);
  if (off.status() !== 404) fail(`paused page status ${off.status()}`);

  const desk = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${BASE}/ucet`);
  await page.click('button:has-text("Znovu zveřejnit")');
  await desk.goto(`${BASE}/${slug}`);
  await desk.screenshot({ path: join(OUT, 'public-desktop.png'), fullPage: true });
  console.log(`✓ smoke test passed – screenshots and PDF in ${OUT}`);
} finally {
  await browser.close();
}
