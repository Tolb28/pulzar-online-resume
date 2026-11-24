import type { Child } from 'hono/jsx';
import { TIERS } from '../config/tiers';
import { formatRange, languageName, LEVEL_LABELS, pick, SECTION_LABELS, UI } from '../cv/i18n';
import { displayUrl } from '../cv/text';
import type { BodySectionKey, CvDoc, Lang, Visibility } from '../cv/types';
import { visibleSections } from '../pdf/render';
import { LINK_LABELS, LinkIcon } from './icons';
import { cvCss, templateFonts } from './styles';

// The public CV page (CV-2 web layouts, CV-4, CV-5, CV-7, CV-9, CV-16).
// The holder's e-mail and phone are never written into this HTML (CV-4 AC).

export interface CvPageProps {
  doc: CvDoc;
  lang: Lang;
  /** "/jana-novakova", or "" on the holder's own domain. */
  basePath: string;
  /** "https://cv.pulzarstudio.cz" or "https://jana.cz". */
  origin: string;
  visibility: Visibility;
  /** Turnstile site key, or "dev" for local development. */
  siteKey: string;
  hasPdf: boolean;
  salesUrl: string;
  nonce: string;
  mediaUrl: (key: string) => string;
  publishedAt?: number;
  preview?: boolean;
  /** The preferred address when it differs from this host (an own domain, CV-10). */
  canonical?: { origin: string; basePath: string };
}

const SECTION_IDS: Record<BodySectionKey, string> = {
  about: 'o-mne',
  experience: 'zkusenosti',
  education: 'vzdelani',
  projects: 'projekty',
  skills: 'dovednosti',
  languages: 'jazyky',
  certifications: 'certifikaty',
  interests: 'zajmy',
};

function langPath(basePath: string, lang: Lang, primary: Lang): string {
  return lang === primary ? basePath || '/' : `${basePath}/${lang}`;
}

/** JSON for a <script> element: "<" is escaped so the text cannot close the element. */
function safeJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** CV-16: ProfilePage + Person, only on public CVs, never with e-mail or phone. */
export function jsonLd(doc: CvDoc, lang: Lang, url: string, mediaUrl: (k: string) => string, publishedAt?: number) {
  const p = doc.profile;
  const b = doc.body;
  const current = b.experience.find((e) => e.to === null);
  const person: Record<string, unknown> = {
    '@type': 'Person',
    name: p.name,
    url,
  };
  const headline = pick(p.headline, lang);
  if (headline) person.jobTitle = headline;
  if (p.photo) person.image = mediaUrl(p.photo.key);
  const loc = pick(p.location, lang);
  if (loc) person.address = { '@type': 'PostalAddress', addressLocality: loc };
  if (p.links.length) person.sameAs = p.links.map((l) => l.url);
  if (current && current.employer) person.worksFor = { '@type': 'Organization', name: current.employer };
  if (b.education.length && !b.layout.hidden.includes('education')) {
    person.alumniOf = b.education.map((e) => ({ '@type': 'EducationalOrganization', name: pick(e.school, lang) }));
  }
  if (b.languages.length && !b.layout.hidden.includes('languages')) {
    person.knowsLanguage = b.languages.map((l) => languageName(l.code, l.name, 'en'));
  }
  const tags = b.layout.hidden.includes('skills') ? [] : b.skills.groups.flatMap((g) => g.tags.map((t) => pick(t, lang)));
  if (tags.length) person.knowsAbout = tags;
  const page: Record<string, unknown> = { '@context': 'https://schema.org', '@type': 'ProfilePage', url, inLanguage: lang, mainEntity: person };
  if (publishedAt) page.dateModified = new Date(publishedAt).toISOString();
  return page;
}

function Section({ id, title, children }: { id: string; title: string; children: Child }) {
  return (
    <section class="cv-sec" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function Paragraphs({ text }: { text: string }) {
  const paras = text.split(/\n+/).filter((p) => p.trim());
  return (
    <>
      {paras.map((p) => (
        <p>{p}</p>
      ))}
    </>
  );
}

function Bullets({ items }: { items: string[] }) {
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <ul>
      {shown.map((t) => (
        <li>{t}</li>
      ))}
    </ul>
  );
}

function SectionBody({ doc, keyName, lang, mediaUrl }: { doc: CvDoc; keyName: BodySectionKey; lang: Lang; mediaUrl: (k: string) => string }) {
  const b = doc.body;
  switch (keyName) {
    case 'about':
      return <Paragraphs text={pick(b.about, lang)} />;
    case 'interests':
      return <Paragraphs text={pick(b.interests, lang)} />;
    case 'experience':
      return (
        <>
          {b.experience.map((e) => (
            <article class="cv-entry">
              <header>
                <div>
                  <h3>{pick(e.role, lang)}</h3>
                  <p class="cv-org">{e.employer}</p>
                </div>
                <p class="cv-date">{formatRange(e.from, e.to, lang)}</p>
              </header>
              <Bullets items={e.bullets.map((t) => pick(t, lang))} />
            </article>
          ))}
        </>
      );
    case 'education':
      return (
        <>
          {b.education.map((e) => (
            <article class="cv-entry">
              <header>
                <div>
                  <h3>{pick(e.school, lang)}</h3>
                  {pick(e.field, lang) && <p class="cv-org">{pick(e.field, lang)}</p>}
                </div>
                <p class="cv-date">{formatRange(e.from, e.to, lang)}</p>
              </header>
              <Bullets items={e.bullets.map((t) => pick(t, lang))} />
            </article>
          ))}
        </>
      );
    case 'projects': {
      const images = TIERS[doc.tier].projectImages;
      return (
        <div class="cv-projects">
          {b.projects.map((p) => (
            <article class="cv-project">
              {images && p.image && <img src={mediaUrl(p.image.key)} width={p.image.width || undefined} height={p.image.height || undefined} alt="" loading="lazy" decoding="async" />}
              <div>
                <h3>{pick(p.title, lang)}</h3>
                {pick(p.text, lang) && <p>{pick(p.text, lang)}</p>}
                {p.url && (
                  <a href={p.url} rel="noopener noreferrer nofollow" target="_blank">
                    {displayUrl(p.url)}
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      );
    }
    case 'skills': {
      const groups = b.skills.groups.filter((g) => g.tags.length);
      if (!b.skills.grouped) {
        return (
          <ul class="cv-tags">
            {groups
              .flatMap((g) => g.tags)
              .map((t) => pick(t, lang))
              .filter(Boolean)
              .map((t) => (
                <li>{t}</li>
              ))}
          </ul>
        );
      }
      return (
        <>
          {groups.map((g) => (
            <div class="cv-group">
              {pick(g.name, lang) && <h3>{pick(g.name, lang)}</h3>}
              <ul class="cv-tags">
                {g.tags
                  .map((t) => pick(t, lang))
                  .filter(Boolean)
                  .map((t) => (
                    <li>{t}</li>
                  ))}
              </ul>
            </div>
          ))}
        </>
      );
    }
    case 'languages':
      return (
        <ul class="cv-langs">
          {b.languages.map((l) => (
            <li>
              <strong>{languageName(l.code, l.name, lang)}</strong> <span>{LEVEL_LABELS[l.level][lang]}</span>
            </li>
          ))}
        </ul>
      );
    case 'certifications':
      return (
        <ul class="cv-certs">
          {b.certifications.map((c) => (
            <li>
              <span>
                <strong>{pick(c.name, lang)}</strong>
                {c.issuer && <span class="cv-org"> · {c.issuer}</span>}
              </span>
              {c.year && <span class="cv-date">{c.year}</span>}
            </li>
          ))}
        </ul>
      );
  }
}

export function CvPage(props: CvPageProps) {
  const { doc, lang, basePath, origin, visibility, siteKey, hasPdf, salesUrl, nonce, mediaUrl, preview } = props;
  const p = doc.profile;
  const ui = UI[lang]!;
  const primary = doc.langs[0] ?? lang;
  const other = doc.langs.find((l) => l !== lang);
  const canonOrigin = props.canonical?.origin ?? origin;
  const canonBase = props.canonical?.basePath ?? basePath;
  const url = canonOrigin + langPath(canonBase, lang, primary);
  const indexable = visibility === 'public' && !preview;
  const headline = pick(p.headline, lang);
  const location = pick(p.location, lang);
  const showContact = !doc.body.layout.hidden.includes('contact') && !!(p.email || p.phone);
  const template = doc.design.template;
  const title = `${p.name} – ${ui.cvTitle}`;
  const sections = visibleSections(doc, lang);
  const cover = TIERS[doc.tier].studioDesign ? doc.design.cover : null;
  const bodyFont = templateFonts(template)[1];
  const actionAttrs = (act: string) => (preview ? { disabled: true, title: 'V náhledu nefunguje' } : { 'data-act': act });

  const head = (
    <header class="cv-head">
      {p.photo && <img class="cv-photo" src={mediaUrl(p.photo.key)} width={p.photo.width || 128} height={p.photo.height || 128} alt={p.name} />}
      <div>
        <h1>{p.name}</h1>
        {headline && <p class="cv-headline">{headline}</p>}
        {location && <p class="cv-loc">{location}</p>}
        {p.links.length > 0 && (
          <ul class="cv-links">
            {p.links.map((l) => {
              const label = l.kind === 'other' && l.label ? l.label : LINK_LABELS[l.kind];
              return (
                <li>
                  <a href={l.url} rel="me noopener noreferrer" target="_blank" aria-label={`${label}: ${displayUrl(l.url)}`} title={label}>
                    <LinkIcon kind={l.kind} />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
        <div class="cv-actions">
          {showContact && (
            <button type="button" class="btn" {...actionAttrs('contact')}>
              {ui.showContact}
            </button>
          )}
          {hasPdf && (
            <button type="button" class={showContact ? 'btn btn-2' : 'btn'} {...actionAttrs('pdf')}>
              {ui.downloadPdf}
            </button>
          )}
          {other && (
            <a class="cv-lang" href={langPath(basePath, other, primary)} hreflang={other} lang={other}>
              {UI[lang]!.switchLang}
            </a>
          )}
        </div>
        <div id="cv-ts" class="cv-ts" hidden></div>
        <div id="cv-contact" class="cv-contact" aria-live="polite" hidden></div>
        {(showContact || hasPdf) && !preview && (
          <noscript>
            <p class="cv-note">{ui.noJs}</p>
          </noscript>
        )}
      </div>
    </header>
  );

  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="robots" content={indexable ? 'index, follow' : 'noindex, nofollow, noarchive'} />
        {headline && <meta name="description" content={headline} />}
        <link rel="canonical" href={url} />
        {doc.langs.length > 1 &&
          doc.langs.map((l) => <link rel="alternate" hreflang={l} href={canonOrigin + langPath(canonBase, l, primary)} />)}
        <meta property="og:type" content="profile" />
        <meta property="og:title" content={title} />
        {headline && <meta property="og:description" content={headline} />}
        <meta property="og:url" content={url} />
        <meta property="og:locale" content={lang === 'cs' ? 'cs_CZ' : 'en_US'} />
        {p.photo && <meta property="og:image" content={mediaUrl(p.photo.key)} />}
        <meta name="twitter:card" content="summary" />
        <meta name="theme-color" content={doc.design.accent} />
        <link rel="preload" href={`/static/fonts/${bodyFont}.woff2`} as="font" type="font/woff2" crossorigin="anonymous" />
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: cvCss(template, doc.design.accent) }} />
        {indexable && (
          <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: safeJson(jsonLd(doc, lang, url, mediaUrl, props.publishedAt)) }} />
        )}
      </head>
      <body class={`t-${template}`}>
        {preview && <div class="cv-preview">Náhled konceptu – takto bude životopis vypadat po zveřejnění.</div>}
        {cover && <img class="cv-cover" src={mediaUrl(cover.key)} alt="" width={cover.width || undefined} height={cover.height || undefined} />}
        <div
          class="cv-root"
          data-cv={basePath}
          data-sk={siteKey}
          data-lang={lang}
          data-copy={ui.copy}
          data-copied={ui.copied}
          data-fail={ui.failed}
          data-wait={ui.checking}
        >
          {template === 'vyrazny' ? (
            <>
              <div class="cv-band">{head}</div>
              <main class="cv-main cv-body">
                {sections.map((k) => (
                  <Section id={SECTION_IDS[k]} title={SECTION_LABELS[k][lang]}>
                    <SectionBody doc={doc} keyName={k} lang={lang} mediaUrl={mediaUrl} />
                  </Section>
                ))}
                <footer class="cv-foot">
                  <a href={`${salesUrl}?src=cv-footer`}>{ui.madeWith}</a>
                </footer>
              </main>
            </>
          ) : (
            <div class="cv">
              {head}
              <main class="cv-body">
                {sections.map((k) => (
                  <Section id={SECTION_IDS[k]} title={SECTION_LABELS[k][lang]}>
                    <SectionBody doc={doc} keyName={k} lang={lang} mediaUrl={mediaUrl} />
                  </Section>
                ))}
              </main>
              <footer class="cv-foot">
                <a href={`${salesUrl}?src=cv-footer`}>{ui.madeWith}</a>
              </footer>
            </div>
          )}
        </div>
        {(showContact || hasPdf) && !preview && <script src="/static/reveal.js" defer></script>}
      </body>
    </html>
  );
}

/** PL-7's inactive state, used for a paused or expired CV (CV-8). */
export function InactivePage({ lang, nonce }: { lang: Lang; nonce: string }) {
  const ui = UI[lang]!;
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{ui.inactive}</title>
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: cvCss('moderni', '#334155') }} />
      </head>
      <body>
        <main class="cv-gate">
          <h1>{ui.inactive}</h1>
          <p>{ui.inactiveHint}</p>
        </main>
      </body>
    </html>
  );
}

/** CV-14: the PIN gate for a private CV. */
export function PinPage({ lang, nonce, action, error, accent }: { lang: Lang; nonce: string; action: string; error?: 'wrong' | 'locked'; accent: string }) {
  const ui = UI[lang]!;
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{ui.pinTitle}</title>
        <style nonce={nonce} dangerouslySetInnerHTML={{ __html: cvCss('moderni', accent) }} />
      </head>
      <body>
        <main class="cv-gate">
          <h1>{ui.pinTitle}</h1>
          <p>{ui.pinHint}</p>
          {error && (
            <p class="err" role="alert">
              {error === 'wrong' ? ui.pinWrong : ui.pinLocked}
            </p>
          )}
          <form method="post" action={action}>
            <label class="sr-only" for="pin">
              {ui.pinLabel}
            </label>
            <input id="pin" name="pin" inputmode="numeric" autocomplete="off" pattern="[0-9]{4,6}" minlength={4} maxlength={6} required autofocus />
            <button class="btn" type="submit">
              {ui.pinSubmit}
            </button>
          </form>
        </main>
      </body>
    </html>
  );
}
