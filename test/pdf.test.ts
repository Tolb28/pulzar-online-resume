import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_IDS } from '../src/config/templates';
import { TIERS } from '../src/config/tiers';
import { pick, SECTION_LABELS } from '../src/cv/i18n';
import type { CvDoc, Lang, TierId } from '../src/cv/types';
import { renderPdf, visibleSections } from '../src/pdf/render';
import { maxDoc, realisticDoc } from './fixtures/docs';

const PHOTO = new Uint8Array(readFileSync(join(__dirname, 'fixtures/photo.jpg')));
const dir = mkdtempSync(join(tmpdir(), 'cvpdf-'));

function pdftotext(bytes: Uint8Array, name: string): string {
  const file = join(dir, name);
  writeFileSync(file, bytes);
  return execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { encoding: 'utf8' });
}
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Every visible section's heading appears in order, and its content sits between its heading and the next. */
function expectReadingOrder(text: string, doc: CvDoc, lang: Lang) {
  const t = flat(text).toLocaleLowerCase(lang);
  const find = (needle: string, from: number) => t.indexOf(flat(needle).toLocaleLowerCase(lang), from);
  let pos = find(doc.profile.name, 0);
  expect(pos, 'name').toBeGreaterThanOrEqual(0);
  const sections = visibleSections(doc, lang);
  const starts = sections.map((key) => {
    const at = find(SECTION_LABELS[key][lang], pos);
    expect(at, `heading ${key}`).toBeGreaterThan(pos);
    pos = at;
    return at;
  });
  sections.forEach((key, i) => {
    const start = starts[i]!;
    const end = starts[i + 1] ?? t.length;
    const samples: string[] = [];
    const b = doc.body;
    if (key === 'about') samples.push(pick(b.about, lang));
    if (key === 'interests') samples.push(pick(b.interests, lang));
    if (key === 'experience') b.experience.forEach((e) => samples.push(pick(e.role, lang), e.employer, ...e.bullets.map((x) => pick(x, lang))));
    if (key === 'education') b.education.forEach((e) => samples.push(pick(e.school, lang), ...e.bullets.map((x) => pick(x, lang))));
    if (key === 'projects') b.projects.forEach((p) => samples.push(pick(p.title, lang), pick(p.text, lang)));
    if (key === 'certifications') b.certifications.forEach((c) => samples.push(pick(c.name, lang)));
    let last = start;
    for (const s of samples.filter(Boolean)) {
      // Long texts wrap over lines; check a prefix that fits on one line.
      const at = find(s.slice(0, 40), last);
      expect(at, `${key}: "${s.slice(0, 40)}"`).toBeGreaterThan(start);
      expect(at, `${key} content stays in its section`).toBeLessThan(end);
      last = at;
    }
  });
}

describe('CV-3 PDF', () => {
  it('extracts in reading order with Czech diacritics intact (ATS check)', async () => {
    for (const template of TEMPLATE_IDS) {
      for (const lang of ['cs', 'en'] as Lang[]) {
        const doc = realisticDoc({ template, photo: true });
        const out = await renderPdf({ doc, lang, photo: PHOTO });
        const text = pdftotext(out.bytes, `real-${template}-${lang}.pdf`);
        expectReadingOrder(text, doc, lang);
        if (lang === 'cs') {
          expect(text).toContain('Jana Nováková');
          expect(text).toContain('Produktová designérka');
          expect(flat(text)).toContain('Vysoká škola uměleckoprůmyslová v Praze');
          expect(flat(text)).toContain('03/2021 – dosud');
        } else {
          expect(flat(text)).toContain('03/2021 – present');
        }
        expect(text).toContain('jana.novakova@example.cz');
      }
    }
  });

  it('keeps a graduate order (Vzdělání first) in the PDF', async () => {
    const doc = realisticDoc({});
    doc.body.layout.order = ['education', 'projects', 'about', 'experience', 'skills', 'languages', 'certifications', 'interests'];
    doc.body.layout.hidden = ['interests'];
    const out = await renderPdf({ doc, lang: 'cs' });
    const text = pdftotext(out.bytes, 'graduate.pdf');
    expectReadingOrder(text, doc, 'cs');
    expect(flat(text)).not.toContain('Lezení, keramika');
  });

  describe.each(['zaklad', 'profi'] as TierId[])('content at every maximum limit – %s', (tier) => {
    it.each(TEMPLATE_IDS)(`fits the page budget in %s`, async (template) => {
      const budget = TIERS[tier].pdfPageBudget;
      for (const lang of ['cs', 'en'] as Lang[]) {
        const doc = maxDoc(tier, lang, template);
        const out = await renderPdf({ doc, lang, photo: PHOTO });
        expect(out.pages, `${tier}/${template}/${lang}`).toBeLessThanOrEqual(budget);
        expect(out.fits).toBe(true);
        expect(out.bytes.length, 'file size with a photo').toBeLessThanOrEqual(500 * 1024);
        expectReadingOrder(pdftotext(out.bytes, `max-${tier}-${template}-${lang}.pdf`), doc, lang);
      }
    });
  });

  it('embeds subset fonts and uses no standard 14 fonts', async () => {
    const out = await renderPdf({ doc: realisticDoc({ template: 'klasik' }), lang: 'cs' });
    const file = join(dir, 'fonts.pdf');
    writeFileSync(file, out.bytes);
    const fonts = execFileSync('pdffonts', [file], { encoding: 'utf8' }).trim().split('\n').slice(2);
    expect(fonts.length).toBeGreaterThanOrEqual(2);
    for (const line of fonts) {
      const cols = line.trim().split(/\s+/);
      // name type encoding emb sub uni ...: embedded, subset and with a ToUnicode map
      expect(line).toMatch(/\+/); // subset prefix ABCDEF+Name
      expect(cols.slice(-5, -2)).toEqual(['yes', 'yes', 'yes']);
    }
  });

  it('has clickable links, metadata and the language set', async () => {
    const doc = realisticDoc({});
    const out = await renderPdf({ doc, lang: 'cs', date: new Date('2026-11-24T10:00:00Z') });
    const pdf = await PDFDocument.load(out.bytes);
    const uris: string[] = [];
    for (const page of pdf.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      for (let i = 0; i < (annots?.size() ?? 0); i++) {
        const a = annots!.lookup(i, PDFDict);
        const action = a.lookup(PDFName.of('A'), PDFDict);
        uris.push((action.lookup(PDFName.of('URI')) as PDFString).decodeText());
      }
    }
    expect(uris).toEqual(
      expect.arrayContaining([
        'mailto:jana.novakova@example.cz',
        'tel:+420777123456',
        'https://www.linkedin.com/in/jana-novakova',
        'https://jananovakova.cz/pristupnost',
      ]),
    );
    expect(pdf.getTitle()).toBe('Jana Nováková – Životopis');
    expect(pdf.getAuthor()).toBe('Jana Nováková');
    expect(pdf.catalog.get(PDFName.of('Lang'))?.toString()).toContain('cs-CZ');
    expect(pdf.getPage(0).getSize().width).toBeCloseTo(595.28, 1);
    expect(pdf.getPage(0).getSize().height).toBeCloseTo(841.89, 1);
  });

  it('leaves out contact details when Kontakt is hidden', async () => {
    const doc = realisticDoc({});
    doc.body.layout.hidden = ['contact'];
    const text = pdftotext((await renderPdf({ doc, lang: 'cs' })).bytes, 'nocontact.pdf');
    expect(text).not.toContain('jana.novakova@example.cz');
    expect(text).not.toContain('777 123 456');
  });

  it('names the file after the holder (CV-3)', async () => {
    const doc = realisticDoc({});
    expect((await renderPdf({ doc, lang: 'cs' })).filename).toBe('Jana-Novakova-CV.pdf');
    expect((await renderPdf({ doc, lang: 'en' })).filename).toBe('Jana-Novakova-CV-EN.pdf');
  });

  it('renders a one-page CV for typical content at the comfortable setting', async () => {
    const out = await renderPdf({ doc: realisticDoc({ photo: true }), lang: 'cs', photo: PHOTO });
    expect(out.pages).toBe(1);
    expect(out.preset).toBe(0);
  });
});

describe('CV-3 PDF layout polish', () => {
  it('does not leave a nearly empty last page for short CVs in any template', async () => {
    for (const template of TEMPLATE_IDS) {
      const out = await renderPdf({ doc: realisticDoc({ template, photo: true }), lang: 'cs', photo: PHOTO });
      expect(out.pages, template).toBe(1);
      expect(out.preset, template).toBeLessThanOrEqual(2);
    }
  });
});

describe('CV-3 file size, worst case', () => {
  it('stays within 500 kB with the largest photo the server accepts (300 kB) and every limit at its maximum', async () => {
    const { MEDIA_LIMITS } = await import('../src/platform/media');
    const target = MEDIA_LIMITS.photo.maxBytes;
    // Pad the fixture JPEG with comment segments (pdf-lib embeds JPEG bytes as they are).
    const parts: number[] = [...PHOTO.subarray(0, 2)];
    let size = PHOTO.length;
    while (size < target) {
      const len = Math.min(65533, target - size - 4);
      if (len < 1) break;
      parts.push(0xff, 0xfe, ((len + 2) >> 8) & 255, (len + 2) & 255, ...new Array(len).fill(0x20));
      size += len + 4;
    }
    const big = new Uint8Array([...parts, ...PHOTO.subarray(2)]);
    expect(big.length).toBeGreaterThan(target - 8);
    for (const template of TEMPLATE_IDS) {
      const out = await renderPdf({ doc: maxDoc('profi', 'cs', template), lang: 'cs', photo: big });
      expect(out.bytes.length, template).toBeLessThanOrEqual(500 * 1024);
    }
  });
});
