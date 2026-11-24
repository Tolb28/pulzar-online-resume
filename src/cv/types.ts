// The CV document. One source for both outputs: the web page and the PDF (G2).
// There are deliberately no fields for sensitive data (CV-6): no date of birth, age,
// marital status, children, nationality, birth number, ID or street address.

export type Lang = 'cs' | 'en';
export const LANGS: readonly Lang[] = ['cs', 'en'];

/** A text field with a Czech and an English version (CV-9). Základ uses one of them. */
export type L10n = { cs: string; en: string };

/** "YYYY-MM" */
export type YearMonth = string;

export type TierId = 'zaklad' | 'profi' | 'na_miru';
export type TemplateId = 'klasik' | 'moderni' | 'vyrazny';
export type Visibility = 'link' | 'public' | 'pin';
export type CvStatus = 'draft' | 'live' | 'paused';

export type LinkKind = 'linkedin' | 'github' | 'behance' | 'dribbble' | 'website' | 'other';
export const LINK_KINDS: readonly LinkKind[] = ['linkedin', 'github', 'behance', 'dribbble', 'website', 'other'];

export interface LinkItem {
  kind: LinkKind;
  url: string;
  /** Only for kind "other". */
  label: string;
}

export interface MediaRef {
  key: string;
  width: number;
  height: number;
}

/**
 * The profile block (PL-2): shared between a person's card and CV.
 * The CV header and contact come from here.
 */
export interface ProfileBlock {
  name: string;
  headline: L10n;
  /** City or region only (CV-6). */
  location: L10n;
  photo: MediaRef | null;
  links: LinkItem[];
  email: string;
  phone: string;
}

export interface ExperienceItem {
  id: string;
  role: L10n;
  employer: string;
  from: YearMonth;
  /** null = "dosud" (present); "" = not filled in yet */
  to: YearMonth | null;
  bullets: L10n[];
}

export interface EducationItem {
  id: string;
  school: L10n;
  field: L10n;
  from: YearMonth;
  to: YearMonth | null;
  bullets: L10n[];
}

export interface ProjectItem {
  id: string;
  title: L10n;
  text: L10n;
  url: string;
  /** Profi and Na míru only. Shown on the web page; the PDF keeps to text (see docs/plan.md). */
  image: MediaRef | null;
}

export interface SkillGroup {
  id: string;
  /** Empty when the skills are not grouped. */
  name: L10n;
  tags: L10n[];
}

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native';
export const CEFR_LEVELS: readonly CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'];

export interface LanguageItem {
  id: string;
  /** ISO 639-1 code from the built-in list, or "" for a language typed in by hand. */
  code: string;
  /** Used when code is "". */
  name: L10n;
  level: CefrLevel;
}

export interface CertificationItem {
  id: string;
  name: L10n;
  issuer: string;
  year: number | null;
}

/** Sections in the body of the CV, which can be hidden and reordered (CV-1). */
export type BodySectionKey =
  | 'about'
  | 'experience'
  | 'education'
  | 'projects'
  | 'skills'
  | 'languages'
  | 'certifications'
  | 'interests';
export const BODY_SECTIONS: readonly BodySectionKey[] = [
  'about',
  'experience',
  'education',
  'projects',
  'skills',
  'languages',
  'certifications',
  'interests',
];

/** Kontakt sits in the header (where recruiters and ATS parsers look for it). It can be hidden, not moved. */
export type HideableSectionKey = BodySectionKey | 'contact';

export interface CvLayout {
  order: BodySectionKey[];
  hidden: HideableSectionKey[];
}

/** The CV's own content (everything except the shared profile block). */
export interface CvBody {
  v: 1;
  about: L10n;
  experience: ExperienceItem[];
  education: EducationItem[];
  projects: ProjectItem[];
  skills: { grouped: boolean; groups: SkillGroup[] };
  languages: LanguageItem[];
  certifications: CertificationItem[];
  interests: L10n;
  layout: CvLayout;
}

export interface CvDesign {
  template: TemplateId;
  /** "#rrggbb" */
  accent: string;
  /** Na míru only: the studio's cover image on the web page. */
  cover: MediaRef | null;
}

/** Everything needed to render the CV: profile + body + design + languages. */
export interface CvDoc {
  profile: ProfileBlock;
  body: CvBody;
  design: CvDesign;
  /** Enabled languages, primary first. Základ: exactly one. */
  langs: Lang[];
  tier: TierId;
}

/** What is stored at every publish; the public page and the PDFs come from it (CV-3). */
export interface PublishedSnapshot {
  publishId: string;
  publishedAt: number;
  doc: CvDoc;
  pdf: Partial<Record<Lang, { key: string; filename: string; bytes: number; pages: number }>>;
}
