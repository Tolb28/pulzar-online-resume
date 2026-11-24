import { DRAFT_HARD_CAP_FACTOR, DRAFT_MAX_LIST_ITEMS, LIMITS } from '../config/limits';
import { DEFAULT_ACCENT, isTemplateId } from '../config/templates';
import { normalizeHex } from './color';
import { emptyL10n } from './defaults';
import { normalizeText, normalizeUrl, randomId } from './text';
import {
  BODY_SECTIONS,
  CEFR_LEVELS,
  LINK_KINDS,
  type BodySectionKey,
  type CefrLevel,
  type CvBody,
  type CvDesign,
  type CvDoc,
  type HideableSectionKey,
  type L10n,
  type LinkKind,
  type MediaRef,
  type ProfileBlock,
} from './types';

// Coerce untrusted JSON (form posts, stored rows, imports) into well-formed documents.
// Shape only: lengths and counts are left alone so the validator can show what is over.

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown, multiline = false): string => normalizeText(x, multiline);

export function l10n(x: unknown, multiline = false): L10n {
  if (typeof x === 'string') return { cs: str(x, multiline), en: '' };
  const o = obj(x);
  return { cs: str(o.cs, multiline), en: str(o.en, multiline) };
}

const isEmpty = (t: L10n) => !t.cs && !t.en;
const id = (x: unknown) => (typeof x === 'string' && /^[A-Za-z0-9_-]{4,32}$/.test(x) ? x : randomId());
const ym = (x: unknown) => (typeof x === 'string' ? x.trim().slice(0, 7) : '');
/** null (or a missing value) means "dosud"; "" means not filled in yet (flagged by validation). */
const toYm = (x: unknown) => (x === null || x === undefined || x === 'present' ? null : ym(x));

function media(x: unknown): MediaRef | null {
  const o = obj(x);
  if (typeof o.key !== 'string' || !/^[A-Za-z0-9/_.-]{4,200}$/.test(o.key)) return null;
  const w = Number(o.width);
  const h = Number(o.height);
  return { key: o.key, width: Number.isFinite(w) ? w : 0, height: Number.isFinite(h) ? h : 0 };
}

export function coerceProfile(x: unknown): ProfileBlock {
  const o = obj(x);
  const links = arr(o.links)
    .map((l) => {
      const lo = obj(l);
      const kind = (LINK_KINDS as readonly string[]).includes(lo.kind as string) ? (lo.kind as LinkKind) : 'website';
      return { kind, url: normalizeUrl(str(lo.url)), label: kind === 'other' ? str(lo.label) : '' };
    })
    .filter((l) => l.url || l.label);
  return {
    name: str(o.name),
    headline: l10n(o.headline),
    location: l10n(o.location),
    photo: media(o.photo),
    links,
    email: str(o.email).toLowerCase(),
    phone: str(o.phone),
  };
}

export function coerceBody(x: unknown): CvBody {
  const o = obj(x);
  const bullets = (b: unknown) => arr(b).map((t) => l10n(t)).filter((t) => !isEmpty(t));

  const experience = arr(o.experience).map((e) => {
    const eo = obj(e);
    return {
      id: id(eo.id),
      role: l10n(eo.role),
      employer: str(eo.employer),
      from: ym(eo.from),
      to: toYm(eo.to),
      bullets: bullets(eo.bullets),
    };
  });
  const education = arr(o.education).map((e) => {
    const eo = obj(e);
    return {
      id: id(eo.id),
      school: l10n(eo.school),
      field: l10n(eo.field),
      from: ym(eo.from),
      to: toYm(eo.to),
      bullets: bullets(eo.bullets),
    };
  });
  const projects = arr(o.projects).map((p) => {
    const po = obj(p);
    return { id: id(po.id), title: l10n(po.title), text: l10n(po.text, true), url: normalizeUrl(str(po.url)), image: media(po.image) };
  });
  const so = obj(o.skills);
  const groups = arr(so.groups).map((g) => {
    const go = obj(g);
    return { id: id(go.id), name: l10n(go.name), tags: arr(go.tags).map((t) => l10n(t)).filter((t) => !isEmpty(t)) };
  });
  const languages = arr(o.languages).map((l) => {
    const lo = obj(l);
    const level = (CEFR_LEVELS as readonly string[]).includes(lo.level as string) ? (lo.level as CefrLevel) : 'B2';
    return { id: id(lo.id), code: typeof lo.code === 'string' ? lo.code.trim().toLowerCase().slice(0, 8) : '', name: l10n(lo.name), level };
  });
  const certifications = arr(o.certifications).map((c) => {
    const co = obj(c);
    const y = Number(co.year);
    return {
      id: id(co.id),
      name: l10n(co.name),
      issuer: str(co.issuer),
      year: co.year === null || co.year === '' || co.year === undefined || !Number.isFinite(y) ? null : Math.trunc(y),
    };
  });

  const lo = obj(o.layout);
  const order = arr(lo.order).filter((s): s is BodySectionKey => (BODY_SECTIONS as readonly string[]).includes(s as string));
  const unique = [...new Set(order)];
  for (const s of BODY_SECTIONS) if (!unique.includes(s)) unique.push(s);
  const hideable: readonly string[] = [...BODY_SECTIONS, 'contact'];
  const hidden = [...new Set(arr(lo.hidden).filter((s): s is HideableSectionKey => hideable.includes(s as string)))];

  return {
    v: 1,
    about: l10n(o.about, true),
    experience,
    education,
    projects,
    skills: { grouped: so.grouped === true, groups },
    languages,
    certifications,
    interests: l10n(o.interests),
    layout: { order: unique, hidden },
  };
}

export function coerceDesign(x: unknown): CvDesign {
  const o = obj(x);
  return {
    template: isTemplateId(o.template) ? o.template : 'moderni',
    accent: normalizeHex(typeof o.accent === 'string' ? o.accent : '') ?? DEFAULT_ACCENT,
    cover: media(o.cover),
  };
}

/**
 * Refuse (never truncate) a save that is wildly over every limit – a pasted document, or a
 * script. Returns a message for the holder, or null when the draft can be stored.
 */
export function hardCapProblem(profile: ProfileBlock, body: CvBody): string | null {
  const cap = (n: number) => n * DRAFT_HARD_CAP_FACTOR;
  const tooLong = (s: string, limit: number) => s.length > cap(limit);
  const tooLongL = (t: L10n, limit: number) => tooLong(t.cs, limit) || tooLong(t.en, limit);
  const lists = [body.experience, body.education, body.projects, body.languages, body.certifications, body.skills.groups, profile.links];
  if (lists.some((l) => l.length > DRAFT_MAX_LIST_ITEMS)) return 'Tolik položek nejde uložit. Zkraťte prosím seznam.';
  const L = LIMITS;
  const bad =
    tooLong(profile.name, L.profile.name) ||
    tooLongL(profile.headline, L.profile.headline) ||
    tooLongL(profile.location, L.profile.location) ||
    tooLongL(body.about, L.about) ||
    tooLongL(body.interests, L.interests) ||
    body.experience.some((e) => tooLongL(e.role, L.experience.role) || tooLong(e.employer, L.experience.employer) || e.bullets.length > DRAFT_MAX_LIST_ITEMS || e.bullets.some((b) => tooLongL(b, L.experience.bullet))) ||
    body.education.some((e) => tooLongL(e.school, L.education.school) || tooLongL(e.field, L.education.field) || e.bullets.length > DRAFT_MAX_LIST_ITEMS || e.bullets.some((b) => tooLongL(b, L.education.bullet))) ||
    body.projects.some((p) => tooLongL(p.title, L.projects.title) || tooLongL(p.text, L.projects.text) || tooLong(p.url, L.projects.url)) ||
    body.skills.groups.some((g) => tooLongL(g.name, L.skills.groupName) || g.tags.length > DRAFT_MAX_LIST_ITEMS || g.tags.some((t) => tooLongL(t, L.skills.tag))) ||
    body.languages.some((l) => tooLongL(l.name, L.languages.name)) ||
    body.certifications.some((c) => tooLongL(c.name, L.certifications.name) || tooLong(c.issuer, L.certifications.issuer)) ||
    profile.links.some((l) => tooLong(l.url, L.profile.url) || tooLong(l.label, L.profile.linkLabel));
  return bad ? `Některý text je mnohonásobně delší, než je limit, a nejde uložit. Zkraťte ho prosím (nic jsme nesmazali).` : null;
}

export { emptyL10n };

const isL10n = (v: unknown): v is L10n =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 2 && typeof (v as L10n).cs === 'string' && typeof (v as L10n).en === 'string';

/** Blank every text in a language the CV does not use. */
export function onlyLangs<T>(value: T, langs: readonly string[]): T {
  if (isL10n(value)) return { cs: langs.includes('cs') ? value.cs : '', en: langs.includes('en') ? value.en : '' } as T;
  if (Array.isArray(value)) return value.map((v) => onlyLangs(v, langs)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, onlyLangs(v, langs)])) as T;
  return value;
}

/**
 * What may be shown: text in the CV's own languages only. Text kept from a language the CV no
 * longer uses stays in the draft (nothing is cut) but is never rendered – it is not validated.
 */
export function renderableDoc(doc: CvDoc): CvDoc {
  return { ...doc, profile: onlyLangs(doc.profile, doc.langs), body: onlyLangs(doc.body, doc.langs) };
}
