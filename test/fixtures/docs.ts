import { LIMITS } from '../../src/config/limits';
import { TIERS } from '../../src/config/tiers';
import { defaultDesign, emptyBody } from '../../src/cv/defaults';
import type { CvDoc, L10n, Lang, TemplateId, TierId } from '../../src/cv/types';

const WORDS_CS =
  'vedl jsem tým pěti vývojářů a zkrátil dobu nasazení zavedl automatické testy přepsal platební modul pro e-shop s tisíci objednávkami měsíčně navrhl novou architekturu zlepšil výkon aplikace spolupracoval s designéry na přístupnosti řídil migraci databáze školil nové kolegy připravil podklady pro vedení snížil náklady na provoz o čtvrtinu'.split(
    ' ',
  );
const WORDS_EN =
  'led a team of five developers and cut deployment time introduced automated tests rewrote the payment module for an online shop with thousands of monthly orders designed a new architecture improved application performance worked with designers on accessibility managed the database migration trained new colleagues prepared reports for management reduced running costs by a quarter'.split(
    ' ',
  );

/** Realistic text of exactly `n` characters (code points), ending with a full stop. */
export function textOf(n: number, lang: Lang = 'cs', seed = 1): string {
  const words = lang === 'cs' ? WORDS_CS : WORDS_EN;
  let s = '';
  let i = seed * 7;
  while ([...s].length < n) {
    const w = words[i++ % words.length]!;
    s = s ? `${s} ${w}` : w.charAt(0).toUpperCase() + w.slice(1);
  }
  let out = [...s].slice(0, n - 1).join('').replace(/\s+$/, '');
  while ([...out].length < n - 1) out += 'a';
  return `${out}.`;
}

const both = (n: number, seed = 1): L10n => ({ cs: textOf(n, 'cs', seed), en: textOf(n, 'en', seed) });

export function realisticDoc(opts: { tier?: TierId; langs?: Lang[]; template?: TemplateId; photo?: boolean } = {}): CvDoc {
  const body = emptyBody();
  body.about = {
    cs: 'Produktová designérka se 6 lety praxe v e-commerce. Navrhuji rozhraní, která jsou přehledná i pro lidi, kteří technice nerozumí, a výsledky ověřuji v testech s uživateli.',
    en: 'Product designer with 6 years in e-commerce. I design interfaces that are clear even to people who are not into technology, and I check the results in user tests.',
  };
  body.experience = [
    {
      id: 'exp1',
      role: { cs: 'Senior produktová designérka', en: 'Senior product designer' },
      employer: 'Rohlík Group',
      from: '2021-03',
      to: null,
      bullets: [
        { cs: 'Vedu redesign košíku, který zvýšil konverzi o 4,2 %.', en: 'I lead the cart redesign that lifted conversion by 4.2%.' },
        { cs: 'Zavedla jsem design systém sdílený třemi týmy.', en: 'I introduced a design system shared by three teams.' },
        { cs: 'Každý měsíc testuji s 8 až 10 zákazníky v Praze a v Brně.', en: 'Every month I test with 8 to 10 customers in Prague and Brno.' },
      ],
    },
    {
      id: 'exp2',
      role: { cs: 'UX designérka', en: 'UX designer' },
      employer: 'Alza.cz',
      from: '2018-09',
      to: '2021-02',
      bullets: [
        { cs: 'Navrhla jsem nový filtr produktů v mobilní aplikaci.', en: 'I designed the new product filter in the mobile app.' },
        { cs: 'Spolupracovala jsem s vývojem na přístupnosti podle WCAG 2.1.', en: 'I worked with engineering on WCAG 2.1 accessibility.' },
      ],
    },
  ];
  body.education = [
    {
      id: 'edu1',
      school: { cs: 'Vysoká škola uměleckoprůmyslová v Praze', en: 'Academy of Arts, Architecture and Design in Prague' },
      field: { cs: 'Grafický design a vizuální komunikace', en: 'Graphic design and visual communication' },
      from: '2013-10',
      to: '2018-06',
      bullets: [{ cs: 'Diplomová práce o přístupnosti e-shopů.', en: 'Thesis on accessibility of online shops.' }],
    },
  ];
  body.projects = [
    {
      id: 'pr1',
      title: { cs: 'Přístupný e-shop', en: 'Accessible online shop' },
      text: { cs: 'Audit a úpravy e-shopu pro lidi se zrakovým postižením.', en: 'Audit and changes to an online shop for people with visual impairments.' },
      url: 'https://jananovakova.cz/pristupnost',
      image: null,
    },
  ];
  body.skills = {
    grouped: true,
    groups: [
      { id: 'sg1', name: { cs: 'Design', en: 'Design' }, tags: [{ cs: 'Figma', en: 'Figma' }, { cs: 'Prototypování', en: 'Prototyping' }, { cs: 'Design systémy', en: 'Design systems' }] },
      { id: 'sg2', name: { cs: 'Výzkum', en: 'Research' }, tags: [{ cs: 'Uživatelské testy', en: 'User testing' }, { cs: 'Rozhovory', en: 'Interviews' }] },
    ],
  };
  body.languages = [
    { id: 'l1', code: 'cs', name: { cs: '', en: '' }, level: 'native' },
    { id: 'l2', code: 'en', name: { cs: '', en: '' }, level: 'C1' },
    { id: 'l3', code: 'de', name: { cs: '', en: '' }, level: 'B1' },
  ];
  body.certifications = [{ id: 'c1', name: { cs: 'Google UX Design', en: 'Google UX Design' }, issuer: 'Coursera', year: 2022 }];
  body.interests = { cs: 'Lezení, keramika a dobrovolnictví v útulku.', en: 'Climbing, ceramics and volunteering at an animal shelter.' };
  return {
    tier: opts.tier ?? 'profi',
    langs: opts.langs ?? ['cs', 'en'],
    design: { ...defaultDesign(), template: opts.template ?? 'moderni' },
    profile: {
      name: 'Jana Nováková',
      headline: { cs: 'Produktová designérka, e-commerce a přístupnost', en: 'Product designer, e-commerce and accessibility' },
      location: { cs: 'Praha', en: 'Prague' },
      photo: opts.photo ? { key: 'p/test/photo.jpg', width: 600, height: 600 } : null,
      links: [
        { kind: 'linkedin', url: 'https://www.linkedin.com/in/jana-novakova', label: '' },
        { kind: 'behance', url: 'https://www.behance.net/jananovakova', label: '' },
        { kind: 'website', url: 'https://jananovakova.cz', label: '' },
      ],
      email: 'jana.novakova@example.cz',
      phone: '+420 777 123 456',
    },
    body,
  };
}

/** CV-3 AC: content at every maximum limit (all of them at once). */
export function maxDoc(tier: TierId, lang: Lang, template: TemplateId = 'moderni'): CvDoc {
  const L = LIMITS;
  const body = emptyBody();
  body.about = both(L.about, 2);
  body.interests = both(L.interests, 3);
  body.experience = Array.from({ length: L.experience.items }, (_, i) => ({
    id: `exp${i}`,
    role: both(L.experience.role, 10 + i),
    employer: textOf(L.experience.employer, 'cs', 20 + i).replace(/\.$/, ''),
    from: `${2000 + i}-01`,
    to: i === 0 ? null : `${2001 + i}-12`,
    bullets: Array.from({ length: L.experience.bullets }, (_, j) => both(L.experience.bullet, 30 + i * 5 + j)),
  }));
  body.education = Array.from({ length: L.education.items }, (_, i) => ({
    id: `edu${i}`,
    school: both(L.education.school, 40 + i),
    field: both(L.education.field, 50 + i),
    from: `${1990 + i}-09`,
    to: `${1994 + i}-06`,
    bullets: Array.from({ length: L.education.bullets }, (_, j) => both(L.education.bullet, 60 + i * 2 + j)),
  }));
  body.projects = Array.from({ length: TIERS[tier].projects }, (_, i) => ({
    id: `pr${i}`,
    title: both(L.projects.title, 70 + i),
    text: both(L.projects.text, 80 + i),
    url: `https://example.cz/projekty/${'projekt-'.repeat(3)}${i}`,
    image: null,
  }));
  const perGroup = L.skills.tags / L.skills.groups;
  body.skills = {
    grouped: true,
    groups: Array.from({ length: L.skills.groups }, (_, g) => ({
      id: `sg${g}`,
      name: both(L.skills.groupName, 90 + g),
      tags: Array.from({ length: perGroup }, (_, t) => both(L.skills.tag, 100 + g * perGroup + t)),
    })),
  };
  body.languages = Array.from({ length: L.languages.items }, (_, i) => ({
    id: `l${i}`,
    code: '',
    name: both(L.languages.name, 110 + i),
    level: 'C2' as const,
  }));
  body.certifications = Array.from({ length: L.certifications.items }, (_, i) => ({
    id: `c${i}`,
    name: both(L.certifications.name, 120 + i),
    issuer: textOf(L.certifications.issuer, 'cs', 130 + i).replace(/\.$/, ''),
    year: 2010 + i,
  }));
  return {
    tier,
    langs: [lang],
    design: { ...defaultDesign(), template },
    profile: {
      name: textOf(L.profile.name, 'cs', 140).replace(/\.$/, '').slice(0, L.profile.name),
      headline: both(L.profile.headline, 141),
      location: both(L.profile.location, 142),
      photo: { key: 'p/test/photo.jpg', width: 600, height: 600 },
      links: [
        { kind: 'linkedin', url: 'https://www.linkedin.com/in/jana-marie-novakova-dvorakova', label: '' },
        { kind: 'github', url: 'https://github.com/jana-marie-novakova', label: '' },
        { kind: 'behance', url: 'https://www.behance.net/jana-marie-novakova', label: '' },
        { kind: 'dribbble', url: 'https://dribbble.com/jana-marie-novakova', label: '' },
        { kind: 'website', url: 'https://jana-marie-novakova.cz', label: '' },
        { kind: 'other', url: 'https://medium.com/@jana-marie-novakova', label: textOf(L.profile.linkLabel, 'cs', 150).replace(/\.$/, '') },
      ],
      email: 'jana.marie.novakova.dvorakova@example.cz',
      phone: '+420 777 123 456',
    },
    body,
  };
}
