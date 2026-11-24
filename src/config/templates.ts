import type { TemplateId } from '../cv/types';

// CV-2: three templates at launch, each with a web layout and an A4 print layout and
// one pair of fonts. Names are a Proposal.

export type FontId =
  | 'source-serif-4-700'
  | 'public-sans-400'
  | 'public-sans-600'
  | 'manrope-700'
  | 'inter-400'
  | 'inter-600'
  | 'space-grotesk-700'
  | 'dm-sans-400'
  | 'dm-sans-600';

export interface TemplateFonts {
  /** Name and section headings. */
  heading: FontId;
  body: FontId;
  bodyStrong: FontId;
  /** CSS font-family names for the web page. */
  css: { heading: string; body: string };
}

export interface TemplateDef {
  id: TemplateId;
  name: string;
  description: string;
  fonts: TemplateFonts;
}

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  klasik: {
    id: 'klasik',
    name: 'Klasik',
    description: 'Patkové nadpisy a klidná sazba. Pro úřady, právo, finance a vše tradiční.',
    fonts: {
      heading: 'source-serif-4-700',
      body: 'public-sans-400',
      bodyStrong: 'public-sans-600',
      css: { heading: '"Source Serif 4", Georgia, serif', body: '"Public Sans", system-ui, sans-serif' },
    },
  },
  moderni: {
    id: 'moderni',
    name: 'Moderní',
    description: 'Čisté bezpatkové písmo a barevné nadpisy. Pro IT, startupy a kanceláře.',
    fonts: {
      heading: 'manrope-700',
      body: 'inter-400',
      bodyStrong: 'inter-600',
      css: { heading: 'Manrope, system-ui, sans-serif', body: 'Inter, system-ui, sans-serif' },
    },
  },
  vyrazny: {
    id: 'vyrazny',
    name: 'Výrazný',
    description: 'Barevná hlavička a výrazné nadpisy. Pro kreativce a každého, kdo chce vyniknout.',
    fonts: {
      heading: 'space-grotesk-700',
      body: 'dm-sans-400',
      bodyStrong: 'dm-sans-600',
      css: { heading: '"Space Grotesk", system-ui, sans-serif', body: '"DM Sans", system-ui, sans-serif' },
    },
  },
};

export const TEMPLATE_IDS: readonly TemplateId[] = ['klasik', 'moderni', 'vyrazny'];

export function isTemplateId(v: unknown): v is TemplateId {
  return typeof v === 'string' && (TEMPLATE_IDS as readonly string[]).includes(v);
}

/** Web font files (public/static/fonts) per CSS family, for @font-face. */
export const WEB_FONT_FACES: Record<FontId, { family: string; weight: number }> = {
  'source-serif-4-700': { family: 'Source Serif 4', weight: 700 },
  'public-sans-400': { family: 'Public Sans', weight: 400 },
  'public-sans-600': { family: 'Public Sans', weight: 600 },
  'manrope-700': { family: 'Manrope', weight: 700 },
  'inter-400': { family: 'Inter', weight: 400 },
  'inter-600': { family: 'Inter', weight: 600 },
  'space-grotesk-700': { family: 'Space Grotesk', weight: 700 },
  'dm-sans-400': { family: 'DM Sans', weight: 400 },
  'dm-sans-600': { family: 'DM Sans', weight: 600 },
};

/**
 * Základ picks one of six accents (CV-2). Each passes WCAG AA (4.5:1) against white, both as
 * text on white and as a background behind white text (the Výrazný header).
 */
export const ACCENT_PALETTE: ReadonlyArray<{ id: string; name: string; hex: string }> = [
  { id: 'modra', name: 'Modrá', hex: '#1d4ed8' },
  { id: 'petrolejova', name: 'Petrolejová', hex: '#0f766e' },
  { id: 'zelena', name: 'Zelená', hex: '#15803d' },
  { id: 'vinova', name: 'Vínová', hex: '#9f1239' },
  { id: 'fialova', name: 'Fialová', hex: '#6d28d9' },
  { id: 'grafitova', name: 'Grafitová', hex: '#334155' },
];

export const DEFAULT_ACCENT = ACCENT_PALETTE[0]!.hex;

/** Minimum contrast of a custom accent against white (Profi, Na míru). */
export const MIN_ACCENT_CONTRAST = 4.5;
