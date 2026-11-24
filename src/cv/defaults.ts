import { DEFAULT_ACCENT } from '../config/templates';
import { BODY_SECTIONS, type BodySectionKey, type CvBody, type CvDesign, type L10n, type ProfileBlock } from './types';

export const emptyL10n = (): L10n => ({ cs: '', en: '' });

export function emptyProfile(): ProfileBlock {
  return { name: '', headline: emptyL10n(), location: emptyL10n(), photo: null, links: [], email: '', phone: '' };
}

/** Graduates put education and projects first (CV-1 example). */
export const GRADUATE_ORDER: BodySectionKey[] = [
  'about',
  'education',
  'projects',
  'experience',
  'skills',
  'languages',
  'certifications',
  'interests',
];

export function emptyBody(order: BodySectionKey[] = [...BODY_SECTIONS]): CvBody {
  return {
    v: 1,
    about: emptyL10n(),
    experience: [],
    education: [],
    projects: [],
    skills: { grouped: false, groups: [] },
    languages: [],
    certifications: [],
    interests: emptyL10n(),
    layout: { order, hidden: [] },
  };
}

export function defaultDesign(): CvDesign {
  return { template: 'moderni', accent: DEFAULT_ACCENT, cover: null };
}
