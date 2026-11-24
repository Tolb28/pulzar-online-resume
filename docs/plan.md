# Pulzar CV: implementation plan

24 Nov 2026 · Plan for the PRD in [`prd/2026-11-24-online-cv-prd.md`](prd/2026-11-24-online-cv-prd.md)

Source tags as in the PRD: **PRD** (stated there), **Owner**, **Proposal** (decided here, open to change),
**Finding** (measured while building, with the numbers).

---

## 1. Scope of this repository

This repo is the CV product: the public page at `cv.pulzarstudio.cz/<slug>`, the PDF, the holder's editor,
the studio admin for Na míru, and the jobs that run the paid year, pauses and retention.

It also holds the **platform pieces the CV needs** (PL-x in the card PRD): accounts, magic-link sign-in,
the shared profile block, payments, Turnstile, the admin audit log, statistics. They live under
`src/platform/` behind small interfaces, so they can be swapped for the card's modules when both products
run on one platform (D1, D7).

**Not in this repo:** the studio site work in PRD §12 (sales page, `/prace/` tile, `/gdpr/` section,
Ceník row, `ROUTES` entry) lives in the studio site's own repository, and §11 (channels) is marketing.
§12 is listed at the end with what this repo provides for it.

### The card PRD was not available

The CV PRD says PL-1 to PL-18 from `2026-11-24-e-vizitka-prd.md` apply. That document is in another
repository this session could not open. Everything this plan assumes about PL-x is in §8; each assumption
names the code to change if the card PRD says otherwise.

---

## 2. Architecture

| Concern | Choice | Why |
|---|---|---|
| Runtime | Cloudflare Workers (TypeScript) | The PRD's platform is Cloudflare: Workers (E1), Turnstile (CV-4, E3), DNS on the studio's Cloudflare account (CV-10) |
| Routing / HTML | Hono with server-side JSX | Small, fast on Workers; public pages ship no framework JS (PL-13) |
| Data | D1 (SQLite), migrations in `migrations/` | One database for accounts, CVs, payments, audit log, statistics (§8: "the platform's own database") |
| Files | R2 bucket for photos, project images and the stored PDFs | PDFs are stored at every publish (CV-3) |
| Static assets | Workers static assets (`public/`): web fonts, the reveal script, editor script, CSS | Cached at the edge |
| PDF | **pdf-lib + fontkit inside the Worker** (E1) | See §6, F2 |
| Jobs | Cron trigger, daily | Expiry reminders, expiry, retention e-mails and deletion (CV-8), the privacy scan (§8 metric) |
| Anti-bot | Turnstile, loaded only on click (PL-14) | CV-4 |
| E-mail | `Mailer` interface: console (dev), Resend-compatible HTTP API | Provider is a platform decision (§8, A6) |
| Payments | `PaymentProvider` interface: dev provider, Stripe Checkout | Provider is a platform decision (§8, A5) |

### Hosts and routes

- `cv.pulzarstudio.cz/<slug>` – the CV in its primary language; `/<slug>/en` or `/<slug>/cs` – the other
  language (CV-9). Root `/` redirects to the sales page (O2 decides the address; `SALES_URL`).
- `cv.pulzarstudio.cz/ucet/…` – the holder's account and editor; `/prihlaseni` – sign-in;
  `/admin/…` – the studio. These words are reserved and cannot be slugs.
- Own domains (CV-10): any other host is looked up in `domains`; if active, that CV is served at `/`.
- `POST /<slug>/kontakt` and `/<slug>/pdf` – the contact reveal and the PDF download, both behind
  Turnstile (CV-4).

### Publishing

The editor saves a **draft**. Publishing validates it, renders one PDF per language from the same data,
stores them in R2 and saves a **snapshot**. The public page and the PDFs both come from the snapshot, so they
always match (G2). Settings that do not change content (visibility, pause, PIN) apply at once.

---

## 3. Requirement map

Status in this branch: **Done** (built and tested), **Partial** (what is missing is named), **Seam** (an
interface is in place; the real integration needs a decision or another repo).

| Req | What | Where | Tests | Status |
|---|---|---|---|---|
| CV-1 | Fixed sections and limits; hide/reorder; over-limit shown, never cut | `src/config/limits.ts`, `src/cv/validate.ts`, editor | `test/validate.test.ts`, app tests | Done |
| CV-2 | 3 templates (web + A4), Základ palette of 6, own accent contrast-checked, one font pair each | `src/config/templates.ts`, `src/web/`, `src/pdf/render.ts` | validate, pdf, web tests | Done |
| CV-3 | PDF at every publish, stored; A4, selectable text, embedded Czech fonts, reading order, links, ≤ 500 kB, file names; page-budget and `pdftotext` ACs | `src/pdf/`, publish service | `test/pdf.test.ts` | Done, see F1 |
| CV-4 | E-mail and phone not in HTML; reveal on click via Turnstile; PDF behind the same check; ≤ 3 kB JS | `public/static/reveal.js`, public routes | web + app tests | Done |
| CV-5 | Link-only by default (`noindex`, no sitemap); public opt-in | public routes, settings | app tests | Done |
| CV-6 | No sensitive fields; photo optional with a note | types, editor, validation (also flags them in free text) | validate tests | Done |
| CV-7 | Profile links as icons; LinkedIn help in the editor | web page, `/ucet/napoveda/linkedin` | web tests | Done; help text must be checked against LinkedIn at launch (AC) |
| CV-8 | Pause; inactive state; free reactivation in the paid period; yearly "keep it?" e-mail, deletion after 30 days with a warning | services, cron | lifecycle tests | Done |
| CV-9 | CS + EN for Profi/Na míru; language switch; one PDF per language | types, editor, web, publish | tests | Done |
| CV-10 | Own domain (Profi, Na míru), DNS on the studio's Cloudflare | host routing, admin domains | app tests | Partial: routing and admin activation; creating the hostname in Cloudflare is a manual step (docs/ops.md) |
| CV-11 | Na míru: pay → session → studio fills in (logged) → holder approves and publishes; studio cannot publish | admin + services | app tests | Done (booking by e-mail, as proposed) |
| CV-12 | Student price: school e-mail magic link or ISIC checked by the studio; Základ, first year only | billing, admin | app tests | Done (both methods, until O3) |
| CV-13 (P1) | LinkedIn ZIP import with review; over-limit flagged | `src/services/import-linkedin.ts` | import tests | Done; format to recheck at build time (E2) |
| CV-14 (P1) | PIN, rate-limited | public routes | app tests | Done |
| CV-15 (P1) | Views, PDF downloads, contact reveals | `src/platform/stats.ts` | app tests | Done |
| CV-16 (P1) | `ProfilePage` + `Person` on public CVs only | web page | web tests | Done |
| CV-17 (P1) | One click to the other product | – | – | Seam: needs the card platform |
| PL-9 dev. | CV defaults to link-only | settings default | tests | Done |
| PL-7 dev. | Pause is a second state alongside expiry | services | tests | Done |

§8 metrics: the admin dashboard computes the leading and lagging indicators from the database, including
"e-mail addresses found in public HTML" from the daily privacy scan.

---

## 4. Phases

The PRD (§10) splits the work into CV-a and CV-b and proposes starting after the card's phase 1 (D7). This
branch builds both on this repo's own platform layer, so the order below is the order of review and launch,
not of construction.

**CV-a** – Základ and Profi without own domains, the PDF, pausing, the student price.
Launch checklist: O1 prices, O3 student proof, L1/L2 legal texts, E3 Turnstile widget, payment and e-mail
providers (A5, A6), production D1/R2 created, `wrangler deploy`, smoke test (docs/ops.md).

**CV-b** – Na míru (needs O4: who runs the sessions and how many a week), own domains, statistics,
LinkedIn import (recheck E2).

Studio site (other repo): the sales page and `/prace/` tile at "Beta" go with CV-a.

---

## 5. Decisions made here (Proposal)

1. **Template names and fonts:** Klasik (Source Serif 4 + Public Sans), Moderní (Manrope + Inter),
   Výrazný (Space Grotesk + DM Sans). All SIL OFL without Reserved Font Names, so the subsets we ship are
   allowed; IBM Plex and Source Sans were dropped for that reason. Fonts are subset to the Latin ranges a
   Czech CV needs (≈ 30–57 kB per PDF font, 17–36 kB per web font).
2. **Characters the fonts cannot draw** (emoji, arrows, CJK) are flagged in the editor and block publishing,
   rather than printing empty boxes or being dropped silently.
3. **Kontakt sits in the header** (where recruiters and ATS parsers look). It can be hidden, not moved.
4. **Project images are web-only.** The PDF keeps projects as text and links: eight images would break the
   500 kB budget and the page budget, and ATS ignores them.
5. **Print layouts are single-column.** That makes reading order trivially correct for `pdftotext` and
   ATS. The web layouts differ more (sidebar in Moderní, band in Výrazný).
6. **Field lengths the PRD does not give** (name 50, role 60, employer 60, school 80, field 80, education
   bullet 120, certificate 80, issuer 50, skill tag 30, group name 30, language name 30, location 40). Chosen
   as realistic maxima and to keep the PDF short.
7. **Drafts can be over the limits; publishing cannot.** A save is refused only past 10× a limit (a pasted
   document), with a message, and nothing is ever truncated.
8. **Free text is checked for contact details and sensitive data.** An e-mail address or the holder's own
   phone in "O mně" would defeat CV-4, so it blocks publishing; other phone-like numbers, dates of birth,
   marital status and street addresses get a warning (CV-6).
9. **Missing translations** in a bilingual CV are warnings; the page falls back to the other language.
10. **Paid time keeps running during a pause** (PRD Proposal, kept). Expiry reminders 30 and 7 days ahead.
11. **Retention:** an offline CV (paused, expired or never published) gets "Chcete životopis dál uchovat?"
    12 months after it went offline, then yearly; a warning at day 23; deletion at day 30. Signing in counts
    as an answer.
12. **Na míru photo crop and cover image:** the studio can upload a cropped photo and a cover image for the
    web page (Na míru only).
13. **Upgrades between tiers** are not self-service in v1 (not in the PRD); the studio can change a tier in
    the admin. See N1.
14. **`Referrer-Policy: no-referrer`** on CV pages, so a link-only address does not leak to the sites it
    links to.
15. **"Dosud" is explicit.** An empty end date without "dosud" ticked is flagged, not read as "dosud".
16. **Sign-in sessions last 30 days.** Holders come back rarely; a new magic link is cheap.
17. **Images are re-encoded in the browser** before upload (size, and no EXIF); the server checks the bytes
    again and strips metadata from JPEGs.

---

## 6. Findings

**F1 – The page budget in CV-3 cannot hold with CV-1's limits.** The fixture test fills every limit at
once. A 160-character bullet needs 610–730 pt of line width at 9 pt in any of the candidate fonts; an A4
line is about 510 pt, so every maximal bullet wraps to two lines. Eight roles × five bullets is then about
80 lines, roughly 1.4 pages for Zkušenosti alone. Measured at the densest setting (8.5 pt):

| Limits: roles × bullets × chars, education entries, certificates | Základ | Profi |
|---|---|---|
| **PRD: 8 × 5 × 160, 5, 8** | **3 pages** | **4 pages** |
| 8 × 4 × 160, 5, 8 | 3 | 3 |
| 6 × 4 × 120, 4, 6 | 2 | 3 |
| 5 × 4 × 140, 3, 5 | 2 | 3 |

This branch keeps CV-1's limits and sets the budgets to 3 (Základ) and 4 (Profi, Na míru) in
`src/config/tiers.ts`; the fixture test enforces whatever is configured. Typical CVs are unaffected (the
realistic fixture is one page at 10 pt). **Owner decision (N2):** keep these budgets, or adopt one of the
tighter limit sets above, which meet the PRD's 2 and 3 pages.

**F2 – E1, the PDF engine.** pdf-lib with fontkit runs inside the Worker: no browser, no extra service,
no per-render fee. Measured in Node (same V8 engine): a typical CV renders in about 30 ms (median 29 ms), a
Profi CV with every limit at its maximum in about 85 ms (median 83 ms, it tries denser settings until it fits).
That needs the Workers Paid plan – the free plan allows 10 ms of CPU – with `limits.cpu_ms` set in
`wrangler.toml`. The smoke test renders and downloads a PDF in workerd itself. Output: 70–90 kB with a photo;
fonts are embedded as subsets with ToUnicode maps, so text extracts with diacritics intact. Browser Rendering was
not needed.

**F3 – Turnstile on the PDF download.** The download is a short POST that returns a signed, 10-minute pass
and then a normal GET of the file, so it works on iOS Safari and shares one check with the contact reveal
(one click for either, not two challenges).

**F4 – Turnstile and own domains (CV-10).** The reveal runs Turnstile on the page's own host, so every own
domain must be listed on the widget. A widget takes at most 10 hostnames on the Free plan (200 on Enterprise,
which also offers "Any hostname"), and a Free account has at most 20 widgets
([hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/),
[plans](https://developers.cloudflare.com/turnstile/plans/)). With the one site key this branch uses, that is
about nine own domains. Decide before CV-b grows past that (N6).

---

## 7. Data model (D1)

`accounts` (role holder/admin, student verification) · `profiles` (the shared profile block, PL-2) ·
`sessions` · `tokens` (magic links, school e-mail check, "keep my CV") · `cvs` (one per account: slug, tier,
languages, design, visibility, PIN hash, status draft/live/paused, draft JSON, published snapshot JSON, paid
until, pause and retention dates, Na míru state) · `payments` · `student_requests` · `domains` ·
`audit_log` (PL-11) · `stats_daily` (PL-16) · `notifications` (idempotent e-mails) · `rate_limits` ·
`media` · `privacy_scans`.

---

## 8. Assumptions about the platform (PL-x)

| # | Assumption | If the card PRD differs, change |
|---|---|---|
| A1 | PL-2: the profile block holds name, headline, location, photo, links, e-mail, phone; the CV header reads it | `src/cv/types.ts` `ProfileBlock`, `profiles` table |
| A2 | Sign-in is by e-mail magic link (the PRD mentions magic links for students) | `src/platform/auth.ts` |
| A3 | PL-7: an expired page shows an inactive state; the CV uses the same wording for pause and expiry, "Tento životopis teď není zveřejněný.", served as 404 + `noindex` | `src/web/inactive.tsx` |
| A4 | PL-11: every admin write is logged with who, what and when | `src/platform/audit.ts` |
| A5 | Payments: provider not known; Stripe Checkout (CZK) and a dev provider behind `PaymentProvider` | `src/platform/payments.ts` |
| A6 | E-mail: provider not known; Resend-compatible HTTP API and a console mailer | `src/platform/mail.ts` |
| A7 | PL-13/PL-14: public pages ship no JS, except the CV's 3 kB reveal script; third-party scripts load only on interaction | `public/static/reveal.js` |
| A8 | PL-16: statistics are counted server-side without cookies; bots and the holder's own views are not counted | `src/platform/stats.ts` |
| A9 | One account has at most one CV | `cvs.account_id UNIQUE` |
| A10 | Deleting a CV for inactivity also deletes the profile block when the account has no other product (no card in this repo) | `src/services/lifecycle.ts` |

---

## 9. Open questions

PRD questions still open: **O1** prices (B is in config), **O2** name and sales page address (`SALES_URL`),
**O3** student proof (both methods built), **O4** Na míru capacity, **O5** launch season, **O6** targets,
**O7** channels (`?src=` is recorded with statistics), **L1** /gdpr/ section, **L2** terms, **E2** LinkedIn
export format (importer is header-based and lenient), **E3** Turnstile widget (one site key per environment
in `TURNSTILE_SITE_KEY`).

New:

| # | Question | Who | Blocks |
|---|---|---|---|
| N1 | Upgrades between tiers during the paid year: self-service at the price difference, or through the studio? | Owner | nothing (admin can change tiers) |
| N2 | F1: keep page budgets 3/4, or tighten limits to fit 2/3? | Owner | sales page copy |
| N3 | Payment provider and invoicing (the voucher service may already have one) | Owner | CV-a launch |
| N4 | E-mail provider and sending domain | Owner | CV-a launch |
| N5 | Are statistics counted for Základ too (for §8) but shown only in Profi? This branch counts all, shows Profi+ | Owner | – |
| N6 | F4: own domains beyond ~9 – Turnstile Enterprise ("Any hostname"), one widget per 10 domains (needs a site key per domain), or run the check on `cv.pulzarstudio.cz` only | Owner + Engineering | CV-b at scale |

---

## 10. Testing

96 Vitest tests in 7 files, plus a browser smoke test. All pass on this branch (`npm test`, `npm run typecheck`).

- **Unit:** validation, sanitising, text helpers, colours (`test/validate.test.ts`).
- **PDF acceptance (CV-3):** `pdftotext` reading order for every template and language, the max-content
  fixture against the page budget and 500 kB with a photo, `pdffonts` for embedded subset fonts with
  ToUnicode, link annotations, metadata, file names (`test/pdf.test.ts`).
- **Web (CV-4, CV-5, CV-16):** the rendered HTML never contains the e-mail or phone; `noindex` unless public;
  JSON-LD only on public CVs; the reveal script ≤ 3 kB.
- **App:** the Worker's Hono app runs in Node against an in-memory D1 (node:sqlite) and R2, covering sign-in,
  editing over limits, publishing, the reveal and PDF endpoints with Turnstile, pausing, payments, the student
  price, Na míru (including "the studio cannot publish"), domains, PIN rate limits, statistics and the cron jobs.
- **Lifecycle:** reminders, expiry, renewal, the retention cycle and the privacy scan with a fake clock
  (`test/lifecycle.test.ts`); LinkedIn import from a generated export ZIP (`test/import.test.ts`).
- **Smoke:** `scripts/e2e-smoke.mjs` drives Chromium against `wrangler dev` (workerd, local D1/R2): sign in,
  create a Profi CV, upload a photo through the browser resize, pay (dev), publish, open the page on a phone,
  reveal the contact, download the PDF and check its text, switch to English, pause. Passed on this branch.

---

## 11. Studio site work (PRD §12) – for the studio repo

- Sales page: use a real published CV for the laptop shot and its PDF; prices from `PRICES` in
  `src/config/tiers.ts` (`tabular-nums`); FAQ starting with privacy (CV-4, CV-5, CV-6, retention in §5.11).
- `/prace/` tile: "Ve vývoji", then "Beta" with CV-a.
- `/gdpr/` CV section (L1): data kept (§7), contact behind a click, retention (§5.11), deletion on request
  (`/ucet/nastaveni`), export (`/ucet/export.json`).
- Ceník: one row linking to the sales page.
