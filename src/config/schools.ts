// CV-12: school e-mail domains that qualify for the student price (Proposal, O3).
// A suffix match, so faculty and student subdomains count too (fit.cvut.cz, student.cuni.cz).
// Secondary schools are too many to list; their students use ISIC, checked by the studio.
// Check this list before launch.

export const SCHOOL_DOMAINS: readonly string[] = [
  // Czech public universities
  'cuni.cz', 'muni.cz', 'upol.cz', 'cvut.cz', 'vutbr.cz', 'vscht.cz', 'vse.cz', 'czu.cz', 'mendelu.cz',
  'vfu.cz', 'ujep.cz', 'jcu.cz', 'zcu.cz', 'tul.cz', 'uhk.cz', 'upce.cz', 'osu.cz', 'vsb.cz', 'slu.cz',
  'utb.cz', 'amu.cz', 'famu.cz', 'damu.cz', 'hamu.cz', 'avu.cz', 'umprum.cz', 'vsup.cz', 'jamu.cz',
  'vspj.cz', 'vstecb.cz', 'polac.cz', 'unob.cz',
  // Czech private universities (larger ones)
  'vsfs.cz', 'ambis.cz', 'unyp.cz', 'aauni.edu', 'mup.cz', 'cevro.cz', 'savs.cz', 'vsem.cz', 'newton.university',
  'unicornuniversity.net', 'vso-praha.eu',
  // Slovak universities
  'uniba.sk', 'stuba.sk', 'tuke.sk', 'upjs.sk', 'euba.sk', 'uniza.sk', 'ukf.sk', 'uniag.sk', 'umb.sk',
  'unipo.sk', 'tuzvo.sk', 'vsmu.sk', 'tnuni.sk', 'ucm.sk', 'truni.sk',
];

/** International academic domains: *.edu, *.ac.uk, *.ac.at … */
const ACADEMIC_SUFFIX = /(\.edu|\.edu\.[a-z]{2}|\.ac\.[a-z]{2})$/;

export function schoolDomainOf(email: string): string | null {
  const m = /^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email.trim());
  if (!m) return null;
  const host = m[1]!.toLowerCase();
  for (const d of SCHOOL_DOMAINS) if (host === d || host.endsWith(`.${d}`)) return d;
  if (ACADEMIC_SUFFIX.test(host)) return host;
  return null;
}

/** ISIC card numbers look like "S 420 123 456 789 A": a letter, 12 digits and a letter. */
export function normalizeIsic(s: string): string | null {
  const t = s.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z]\d{12}[A-Z]$/.test(t) ? t : null;
}
