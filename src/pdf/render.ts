import fontkit from '@pdf-lib/fontkit';
import {
  appendBezierCurve,
  clip,
  closePath,
  endPath,
  lineTo,
  moveTo,
  PDFDocument,
  PDFName,
  PDFString,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { TEMPLATES, type FontId } from '../config/templates';
import { TIERS } from '../config/tiers';
import { hexToRgb01, tint } from '../cv/color';
import { formatRange, languageName, LEVEL_LABELS, pick, SECTION_LABELS, UI } from '../cv/i18n';
import { displayUrl, pdfFilename } from '../cv/text';
import type { BodySectionKey, CvDoc, Lang, TemplateId } from '../cv/types';
import { FONT_DATA } from './font-data';

// CV-3: the PDF. A4, selectable text, embedded fonts with full Czech diacritics, reading
// order that follows the visual order (everything is drawn top to bottom in one column, so
// the content stream order is the reading order), clickable links, and small files.

const A4: [number, number] = [595.28, 841.89];

export interface PdfInput {
  doc: CvDoc;
  lang: Lang;
  fonts?: Record<FontId, ArrayBuffer | Uint8Array>;
  /** JPEG bytes of doc.profile.photo, already loaded. */
  photo?: Uint8Array | null;
  /** Defaults to "Kontakt is not hidden". */
  includeContact?: boolean;
  /** For the document dates; defaults to now. */
  date?: Date;
  /** Defaults to the tier's budget (CV-3 AC). */
  pageBudget?: number;
}

export interface PdfOutput {
  bytes: Uint8Array<ArrayBuffer>;
  pages: number;
  /** Index into PRESETS that was used (0 = most comfortable). */
  preset: number;
  /** False only if even the densest setting needs more pages than the budget. */
  fits: boolean;
  filename: string;
}

type Color = ReturnType<typeof rgb>;

interface Theme {
  header: 'centered' | 'left' | 'band';
  heading: 'rule' | 'caps' | 'bar';
  photo: 'square' | 'circle';
  nameSize: number;
  headingSize: number;
  marginX: number;
  marginTop: number;
  marginBottom: number;
}

const THEMES: Record<TemplateId, Theme> = {
  klasik: { header: 'centered', heading: 'rule', photo: 'square', nameSize: 24, headingSize: 12.5, marginX: 44, marginTop: 42, marginBottom: 40 },
  moderni: { header: 'left', heading: 'caps', photo: 'circle', nameSize: 23, headingSize: 9.6, marginX: 42, marginTop: 40, marginBottom: 40 },
  vyrazny: { header: 'band', heading: 'bar', photo: 'circle', nameSize: 24, headingSize: 12, marginX: 42, marginTop: 38, marginBottom: 40 },
};

/**
 * From comfortable to dense; a CV only gets denser when it would not fit its tier's page
 * budget. The densest keeps body text at 8.5 pt, the floor for a printed CV.
 */
export const PRESETS = [
  { body: 10, lead: 1.4, gap: 1 },
  { body: 9.6, lead: 1.34, gap: 0.86 },
  { body: 9.2, lead: 1.29, gap: 0.72 },
  { body: 8.8, lead: 1.25, gap: 0.6 },
  { body: 8.5, lead: 1.22, gap: 0.5 },
] as const;
type Preset = (typeof PRESETS)[number];

const COLORS = { text: '#1f2328', muted: '#5b636e', rule: '#d5dae0' };

// ---------- measuring and wrapping ----------

class Meter {
  private cache = new Map<PDFFont, Map<string, number>>();
  width(f: PDFFont, s: string, size: number): number {
    let m = this.cache.get(f);
    if (!m) this.cache.set(f, (m = new Map()));
    let w = m.get(s);
    if (w === undefined) {
      w = f.widthOfTextAtSize(s, 1000);
      m.set(s, w);
    }
    return (w * size) / 1000;
  }
}

/**
 * Words to wrap. Czech typography keeps one-letter prepositions and conjunctions
 * ("v", "s", "z", "k", "o", "u", "a", "i") off the end of a line, so they travel with the
 * next word. The space between them stays a normal space in the text.
 */
function tokens(text: string): string[] {
  const words = text.split(/ +/).filter(Boolean);
  const out: string[] = [];
  let carry = '';
  for (const w of words) {
    if (/^[vszkouaiVSZKOUAI]$/.test(w)) {
      carry = carry ? `${carry} ${w}` : w;
      continue;
    }
    out.push(carry ? `${carry} ${w}` : w);
    carry = '';
  }
  if (carry) out.push(carry);
  return out;
}

function wrap(meter: Meter, text: string, f: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  const space = meter.width(f, ' ', size);
  let line = '';
  let lineW = 0;
  for (const tok of tokens(text)) {
    const w = meter.width(f, tok, size);
    if (!line) {
      if (w <= width) {
        line = tok;
        lineW = w;
        continue;
      }
    } else if (lineW + space + w <= width) {
      line += ` ${tok}`;
      lineW += space + w;
      continue;
    } else {
      lines.push(line);
      line = '';
      lineW = 0;
      if (w <= width) {
        line = tok;
        lineW = w;
        continue;
      }
    }
    // A single token wider than the line (a long URL): break it by characters.
    let chunk = '';
    for (const ch of tok) {
      if (chunk && meter.width(f, chunk + ch, size) > width) {
        lines.push(chunk);
        chunk = ch;
      } else chunk += ch;
    }
    line = chunk;
    lineW = meter.width(f, chunk, size);
  }
  if (line) lines.push(line);
  return lines;
}

// ---------- boxes ----------

type Op =
  | { k: 'text'; x: number; y: number; s: string; f: PDFFont; size: number; c: Color }
  | { k: 'link'; x: number; y: number; w: number; h: number; url: string }
  | { k: 'rect'; x: number; y: number; w: number; h: number; c: Color }
  | { k: 'line'; x: number; y: number; w: number; t: number; c: Color }
  | { k: 'image'; x: number; y: number; w: number; h: number; img: PDFImage; circle: boolean };

/** An unbreakable piece of the flow. Op y values are relative to the box top (downwards). */
interface Box {
  h: number;
  before: number;
  ops: Op[];
  /** Keep on the same page as the next box (headings, entry headers). */
  keep?: boolean;
}

interface Run {
  s: string;
  f: PDFFont;
  c: Color;
  url?: string;
}

interface Ctx {
  meter: Meter;
  lang: Lang;
  p: Preset;
  theme: Theme;
  W: number;
  x0: number;
  fonts: { heading: PDFFont; body: PDFFont; strong: PDFFont };
  col: { text: Color; muted: Color; rule: Color; accent: Color; accentHex: string };
  size: { body: number; meta: number; small: number; heading: number };
  lh: number;
}

function textOp(ctx: Ctx, x: number, s: string, f: PDFFont, size: number, c: Color, lineH: number): Op {
  // Baseline: centre the x-height in the line box.
  return { k: 'text', x, y: (lineH - size) / 2 + size * 0.8, s, f, size, c };
}

function paragraph(ctx: Ctx, text: string, opts: { f?: PDFFont; c?: Color; size?: number; indent?: number; before?: number } = {}): Box[] {
  const f = opts.f ?? ctx.fonts.body;
  const size = opts.size ?? ctx.size.body;
  const c = opts.c ?? ctx.col.text;
  const indent = opts.indent ?? 0;
  const lh = size * ctx.p.lead;
  const boxes: Box[] = [];
  text.split('\n').forEach((para, pi) => {
    if (!para.trim()) return;
    wrap(ctx.meter, para.trim(), f, size, ctx.W - indent).forEach((line, li) => {
      boxes.push({
        h: lh,
        before: li === 0 ? (pi === 0 ? (opts.before ?? 0) : lh * 0.35) : 0,
        ops: [textOp(ctx, ctx.x0 + indent, line, f, size, c, lh)],
      });
    });
  });
  return boxes;
}

function bullets(ctx: Ctx, items: string[], before: number): Box[] {
  const out: Box[] = [];
  const indent = ctx.size.body * 1.05;
  items.forEach((item, i) => {
    const lines = wrap(ctx.meter, item, ctx.fonts.body, ctx.size.body, ctx.W - indent);
    lines.forEach((line, li) => {
      const ops: Op[] = [textOp(ctx, ctx.x0 + indent, line, ctx.fonts.body, ctx.size.body, ctx.col.text, ctx.lh)];
      if (li === 0) ops.unshift(textOp(ctx, ctx.x0 + ctx.size.body * 0.15, '•', ctx.fonts.body, ctx.size.body, ctx.col.accent, ctx.lh));
      out.push({ h: ctx.lh, before: li === 0 ? (i === 0 ? before : ctx.lh * 0.12) : 0, ops });
    });
  });
  return out;
}

/** Inline items separated by " · ", wrapping between items. */
function inline(ctx: Ctx, items: Run[][], opts: { size?: number; align?: 'left' | 'center'; color?: Color; before?: number; width?: number; x0?: number } = {}): Box[] {
  const size = opts.size ?? ctx.size.body;
  const lh = size * ctx.p.lead;
  const width = opts.width ?? ctx.W;
  const x0 = opts.x0 ?? ctx.x0;
  const sep: Run = { s: '  ·  ', f: ctx.fonts.body, c: opts.color ?? ctx.col.muted };
  const runW = (r: Run) => ctx.meter.width(r.f, r.s, size);
  const itemW = (it: Run[]) => it.reduce((n, r) => n + runW(r), 0);

  // Items wider than a line are split into word runs so they can wrap.
  const flat: Run[][] = [];
  for (const it of items) {
    if (itemW(it) <= width) flat.push(it);
    else for (const r of it) for (const w of wrap(ctx.meter, r.s, r.f, size, width)) flat.push([{ ...r, s: w }]);
  }

  const lines: Run[][] = [];
  let line: Run[] = [];
  let lineW = 0;
  for (const it of flat) {
    const w = itemW(it);
    const add = line.length ? runW(sep) + w : w;
    if (line.length && lineW + add > width) {
      lines.push(line);
      line = [];
      lineW = 0;
    }
    if (line.length) {
      line.push(sep);
      lineW += runW(sep);
    }
    line.push(...it);
    lineW += w;
  }
  if (line.length) lines.push(line);

  return lines.map((runs, i) => {
    const total = runs.reduce((n, r) => n + runW(r), 0);
    let x = opts.align === 'center' ? x0 + (width - total) / 2 : x0;
    const ops: Op[] = [];
    for (const r of runs) {
      const w = runW(r);
      ops.push(textOp(ctx, x, r.s, r.f, size, r.c, lh));
      if (r.url) ops.push({ k: 'link', x, y: 0, w, h: lh, url: r.url });
      x += w;
    }
    return { h: lh, before: i === 0 ? (opts.before ?? 0) : 0, ops };
  });
}

/** An entry header: bold title (+ regular subtitle) on the left, a date on the right. */
function entryHeader(ctx: Ctx, title: string, subtitle: string, right: string, before: number, rightUrl?: string): Box[] {
  const { body: size } = ctx.size;
  const lh = ctx.lh;
  const m = ctx.meter;
  const rightF = ctx.fonts.body;
  const rightC = rightUrl ? ctx.col.accent : ctx.col.muted;
  const rightW = right ? m.width(rightF, right, ctx.size.meta) : 0;
  const gap = right ? size * 1.2 : 0;
  const sub = subtitle ? `  ·  ${subtitle}` : '';
  const oneLine = m.width(ctx.fonts.strong, title, size) + (sub ? m.width(ctx.fonts.body, sub, size) : 0) + gap + rightW <= ctx.W;
  const rightOps = (): Op[] => {
    if (!right) return [];
    const x = ctx.x0 + ctx.W - rightW;
    const ops: Op[] = [textOp(ctx, x, right, rightF, ctx.size.meta, rightC, lh)];
    if (rightUrl) ops.push({ k: 'link', x, y: 0, w: rightW, h: lh, url: rightUrl });
    return ops;
  };
  if (oneLine) {
    const ops: Op[] = [textOp(ctx, ctx.x0, title, ctx.fonts.strong, size, ctx.col.text, lh)];
    if (sub) ops.push(textOp(ctx, ctx.x0 + m.width(ctx.fonts.strong, title, size), sub, ctx.fonts.body, size, ctx.col.muted, lh));
    return [{ h: lh, before, ops: [...ops, ...rightOps()], keep: true }];
  }
  const boxes: Box[] = [];
  wrap(m, title, ctx.fonts.strong, size, ctx.W - gap - rightW).forEach((line, i) => {
    const ops: Op[] = [textOp(ctx, ctx.x0, line, ctx.fonts.strong, size, ctx.col.text, lh)];
    boxes.push({ h: lh, before: i === 0 ? before : 0, ops: i === 0 ? [...ops, ...rightOps()] : ops, keep: true });
  });
  if (subtitle) {
    for (const line of wrap(m, subtitle, ctx.fonts.body, size, ctx.W)) {
      boxes.push({ h: lh, before: 0, ops: [textOp(ctx, ctx.x0, line, ctx.fonts.body, size, ctx.col.muted, lh)], keep: true });
    }
  }
  return boxes;
}

function heading(ctx: Ctx, label: string, first: boolean): Box[] {
  const t = ctx.theme;
  const size = ctx.size.heading;
  const lh = size * 1.35;
  const before = first ? 0 : 15 * ctx.p.gap + 4;
  const text = t.heading === 'caps' ? label.toLocaleUpperCase(ctx.lang) : label;
  const color = t.heading === 'bar' ? ctx.col.text : ctx.col.accent;
  const ops: Op[] = [];
  let x = ctx.x0;
  if (t.heading === 'bar') {
    ops.push({ k: 'rect', x, y: lh * 0.2, w: size * 0.42, h: lh * 0.6, c: ctx.col.accent });
    x += size * 0.85;
  }
  ops.push(textOp(ctx, x, text, ctx.fonts.heading, size, color, lh));
  let h = lh;
  if (t.heading === 'rule' || t.heading === 'caps') {
    ops.push({ k: 'line', x: ctx.x0, y: lh + 1.5, w: ctx.W, t: t.heading === 'rule' ? 0.8 : 0.6, c: t.heading === 'rule' ? ctx.col.accent : ctx.col.rule });
    h += 3;
  }
  return [{ h: h + 4 * ctx.p.gap, before, ops, keep: true }];
}

// ---------- sections ----------

function sectionBoxes(ctx: Ctx, doc: CvDoc, key: BodySectionKey): Box[] {
  const { lang } = ctx;
  const b = doc.body;
  const entryGap = 7 * ctx.p.gap;
  const out: Box[] = [];
  switch (key) {
    case 'about':
      return paragraph(ctx, pick(b.about, lang));
    case 'interests':
      return paragraph(ctx, pick(b.interests, lang));
    case 'experience':
      b.experience.forEach((e, i) => {
        out.push(...entryHeader(ctx, pick(e.role, lang), e.employer, formatRange(e.from, e.to, lang), i === 0 ? 0 : entryGap));
        out.push(...bullets(ctx, e.bullets.map((t) => pick(t, lang)).filter(Boolean), ctx.lh * 0.1));
      });
      return out;
    case 'education':
      b.education.forEach((e, i) => {
        out.push(...entryHeader(ctx, pick(e.school, lang), pick(e.field, lang), formatRange(e.from, e.to, lang), i === 0 ? 0 : entryGap));
        out.push(...bullets(ctx, e.bullets.map((t) => pick(t, lang)).filter(Boolean), ctx.lh * 0.1));
      });
      return out;
    case 'projects':
      b.projects.forEach((p, i) => {
        const url = p.url ? displayUrl(p.url) : '';
        const title = pick(p.title, lang);
        const fits = url && ctx.meter.width(ctx.fonts.strong, title, ctx.size.body) + ctx.meter.width(ctx.fonts.body, url, ctx.size.meta) + ctx.size.body * 1.5 <= ctx.W;
        out.push(...entryHeader(ctx, title, '', fits ? url : '', i === 0 ? 0 : entryGap, fits ? p.url : undefined));
        out.push(...paragraph(ctx, pick(p.text, lang)));
        if (url && !fits) {
          out.push(...inline(ctx, [[{ s: url, f: ctx.fonts.body, c: ctx.col.accent, url: p.url }]], { size: ctx.size.meta }));
        }
      });
      return out;
    case 'skills': {
      const groups = b.skills.groups.filter((g) => g.tags.length);
      if (b.skills.grouped) {
        groups.forEach((g, i) => {
          const name = pick(g.name, lang);
          const items: Run[][] = g.tags.map((t, j) => {
            const run: Run = { s: pick(t, lang), f: ctx.fonts.body, c: ctx.col.text };
            return j === 0 && name ? [{ s: `${name}: `, f: ctx.fonts.strong, c: ctx.col.text }, run] : [run];
          });
          out.push(...inline(ctx, items, { before: i === 0 ? 0 : ctx.lh * 0.25 }));
        });
        return out;
      }
      const all = groups.flatMap((g) => g.tags).map((t): Run[] => [{ s: pick(t, lang), f: ctx.fonts.body, c: ctx.col.text }]);
      return inline(ctx, all);
    }
    case 'languages':
      return inline(
        ctx,
        b.languages.map((l): Run[] => [
          { s: `${languageName(l.code, l.name, lang)} `, f: ctx.fonts.strong, c: ctx.col.text },
          { s: LEVEL_LABELS[l.level][lang], f: ctx.fonts.body, c: ctx.col.muted },
        ]),
      );
    case 'certifications':
      b.certifications.forEach((c, i) => {
        out.push(...entryHeader(ctx, pick(c.name, lang), c.issuer, c.year ? String(c.year) : '', i === 0 ? 0 : ctx.lh * 0.2));
        out[out.length - 1]!.keep = false;
      });
      return out;
  }
}

function hasContent(doc: CvDoc, key: BodySectionKey, lang: Lang): boolean {
  const b = doc.body;
  switch (key) {
    case 'about':
      return !!pick(b.about, lang);
    case 'interests':
      return !!pick(b.interests, lang);
    case 'skills':
      return b.skills.groups.some((g) => g.tags.length);
    default:
      return b[key].length > 0;
  }
}

export function visibleSections(doc: CvDoc, lang: Lang): BodySectionKey[] {
  return doc.body.layout.order.filter((k) => !doc.body.layout.hidden.includes(k) && hasContent(doc, k, lang));
}

// ---------- header (page 1) ----------

interface Header {
  ops: Op[]; // absolute, top-based page coordinates
  bottom: number;
}

function header(ctx: Ctx, doc: CvDoc, includeContact: boolean, photo: PDFImage | null, pageW: number): Header {
  const { lang, theme: t, meter: m } = ctx;
  const p = doc.profile;
  const ops: Op[] = [];
  const nameSize = t.nameSize * (0.9 + 0.1 * (ctx.p.body / 10));
  const headlineSize = ctx.size.body * 1.12;
  const metaSize = ctx.size.meta;
  const onBand = t.header === 'band';
  const white = rgb(1, 1, 1);
  const bandMuted = rgb(0.93, 0.95, 0.97);

  const meta: Run[][] = [];
  const metaC = onBand ? bandMuted : ctx.col.muted;
  const location = pick(p.location, lang);
  if (location) meta.push([{ s: location, f: ctx.fonts.body, c: metaC }]);
  if (includeContact && p.email) meta.push([{ s: p.email, f: ctx.fonts.body, c: onBand ? white : ctx.col.text, url: `mailto:${p.email}` }]);
  if (includeContact && p.phone) meta.push([{ s: p.phone, f: ctx.fonts.body, c: onBand ? white : ctx.col.text, url: `tel:${p.phone.replace(/[^\d+]/g, '')}` }]);
  for (const l of p.links) {
    if (!l.url) continue;
    meta.push([{ s: l.kind === 'other' && l.label ? `${l.label}: ${displayUrl(l.url)}` : displayUrl(l.url), f: ctx.fonts.body, c: onBand ? white : ctx.col.accent, url: l.url }]);
  }

  const photoSize = t.header === 'centered' ? 64 : 70;
  const top = t.marginTop;
  let y = top;

  const place = (boxes: Box[], at: number): number => {
    let yy = at;
    for (const b of boxes) {
      yy += b.before;
      for (const op of b.ops) ops.push({ ...op, y: op.y + yy });
      yy += b.h;
    }
    return yy;
  };
  const line = (s: string, f: PDFFont, size: number, c: Color, x: number, width: number, align: 'left' | 'center', lead = 1.2): Box[] => {
    return wrap(m, s, f, size, width).map((ln) => {
      const lh = size * lead;
      const w = m.width(f, ln, size);
      return { h: lh, before: 0, ops: [textOp(ctx, align === 'center' ? x + (width - w) / 2 : x, ln, f, size, c, lh)] };
    });
  };

  if (t.header === 'centered') {
    if (photo) {
      ops.push({ k: 'image', x: ctx.x0 + (ctx.W - photoSize) / 2, y, w: photoSize, h: photoSize, img: photo, circle: false });
      y += photoSize + 10;
    }
    y = place(line(p.name, ctx.fonts.heading, nameSize, ctx.col.text, ctx.x0, ctx.W, 'center'), y);
    const headline = pick(p.headline, lang);
    if (headline) y = place(line(headline, ctx.fonts.body, headlineSize, ctx.col.muted, ctx.x0, ctx.W, 'center'), y + 2);
    if (meta.length) y = place(inline(ctx, meta, { size: metaSize, align: 'center' }), y + 5);
    y += 8;
    ops.push({ k: 'line', x: ctx.x0, y, w: ctx.W, t: 0.8, c: ctx.col.accent });
    return { ops, bottom: y + 14 * ctx.p.gap + 4 };
  }

  const textW = photo ? ctx.W - photoSize - 16 : ctx.W;
  let bandBottom = 0;
  if (onBand) {
    // Measure first so the band fits its content.
    let yy = top;
    const measure = (boxes: Box[], at: number) => boxes.reduce((acc, b) => acc + b.before + b.h, at);
    yy = measure(line(p.name, ctx.fonts.heading, nameSize, white, ctx.x0, textW, 'left'), yy);
    const headline = pick(p.headline, lang);
    if (headline) yy = measure(line(headline, ctx.fonts.body, headlineSize, white, ctx.x0, textW, 'left'), yy + 2);
    if (meta.length) yy = measure(inline(ctx, meta, { size: metaSize, width: textW }), yy + 6);
    bandBottom = Math.max(yy, top + (photo ? photoSize : 0)) + 24;
    ops.push({ k: 'rect', x: 0, y: 0, w: pageW, h: bandBottom, c: ctx.col.accent });
  }
  const nameC = onBand ? white : ctx.col.text;
  y = place(line(p.name, ctx.fonts.heading, nameSize, nameC, ctx.x0, textW, 'left'), y);
  const headline = pick(p.headline, lang);
  if (headline) y = place(line(headline, ctx.fonts.body, headlineSize, onBand ? white : ctx.col.accent, ctx.x0, textW, 'left'), y + 2);
  if (meta.length) y = place(inline(ctx, meta, { size: metaSize, width: textW }), y + 6);
  if (photo) {
    ops.push({ k: 'image', x: ctx.x0 + ctx.W - photoSize, y: top, w: photoSize, h: photoSize, img: photo, circle: t.photo === 'circle' });
    y = Math.max(y, top + photoSize);
  }
  if (onBand) return { ops, bottom: bandBottom + 22 * ctx.p.gap + 4 };
  y += 10;
  ops.push({ k: 'line', x: ctx.x0, y, w: ctx.W, t: 1.4, c: ctx.col.accent });
  return { ops, bottom: y + 14 * ctx.p.gap + 4 };
}

// ---------- pagination and drawing ----------

interface Placed {
  op: Op;
  page: number;
  top: number; // absolute top-based y of the op
}

function paginate(boxes: Box[], firstTop: number, top: number, bottom: number): { placed: Placed[]; pages: number; lastFill: number } {
  const placed: Placed[] = [];
  let page = 0;
  let y = firstTop;
  const startY = () => (page === 0 ? firstTop : top);
  let i = 0;
  while (i < boxes.length) {
    // A chain of boxes that keep with the next one, plus the one they lead into.
    let j = i;
    while (j < boxes.length - 1 && boxes[j]!.keep && j - i < 4) j++;
    const chain = boxes.slice(i, j + 1);
    const chainH = chain.reduce((n, b, k) => n + (k === 0 && y === startY() ? 0 : b.before) + b.h, 0);
    if (y > startY() && y + chainH > bottom) {
      page++;
      y = top;
    }
    for (const b of chain) {
      const before = y === startY() ? 0 : b.before;
      if (y > startY() && y + before + b.h > bottom) {
        page++;
        y = top;
      }
      const at = y === startY() ? y : y + before;
      for (const op of b.ops) placed.push({ op, page, top: at + op.y });
      y = at + b.h;
    }
    i = j + 1;
  }
  const start = page === 0 ? firstTop : top;
  return { placed, pages: page + 1, lastFill: (y - start) / (bottom - start) };
}

function circlePath(cx: number, cy: number, r: number) {
  const k = 0.5522847498 * r;
  return [
    moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + k, cx + k, cy + r, cx, cy + r),
    appendBezierCurve(cx - k, cy + r, cx - r, cy + k, cx - r, cy),
    appendBezierCurve(cx - r, cy - k, cx - k, cy - r, cx, cy - r),
    appendBezierCurve(cx + k, cy - r, cx + r, cy - k, cx + r, cy),
    closePath(),
  ];
}

function draw(pdf: PDFDocument, page: PDFPage, op: Op, top: number, pageH: number): void {
  switch (op.k) {
    case 'text':
      page.drawText(op.s, { x: op.x, y: pageH - top, size: op.size, font: op.f, color: op.c });
      return;
    case 'rect':
      page.drawRectangle({ x: op.x, y: pageH - top - op.h, width: op.w, height: op.h, color: op.c });
      return;
    case 'line':
      page.drawLine({ start: { x: op.x, y: pageH - top }, end: { x: op.x + op.w, y: pageH - top }, thickness: op.t, color: op.c });
      return;
    case 'image': {
      const y = pageH - top - op.h;
      // Fill the frame: crop the longer side of the photo.
      const ratio = op.img.width / op.img.height;
      let w = op.w;
      let h = op.h;
      if (ratio > 1) w = op.h * ratio;
      else h = op.w / ratio;
      const x = op.x - (w - op.w) / 2;
      const yy = y - (h - op.h) / 2;
      page.pushOperators(pushGraphicsState());
      if (op.circle) page.pushOperators(...circlePath(op.x + op.w / 2, y + op.h / 2, op.w / 2), clip(), endPath());
      else page.pushOperators(moveTo(op.x, y), lineTo(op.x + op.w, y), lineTo(op.x + op.w, y + op.h), lineTo(op.x, y + op.h), closePath(), clip(), endPath());
      page.drawImage(op.img, { x, y: yy, width: w, height: h });
      page.pushOperators(popGraphicsState());
      return;
    }
    case 'link': {
      const y1 = pageH - top - op.h;
      const annot = pdf.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [op.x, y1, op.x + op.w, y1 + op.h],
        Border: [0, 0, 0],
        A: { Type: 'Action', S: 'URI', URI: PDFString.of(op.url) },
      });
      page.node.addAnnot(pdf.context.register(annot));
      return;
    }
  }
}

// ---------- entry point ----------

function subsetName(id: FontId): string {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let tag = '';
  for (let i = 0; i < 6; i++) {
    tag += String.fromCharCode(65 + (h % 26));
    h = Math.floor(h / 26) + i * 7;
  }
  const name = id.replace(/-(\d+)$/, '').split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return `${tag}+${name}-${id.endsWith('700') ? 'Bold' : id.endsWith('600') ? 'SemiBold' : 'Regular'}`;
}

export async function renderPdf(input: PdfInput): Promise<PdfOutput> {
  const { doc, lang } = input;
  const tpl = TEMPLATES[doc.design.template] ?? TEMPLATES.moderni;
  const theme = THEMES[tpl.id];
  const fonts = input.fonts ?? FONT_DATA;
  const includeContact = input.includeContact ?? !doc.body.layout.hidden.includes('contact');
  const budget = input.pageBudget ?? TIERS[doc.tier].pdfPageBudget;
  const date = input.date ?? new Date();

  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Subset fonts are named "ABCDEF+Name" (PDF 32000 §9.6.4) so tools can tell they are subsets.
  const embed = (id: FontId) => pdf.embedFont(fonts[id], { subset: true, features: { liga: false }, customName: subsetName(id) });
  const [headingF, bodyF, strongF] = await Promise.all([embed(tpl.fonts.heading), embed(tpl.fonts.body), embed(tpl.fonts.bodyStrong)]);
  const photo = input.photo && doc.profile.photo ? await pdf.embedJpg(input.photo) : null;

  const accentHex = doc.design.accent;
  const c = (hex: string) => rgb(...hexToRgb01(hex));
  const meter = new Meter();
  const [pageW, pageH] = A4;

  const build = (preset: Preset) => {
    const ctx: Ctx = {
      meter,
      lang,
      p: preset,
      theme,
      W: pageW - theme.marginX * 2,
      x0: theme.marginX,
      fonts: { heading: headingF, body: bodyF, strong: strongF },
      col: { text: c(COLORS.text), muted: c(COLORS.muted), rule: c(tint(accentHex, 0.8)), accent: c(accentHex), accentHex },
      size: { body: preset.body, meta: preset.body * 0.93, small: preset.body * 0.85, heading: theme.headingSize * (0.88 + 0.12 * (preset.body / 10)) },
      lh: preset.body * preset.lead,
    };
    if (theme.heading === 'caps') ctx.col.rule = c(COLORS.rule);
    const head = header(ctx, doc, includeContact, photo, pageW);
    const boxes: Box[] = [];
    visibleSections(doc, lang).forEach((key, i) => {
      boxes.push(...heading(ctx, SECTION_LABELS[key][lang], i === 0));
      boxes.push(...sectionBoxes(ctx, doc, key));
    });
    const flow = paginate(boxes, head.bottom, theme.marginTop, pageH - theme.marginBottom);
    return { ctx, head, flow };
  };

  let chosen = 0;
  let result = build(PRESETS[0]);
  while (result.flow.pages > budget && chosen < PRESETS.length - 1) {
    chosen++;
    result = build(PRESETS[chosen]!);
  }
  // Avoid a nearly empty last page when a slightly denser setting (still ≥ 9.2 pt) saves it.
  if (result.flow.pages > 1 && result.flow.lastFill < 0.25) {
    for (let k = chosen + 1; k <= 2; k++) {
      const tighter = build(PRESETS[k]!);
      if (tighter.flow.pages < result.flow.pages) {
        chosen = k;
        result = tighter;
        break;
      }
    }
  }

  const { ctx, head, flow } = result;
  const pages: PDFPage[] = [];
  for (let i = 0; i < flow.pages; i++) pages.push(pdf.addPage(A4));
  for (const op of head.ops) draw(pdf, pages[0]!, op, op.y, pageH);
  for (const pl of flow.placed) draw(pdf, pages[pl.page]!, pl.op, pl.top, pageH);
  if (flow.pages > 1) {
    pages.forEach((page, i) => {
      const s = `${i + 1} / ${flow.pages}`;
      const size = ctx.size.small;
      const w = meter.width(bodyF, s, size);
      page.drawText(s, { x: pageW - theme.marginX - w, y: theme.marginBottom / 2, size, font: bodyF, color: ctx.col.muted });
    });
  }

  const name = doc.profile.name || 'CV';
  const headline = pick(doc.profile.headline, lang);
  pdf.setTitle(`${name} – ${UI[lang]!.cvTitle}`, { showInWindowTitleBar: true });
  pdf.setAuthor(name);
  if (headline) pdf.setSubject(headline);
  pdf.setCreator('Pulzar CV');
  pdf.setProducer('Pulzar CV');
  pdf.setLanguage(lang === 'cs' ? 'cs-CZ' : 'en');
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);
  pdf.catalog.set(PDFName.of('PageLayout'), PDFName.of('OneColumn'));

  // pdf-lib returns a fresh buffer.
  const bytes = (await pdf.save({ useObjectStreams: true })) as Uint8Array<ArrayBuffer>;
  return { bytes, pages: flow.pages, preset: chosen, fits: flow.pages <= budget, filename: pdfFilename(name, lang) };
}
