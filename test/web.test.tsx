import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_IDS } from '../src/config/templates';
import type { CvDoc, Lang, Visibility } from '../src/cv/types';
import { CvPage, InactivePage, PinPage } from '../src/web/page';
// @ts-expect-error – plain ESM build script
import { buildClient } from '../scripts/build-client.mjs';
import { maxDoc, realisticDoc } from './fixtures/docs';

function render(doc: CvDoc, opts: { lang?: Lang; visibility?: Visibility; preview?: boolean; basePath?: string } = {}): string {
  return (
    '<!doctype html>' +
    (
      <CvPage
        doc={doc}
        lang={opts.lang ?? 'cs'}
        basePath={opts.basePath ?? '/jana-novakova'}
        origin="https://cv.pulzarstudio.cz"
        visibility={opts.visibility ?? 'link'}
        siteKey="1x00000000000000000000AA"
        hasPdf
        salesUrl="https://pulzarstudio.cz/zivotopis/"
        nonce="n0nce"
        mediaUrl={(k) => `/media/${k}`}
        publishedAt={Date.UTC(2026, 10, 24)}
        preview={opts.preview}
      />
    ).toString()
  );
}

describe('CV-4 contact details hidden from bots', () => {
  it('never puts the e-mail or phone into the page HTML, in any template or language', () => {
    for (const template of TEMPLATE_IDS) {
      for (const lang of ['cs', 'en'] as Lang[]) {
        for (const visibility of ['link', 'public'] as Visibility[]) {
          const doc = realisticDoc({ template, photo: true });
          const html = render(doc, { lang, visibility });
          expect(html).not.toContain('jana.novakova@example.cz');
          expect(html).not.toContain('example.cz"');
          expect(html.replace(/\s/g, '')).not.toContain('777123456');
          expect(html).not.toMatch(/mailto:|tel:/);
          expect(html).toContain('data-act="contact"');
          expect(html).toContain('data-act="pdf"');
        }
      }
    }
  });

  it('also holds for content at every maximum', () => {
    const doc = maxDoc('profi', 'cs');
    const html = render(doc, { visibility: 'public' });
    expect(html).not.toContain(doc.profile.email);
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('loads only the small reveal script, and no third-party script until a click', () => {
    const html = render(realisticDoc({}));
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((m) => m[1]);
    expect(scripts).toEqual([' src="/static/reveal.js" defer=""']);
    expect(html).not.toContain('challenges.cloudflare.com');
  });

  it('keeps the reveal script within 3 kB, and the built file is up to date', async () => {
    const built = (await buildClient(false)) as Record<string, string>;
    const shipped = readFileSync(join(__dirname, '../public/static/reveal.js'), 'utf8');
    expect(Buffer.byteLength(shipped)).toBeLessThanOrEqual(3 * 1024);
    expect(shipped).toBe(built.reveal);
  });

  it('shows no contact button when Kontakt is hidden, and no script when nothing needs it', () => {
    const doc = realisticDoc({});
    doc.body.layout.hidden = ['contact'];
    const html = render(doc);
    expect(html).not.toContain('data-act="contact"');
    expect(html).toContain('data-act="pdf"');
  });

  it('disables the actions in a draft preview', () => {
    const html = render(realisticDoc({}), { preview: true });
    expect(html).not.toContain('data-act=');
    expect(html).not.toContain('reveal.js');
    expect(html).toContain('Náhled konceptu');
    expect(html).toContain('noindex');
  });
});

describe('CV-5 visibility and CV-16 structured data', () => {
  it('is noindex by default (link only) and has no JSON-LD', () => {
    const html = render(realisticDoc({}), { visibility: 'link' });
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive"/>');
    expect(html).not.toContain('application/ld+json');
  });

  it('is indexable with ProfilePage + Person JSON-LD when public, without contact details', () => {
    const html = render(realisticDoc({ photo: true }), { visibility: 'public' });
    expect(html).toContain('<meta name="robots" content="index, follow"/>');
    const json = JSON.parse(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/s.exec(html)![1]!);
    expect(json['@type']).toBe('ProfilePage');
    expect(json.mainEntity['@type']).toBe('Person');
    expect(json.mainEntity.name).toBe('Jana Nováková');
    expect(json.mainEntity.worksFor.name).toBe('Rohlík Group');
    expect(JSON.stringify(json)).not.toMatch(/@example|777/);
    expect(json.mainEntity.email).toBeUndefined();
    expect(json.mainEntity.telephone).toBeUndefined();
  });

  it('escapes "<" in JSON-LD so text cannot close the script element', () => {
    const doc = realisticDoc({});
    doc.profile.headline.cs = '</script><script>alert(1)</script>';
    const html = render(doc, { visibility: 'public' });
    expect(html).not.toContain('</script><script>alert(1)');
  });
});

describe('CV-9 two languages', () => {
  it('links the other language and declares alternates', () => {
    const cs = render(realisticDoc({}), { lang: 'cs' });
    expect(cs).toContain('<html lang="cs">');
    expect(cs).toContain('href="/jana-novakova/en" hreflang="en"');
    expect(cs).toContain('<link rel="alternate" hreflang="en" href="https://cv.pulzarstudio.cz/jana-novakova/en"/>');
    expect(cs).toContain('<link rel="canonical" href="https://cv.pulzarstudio.cz/jana-novakova"/>');
    const en = render(realisticDoc({}), { lang: 'en' });
    expect(en).toContain('<html lang="en">');
    expect(en).toContain('Experience');
    expect(en).toContain('Show contact');
    expect(en).toContain('href="/jana-novakova" hreflang="cs"');
    expect(en).toContain('<link rel="canonical" href="https://cv.pulzarstudio.cz/jana-novakova/en"/>');
  });

  it('has no language switch for a one-language CV', () => {
    const html = render(realisticDoc({ tier: 'zaklad', langs: ['cs'] }));
    expect(html).not.toContain('hreflang');
  });

  it('works at the root of an own domain (CV-10)', () => {
    const html = render(realisticDoc({}), { basePath: '' });
    expect(html).toContain('data-cv=""');
    expect(html).toContain('href="/en" hreflang="en"');
  });
});

describe('CV-1, CV-2, CV-7 content', () => {
  it('renders sections in the holder’s order and leaves out hidden ones', () => {
    const doc = realisticDoc({});
    doc.body.layout.order = ['education', 'experience', 'about', 'projects', 'skills', 'languages', 'certifications', 'interests'];
    doc.body.layout.hidden = ['interests'];
    const html = render(doc);
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect(at('vzdelani')).toBeLessThan(at('zkusenosti'));
    expect(at('zkusenosti')).toBeLessThan(at('o-mne'));
    expect(at('zajmy')).toBe(-1);
  });

  it('shows profile links as labelled icons that do not leak the CV address', () => {
    const html = render(realisticDoc({}));
    expect(html).toContain('aria-label="LinkedIn: linkedin.com/in/jana-novakova"');
    expect(html).toMatch(/rel="me noopener noreferrer"/);
  });

  it('escapes holder text', () => {
    const doc = realisticDoc({});
    doc.body.about.cs = '<img src=x onerror=alert(1)>';
    expect(render(doc)).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('shows project images only where the tier includes them', () => {
    const doc = realisticDoc({ tier: 'profi' });
    doc.body.projects[0]!.image = { key: 'cv/x/pr.jpg', width: 800, height: 500 };
    expect(render(doc)).toContain('/media/cv/x/pr.jpg');
    doc.tier = 'zaklad';
    doc.langs = ['cs'];
    expect(render(doc)).not.toContain('/media/cv/x/pr.jpg');
  });

  it('inlines the template CSS with the accent and only the template fonts', () => {
    const doc = realisticDoc({ template: 'klasik' });
    doc.design.accent = '#0f766e';
    const html = render(doc);
    expect(html).toContain('--accent:#0f766e');
    expect(html).toContain('/static/fonts/source-serif-4-700.woff2');
    expect(html).not.toContain('inter-400.woff2');
    expect(html).toContain('<style nonce="n0nce">');
  });
});

describe('inactive and PIN pages', () => {
  it('uses the PL-7 wording for a paused CV (CV-8)', () => {
    const html = (<InactivePage lang="cs" nonce="n" />).toString();
    expect(html).toContain('Tento životopis teď není zveřejněný.');
    expect(html).toContain('noindex');
  });
  it('asks for a PIN without showing anything of the CV (CV-14)', () => {
    const html = (<PinPage lang="cs" nonce="n" action="/jana/pin" accent="#1d4ed8" error="wrong" />).toString();
    expect(html).toContain('PIN nesedí');
    expect(html).toContain('action="/jana/pin"');
  });
});
