import { unzipSync } from 'fflate';
import { LIMITS } from '../config/limits';
import { LANGUAGE_NAMES } from '../cv/i18n';
import { normalizeText, normalizeUrl, randomId } from '../cv/text';
import type { CefrLevel, CertificationItem, EducationItem, ExperienceItem, L10n, Lang, LanguageItem, LinkItem, ProjectItem } from '../cv/types';

// CV-13 (P1): import the ZIP from LinkedIn's "Get a copy of your data".
// E2: LinkedIn changes file names and columns now and then, so files are found by name
// anywhere in the archive and columns by header text, case-insensitively.
// CV-6: Birth Date, Address, Zip Code and Maiden Name are never read.

export interface ImportResult {
  name: string;
  headline: string;
  about: string;
  location: string;
  links: LinkItem[];
  email: string;
  phone: string;
  experience: Array<Omit<ExperienceItem, 'role' | 'bullets'> & { role: string; bullets: string[] }>;
  education: Array<Omit<EducationItem, 'school' | 'field' | 'bullets'> & { school: string; field: string; bullets: string[] }>;
  projects: Array<Omit<ProjectItem, 'title' | 'text'> & { title: string; text: string }>;
  skills: string[];
  languages: Array<Omit<LanguageItem, 'name'> & { name: string }>;
  certifications: Array<Omit<CertificationItem, 'name'> & { name: string }>;
  /** Things the holder should check (guessed months, unknown languages…). */
  notes: string[];
  files: string[];
}

const WANTED = ['profile', 'positions', 'education', 'skills', 'languages', 'certifications', 'projects', 'email addresses', 'phonenumbers', 'phone numbers'];

/** RFC 4180 CSV: quotes, doubled quotes, newlines inside quotes, BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  const s = text.replace(/^\ufeff/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** Rows as objects keyed by lower-case header; skips any "Notes:" preamble above the header. */
function table(text: string, mustHave: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => r.some((x) => x.trim().toLowerCase() === mustHave));
  if (h < 0) return [];
  const header = rows[h]!.map((x) => x.trim().toLowerCase());
  return rows.slice(h + 1).map((r) => Object.fromEntries(header.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

/** "Mar 2021" → "2021-03"; "2021" → guessed month and a note; "" → "". */
function ym(s: string, guessMonth: string, notes: string[], what: string): string {
  const t = s.trim();
  if (!t) return '';
  let m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(t);
  if (m && MONTHS[m[1]!.toLowerCase()]) return `${m[2]}-${MONTHS[m[1]!.toLowerCase()]}`;
  m = /^(\d{4})-(\d{2})(-\d{2})?$/.exec(t);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  m = /^(\d{4})$/.exec(t);
  if (m) {
    notes.push(`${what}: LinkedIn uvádí jen rok ${m[1]}, měsíc jsme odhadli – zkontrolujte ho.`);
    return `${m[1]}-${guessMonth}`;
  }
  notes.push(`${what}: datum „${t}“ jsme nepřečetli – doplňte ho.`);
  return '';
}

/** Split a LinkedIn description into bullets: by lines, "•", "-", "*" or numbered items. */
export function splitBullets(desc: string): string[] {
  const lines = desc
    .split(/\r?\n|(?:^|\s)[•▪●◦]\s+/)
    .map((l) => normalizeText(l.replace(/^\s*(?:[-*–•]|\d+[.)])\s+/, '')))
    .filter(Boolean);
  return lines;
}

const LEVELS: Array<[RegExp, CefrLevel]> = [
  [/native|bilingual|rodil/i, 'native'],
  [/full professional/i, 'C1'],
  [/professional working/i, 'B2'],
  [/limited working/i, 'B1'],
  [/elementary/i, 'A2'],
];

function languageCode(name: string): string {
  const n = name.trim().toLowerCase();
  for (const [code, names] of Object.entries(LANGUAGE_NAMES)) {
    if (names.en.toLowerCase() === n || names.cs.toLowerCase() === n) return code;
  }
  return '';
}

function linksFromWebsites(s: string): LinkItem[] {
  // "[PORTFOLIO:https://x.cz],[OTHER:https://y.cz]" or a plain list of URLs.
  const urls = [...s.matchAll(/https?:\/\/[^\s,\]]+/g)].map((m) => m[0]);
  const out: LinkItem[] = [];
  for (const u of urls) {
    const host = (() => {
      try {
        return new URL(u).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    const kind = host.endsWith('github.com') ? 'github' : host.endsWith('behance.net') ? 'behance' : host.endsWith('dribbble.com') ? 'dribbble' : host.endsWith('linkedin.com') ? 'linkedin' : out.some((l) => l.kind === 'website') ? 'other' : 'website';
    if (out.some((l) => l.kind === kind)) continue;
    out.push({ kind, url: normalizeUrl(u), label: kind === 'other' ? host : '' });
  }
  return out;
}

export function parseLinkedInZip(zip: Uint8Array): ImportResult {
  const files = unzipSync(zip, {
    filter: (f) => {
      const base = f.name.split('/').pop()!.toLowerCase();
      return base.endsWith('.csv') && WANTED.includes(base.replace(/\.csv$/, '')) && f.originalSize < 5_000_000;
    },
  });
  const byName = new Map<string, string>();
  const dec = new TextDecoder('utf-8');
  for (const [name, bytes] of Object.entries(files)) byName.set(name.split('/').pop()!.toLowerCase().replace(/\.csv$/, ''), dec.decode(bytes));
  const notes: string[] = [];
  const get = (n: string, key: string) => table(byName.get(n) ?? '', key);

  const profile = get('profile', 'first name')[0] ?? {};
  const name = normalizeText(`${profile['first name'] ?? ''} ${profile['last name'] ?? ''}`);
  const geo = profile['geo location'] ?? '';
  const location = normalizeText(geo.split(',')[0] ?? '');

  const experience = get('positions', 'company name').map((r, i) => {
    const what = `Zkušenost ${i + 1} (${r['company name'] || r['title']})`;
    return {
      id: randomId(),
      role: normalizeText(r['title']),
      employer: normalizeText(r['company name']),
      from: ym(r['started on'] ?? '', '01', notes, what),
      to: r['finished on'] ? ym(r['finished on'], '12', notes, what) : null,
      bullets: splitBullets(r['description'] ?? ''),
    };
  });
  const education = get('education', 'school name').map((r, i) => {
    const what = `Vzdělání ${i + 1} (${r['school name']})`;
    const field = [r['degree name'], r['notes']].filter(Boolean).join(', ');
    return {
      id: randomId(),
      school: normalizeText(r['school name']),
      field: normalizeText(field),
      from: ym(r['start date'] ?? '', '09', notes, what),
      to: r['end date'] ? ym(r['end date'], '06', notes, what) : null,
      bullets: splitBullets(r['activities'] ?? ''),
    };
  });
  const projects = get('projects', 'title').map((r) => ({ id: randomId(), title: normalizeText(r['title']), text: normalizeText(r['description'], true), url: normalizeUrl(r['url'] ?? ''), image: null }));
  const skills = get('skills', 'name')
    .map((r) => normalizeText(r['name']))
    .filter(Boolean);
  const languages = get('languages', 'name').map((r) => {
    const code = languageCode(r['name'] ?? '');
    const level = LEVELS.find(([re]) => re.test(r['proficiency'] ?? ''))?.[1] ?? 'B2';
    if (!r['proficiency']) notes.push(`Jazyk ${r['name']}: LinkedIn neuvádí úroveň, nastavili jsme B2 – upravte ji.`);
    return { id: randomId(), code, name: code ? '' : normalizeText(r['name']), level };
  });
  const certifications = get('certifications', 'name').map((r) => {
    const y = /(\d{4})/.exec(r['started on'] ?? '')?.[1];
    return { id: randomId(), name: normalizeText(r['name']), issuer: normalizeText(r['authority']), year: y ? Number(y) : null };
  });
  const emails = get('email addresses', 'email address');
  const email = (emails.find((e) => /yes/i.test(e['primary'] ?? '')) ?? emails[0])?.['email address'] ?? '';
  const phones = get(byName.has('phonenumbers') ? 'phonenumbers' : 'phone numbers', 'number');
  const phone = phones[0]?.['number'] ?? '';

  // Tell the holder what is over a limit – the editor flags it, nothing is dropped.
  const L = LIMITS;
  if (experience.length > L.experience.items) notes.push(`Zkušeností je ${experience.length}, limit je ${L.experience.items}. Všechny jsme načetli; v editoru vyberete, které zkrátit nebo smazat.`);
  if (education.length > L.education.items) notes.push(`Škol je ${education.length}, limit je ${L.education.items}.`);
  if (skills.length > L.skills.tags) notes.push(`Dovedností je ${skills.length}, limit je ${L.skills.tags}.`);
  if (languages.length > L.languages.items) notes.push(`Jazyků je ${languages.length}, limit je ${L.languages.items}.`);
  if (certifications.length > L.certifications.items) notes.push(`Certifikátů je ${certifications.length}, limit je ${L.certifications.items}.`);
  if (profile['birth date'] || profile['address'] || profile['zip code']) notes.push('Datum narození a adresu z LinkedInu jsme záměrně nenačetli – do životopisu na webu nepatří.');

  return {
    name,
    headline: normalizeText(profile['headline']),
    about: normalizeText(profile['summary'], true),
    location,
    links: linksFromWebsites(profile['websites'] ?? ''),
    email: normalizeText(email).toLowerCase(),
    phone: normalizeText(phone),
    experience,
    education,
    projects,
    skills,
    languages,
    certifications,
    notes,
    files: [...byName.keys()],
  };
}

/** Put imported text into the chosen language slot of the L10n fields. */
export function toL10n(text: string, lang: Lang, existing?: L10n): L10n {
  return { cs: lang === 'cs' ? text : (existing?.cs ?? ''), en: lang === 'en' ? text : (existing?.en ?? '') };
}
