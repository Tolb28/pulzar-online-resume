import { LIMITS } from '../config/limits';
import { ACCENT_PALETTE, isTemplateId, MIN_ACCENT_CONTRAST } from '../config/templates';
import { TIERS } from '../config/tiers';
import { contrastRatio, normalizeHex } from './color';
import { LANGUAGE_NAMES } from './i18n';
import { charCount, unsupportedChars } from './text';
import {
  BODY_SECTIONS,
  CEFR_LEVELS,
  LANGS,
  type CvDoc,
  type HideableSectionKey,
  type L10n,
  type Lang,
  type LinkKind,
} from './types';

// CV-1 AC: when the holder goes over a limit, the editor shows what is over and cuts nothing.
// Validation never changes the document. Errors block publishing; warnings do not.

export type IssueCode =
  | 'too_long'
  | 'too_many'
  | 'required'
  | 'invalid'
  | 'missing_translation'
  | 'unsupported_char'
  | 'contact_in_text'
  | 'sensitive'
  | 'tier';

export type IssueSection = HideableSectionKey | 'header' | 'design' | 'settings';

export interface Issue {
  /** Dotted path to the field, e.g. "body.experience.2.bullets.0.cs". */
  path: string;
  section: IssueSection;
  code: IssueCode;
  severity: 'error' | 'warning';
  message: string;
  limit?: number;
  actual?: number;
}

const LANG_NAME: Record<Lang, string> = { cs: 'česká', en: 'anglická' };
const LANG_IN: Record<Lang, string> = { cs: 'v češtině', en: 'v angličtině' };

const EMAIL_IN_TEXT = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/i;
const BIRTH_NUMBER = /\b\d{2}[0-35-8]\d{3}\s?\/\s?\d{3,4}\b/;
const PHONE_LIKE = /(?:\+|00)\d{2,3}[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}\b|\b[67]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/;
const SENSITIVE_WORDS =
  /\b(datum narození|narozen[aáý]?|rodné číslo|r\.\s?č\.|rodinný stav|ženatý|vdaná|rozveden[aáý]?|státní (občanství|příslušnost)|národnost|číslo (op|občanského průkazu|pasu)|date of birth|marital status|nationality|passport number)\b/i;
const STREET_HINT = /\b\d{3}\s?\d{2}\b|\b\d+\s?\/\s?\d+\b|\b(ulice|ul\.|náměstí|nám\.|třída|street|st\.)\b/i;

const LINK_HOSTS: Partial<Record<LinkKind, string>> = {
  linkedin: 'linkedin.com',
  github: 'github.com',
  behance: 'behance.net',
  dribbble: 'dribbble.com',
};
const LINK_NAMES: Record<LinkKind, string> = {
  linkedin: 'LinkedIn',
  github: 'GitHub',
  behance: 'Behance',
  dribbble: 'Dribbble',
  website: 'Web',
  other: 'Další odkaz',
};

export function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= LIMITS.profile.email;
}

export function isValidPhone(s: string): boolean {
  if (!/^\+?[\d\s()./-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, '').length;
  return digits >= 9 && digits <= 15;
}

export function isValidYearMonth(s: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = +m[1]!;
  const mo = +m[2]!;
  return y >= 1950 && y <= 2100 && mo >= 1 && mo <= 12;
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

interface Ctx {
  doc: CvDoc;
  issues: Issue[];
  langs: Lang[];
  phoneDigits: string;
  email: string;
}

function add(ctx: Ctx, issue: Issue): void {
  ctx.issues.push(issue);
}

/** Checks shared by every piece of free text. */
function checkText(ctx: Ctx, path: string, section: IssueSection, label: string, value: string, max: number): void {
  if (!value) return;
  const n = charCount(value);
  if (n > max) {
    add(ctx, {
      path,
      section,
      code: 'too_long',
      severity: 'error',
      limit: max,
      actual: n,
      message: `${label}: ${n} znaků z ${max}. Zkraťte o ${n - max}.`,
    });
  }
  const bad = unsupportedChars(value);
  if (bad.length) {
    add(ctx, {
      path,
      section,
      code: 'unsupported_char',
      severity: 'error',
      message: `${label}: ${plural(bad.length, 'znak', 'znaky', 'znaky')} ${bad.map((c) => `„${c}“`).join(' ')} se v PDF nezobrazí. Nahraďte ${bad.length === 1 ? 'ho' : 'je'} nebo smažte.`,
    });
  }
  if (EMAIL_IN_TEXT.test(value) || (ctx.email && value.toLowerCase().includes(ctx.email.toLowerCase()))) {
    add(ctx, {
      path,
      section,
      code: 'contact_in_text',
      severity: 'error',
      message: `${label}: obsahuje e-mailovou adresu. Kontakt patří do sekce Kontakt, kde ho chráníme před roboty.`,
    });
  }
  const digits = value.replace(/\D/g, '');
  if (ctx.phoneDigits.length >= 9 && digits.includes(ctx.phoneDigits.slice(-9))) {
    add(ctx, {
      path,
      section,
      code: 'contact_in_text',
      severity: 'error',
      message: `${label}: obsahuje vaše telefonní číslo. Telefon patří do sekce Kontakt, kde ho chráníme před roboty.`,
    });
  } else if (PHONE_LIKE.test(value)) {
    add(ctx, {
      path,
      section,
      code: 'contact_in_text',
      severity: 'warning',
      message: `${label}: vypadá to jako telefonní číslo. Kontakty patří do sekce Kontakt, kde je chráníme před roboty.`,
    });
  }
  if (BIRTH_NUMBER.test(value)) {
    add(ctx, {
      path,
      section,
      code: 'sensitive',
      severity: 'error',
      message: `${label}: vypadá to jako rodné číslo. To do životopisu nepatří.`,
    });
  } else if (SENSITIVE_WORDS.test(value)) {
    add(ctx, {
      path,
      section,
      code: 'sensitive',
      severity: 'warning',
      message: `${label}: datum narození, rodinný stav, národnost ani doklady do životopisu nepatří a zaměstnavatel se na ně ptát nesmí.`,
    });
  }
}

function checkL10n(
  ctx: Ctx,
  path: string,
  section: IssueSection,
  label: string,
  value: L10n,
  max: number,
  required = false,
): void {
  for (const lang of LANGS) {
    const v = value[lang] ?? '';
    const enabled = ctx.langs.includes(lang);
    // Text in a language the CV does not use is kept (nothing is cut) but not checked.
    if (!enabled) continue;
    checkText(ctx, `${path}.${lang}`, section, ctx.langs.length > 1 ? `${label} (${lang.toUpperCase()})` : label, v, max);
  }
  const filled = ctx.langs.filter((l) => (value[l] ?? '').trim() !== '');
  const otherFilled = LANGS.some((l) => (value[l] ?? '').trim() !== '');
  if (filled.length === 0) {
    if (required) {
      add(ctx, {
        path: `${path}.${ctx.langs[0]}`,
        section,
        code: 'required',
        severity: 'error',
        message: `${label}: vyplňte prosím.`,
      });
    } else if (otherFilled) {
      const lang = ctx.langs[0]!;
      add(ctx, {
        path: `${path}.${lang}`,
        section,
        code: 'missing_translation',
        severity: 'warning',
        message: `${label}: text je jen ${LANG_IN[lang === 'cs' ? 'en' : 'cs']}, ale životopis je ${lang === 'cs' ? 'český' : 'anglický'}.`,
      });
    }
    return;
  }
  for (const lang of ctx.langs) {
    if (!(value[lang] ?? '').trim()) {
      add(ctx, {
        path: `${path}.${lang}`,
        section,
        code: 'missing_translation',
        severity: 'warning',
        message: `${label}: chybí ${LANG_NAME[lang]} verze. Na ${lang === 'en' ? 'anglické' : 'české'} stránce a v PDF se použije ${lang === 'en' ? 'česká' : 'anglická'}.`,
      });
    }
  }
}

function checkPlain(ctx: Ctx, path: string, section: IssueSection, label: string, value: string, max: number, required = false): void {
  if (!value.trim()) {
    if (required) add(ctx, { path, section, code: 'required', severity: 'error', message: `${label}: vyplňte prosím.` });
    return;
  }
  checkText(ctx, path, section, label, value, max);
}

function checkCount(ctx: Ctx, path: string, section: IssueSection, label: string, n: number, max: number, unit: [string, string, string]): void {
  if (n > max) {
    const over = n - max;
    add(ctx, {
      path,
      section,
      code: 'too_many',
      severity: 'error',
      limit: max,
      actual: n,
      message: `${label}: ${n} ${plural(n, ...unit)} z ${max}. Odeberte ${over} ${plural(over, ...unit)}.`,
    });
  }
}

function checkRange(ctx: Ctx, path: string, section: IssueSection, label: string, from: string, to: string | null): void {
  if (!from) {
    add(ctx, { path: `${path}.from`, section, code: 'required', severity: 'error', message: `${label}: vyplňte, od kdy.` });
  } else if (!isValidYearMonth(from)) {
    add(ctx, { path: `${path}.from`, section, code: 'invalid', severity: 'error', message: `${label}: datum „od“ zadejte jako měsíc a rok.` });
  }
  if (to !== null && to !== '') {
    if (!isValidYearMonth(to)) {
      add(ctx, { path: `${path}.to`, section, code: 'invalid', severity: 'error', message: `${label}: datum „do“ zadejte jako měsíc a rok, nebo zvolte „dosud“.` });
    } else if (from && isValidYearMonth(from) && to < from) {
      add(ctx, { path: `${path}.to`, section, code: 'invalid', severity: 'error', message: `${label}: „do“ je dřív než „od“.` });
    }
  }
}

/**
 * Validate a CV for its tier. Errors block publishing; the editor shows errors and warnings
 * next to the fields as the holder works, and drafts are saved either way.
 */
export function validateDoc(doc: CvDoc): Issue[] {
  const tier = TIERS[doc.tier];
  const ctx: Ctx = {
    doc,
    issues: [],
    langs: doc.langs.length ? doc.langs : ['cs'],
    phoneDigits: doc.profile.phone.replace(/\D/g, ''),
    email: doc.profile.email.trim(),
  };
  const { profile: p, body: b } = doc;
  const L = LIMITS;

  // Languages (CV-9): Základ is CS or EN, Profi and Na míru CS + EN.
  if (doc.langs.length === 0) {
    add(ctx, { path: 'langs', section: 'settings', code: 'required', severity: 'error', message: 'Zvolte jazyk životopisu.' });
  } else if (doc.langs.length > tier.maxLangs) {
    add(ctx, {
      path: 'langs',
      section: 'settings',
      code: 'tier',
      severity: 'error',
      message: `${tier.name} má jeden jazyk. Dvojjazyčný životopis (CS + EN) je v Profi a Na míru.`,
    });
  }

  // Hlavička
  checkPlain(ctx, 'profile.name', 'header', 'Jméno', p.name, L.profile.name, true);
  checkL10n(ctx, 'profile.headline', 'header', 'Titulek', p.headline, L.profile.headline);
  checkL10n(ctx, 'profile.location', 'header', 'Město nebo kraj', p.location, L.profile.location);
  for (const lang of ctx.langs) {
    if (STREET_HINT.test(p.location[lang] ?? '')) {
      add(ctx, {
        path: `profile.location.${lang}`,
        section: 'header',
        code: 'sensitive',
        severity: 'warning',
        message: 'Město nebo kraj: stačí město nebo kraj. Ulici, číslo domu ani PSČ do životopisu na webu nedávejte.',
      });
    }
  }
  checkCount(ctx, 'profile.links', 'header', 'Odkazy', p.links.length, L.profile.links, ['odkaz', 'odkazy', 'odkazů']);
  const seen = new Set<LinkKind>();
  p.links.forEach((link, i) => {
    const path = `profile.links.${i}`;
    const name = LINK_NAMES[link.kind] ?? 'Odkaz';
    if (seen.has(link.kind)) {
      add(ctx, { path, section: 'header', code: 'invalid', severity: 'error', message: `${name}: tento odkaz už máte. Každý druh odkazu může být jen jednou.` });
    }
    seen.add(link.kind);
    if (!link.url) {
      add(ctx, { path: `${path}.url`, section: 'header', code: 'required', severity: 'error', message: `${name}: doplňte adresu, nebo odkaz smažte.` });
      return;
    }
    if (!isHttpUrl(link.url) || charCount(link.url) > L.profile.url) {
      add(ctx, { path: `${path}.url`, section: 'header', code: 'invalid', severity: 'error', message: `${name}: adresa musí být webový odkaz (https://…).` });
      return;
    }
    const host = new URL(link.url).hostname.toLowerCase();
    const want = LINK_HOSTS[link.kind];
    if (want && host !== want && !host.endsWith(`.${want}`)) {
      add(ctx, { path: `${path}.url`, section: 'header', code: 'invalid', severity: 'error', message: `${name}: odkaz musí vést na ${want}.` });
    }
    if (link.kind === 'other') {
      checkPlain(ctx, `${path}.label`, 'header', 'Název dalšího odkazu', link.label, L.profile.linkLabel, true);
    }
  });

  // Kontakt (CV-4): the e-mail and phone themselves.
  if (p.email && !isValidEmail(p.email)) {
    add(ctx, { path: 'profile.email', section: 'contact', code: 'invalid', severity: 'error', message: 'E-mail: zkontrolujte prosím adresu.' });
  }
  if (p.phone && !isValidPhone(p.phone)) {
    add(ctx, { path: 'profile.phone', section: 'contact', code: 'invalid', severity: 'error', message: 'Telefon: zadejte číslo s předvolbou, např. +420 777 123 456.' });
  }
  if (!b.layout.hidden.includes('contact') && !p.email && !p.phone) {
    add(ctx, {
      path: 'profile.email',
      section: 'contact',
      code: 'required',
      severity: 'warning',
      message: 'Kontakt: bez e-mailu nebo telefonu se vám náborář neozve. Vyplňte aspoň jedno, nebo sekci skryjte.',
    });
  }

  // O mně, Zájmy
  checkL10n(ctx, 'body.about', 'about', 'O mně', b.about, L.about);
  checkL10n(ctx, 'body.interests', 'interests', 'Zájmy', b.interests, L.interests);

  // Zkušenosti
  checkCount(ctx, 'body.experience', 'experience', 'Zkušenosti', b.experience.length, L.experience.items, ['položka', 'položky', 'položek']);
  b.experience.forEach((e, i) => {
    const path = `body.experience.${i}`;
    const label = `Zkušenost ${i + 1}`;
    checkL10n(ctx, `${path}.role`, 'experience', `${label} – pozice`, e.role, L.experience.role, true);
    checkPlain(ctx, `${path}.employer`, 'experience', `${label} – zaměstnavatel`, e.employer, L.experience.employer, true);
    checkRange(ctx, path, 'experience', label, e.from, e.to);
    checkCount(ctx, `${path}.bullets`, 'experience', `${label} – odrážky`, e.bullets.length, L.experience.bullets, ['odrážka', 'odrážky', 'odrážek']);
    e.bullets.forEach((t, j) => checkL10n(ctx, `${path}.bullets.${j}`, 'experience', `${label} – odrážka ${j + 1}`, t, L.experience.bullet));
  });

  // Vzdělání
  checkCount(ctx, 'body.education', 'education', 'Vzdělání', b.education.length, L.education.items, ['položka', 'položky', 'položek']);
  b.education.forEach((e, i) => {
    const path = `body.education.${i}`;
    const label = `Vzdělání ${i + 1}`;
    checkL10n(ctx, `${path}.school`, 'education', `${label} – škola`, e.school, L.education.school, true);
    checkL10n(ctx, `${path}.field`, 'education', `${label} – obor`, e.field, L.education.field);
    checkRange(ctx, path, 'education', label, e.from, e.to);
    checkCount(ctx, `${path}.bullets`, 'education', `${label} – odrážky`, e.bullets.length, L.education.bullets, ['odrážka', 'odrážky', 'odrážek']);
    e.bullets.forEach((t, j) => checkL10n(ctx, `${path}.bullets.${j}`, 'education', `${label} – odrážka ${j + 1}`, t, L.education.bullet));
  });

  // Projekty
  checkCount(ctx, 'body.projects', 'projects', `Projekty (${tier.name})`, b.projects.length, tier.projects, ['projekt', 'projekty', 'projektů']);
  b.projects.forEach((pr, i) => {
    const path = `body.projects.${i}`;
    const label = `Projekt ${i + 1}`;
    checkL10n(ctx, `${path}.title`, 'projects', `${label} – název`, pr.title, L.projects.title, true);
    checkL10n(ctx, `${path}.text`, 'projects', `${label} – popis`, pr.text, L.projects.text);
    if (pr.url && (!isHttpUrl(pr.url) || charCount(pr.url) > L.projects.url)) {
      add(ctx, { path: `${path}.url`, section: 'projects', code: 'invalid', severity: 'error', message: `${label}: odkaz musí být webová adresa (https://…).` });
    }
    if (pr.image && !tier.projectImages) {
      add(ctx, {
        path: `${path}.image`,
        section: 'projects',
        code: 'tier',
        severity: 'warning',
        message: `${label}: obrázky projektů jsou v Profi a Na míru. V Základu se obrázek nezobrazí (zůstává uložený).`,
      });
    }
  });

  // Dovednosti
  const tagCount = b.skills.groups.reduce((n, g) => n + g.tags.length, 0);
  checkCount(ctx, 'body.skills', 'skills', 'Dovednosti', tagCount, L.skills.tags, ['dovednost', 'dovednosti', 'dovedností']);
  if (b.skills.grouped) {
    checkCount(ctx, 'body.skills.groups', 'skills', 'Skupiny dovedností', b.skills.groups.length, L.skills.groups, ['skupina', 'skupiny', 'skupin']);
  }
  b.skills.groups.forEach((g, i) => {
    const path = `body.skills.groups.${i}`;
    if (b.skills.grouped) checkL10n(ctx, `${path}.name`, 'skills', `Skupina ${i + 1} – název`, g.name, L.skills.groupName, true);
    g.tags.forEach((t, j) => checkL10n(ctx, `${path}.tags.${j}`, 'skills', `Dovednost „${t.cs || t.en}“`, t, L.skills.tag));
  });

  // Jazyky
  checkCount(ctx, 'body.languages', 'languages', 'Jazyky', b.languages.length, L.languages.items, ['jazyk', 'jazyky', 'jazyků']);
  b.languages.forEach((l, i) => {
    const path = `body.languages.${i}`;
    if (l.code && !LANGUAGE_NAMES[l.code]) {
      add(ctx, { path: `${path}.code`, section: 'languages', code: 'invalid', severity: 'error', message: `Jazyk ${i + 1}: vyberte jazyk ze seznamu.` });
    }
    if (!l.code) checkL10n(ctx, `${path}.name`, 'languages', `Jazyk ${i + 1}`, l.name, L.languages.name, true);
    if (!CEFR_LEVELS.includes(l.level)) {
      add(ctx, { path: `${path}.level`, section: 'languages', code: 'invalid', severity: 'error', message: `Jazyk ${i + 1}: zvolte úroveň A1–C2 nebo rodilý mluvčí.` });
    }
  });

  // Certifikáty a kurzy
  checkCount(ctx, 'body.certifications', 'certifications', 'Certifikáty a kurzy', b.certifications.length, L.certifications.items, ['položka', 'položky', 'položek']);
  const thisYear = new Date().getUTCFullYear();
  b.certifications.forEach((c, i) => {
    const path = `body.certifications.${i}`;
    const label = `Certifikát ${i + 1}`;
    checkL10n(ctx, `${path}.name`, 'certifications', `${label} – název`, c.name, L.certifications.name, true);
    checkPlain(ctx, `${path}.issuer`, 'certifications', `${label} – vydal`, c.issuer, L.certifications.issuer);
    if (c.year !== null && (!Number.isInteger(c.year) || c.year < 1950 || c.year > thisYear + 1)) {
      add(ctx, { path: `${path}.year`, section: 'certifications', code: 'invalid', severity: 'error', message: `${label}: rok zadejte jako čtyři číslice.` });
    }
  });

  // Layout: a permutation of the fixed set; nothing can be added (CV-1).
  const order = b.layout.order;
  if (order.length !== BODY_SECTIONS.length || !BODY_SECTIONS.every((s) => order.includes(s))) {
    add(ctx, { path: 'body.layout.order', section: 'settings', code: 'invalid', severity: 'error', message: 'Pořadí sekcí je neplatné.' });
  }

  // Design (CV-2)
  const d = doc.design;
  if (!isTemplateId(d.template)) {
    add(ctx, { path: 'design.template', section: 'design', code: 'invalid', severity: 'error', message: 'Vyberte šablonu.' });
  }
  const hex = normalizeHex(d.accent);
  if (!hex) {
    add(ctx, { path: 'design.accent', section: 'design', code: 'invalid', severity: 'error', message: 'Barva: zadejte ji jako #rrggbb.' });
  } else if (!tier.ownAccent) {
    if (!ACCENT_PALETTE.some((a) => a.hex === hex)) {
      add(ctx, {
        path: 'design.accent',
        section: 'design',
        code: 'tier',
        severity: 'error',
        message: `${tier.name} nabízí ${ACCENT_PALETTE.length} barev. Vlastní barvu má Profi a Na míru.`,
      });
    }
  } else {
    const ratio = contrastRatio(hex, '#ffffff');
    if (ratio < MIN_ACCENT_CONTRAST) {
      add(ctx, {
        path: 'design.accent',
        section: 'design',
        code: 'invalid',
        severity: 'error',
        message: `Barva je na bílém pozadí špatně čitelná (kontrast ${ratio.toFixed(1)} : 1, potřeba aspoň ${MIN_ACCENT_CONTRAST} : 1). Zvolte tmavší odstín.`,
      });
    }
  }
  if (d.cover && !tier.studioDesign) {
    add(ctx, {
      path: 'design.cover',
      section: 'design',
      code: 'tier',
      severity: 'warning',
      message: 'Úvodní obrázek patří k Na míru. V jiném balíčku se nezobrazí.',
    });
  }

  return ctx.issues;
}

export function errorsOf(issues: Issue[]): Issue[] {
  return issues.filter((i) => i.severity === 'error');
}

export function issuesBySection(issues: Issue[]): Map<IssueSection, Issue[]> {
  const m = new Map<IssueSection, Issue[]>();
  for (const i of issues) {
    const list = m.get(i.section) ?? [];
    list.push(i);
    m.set(i.section, list);
  }
  return m;
}
