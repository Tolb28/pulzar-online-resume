// CV-1: fixed sections and limits. Numbers from the PRD are marked "PRD"; the rest are a
// Proposal (field lengths the PRD does not give) and are listed in docs/plan.md.

export const LIMITS = {
  profile: {
    name: 50, // Proposal
    headline: 80, // PRD
    location: 40, // Proposal
    links: 6, // PRD: LinkedIn, GitHub, Behance, Dribbble, website, plus one more
    linkLabel: 25, // Proposal
    url: 300, // Proposal
    email: 120, // Proposal
    phone: 25, // Proposal
  },
  about: 600, // PRD
  experience: { items: 8, role: 60, employer: 60, bullets: 5, bullet: 160 }, // items, bullets, bullet: PRD
  education: { items: 5, school: 80, field: 80, bullets: 2, bullet: 120 }, // items, bullets: PRD
  projects: { title: 60, text: 300, url: 300 }, // title, text: PRD (count is per tier)
  skills: { tags: 20, groups: 4, tag: 30, groupName: 30 }, // tags, groups: PRD
  languages: { items: 6, name: 30 }, // items: PRD
  certifications: { items: 8, name: 80, issuer: 50 }, // items: PRD
  interests: 160, // PRD
} as const;

/**
 * A draft may go over the limits (the editor shows what is over and cuts nothing), but not
 * without bound: past this many times a limit a save is refused with a message, so a paste
 * of a whole document cannot fill the database. Nothing is truncated either way.
 */
export const DRAFT_HARD_CAP_FACTOR = 10;
export const DRAFT_MAX_LIST_ITEMS = 50;
