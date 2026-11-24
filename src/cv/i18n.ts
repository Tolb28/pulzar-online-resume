import type { CefrLevel, HideableSectionKey, L10n, Lang, YearMonth } from './types';

export const SECTION_LABELS: Record<HideableSectionKey | 'header', Record<Lang, string>> = {
  header: { cs: 'Hlavička', en: 'Header' },
  about: { cs: 'O mně', en: 'About me' },
  experience: { cs: 'Zkušenosti', en: 'Experience' },
  education: { cs: 'Vzdělání', en: 'Education' },
  projects: { cs: 'Projekty', en: 'Projects' },
  skills: { cs: 'Dovednosti', en: 'Skills' },
  languages: { cs: 'Jazyky', en: 'Languages' },
  certifications: { cs: 'Certifikáty a kurzy', en: 'Certificates and courses' },
  contact: { cs: 'Kontakt', en: 'Contact' },
  interests: { cs: 'Zájmy', en: 'Interests' },
};

/** Strings on the public page and in the PDF. */
export const UI: Record<Lang, Record<string, string>> = {
  cs: {
    present: 'dosud',
    showContact: 'Zobrazit kontakt',
    downloadPdf: 'Stáhnout PDF',
    copy: 'Kopírovat',
    copied: 'Zkopírováno',
    email: 'E-mail',
    phone: 'Telefon',
    noJs: 'Kontakt a PDF se zobrazí po povolení JavaScriptu (ochrana před roboty).',
    checking: 'Ověřujeme, že nejste robot…',
    failed: 'Ověření se nepovedlo. Zkuste to prosím znovu.',
    inactive: 'Tento životopis teď není zveřejněný.',
    inactiveHint: 'Pokud vám ho někdo poslal, zeptejte se ho na aktuální odkaz.',
    madeWith: 'Vytvořeno v Pulzar CV',
    cvTitle: 'Životopis',
    photoAlt: 'Fotografie',
    switchLang: 'English',
    pinTitle: 'Tento životopis je chráněný PINem',
    pinHint: 'PIN najdete v přihlášce nebo e-mailu, kterým vám životopis přišel.',
    pinLabel: 'PIN',
    pinSubmit: 'Zobrazit životopis',
    pinWrong: 'PIN nesedí. Zkuste to znovu.',
    pinLocked: 'Příliš mnoho pokusů. Zkuste to prosím později.',
    page: 'strana',
    projectLink: 'Odkaz',
  },
  en: {
    present: 'present',
    showContact: 'Show contact',
    downloadPdf: 'Download PDF',
    copy: 'Copy',
    copied: 'Copied',
    email: 'E-mail',
    phone: 'Phone',
    noJs: 'Contact details and the PDF appear once JavaScript is on (it keeps bots out).',
    checking: 'Checking you are not a bot…',
    failed: 'The check failed. Please try again.',
    inactive: 'This CV is not published at the moment.',
    inactiveHint: 'If someone sent it to you, ask them for the current link.',
    madeWith: 'Made with Pulzar CV',
    cvTitle: 'CV',
    photoAlt: 'Photo',
    switchLang: 'Česky',
    pinTitle: 'This CV is protected by a PIN',
    pinHint: 'You will find the PIN in the application or e-mail that brought you here.',
    pinLabel: 'PIN',
    pinSubmit: 'Show the CV',
    pinWrong: 'Wrong PIN. Please try again.',
    pinLocked: 'Too many attempts. Please try again later.',
    page: 'page',
    projectLink: 'Link',
  },
};

export const LEVEL_LABELS: Record<CefrLevel, Record<Lang, string>> = {
  A1: { cs: 'A1', en: 'A1' },
  A2: { cs: 'A2', en: 'A2' },
  B1: { cs: 'B1', en: 'B1' },
  B2: { cs: 'B2', en: 'B2' },
  C1: { cs: 'C1', en: 'C1' },
  C2: { cs: 'C2', en: 'C2' },
  native: { cs: 'rodilý mluvčí', en: 'native speaker' },
};

/** Languages offered in the editor; stored as codes so both CV languages get the right name. */
export const LANGUAGE_NAMES: Record<string, L10n> = {
  cs: { cs: 'čeština', en: 'Czech' },
  sk: { cs: 'slovenština', en: 'Slovak' },
  en: { cs: 'angličtina', en: 'English' },
  de: { cs: 'němčina', en: 'German' },
  fr: { cs: 'francouzština', en: 'French' },
  es: { cs: 'španělština', en: 'Spanish' },
  it: { cs: 'italština', en: 'Italian' },
  pt: { cs: 'portugalština', en: 'Portuguese' },
  pl: { cs: 'polština', en: 'Polish' },
  hu: { cs: 'maďarština', en: 'Hungarian' },
  ru: { cs: 'ruština', en: 'Russian' },
  uk: { cs: 'ukrajinština', en: 'Ukrainian' },
  vi: { cs: 'vietnamština', en: 'Vietnamese' },
  zh: { cs: 'čínština', en: 'Chinese' },
  ja: { cs: 'japonština', en: 'Japanese' },
  ko: { cs: 'korejština', en: 'Korean' },
  ar: { cs: 'arabština', en: 'Arabic' },
  tr: { cs: 'turečtina', en: 'Turkish' },
  nl: { cs: 'nizozemština', en: 'Dutch' },
  sv: { cs: 'švédština', en: 'Swedish' },
  no: { cs: 'norština', en: 'Norwegian' },
  da: { cs: 'dánština', en: 'Danish' },
  fi: { cs: 'finština', en: 'Finnish' },
  el: { cs: 'řečtina', en: 'Greek' },
  ro: { cs: 'rumunština', en: 'Romanian' },
  bg: { cs: 'bulharština', en: 'Bulgarian' },
  hr: { cs: 'chorvatština', en: 'Croatian' },
  sr: { cs: 'srbština', en: 'Serbian' },
  sl: { cs: 'slovinština', en: 'Slovenian' },
  he: { cs: 'hebrejština', en: 'Hebrew' },
  hi: { cs: 'hindština', en: 'Hindi' },
  la: { cs: 'latina', en: 'Latin' },
  csl: { cs: 'český znakový jazyk', en: 'Czech Sign Language' },
};

/** Pick the text in `lang`, falling back to the other language when it is empty. */
export function pick(t: L10n | undefined, lang: Lang): string {
  if (!t) return '';
  const own = t[lang]?.trim() ?? '';
  if (own) return own;
  return (lang === 'cs' ? t.en : t.cs)?.trim() ?? '';
}

export function languageName(code: string, custom: L10n, lang: Lang): string {
  const known = code ? LANGUAGE_NAMES[code] : undefined;
  const name = known ? known[lang] : pick(custom, lang);
  // Capitalise for display ("Angličtina"); stored names stay lower case as Czech writes them.
  return name ? name.charAt(0).toLocaleUpperCase(lang) + name.slice(1) : '';
}

/** "03/2021" */
export function formatYearMonth(ym: YearMonth): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  return m ? `${m[2]}/${m[1]}` : ym;
}

/** "03/2021 – dosud" with an en dash and non-breaking spaces around it. */
export function formatRange(from: YearMonth, to: YearMonth | null, lang: Lang): string {
  const a = from ? formatYearMonth(from) : '';
  if (to === '') return a ? `${a}\u00a0–` : '';
  const b = to ? formatYearMonth(to) : UI[lang]!.present!;
  if (!a) return b === UI[lang]!.present ? '' : b;
  return `${a} – ${b}`;
}

const DATE_CS = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

/** "24. 11. 2026" in Prague time. */
export function formatDateCs(ms: number): string {
  return DATE_CS.format(new Date(ms));
}
