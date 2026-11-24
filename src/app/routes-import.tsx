import type { Hono } from 'hono';
import { coerceBody, coerceProfile } from '../cv/sanitize';
import { randomId } from '../cv/text';
import type { Lang } from '../cv/types';
import { one, run } from '../platform/db';
import { draftDoc, getCvByAccount, saveBody, saveProfile } from '../services/cvs';
import { parseLinkedInZip, toL10n, type ImportResult } from '../services/import-linkedin';
import { errorPage, holderActor, page, type AppEnv, type Ctx } from './core';
import { IssueList } from './views/fields';

// CV-13: upload → review → save into the draft. Over-limit entries are flagged, not dropped.

const SECTIONS: Array<[keyof ImportResult, string]> = [
  ['name', 'Jméno, titulek, město a odkazy'],
  ['about', 'O mně'],
  ['experience', 'Zkušenosti'],
  ['education', 'Vzdělání'],
  ['projects', 'Projekty'],
  ['skills', 'Dovednosti'],
  ['languages', 'Jazyky'],
  ['certifications', 'Certifikáty a kurzy'],
  ['email', 'Kontakt (jen pokud ho ještě nemáte)'],
];

function count(r: ImportResult, key: keyof ImportResult): number {
  const v = r[key];
  return Array.isArray(v) ? v.length : v ? 1 : 0;
}

function UploadView({ problem }: { problem?: string }) {
  return (
    <div class="narrow prose">
      <h1>Načíst z LinkedInu</h1>
      {problem && <p class="flash error">{problem}</p>}
      <ol>
        <li>
          V LinkedInu otevřete <strong>Nastavení → Ochrana osobních údajů → Získat kopii vašich dat</strong> (Get a copy of your data).
        </li>
        <li>Zvolte menší export (profil, pozice, vzdělání, dovednosti…). LinkedIn ho pošle e-mailem do pár minut jako ZIP.</li>
        <li>Nahrajte ZIP sem. Než se cokoli uloží, všechno uvidíte.</li>
      </ol>
      <form method="post" action="/ucet/import" enctype="multipart/form-data" class="stack">
        <input type="file" name="file" accept=".zip,application/zip" required aria-label="ZIP z LinkedInu" />
        <button class="btn" type="submit">
          Nahrát a zkontrolovat
        </button>
      </form>
      <p class="sub">Datum narození ani adresu z LinkedInu nenačítáme.</p>
    </div>
  );
}

function ReviewView({ id, r, langs }: { id: string; r: ImportResult; langs: Lang[] }) {
  return (
    <div class="narrow">
      <h1>Co jsme našli</h1>
      {r.notes.length > 0 && <IssueList issues={r.notes.map((message) => ({ path: '', section: 'settings', code: 'invalid', severity: 'warning', message }))} />}
      <form method="post" action={`/ucet/import/${id}`} class="stack">
        <fieldset class="choices">
          <legend>Co načíst (vybrané sekce nahradí obsah v konceptu)</legend>
          {SECTIONS.map(([key, label]) =>
            count(r, key) ? (
              <label class="check">
                <input type="checkbox" name="sections" value={key} checked={key !== 'email' || !!r.email} /> {label}
                {Array.isArray(r[key]) ? ` (${count(r, key)})` : ''}
              </label>
            ) : null,
          )}
        </fieldset>
        {langs.length > 1 && (
          <fieldset class="choices">
            <legend>V jakém jazyce je váš LinkedIn?</legend>
            {langs.map((l, i) => (
              <label class="check">
                <input type="radio" name="lang" value={l} checked={i === 0} /> {l === 'cs' ? 'Česky' : 'Anglicky'}
              </label>
            ))}
          </fieldset>
        )}
        <button class="btn" type="submit">
          Uložit do konceptu
        </button>
        <p class="sub">Nic se nezveřejní. Co je přes limit, uvidíte v editoru označené a zkrátíte to sami.</p>
      </form>
    </div>
  );
}

export function registerImport(app: Hono<AppEnv>): void {
  app.get('/ucet/import', (c) => page(c, 'Načíst z LinkedInu', <UploadView />));
  app.post('/ucet/import', async (c: Ctx) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const row = await getCvByAccount(deps.db, account.id);
    if (!row) return c.redirect('/ucet/novy', 303);
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File) || file.size === 0) return page(c, 'Načíst z LinkedInu', <UploadView problem="Vyberte prosím ZIP z LinkedInu." />, { status: 400 });
    if (file.size > 30 * 1024 * 1024) return page(c, 'Načíst z LinkedInu', <UploadView problem="Soubor je moc velký. Stačí menší export (bez zpráv a kontaktů)." />, { status: 400 });
    let result: ImportResult;
    try {
      result = parseLinkedInZip(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return page(c, 'Načíst z LinkedInu', <UploadView problem="Tohle nevypadá jako ZIP z LinkedInu." />, { status: 400 });
    }
    if (!result.files.length) return page(c, 'Načíst z LinkedInu', <UploadView problem="V ZIPu jsme nenašli data profilu (Profile.csv, Positions.csv…)." />, { status: 400 });
    const id = randomId();
    await run(deps.db, 'INSERT INTO imports (id, account_id, data, created_at) VALUES (?, ?, ?, ?)', id, account.id, JSON.stringify(result), deps.now());
    return c.redirect(`/ucet/import/${id}`, 303);
  });
  app.get('/ucet/import/:id', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const imp = await one<{ data: string }>(deps.db, 'SELECT data FROM imports WHERE id = ? AND account_id = ?', c.req.param('id'), account.id);
    const row = await getCvByAccount(deps.db, account.id);
    if (!imp || !row) return errorPage(c, 404, 'Import už vypršel. Nahrajte ZIP znovu.');
    const doc = await draftDoc(deps.db, row);
    return page(c, 'Načíst z LinkedInu', <ReviewView id={c.req.param('id')} r={JSON.parse(imp.data)} langs={doc.langs} />);
  });
  app.post('/ucet/import/:id', async (c) => {
    const deps = c.get('deps');
    const account = c.get('account')!;
    const imp = await one<{ data: string }>(deps.db, 'SELECT data FROM imports WHERE id = ? AND account_id = ?', c.req.param('id'), account.id);
    const row = await getCvByAccount(deps.db, account.id);
    if (!imp || !row) return errorPage(c, 404, 'Import už vypršel. Nahrajte ZIP znovu.');
    const r = JSON.parse(imp.data) as ImportResult;
    const form = await c.req.parseBody({ all: true });
    const picked = new Set(([] as unknown[]).concat(form.sections ?? []).map(String));
    const doc = await draftDoc(deps.db, row);
    const lang: Lang = form.lang === 'en' && doc.langs.includes('en') ? 'en' : form.lang === 'cs' && doc.langs.includes('cs') ? 'cs' : doc.langs[0]!;
    const t = (s: string) => toL10n(s, lang);
    const profile = { ...doc.profile };
    const body = { ...doc.body };
    if (picked.has('name')) {
      if (r.name) profile.name = r.name;
      if (r.headline) profile.headline = toL10n(r.headline, lang, profile.headline);
      if (r.location) profile.location = toL10n(r.location, lang, profile.location);
      for (const l of r.links) if (!profile.links.some((x) => x.kind === l.kind)) profile.links = [...profile.links, l];
    }
    if (picked.has('email')) {
      if (!profile.email && r.email) profile.email = r.email;
      if (!profile.phone && r.phone) profile.phone = r.phone;
    }
    if (picked.has('about') && r.about) body.about = toL10n(r.about, lang, body.about);
    if (picked.has('experience')) body.experience = r.experience.map((e) => ({ ...e, role: t(e.role), bullets: e.bullets.map(t) }));
    if (picked.has('education')) body.education = r.education.map((e) => ({ ...e, school: t(e.school), field: t(e.field), bullets: e.bullets.map(t) }));
    if (picked.has('projects')) body.projects = r.projects.map((p) => ({ ...p, title: t(p.title), text: t(p.text) }));
    if (picked.has('skills')) body.skills = { grouped: false, groups: [{ id: randomId(), name: { cs: '', en: '' }, tags: r.skills.map(t) }] };
    if (picked.has('languages')) body.languages = r.languages.map((l) => ({ ...l, name: t(l.name) }));
    if (picked.has('certifications')) body.certifications = r.certifications.map((x) => ({ ...x, name: t(x.name) }));
    const actor = holderActor(account);
    await saveProfile(deps, account.id, coerceProfile(profile), actor);
    await saveBody(deps, row, coerceBody(body), actor);
    await run(deps.db, 'DELETE FROM imports WHERE id = ?', c.req.param('id'));
    return c.redirect('/ucet?ok=importovano', 303);
  });
}
