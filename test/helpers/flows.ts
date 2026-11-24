import { expect } from 'vitest';
import type { Browser } from './env';

/** Create and fill a CV through the editor, as a holder would. */
export async function fillCv(b: Browser, opts: { tier?: string; lang?: string; slug?: string } = {}) {
  let r = await b.post('/ucet/novy', { name: 'Jana Nováková', slug: opts.slug ?? 'jana-novakova', tier: opts.tier ?? 'zaklad', lang: opts.lang ?? 'cs', template: 'moderni' });
  expect(r.status).toBe(303);
  r = await b.post('/ucet/upravit/hlavicka', {
    name: 'Jana Nováková',
    'headline.cs': 'Produktová designérka',
    'headline.en': 'Product designer',
    'location.cs': 'Praha',
    'location.en': 'Prague',
    'links.linkedin.url': 'linkedin.com/in/jana-novakova',
    'links.website.url': 'https://jananovakova.cz',
  });
  expect(r.status).toBe(303);
  r = await b.post('/ucet/upravit/kontakt', { email: 'jana@example.cz', phone: '+420 777 123 456' });
  expect(r.status).toBe(303);
  r = await b.post('/ucet/upravit/o-mne', { 'about.cs': 'Navrhuji přehledná rozhraní.', 'about.en': 'I design clear interfaces.' });
  expect(r.status).toBe(303);
  // Add an experience entry, then fill it.
  await b.post('/ucet/upravit/zkusenosti', { op: 'add' });
  r = await b.post('/ucet/upravit/zkusenosti', {
    'experience.0.role.cs': 'UX designérka',
    'experience.0.role.en': 'UX designer',
    'experience.0.employer': 'Alza.cz',
    'experience.0.from': '2019-03',
    'experience.0.present': '1',
    'experience.0.bullets.0.cs': 'Navrhla jsem nový filtr produktů.',
    'experience.0.bullets.0.en': 'I designed the new product filter.',
  });
  expect(r.status).toBe(303);
}

