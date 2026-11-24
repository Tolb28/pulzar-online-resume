import { normalizeHex } from '../cv/color';
import { GRADUATE_ORDER } from '../cv/defaults';
import { coerceBody, coerceProfile } from '../cv/sanitize';
import { normalizeText, normalizeUrl, randomId } from '../cv/text';
import { BODY_SECTIONS, LINK_KINDS, type BodySectionKey, type CvBody, type CvDesign, type CvDoc, type HideableSectionKey, type L10n, type ProfileBlock } from '../cv/types';
import { isTemplateId } from '../config/templates';

// Apply one posted editor section to the draft. Fields of a language the form did not show
// are taken from the existing draft, so switching a CV to one language never drops text.

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x.filter((v) => v !== undefined) : x && typeof x === 'object' ? Object.values(x as Obj) : []);
const str = (x: unknown) => (typeof x === 'string' ? x : '');

/** Nested object from dotted form keys: "experience.0.role.cs" → { experience: [ { role: { cs } } ] }. */
export function parseForm(entries: Iterable<[string, unknown]>): Obj {
  const root: Obj = {};
  for (const [key, value] of entries) {
    if (typeof value !== 'string') continue;
    const parts = key.split('.');
    if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
    let node: Obj | unknown[] = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      const nextIsIndex = !last && /^\d+$/.test(parts[i + 1]!);
      const k = /^\d+$/.test(part) && Array.isArray(node) ? Number(part) : part;
      const container = node as Record<string | number, unknown>;
      if (last) {
        const prev = container[k];
        if (prev === undefined) container[k] = value;
        else container[k] = Array.isArray(prev) ? [...prev, value] : [prev, value];
      } else {
        if (container[k] === undefined || typeof container[k] !== 'object') container[k] = nextIsIndex ? [] : {};
        node = container[k] as Obj | unknown[];
      }
    });
  }
  return root;
}

/** Keep the languages the form did not send. */
function fill(parsed: unknown, existing: L10n | undefined): L10n {
  const o = obj(parsed);
  return {
    cs: 'cs' in o ? str(o.cs) : (existing?.cs ?? ''),
    en: 'en' in o ? str(o.en) : (existing?.en ?? ''),
  };
}

/** "2021-03" from a month input, or "03/2021", "3.2021", "2021/3" typed by hand. */
export function month(x: unknown): string {
  const s = str(x).trim();
  if (!s) return '';
  let m = /^(\d{4})-(\d{1,2})$/.exec(s) ?? /^(\d{4})[/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}`;
  m = /^(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  return s;
}

function listOp<T>(list: T[], op: string | null, make: () => T): T[] {
  if (!op) return list;
  const [cmd, a] = op.split(':');
  const i = Number(a);
  const out = [...list];
  if (cmd === 'add') out.push(make());
  else if (cmd === 'del' && i >= 0 && i < out.length) out.splice(i, 1);
  else if (cmd === 'up' && i > 0 && i < out.length) [out[i - 1], out[i]] = [out[i]!, out[i - 1]!];
  else if (cmd === 'down' && i >= 0 && i < out.length - 1) [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
  return out;
}

/** A field that is not in the post at all keeps its stored value (text inputs are always posted). */
function keep<T>(o: Obj, key: string, existing: T | undefined, fallback: T, read: (v: unknown) => T): T {
  return key in o ? read(o[key]) : (existing ?? fallback);
}

/** "dosud" is a checkbox (absent when unticked), so it is only read together with its date field. */
function endDate(o: Obj, existing: string | null | undefined): string | null {
  if (!('to' in o) && !('present' in o)) return existing === undefined ? '' : existing;
  return o.present ? null : month(o.to);
}

function byId<T extends { id: string }>(list: T[], id: unknown, i: number): T | undefined {
  return list.find((x) => x.id === id) ?? list[i];
}

function bullets(parsed: unknown, existing: L10n[] | undefined): L10n[] {
  return arr(parsed).map((b, j) => fill(b, existing?.[j]));
}

const emptyL = (): L10n => ({ cs: '', en: '' });

export interface Applied {
  profile?: ProfileBlock;
  body?: CvBody;
  design?: Partial<CvDesign>;
}

export function applySection(key: string, doc: CvDoc, form: Obj, op: string | null): Applied {
  const b = doc.body;
  switch (key) {
    case 'hlavicka': {
      const links = obj(form.links);
      const profile = coerceProfile({
        ...doc.profile,
        name: form.name,
        headline: fill(form.headline, doc.profile.headline),
        location: fill(form.location, doc.profile.location),
        photo: op === 'photo:remove' ? null : doc.profile.photo,
        links: LINK_KINDS.map((kind) => ({
          kind,
          url: normalizeUrl(str(obj(links[kind]).url)),
          label: kind === 'other' ? str(obj(links.other).label) : '',
        })),
      });
      return { profile };
    }
    case 'kontakt': {
      const hidden = new Set<HideableSectionKey>(b.layout.hidden);
      if (form.hideContact) hidden.add('contact');
      else hidden.delete('contact');
      return {
        profile: coerceProfile({ ...doc.profile, email: form.email, phone: form.phone }),
        body: { ...b, layout: { ...b.layout, hidden: [...hidden] } },
      };
    }
    case 'o-mne':
      return { body: coerceBody({ ...b, about: fill(form.about, b.about) }) };
    case 'zajmy':
      return { body: coerceBody({ ...b, interests: fill(form.interests, b.interests) }) };
    case 'zkusenosti': {
      // A post without the list (only an operation) keeps the stored list: never lose entries.
      const items = form.experience === undefined ? b.experience : arr(form.experience).map((x, i) => {
        const o = obj(x);
        const ex = byId(b.experience, o.id, i);
        return {
          id: str(o.id) || randomId(),
          role: fill(o.role, ex?.role),
          employer: keep(o, 'employer', ex?.employer, '', str),
          from: keep(o, 'from', ex?.from, '', month),
          to: endDate(o, ex?.to),
          bullets: 'bullets' in o ? bullets(o.bullets, ex?.bullets) : (ex?.bullets ?? []),
        };
      });
      const experience = listOp(items, op, () => ({ id: randomId(), role: emptyL(), employer: '', from: '', to: '', bullets: [] }));
      return { body: coerceBody({ ...b, experience }) };
    }
    case 'vzdelani': {
      const items = form.education === undefined ? b.education : arr(form.education).map((x, i) => {
        const o = obj(x);
        const ex = byId(b.education, o.id, i);
        return {
          id: str(o.id) || randomId(),
          school: fill(o.school, ex?.school),
          field: fill(o.field, ex?.field),
          from: keep(o, 'from', ex?.from, '', month),
          to: endDate(o, ex?.to),
          bullets: 'bullets' in o ? bullets(o.bullets, ex?.bullets) : (ex?.bullets ?? []),
        };
      });
      const education = listOp(items, op, () => ({ id: randomId(), school: emptyL(), field: emptyL(), from: '', to: '', bullets: [] }));
      return { body: coerceBody({ ...b, education }) };
    }
    case 'projekty': {
      let items = form.projects === undefined ? b.projects.map((p) => ({ ...p })) : arr(form.projects).map((x, i) => {
        const o = obj(x);
        const ex = byId(b.projects, o.id, i);
        return { id: str(o.id) || randomId(), title: fill(o.title, ex?.title), text: fill(o.text, ex?.text), url: keep(o, 'url', ex?.url, '', (v) => normalizeUrl(str(v))), image: ex?.image ?? null };
      });
      const rm = /^image:remove:(\d+)$/.exec(op ?? '');
      if (rm && items[Number(rm[1])]) items[Number(rm[1])]!.image = null;
      items = listOp(items, rm ? null : op, () => ({ id: randomId(), title: emptyL(), text: emptyL(), url: '', image: null }));
      return { body: coerceBody({ ...b, projects: items }) };
    }
    case 'dovednosti': {
      const so = obj(form.skills);
      if (form.skills === undefined) {
        const groups = b.skills.grouped ? listOp(b.skills.groups, op, () => ({ id: randomId(), name: emptyL(), tags: [] as L10n[] })) : b.skills.groups;
        return { body: coerceBody({ ...b, skills: { ...b.skills, groups } }) };
      }
      const grouped = !!so.grouped;
      const split = (s: unknown) =>
        typeof s === 'string'
          ? s
              .split(/[\n,;]+/)
              .map((t) => normalizeText(t))
              .filter(Boolean)
          : null;
      let groups = arr(so.groups).map((g, i) => {
        const go = obj(g);
        const ex = byId(b.skills.groups, go.id, i);
        const tags = obj(go.tags);
        const cs = split(tags.cs);
        const en = split(tags.en);
        const n = Math.max(cs?.length ?? ex?.tags.length ?? 0, en?.length ?? (cs ? 0 : (ex?.tags.length ?? 0)));
        const list: L10n[] = [];
        for (let j = 0; j < n; j++) list.push({ cs: cs ? (cs[j] ?? '') : (ex?.tags[j]?.cs ?? ''), en: en ? (en[j] ?? '') : (ex?.tags[j]?.en ?? '') });
        return { id: str(go.id) || randomId(), name: fill(go.name, ex?.name), tags: list };
      });
      if (!grouped && groups.length > 1) groups = [{ ...groups[0]!, name: emptyL(), tags: groups.flatMap((g) => g.tags) }];
      if (grouped) groups = listOp(groups, op, () => ({ id: randomId(), name: emptyL(), tags: [] }));
      return { body: coerceBody({ ...b, skills: { grouped, groups } }) };
    }
    case 'jazyky': {
      const items: Array<{ id: string; code: string; name: L10n; level: string }> = form.languages === undefined ? b.languages : arr(form.languages).map((x, i) => {
        const o = obj(x);
        const ex = byId(b.languages, o.id, i);
        return { id: str(o.id) || randomId(), code: keep(o, 'code', ex?.code, '', str), name: fill(o.name, ex?.name), level: keep(o, 'level', ex?.level as string | undefined, 'B2', str) };
      });
      const languages = listOp(items, op, () => ({ id: randomId(), code: 'en', name: emptyL(), level: 'B2' }));
      return { body: coerceBody({ ...b, languages }) };
    }
    case 'certifikaty': {
      const items = form.certifications === undefined ? b.certifications : arr(form.certifications).map((x, i) => {
        const o = obj(x);
        const ex = byId(b.certifications, o.id, i);
        const y = str(o.year).trim();
        return {
          id: str(o.id) || randomId(),
          name: fill(o.name, ex?.name),
          issuer: keep(o, 'issuer', ex?.issuer, '', str),
          year: 'year' in o ? (y ? Number(y) : null) : (ex?.year ?? null),
        };
      });
      const certifications = listOp(items, op, () => ({ id: randomId(), name: emptyL(), issuer: '', year: null }));
      return { body: coerceBody({ ...b, certifications }) };
    }
    case 'poradi': {
      let order = arr(form.order).map(str).filter((s): s is BodySectionKey => (BODY_SECTIONS as readonly string[]).includes(s));
      if (order.length !== BODY_SECTIONS.length) order = [...b.layout.order];
      if (op === 'preset:graduate') order = [...GRADUATE_ORDER];
      else if (op === 'preset:default') order = [...BODY_SECTIONS];
      else order = listOp(order, op && /^(up|down):/.test(op) ? op : null, () => 'about');
      const hiddenRaw = form.hidden === undefined ? [] : Array.isArray(form.hidden) ? form.hidden : [form.hidden];
      return { body: coerceBody({ ...b, layout: { order, hidden: hiddenRaw } }) };
    }
    case 'vzhled': {
      const design: Partial<CvDesign> = {};
      if (isTemplateId(form.template)) design.template = form.template;
      const hex = normalizeHex(str(form.accent));
      if (hex) design.accent = hex;
      if (op === 'cover:remove') design.cover = null;
      return { design };
    }
  }
  return {};
}
