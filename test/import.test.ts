import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { errorsOf, validateDoc } from '../src/cv/validate';
import { draftDoc, getCvBySlug } from '../src/services/cvs';
import { parseCsv, parseLinkedInZip, splitBullets } from '../src/services/import-linkedin';
import { Browser, harness } from './helpers/env';
import { fillCv } from './helpers/flows';

function linkedInZip(): Uint8Array<ArrayBuffer> {
  const positions = [
    'Company Name,Title,Description,Location,Started On,Finished On',
    '"Rohlík Group","Senior Product Designer","• Led the cart redesign (+4.2% conversion)\n• Built a design system for three teams","Prague","Mar 2021",""',
    ...Array.from({ length: 8 }, (_, i) => `"Firma ${i}","Designer ${i}","Work ${i}","Brno","${2010 + i}","${2011 + i}"`),
  ].join('\n');
  return zipSync({
    'Basic_LinkedInDataExport_11-24-2026/Profile.csv': strToU8(
      'First Name,Last Name,Maiden Name,Address,Birth Date,Headline,Summary,Industry,Zip Code,Geo Location,Twitter Handles,Websites,Instant Messengers\n' +
        'Jana,Nováková,Dvořáková,"Vinohradská 12, Praha",1990-05-01,"Product designer","I design clear interfaces.\nAnd test them.",Design,12000,"Prague, Czechia",,"[PORTFOLIO:https://jananovakova.cz],[OTHER:https://github.com/jana]",\n',
    ),
    'Basic_LinkedInDataExport_11-24-2026/Positions.csv': strToU8(positions),
    'Basic_LinkedInDataExport_11-24-2026/Education.csv': strToU8('School Name,Start Date,End Date,Notes,Degree Name,Activities\n"Univerzita Karlova",2013,2018,,"Mgr., Informatika","Diplomka o přístupnosti"\n'),
    'Basic_LinkedInDataExport_11-24-2026/Skills.csv': strToU8('Name\nFigma\nUser Research\n"Design Systems"\n'),
    'Basic_LinkedInDataExport_11-24-2026/Languages.csv': strToU8('Name,Proficiency\nCzech,Native or bilingual proficiency\nEnglish,Full professional proficiency\nKlingon,\n'),
    'Basic_LinkedInDataExport_11-24-2026/Certifications.csv': strToU8('Name,Url,Authority,Started On,Finished On,License Number\n"Google UX Design",https://coursera.org,Coursera,Jan 2022,,ABC\n'),
    'Basic_LinkedInDataExport_11-24-2026/Email Addresses.csv': strToU8('Email Address,Confirmed,Primary,Updated On\nold@example.cz,Yes,No,\njana@example.cz,Yes,Yes,\n'),
    'Basic_LinkedInDataExport_11-24-2026/Connections.csv': strToU8('Notes:\n"Lots of people"\n\nFirst Name,Last Name\nA,B\n'),
  }) as Uint8Array<ArrayBuffer>;
}

describe('CV-13 LinkedIn import', () => {
  it('parses CSV with quotes, doubled quotes and newlines', () => {
    expect(parseCsv('a,b\n"x, y","He said ""hi""\nthere"\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'He said "hi"\nthere'],
    ]);
    expect(splitBullets('• One\n• Two\n- Three\n1) Four')).toEqual(['One', 'Two', 'Three', 'Four']);
  });

  it('maps the export onto the sections and never reads sensitive fields (CV-6)', () => {
    const r = parseLinkedInZip(linkedInZip());
    expect(r.name).toBe('Jana Nováková');
    expect(r.headline).toBe('Product designer');
    expect(r.about).toBe('I design clear interfaces.\nAnd test them.');
    expect(r.location).toBe('Prague');
    expect(r.links.map((l) => l.kind)).toEqual(['website', 'github']);
    expect(r.email).toBe('jana@example.cz');
    expect(r.experience[0]).toMatchObject({ role: 'Senior Product Designer', employer: 'Rohlík Group', from: '2021-03', to: null });
    expect(r.experience[0]!.bullets).toEqual(['Led the cart redesign (+4.2% conversion)', 'Built a design system for three teams']);
    expect(r.experience).toHaveLength(9);
    expect(r.education[0]).toMatchObject({ school: 'Univerzita Karlova', field: 'Mgr., Informatika', from: '2013-09', to: '2018-06' });
    expect(r.skills).toEqual(['Figma', 'User Research', 'Design Systems']);
    expect(r.languages.map((l) => [l.code, l.level])).toEqual([
      ['cs', 'native'],
      ['en', 'C1'],
      ['', 'B2'],
    ]);
    expect(r.certifications[0]).toMatchObject({ name: 'Google UX Design', issuer: 'Coursera', year: 2022 });
    const all = JSON.stringify(r);
    expect(all).not.toContain('1990-05-01');
    expect(all).not.toContain('Vinohradská');
    expect(all).not.toContain('12000');
    expect(all).not.toContain('Dvořáková');
    expect(r.notes.join(' ')).toContain('Zkušeností je 9, limit je 8');
    expect(r.notes.join(' ')).toContain('měsíc jsme odhadli');
    expect(r.notes.join(' ')).toContain('Datum narození a adresu z LinkedInu jsme záměrně nenačetli');
  });

  it('imports through review into the draft, flagging over-limit entries instead of dropping them', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b, { tier: 'profi', lang: 'cs,en' });
    const fd = new FormData();
    fd.append('file', new File([linkedInZip()], 'export.zip', { type: 'application/zip' }));
    const up = await b.request('POST', '/ucet/import', { body: fd });
    expect(up.status).toBe(303);
    const review = await (await b.get(up.headers.get('location')!)).text();
    expect(review).toContain('Zkušenosti (9)');
    expect(review).toContain('Zkušeností je 9, limit je 8');
    const save = await b.post(up.headers.get('location')!, { sections: ['name', 'about', 'experience', 'education', 'skills', 'languages', 'certifications'], lang: 'en' });
    expect(save.headers.get('location')).toBe('/ucet?ok=importovano');
    const row = (await getCvBySlug(h.deps.db, 'jana-novakova'))!;
    const doc = await draftDoc(h.deps.db, row);
    expect(doc.body.experience).toHaveLength(9);
    expect(doc.body.experience[0]!.role).toEqual({ cs: '', en: 'Senior Product Designer' });
    expect(doc.profile.headline).toEqual({ cs: 'Produktová designérka', en: 'Product designer' });
    const errs = errorsOf(validateDoc(doc));
    expect(errs.find((e) => e.path === 'body.experience')).toMatchObject({ code: 'too_many', actual: 9, limit: 8 });
    // The import is gone after use.
    expect((await b.get(up.headers.get('location')!)).status).toBe(404);
  });

  it('rejects files that are not a LinkedIn export', async () => {
    const h = harness();
    const b = new Browser(h);
    await b.signIn('jana@example.cz');
    await fillCv(b);
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array([1, 2, 3])], 'x.zip'));
    expect((await b.request('POST', '/ucet/import', { body: fd })).status).toBe(400);
    const fd2 = new FormData();
    fd2.append('file', new File([zipSync({ 'readme.txt': strToU8('hi') }) as Uint8Array<ArrayBuffer>], 'x.zip'));
    expect(await (await b.request('POST', '/ucet/import', { body: fd2 })).text()).toContain('nenašli data profilu');
  });
});
