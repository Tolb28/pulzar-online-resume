# Pulzar CV

The online CV (životopis) by Studio Pulzar: a personal link for LinkedIn and job applications at
`cv.pulzarstudio.cz/jana-novakova`, with a PDF made from the same content.

- **PRD:** [docs/prd/2026-11-24-online-cv-prd.md](docs/prd/2026-11-24-online-cv-prd.md)
- **Implementation plan, requirement map, findings and open questions:** [docs/plan.md](docs/plan.md)
- **Running, deploying and operating it:** [docs/ops.md](docs/ops.md)

## What it does

- **Holders** sign in by e-mail link, build their CV in a fixed set of sections with strict limits, preview the
  web page and the PDF, pay once for 12 months, and publish. They can pause for free and come back on the same
  link.
- **Tiers:** Základ (one language, palette colours, 3 projects), Profi (CS + EN, own colour, 8 projects with
  images, statistics, own domain) and Na míru (Profi plus a session with the studio, who fills the CV in for the
  holder to approve). Students get Základ cheaper in the first year.
- **Recruiters** get a fast page that reads at a glance on a phone. The e-mail and phone are not in the page;
  one click behind a Turnstile check shows them, and the PDF downloads through the same check.
- **The studio** works in an admin with the §8 metrics, the Na míru queue, ISIC checks, own domains, a daily
  privacy scan and an audit log of everything it does.

## Stack

Cloudflare Workers (TypeScript) · Hono with server-side JSX · D1 · R2 · Turnstile · pdf-lib + fontkit for the PDF,
rendered inside the Worker. Public pages ship no framework JavaScript, only a 1.8 kB script for the contact
reveal.

## Quick start

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run dev
```

```bash
npm test
```

Open <http://localhost:8787/prihlaseni>; the sign-in e-mail is printed in the terminal. See
[docs/ops.md](docs/ops.md) for the admin, test payments, fonts and deployment.

## Layout

```
src/
  index.ts             Worker entry: fetch + daily cron
  app/                 Routes and views (public, account/editor, admin, LinkedIn import)
  cv/                  The CV document: types, validation, sanitising, i18n, text helpers
  config/              Limits (CV-1), tiers and prices (§5), templates (CV-2), school domains (CV-12)
  pdf/                 PDF layout engine and the three print templates (CV-3)
  web/                 Public CV page, its CSS and icons
  platform/            Pieces shared with the card platform: auth, mail, payments, Turnstile,
                       audit log, rate limits, media, statistics
  services/            CVs, publishing, billing, Na míru, domains, lifecycle cron, metrics
  client/              Browser scripts (built into public/static by `npm run build:client`)
migrations/            D1 schema
assets/fonts/          Subset TTF fonts for the PDF (OFL)
public/static/         Web fonts, CSS, built scripts
scripts/               Font subsetting, client build, browser smoke test
test/                  Vitest: validation, PDF acceptance, web page, app journeys, lifecycle, import
```
