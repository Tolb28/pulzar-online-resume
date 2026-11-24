import { describe, expect, it } from 'vitest';
import { getCvBySlug } from '../src/services/cvs';
import { EDITOR_SECTIONS } from '../src/app/views/editor';
import { Browser, harness } from './helpers/env';
import { fillCv } from './helpers/flows';

describe('every page renders', () => {
  it('for a holder with a published Profi CV and for the studio', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b, { tier: 'profi', lang: 'cs,en' });
    const pay = await b.post('/ucet/zverejnit');
    await b.post(pay.headers.get('location')!);
    const holderPages = [
      '/ucet',
      ...EDITOR_SECTIONS.map((s) => `/ucet/upravit/${s.key}`),
      '/ucet/nahled',
      '/ucet/nahled?lang=en',
      '/ucet/zverejnit',
      '/ucet/nastaveni',
      '/ucet/student',
      '/ucet/statistiky',
      '/ucet/napoveda/linkedin',
      '/ucet/import',
    ];
    for (const path of holderPages) {
      const r = await b.get(path);
      const body = await r.text();
      expect(r.status, path).toBe(200);
      expect(body, path).not.toContain('Něco se pokazilo');
    }
    const pdf = await b.get('/ucet/nahled.pdf?lang=en');
    expect(pdf.headers.get('content-type')).toBe('application/pdf');

    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    const studio = new Browser(h);
    await studio.signIn('studio@pulzar.test');
    const adminPages = ['/admin', '/admin/cv', '/admin/cv?q=jana', `/admin/cv/${row.id}`, `/admin/cv/${row.id}/nahled`, '/admin/studenti', '/admin/domeny', '/admin/audit', '/admin/soukromi', ...EDITOR_SECTIONS.map((s) => `/admin/cv/${row.id}/upravit/${s.key}`)];
    for (const path of adminPages) {
      const r = await studio.get(path);
      expect(r.status, path).toBe(200);
    }
    // Unknown things are a clean 404, not an error.
    expect((await b.get('/ucet/upravit/neexistuje')).status).toBe(404);
    expect((await new Browser(h).get('/nikdo-takovy')).status).toBe(404);
    expect((await new Browser(h).get('/media/cv/abcd/photo-xyz1.jpg')).status).toBe(404);
  });
});
