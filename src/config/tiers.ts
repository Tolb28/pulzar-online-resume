import type { TierId } from '../cv/types';

// §5 Tiers and prices. The shape is the owner's (D3, D4); contents and numbers are a Proposal.
// Prices are option B ("recommended") until the owner answers O1. Change them here only.

export interface Tier {
  id: TierId;
  name: string;
  /** How many CV languages: Základ CS or EN, Profi and Na míru CS + EN (CV-9). */
  maxLangs: 1 | 2;
  projects: number;
  projectImages: boolean;
  /** Základ picks from the palette; Profi and Na míru pick their own accent (CV-2). */
  ownAccent: boolean;
  ownDomain: boolean; // CV-10
  stats: boolean; // CV-15
  studioHelp: boolean; // CV-11
  /** The studio's design touch: cover image, accent, photo crop. */
  studioDesign: boolean;
  /** CV-3 AC: content at every maximum fits this many A4 pages. */
  pdfPageBudget: number;
}

export const TIERS: Record<TierId, Tier> = {
  zaklad: {
    id: 'zaklad',
    name: 'Základ',
    maxLangs: 1,
    projects: 3,
    projectImages: false,
    ownAccent: false,
    ownDomain: false,
    stats: false,
    studioHelp: false,
    studioDesign: false,
    // CV-3 AC says 2 (Základ) and 3 (Profi). With CV-1's limits all at their maximum the
    // content needs 3 and 4 pages even at 8.5 pt – see docs/plan.md, "Finding F1". The owner
    // chooses: these budgets, or tighter experience limits that fit 2 and 3.
    pdfPageBudget: 3,
  },
  profi: {
    id: 'profi',
    name: 'Profi',
    maxLangs: 2,
    projects: 8,
    projectImages: true,
    ownAccent: true,
    ownDomain: true,
    stats: true,
    studioHelp: false,
    studioDesign: false,
    pdfPageBudget: 4,
  },
  na_miru: {
    id: 'na_miru',
    name: 'Na míru',
    maxLangs: 2,
    projects: 8,
    projectImages: true,
    ownAccent: true,
    ownDomain: true,
    stats: true,
    studioHelp: true,
    studioDesign: true,
    pdfPageBudget: 4,
  },
};

export const TIER_IDS: readonly TierId[] = ['zaklad', 'profi', 'na_miru'];

export function isTierId(v: unknown): v is TierId {
  return typeof v === 'string' && (TIER_IDS as readonly string[]).includes(v);
}

/** Prices in CZK. Each covers 12 months (D3). */
export const PRICES = {
  zaklad: 690,
  zakladStudent: 390, // CV-12: Základ only, first year only
  profi: 1490,
  na_miru: 3990,
  renewal: 390, // per year, any tier
  pause: 0,
  domainFrom: 390, // per year, own domain registered by the studio (CV-10)
} as const;

export const PAID_PERIOD_MONTHS = 12;

export function initialPrice(tier: TierId, student: boolean): number {
  if (tier === 'zaklad') return student ? PRICES.zakladStudent : PRICES.zaklad;
  return tier === 'profi' ? PRICES.profi : PRICES.na_miru;
}

export function formatCzk(n: number): string {
  // "1 490 Kč" with a non-breaking space, as on the studio's price list.
  return `${n.toLocaleString('cs-CZ').replace(/\s/g, ' ')} Kč`;
}
