import { describe, expect, it } from 'vitest';
import { ACCENT_PALETTE } from '../src/config/templates';
import { contrastRatio } from '../src/cv/color';
import { emptyBody, emptyProfile } from '../src/cv/defaults';
import { formatRange, languageName } from '../src/cv/i18n';
import { coerceBody, coerceProfile, hardCapProblem } from '../src/cv/sanitize';
import { charCount, normalizeText, pdfFilename, slugify, slugProblem, unsupportedChars } from '../src/cv/text';
import type { CvDoc } from '../src/cv/types';
import { errorsOf, validateDoc, type Issue } from '../src/cv/validate';
import { maxDoc, realisticDoc, textOf } from './fixtures/docs';

const codes = (issues: Issue[]) => issues.map((i) => `${i.severity}:${i.code}:${i.path}`);

describe('CV-1 limits', () => {
  it('a realistic CV has no errors', () => {
    expect(errorsOf(validateDoc(realisticDoc({})))).toEqual([]);
  });

  it('content at every maximum is valid for both tiers (the fixture sits exactly at the limits)', () => {
    for (const tier of ['zaklad', 'profi'] as const) {
      for (const lang of ['cs', 'en'] as const) {
        const errs = errorsOf(validateDoc(maxDoc(tier, lang)));
        expect(errs, `${tier}/${lang}`).toEqual([]);
      }
    }
  });

  it('shows what is over and by how much, and cuts nothing', () => {
    const doc = realisticDoc({});
    const long = textOf(645, 'cs');
    doc.body.about.cs = long;
    const before = JSON.stringify(doc);
    const issues = validateDoc(doc);
    expect(JSON.stringify(doc)).toBe(before);
    const about = issues.find((i) => i.path === 'body.about.cs')!;
    expect(about).toMatchObject({ code: 'too_long', severity: 'error', limit: 600, actual: 645, section: 'about' });
    expect(about.message).toContain('Zkraťte o 45');
  });

  it('counts entries over the limit (e.g. after a downgrade to Základ)', () => {
    const doc = maxDoc('profi', 'cs');
    doc.tier = 'zaklad';
    const issue = validateDoc(doc).find((i) => i.path === 'body.projects')!;
    expect(issue).toMatchObject({ code: 'too_many', limit: 3, actual: 8 });
    expect(issue.message).toBe('Projekty (Základ): 8 projektů z 3. Odeberte 5 projektů.');
    expect(doc.body.projects).toHaveLength(8);
  });

  it('flags bullets per entry and their length', () => {
    const doc = realisticDoc({});
    doc.body.experience[0]!.bullets = Array.from({ length: 6 }, (_, i) => ({ cs: textOf(i === 0 ? 170 : 50, 'cs', i), en: textOf(40, 'en', i) }));
    const c = codes(validateDoc(doc));
    expect(c).toContain('error:too_many:body.experience.0.bullets');
    expect(c).toContain('error:too_long:body.experience.0.bullets.0.cs');
  });

  it('counts characters as people see them', () => {
    expect(charCount('Příliš žluťoučký kůň')).toBe(20);
  });
});

describe('CV-4/CV-6: contact and sensitive data stay out of free text', () => {
  const withAbout = (text: string): CvDoc => {
    const d = realisticDoc({});
    d.body.about.cs = text;
    return d;
  };
  it('blocks an e-mail address in free text', () => {
    expect(codes(validateDoc(withAbout('Pište na jana@seznam.cz')))).toContain('error:contact_in_text:body.about.cs');
  });
  it("blocks the holder's own phone number in free text", () => {
    expect(codes(validateDoc(withAbout('Volejte 777 123 456')))).toContain('error:contact_in_text:body.about.cs');
  });
  it('warns about anything that looks like a phone number', () => {
    expect(codes(validateDoc(withAbout('Kontakt 603 111 222')))).toContain('warning:contact_in_text:body.about.cs');
  });
  it('does not mistake ordinary numbers for phones', () => {
    const c = codes(validateDoc(withAbout('Obrat 1 000 000 Kč za rok 2023, tým 12 lidí, 40 % růst.')));
    expect(c.filter((x) => x.includes('contact_in_text'))).toEqual([]);
  });
  it('blocks a birth number and warns about date of birth or marital status', () => {
    expect(codes(validateDoc(withAbout('RČ 905112/1234')))).toContain('error:sensitive:body.about.cs');
    expect(codes(validateDoc(withAbout('Datum narození 1. 1. 1990, ženatý')))).toContain('warning:sensitive:body.about.cs');
  });
  it('warns when the location looks like a street address', () => {
    const d = realisticDoc({});
    d.profile.location.cs = 'Vinohradská 12/34, 120 00 Praha';
    expect(codes(validateDoc(d))).toContain('warning:sensitive:profile.location.cs');
  });
  it('has no fields for sensitive data at all', () => {
    const keys = Object.keys(coerceProfile({ dateOfBirth: '1990-01-01', nationality: 'CZ', address: 'Ulice 1' }));
    expect(keys.sort()).toEqual(['email', 'headline', 'links', 'location', 'name', 'phone', 'photo']);
  });
});

describe('characters the PDF fonts cannot draw', () => {
  it('flags them instead of dropping them', () => {
    expect(unsupportedChars('Příliš žluťoučký kůň úpěl ďábelské ódy – „ok“ … €')).toEqual([]);
    expect(unsupportedChars('Ahoj 😀 → 漢')).toEqual(['😀', '→', '漢']);
    const d = realisticDoc({});
    d.profile.headline.cs = 'Designérka 🚀';
    const issue = validateDoc(d).find((i) => i.code === 'unsupported_char')!;
    expect(issue.message).toContain('„🚀“');
    expect(d.profile.headline.cs).toBe('Designérka 🚀');
  });
});

describe('CV-9 languages and tiers', () => {
  it('Základ has one language', () => {
    const d = realisticDoc({ tier: 'zaklad', langs: ['cs', 'en'] });
    d.design.accent = ACCENT_PALETTE[1]!.hex;
    expect(codes(validateDoc(d))).toContain('error:tier:langs');
  });
  it('warns about a missing translation in a bilingual CV', () => {
    const d = realisticDoc({});
    d.body.about.en = '';
    const issue = validateDoc(d).find((i) => i.path === 'body.about.en')!;
    expect(issue).toMatchObject({ code: 'missing_translation', severity: 'warning' });
  });
  it('ignores the other language in a one-language CV', () => {
    const d = realisticDoc({ tier: 'zaklad', langs: ['cs'] });
    d.design.accent = ACCENT_PALETTE[0]!.hex;
    d.body.about.en = textOf(900, 'en');
    expect(errorsOf(validateDoc(d))).toEqual([]);
  });
});

describe('CV-2 accent colours', () => {
  it('every palette colour passes AA against white', () => {
    for (const a of ACCENT_PALETTE) expect(contrastRatio(a.hex, '#ffffff'), a.name).toBeGreaterThanOrEqual(4.5);
  });
  it('Základ picks from the palette; Profi picks its own, contrast-checked', () => {
    const z = realisticDoc({ tier: 'zaklad', langs: ['cs'] });
    z.design.accent = '#123456';
    expect(codes(validateDoc(z))).toContain('error:tier:design.accent');
    const p = realisticDoc({ tier: 'profi' });
    p.design.accent = '#123456';
    expect(codes(validateDoc(p)).filter((c) => c.includes('design.accent'))).toEqual([]);
    p.design.accent = '#ffcc00';
    expect(codes(validateDoc(p))).toContain('error:invalid:design.accent');
  });
});

describe('links', () => {
  it('checks each link goes where it says', () => {
    const d = realisticDoc({});
    d.profile.links = [
      { kind: 'linkedin', url: 'https://github.com/jana', label: '' },
      { kind: 'github', url: 'https://github.com/jana', label: '' },
      { kind: 'github', url: 'https://github.com/jana2', label: '' },
      { kind: 'other', url: 'javascript:alert(1)', label: 'X' },
    ];
    const c = codes(validateDoc(d));
    expect(c).toContain('error:invalid:profile.links.0.url');
    expect(c).not.toContain('error:invalid:profile.links.1.url');
    expect(c).toContain('error:invalid:profile.links.2');
    expect(c).toContain('error:invalid:profile.links.3.url');
  });
});

describe('sanitizing input', () => {
  it('normalizes text without removing anything visible', () => {
    expect(normalizeText('  Ahoj\u00adsvete\u200b  \t tady ')).toBe('Ahojsvete tady');
    expect(normalizeText('a\r\n\r\n\r\n\r\nb', true)).toBe('a\n\nb');
    expect(normalizeText('Nova\u0301kova\u0301')).toBe('Nováková');
  });
  it('fills in a missing or broken section order and drops unknown sections', () => {
    const body = coerceBody({ layout: { order: ['education', 'bogus', 'education'], hidden: ['contact', 'bogus'] } });
    expect(body.layout.order[0]).toBe('education');
    expect(body.layout.order).toHaveLength(8);
    expect(body.layout.hidden).toEqual(['contact']);
  });
  it('does not truncate long text', () => {
    const body = coerceBody({ about: { cs: textOf(700), en: '' } });
    expect(charCount(body.about.cs)).toBe(700);
  });
  it('refuses absurd drafts instead of truncating them', () => {
    const body = emptyBody();
    body.about.cs = 'x'.repeat(6001);
    expect(hardCapProblem(emptyProfile(), body)).toMatch(/nic jsme nesmazali/);
    body.about.cs = 'x'.repeat(5000);
    expect(hardCapProblem(emptyProfile(), body)).toBeNull();
  });
});

describe('addresses and file names', () => {
  it('makes a slug from a Czech name (D2)', () => {
    expect(slugify('Jana Nováková')).toBe('jana-novakova');
    expect(slugify('  Žofie  Ďurišová-Łukasik ')).toBe('zofie-durisova-lukasik');
  });
  it('rejects reserved and malformed slugs', () => {
    expect(slugProblem('jana-novakova')).toBeNull();
    expect(slugProblem('ucet')).toMatch(/aplikace/);
    expect(slugProblem('-jana')).not.toBeNull();
    expect(slugProblem('ja')).not.toBeNull();
    expect(slugProblem('jana--novakova')).not.toBeNull();
  });
  it('names PDFs as the PRD says', () => {
    expect(pdfFilename('Jana Nováková', 'cs')).toBe('Jana-Novakova-CV.pdf');
    expect(pdfFilename('Jana Nováková', 'en')).toBe('Jana-Novakova-CV-EN.pdf');
    expect(pdfFilename('', 'cs')).toBe('Zivotopis-CV.pdf');
  });
  it('formats dates and language names', () => {
    expect(formatRange('2021-03', null, 'cs')).toBe('03/2021 – dosud');
    expect(formatRange('2018-09', '2021-02', 'en')).toBe('09/2018 – 02/2021');
    expect(languageName('en', { cs: '', en: '' }, 'cs')).toBe('Angličtina');
    expect(languageName('', { cs: 'esperanto', en: 'Esperanto' }, 'cs')).toBe('Esperanto');
  });
});
