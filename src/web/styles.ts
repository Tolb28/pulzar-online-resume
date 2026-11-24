import { TEMPLATES, WEB_FONT_FACES, type FontId } from '../config/templates';
import { tint } from '../cv/color';
import type { TemplateId } from '../cv/types';

// CSS for the public CV page, inlined (one request, fast first paint on a phone).
// Light only: a CV is a document and should look like its PDF.

const BASE = `
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;color-scheme:light}
body{margin:0;background:var(--bg);color:var(--ink);font:400 1.0625rem/1.6 var(--body);font-kerning:normal;overflow-wrap:break-word}
a{color:var(--link);text-underline-offset:.16em;text-decoration-thickness:.07em}
a:hover{text-decoration-thickness:.12em}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:2px}
h1,h2,h3{font-family:var(--head);line-height:1.2;margin:0;text-wrap:balance}
h1{font-size:clamp(2rem,1.6rem + 2vw,2.75rem);letter-spacing:-.015em}
h3{font-family:var(--body);font-weight:600;font-size:1.02em;line-height:1.4}
p{margin:0}
.cv-sec p+p{margin-top:.7em}
ul{margin:.35em 0 0;padding-left:1.15em}
li{margin:.2em 0}
li::marker{color:var(--accent)}
img{max-width:100%;height:auto}
.cv-headline{font-size:1.15em;color:var(--muted);margin-top:.35em}
.cv-loc{color:var(--muted);margin-top:.35em;font-size:.95em}
.cv-links{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;padding:0;margin:1rem 0 0}
.cv-links a{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:12px;background:var(--tint);color:var(--accent-ink)}
.cv-links a:hover{background:var(--tint-2)}
.cv-links svg{width:22px;height:22px;fill:currentColor}
.cv-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-top:1.4rem}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.5em;min-height:44px;padding:.7em 1.15em;border-radius:12px;border:2px solid var(--accent);background:var(--accent);color:#fff;font:600 .95rem/1.1 var(--body);cursor:pointer;text-decoration:none}
.btn:hover{filter:brightness(1.08)}
.btn-2{background:transparent;color:var(--accent-ink)}
.btn[aria-busy=true]{opacity:.6;cursor:progress}
.btn[disabled]{opacity:.55;cursor:not-allowed}
.cv-lang{font-weight:600;font-size:.95rem;padding:.6em .4em}
.cv-contact{margin-top:1rem;padding:.9rem 1rem;border-radius:12px;background:var(--tint);display:grid;gap:.45rem}
.cv-contact p{display:flex;flex-wrap:wrap;align-items:center;gap:.6rem}
.cv-contact a{font-weight:600;color:var(--ink)}
.cv-copy{font:600 .85rem/1 var(--body);padding:.55em .8em;border-radius:8px;border:1.5px solid var(--accent);background:#fff;color:var(--accent-ink);cursor:pointer;min-height:36px}
.cv-ts:not([hidden]){margin-top:.8rem}
.cv-note{margin-top:.8rem;font-size:.88rem;color:var(--muted)}
.cv-sec{margin-top:2.6rem}
.cv-sec>h2{margin-bottom:1rem}
.cv-entry+.cv-entry{margin-top:1.4rem}
.cv-entry>header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:.1rem 1rem}
.cv-org{color:var(--muted)}
.cv-date{color:var(--muted);font-size:.9em;white-space:nowrap;font-variant-numeric:tabular-nums}
.cv-tags{display:flex;flex-wrap:wrap;gap:.45rem;list-style:none;padding:0;margin:0}
.cv-tags li{margin:0;padding:.3em .75em;border-radius:999px;background:var(--tint);font-size:.93em;line-height:1.35}
.cv-group+.cv-group{margin-top:1rem}
.cv-group h3{font-size:.95em;margin-bottom:.45rem}
.cv-langs{display:grid;grid-template-columns:repeat(auto-fill,minmax(12rem,1fr));gap:.5rem 1.5rem;list-style:none;padding:0;margin:0}
.cv-langs li{margin:0;display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding:.35em 0}
.cv-langs span{color:var(--muted)}
.cv-certs{list-style:none;padding:0;margin:0}
.cv-certs li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.1rem 1rem;margin:0;padding:.4em 0;border-bottom:1px solid var(--line)}
.cv-certs .cv-org{font-size:.95em}
.cv-projects{display:grid;gap:1.2rem;grid-template-columns:repeat(auto-fill,minmax(16rem,1fr))}
.cv-project{border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
.cv-project img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:var(--tint)}
.cv-project div{padding:1rem 1.1rem 1.1rem}
.cv-project p{margin-top:.35rem;font-size:.96em}
.cv-project a{display:inline-block;margin-top:.5rem;font-weight:600;font-size:.93em}
.cv-cover{display:block;width:100%;max-height:22rem;object-fit:cover}
.cv-preview{position:sticky;top:0;z-index:5;background:#111827;color:#fff;text-align:center;font:600 .9rem/1.4 system-ui,sans-serif;padding:.6rem 1rem}
.cv-foot{margin:4rem 0 2rem;font-size:.85rem;color:var(--muted)}
.cv-foot a{color:var(--muted)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.cv-gate{max-width:28rem;margin:12vh auto;padding:2rem 1.25rem;text-align:center}
.cv-gate h1{font-size:1.6rem}
.cv-gate p{margin-top:.8rem;color:var(--muted)}
.cv-gate form{margin-top:1.5rem;display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap}
.cv-gate input{font:600 1.3rem/1 var(--body);letter-spacing:.3em;text-align:center;width:9rem;padding:.55em .5em;border:2px solid var(--line);border-radius:12px}
.cv-gate .err{color:#b42318;font-weight:600}
@media print{.cv-actions,.cv-links,.cv-foot,.cv-preview{display:none!important}.cv-sec{break-inside:avoid-page}body{font-size:11pt}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;

const KLASIK = `
.cv{max-width:47rem;margin:0 auto;padding:3.5rem 1.25rem 0}
.cv-head{text-align:center;padding-bottom:2rem;border-bottom:2px solid var(--accent)}
.cv-photo{width:120px;height:120px;object-fit:cover;border-radius:10px;margin:0 auto 1.2rem;display:block}
.cv-links,.cv-actions{justify-content:center}
.cv-contact{justify-items:center;text-align:center}
.cv-sec>h2{font-size:1.45rem;color:var(--accent-ink);padding-bottom:.35rem;border-bottom:1px solid var(--line)}
`;

const MODERNI = `
.cv{max-width:74rem;margin:0 auto;padding:2.5rem 1.25rem 0}
.cv-photo{width:132px;height:132px;object-fit:cover;border-radius:50%;margin-bottom:1.2rem;display:block}
.cv-headline{color:var(--accent-ink);font-weight:600}
.cv-sec>h2{font-size:.82rem;letter-spacing:.09em;text-transform:uppercase;color:var(--accent-ink);padding-bottom:.55rem;border-bottom:1px solid var(--line)}
@media (min-width:60rem){
 .cv{display:grid;grid-template-columns:19rem minmax(0,1fr);gap:4rem;padding-top:4rem}
 .cv-head{position:sticky;top:2rem;align-self:start}
 .cv-actions{flex-direction:column;align-items:stretch}
 .cv-body>.cv-sec:first-child{margin-top:0}
 .cv-foot{grid-column:2}
}
`;

const VYRAZNY = `
.cv-band{background:var(--accent);color:#fff}
.cv-head{max-width:62rem;margin:0 auto;padding:3rem 1.25rem 2.5rem;display:grid;gap:1.5rem;align-items:center}
.cv-head h1{color:#fff}
.cv-headline,.cv-loc{color:rgba(255,255,255,.9)}
.cv-photo{width:128px;height:128px;object-fit:cover;border-radius:50%;border:4px solid rgba(255,255,255,.35)}
.cv-links a{background:rgba(255,255,255,.16);color:#fff}
.cv-links a:hover{background:rgba(255,255,255,.28)}
.cv-head .btn{background:#fff;color:var(--accent-ink);border-color:#fff}
.cv-head .btn-2{background:transparent;color:#fff;border-color:rgba(255,255,255,.75)}
.cv-head .cv-lang{color:#fff}
.cv-head .cv-contact{background:rgba(255,255,255,.14)}
.cv-head .cv-contact a{color:#fff}
.cv-head .cv-note{color:rgba(255,255,255,.85)}
.cv-head :focus-visible{outline-color:#fff}
.cv-main{max-width:62rem;margin:0 auto;padding:0 1.25rem}
.cv-sec>h2{font-size:1.3rem;display:flex;align-items:center;gap:.6rem}
.cv-sec>h2::before{content:"";width:.5rem;height:1.15em;border-radius:2px;background:var(--accent)}
@media (min-width:52rem){
 .cv-head{grid-template-columns:auto 1fr}
 .cv-sec{display:grid;grid-template-columns:13rem minmax(0,1fr);gap:2rem}
 .cv-sec>h2{align-self:start;margin:0}
}
`;

const TEMPLATE_CSS: Record<TemplateId, string> = { klasik: KLASIK, moderni: MODERNI, vyrazny: VYRAZNY };

function fontFaces(ids: FontId[]): string {
  return [...new Set(ids)]
    .map((id) => {
      const f = WEB_FONT_FACES[id];
      return `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:normal;font-display:swap;src:url(/static/fonts/${id}.woff2) format("woff2")}`;
    })
    .join('');
}

export function templateFonts(template: TemplateId): FontId[] {
  const f = TEMPLATES[template].fonts;
  return [f.heading, f.body, f.bodyStrong];
}

/** All CSS for a CV page with the given template and accent. */
export function cvCss(template: TemplateId, accent: string): string {
  const t = TEMPLATES[template];
  const vars = `:root{--accent:${accent};--accent-ink:${accent};--link:${accent};--tint:${tint(accent, 0.9)};--tint-2:${tint(accent, 0.8)};--ink:#1f2328;--muted:#59636e;--line:#e3e6ea;--bg:#fff;--head:${t.fonts.css.heading};--body:${t.fonts.css.body}}`;
  return fontFaces(templateFonts(template)) + vars + BASE + TEMPLATE_CSS[template];
}
