# Pulzar CV: operations

How to run, deploy and operate the Worker. The architecture and requirement map are in [plan.md](plan.md).

## Local development

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

```bash
npm run dev
```

`npm run dev` applies the D1 migrations to the local database and starts `wrangler dev` on
<http://localhost:8787>. Locally:

- **Sign in:** e-mails are printed to the console (`MAIL_PROVIDER=console`). Open the `/auth/…` link from there.
- **Admin:** sign in as `studio@pulzar.test` (`ADMIN_EMAILS` in `.dev.vars`).
- **Payments:** `PAYMENTS_PROVIDER=dev` shows a "Zaplatit (test)" page instead of a payment gateway.
- **Turnstile:** `TURNSTILE_SITE_KEY=dev` skips the widget. To exercise the real widget, use Cloudflare's test keys:
  site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`.
- **Daily job:** run it from the admin ("Spustit denní úlohu teď"), or with `wrangler dev --test-scheduled` and
  `curl "http://localhost:8787/__scheduled?cron=17+3+*+*+*"`.

### Tests

```bash
npm test
```

```bash
npm run typecheck
```

`npm test` builds the browser scripts and runs Vitest. The PDF tests need `pdftotext` and `pdffonts`
(poppler-utils). The app tests run the Worker's Hono app in Node against an in-memory D1 (`node:sqlite`, Node 22+)
and R2.

The browser smoke test runs against a running dev server and needs Playwright:

```bash
node scripts/e2e-smoke.mjs http://localhost:8787 path/to/wrangler-dev.log
```

### Fonts

The subset fonts are committed. To rebuild them (for example to cover more characters):

```bash
pip install fonttools brotli
```

```bash
npm run fonts
```

This also regenerates `src/generated/charset.ts`, the characters the editor accepts.

## First deployment

1. **Workers Paid plan.** PDF rendering takes 30–100 ms of CPU (plan.md, F2); the free plan allows 10 ms.
2. **D1 and R2.**

   ```bash
   npx wrangler d1 create pulzar-cv
   ```

   Put the returned `database_id` into `wrangler.toml`. Then:

   ```bash
   npx wrangler r2 bucket create pulzar-cv-media
   ```

   ```bash
   npm run db:migrate:remote
   ```

3. **Turnstile (E3).** Create a widget in the Cloudflare dashboard for `cv.pulzarstudio.cz`, mode "Managed". Put the
   site key into `TURNSTILE_SITE_KEY` in `wrangler.toml` and the secret into a secret (below). Own domains must be
   added to the widget's hostnames; see "Own domains".
4. **Variables** in `wrangler.toml`: `ADMIN_EMAILS` (the studio's addresses, comma-separated), `SALES_URL` (O2),
   `MAIL_FROM`.
5. **Secrets.** Run each of these once:

   ```bash
   npx wrangler secret put SESSION_SECRET
   ```

   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY
   ```

   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   ```

   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

   `SESSION_SECRET` signs the reveal passes and PIN cookies: 32+ random bytes, for example from `openssl rand -base64 48`.
6. **Payments (A5, N3).** In Stripe, add a webhook to `https://cv.pulzarstudio.cz/webhooks/platby` for
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Production refuses to start with
   the dev payment provider. If the platform uses another provider, implement `PaymentProvider` in
   `src/platform/payments.ts`.
7. **E-mail (A6, N4).** Verify the sending domain with the provider. Another provider: implement `Mailer` in
   `src/platform/mail.ts`.
8. **Deploy.**

   ```bash
   npm run deploy
   ```

   `wrangler.toml` binds the custom domain `cv.pulzarstudio.cz` and the daily cron (03:17 UTC).

### Smoke check after a deploy

- `https://cv.pulzarstudio.cz/robots.txt` answers.
- Sign in, create a CV, publish it (a 100 % discount code or a test-mode key), and check that:
  - the page source has no e-mail or phone;
  - "Zobrazit kontakt" passes Turnstile;
  - the PDF downloads as `Jmeno-Prijmeni-CV.pdf`.
- The admin dashboard shows the privacy scan after the first cron run.

## Own domains (CV-10, phase CV-b)

Phase 1 needs the domain's DNS on the studio's Cloudflare account.

1. The holder asks in **Nastavení → Vlastní doména**. The studio gets an e-mail and the request appears in
   **/admin/domeny**.
2. Register the domain (the "od 390 Kč/rok" add-on, invoiced separately), or have the holder move its DNS to the
   studio's account.
3. Add the hostname to the Worker: in the dashboard under Workers → pulzar-cv → Domains & Routes → Add →
   Custom domain, or add `{ pattern = "jananovakova.cz", custom_domain = true }` to `routes` and deploy.
4. **Add the hostname to the Turnstile widget** (Turnstile → widget → Hostnames). Without it the contact reveal
   and PDF fail on that domain. See the limit below.
5. Open the domain; once the Worker answers, click **Aktivovat** in /admin/domeny. The CV is then served at `/`,
   `/en`, `/kontakt`, `/pdf`, and its canonical URL points to the own domain. The `cv.` address keeps working.

**Limit (plan.md, F4):** a Turnstile widget accepts at most 10 hostnames on the Free plan (200 on Enterprise),
and a Free account has at most 20 widgets. With one widget that means about nine own domains. Before that, decide
between Enterprise ("Any hostname"), several widgets (needs a site key per domain; not built), or running the
check on `cv.pulzarstudio.cz` only.

## Daily job

`scheduled()` runs `runDaily` (`src/services/lifecycle.ts`):

1. **Reminders:** 30 and 7 days before the paid period ends, each sent once.
2. **Expiry:** a live CV whose paid time ended is marked offline (it already shows the inactive page from that
   moment) and the holder gets an e-mail.
3. **Retention:** "Chcete životopis dál uchovat?" a year after a CV went offline. A warning follows at day 23 and
   deletion at day 30 without an answer. Signing in, editing, paying or the keep link all count as answers.
4. **Privacy scan:** every public page is rendered and checked for the holder's e-mail and phone. Any finding
   e-mails the studio. Target: 0, always (§8).
5. **Cleanup** of expired tokens, sessions, rate-limit rows and stale imports.

Every run is in the audit log (`cron.daily`) with its counts.

## Data and privacy

- **Personal data:** the profile block (name, headline, city, photo, links, e-mail, phone), the CV text, payment
  records, and daily view counts without IPs or cookies.
- **Photos:** EXIF and other metadata are stripped in the browser and again on the server.
- **Deletion:** the holder deletes from **Nastavení** (typing the address to confirm), or the retention job does.
  Deletion removes the CV row, the profile block, every R2 object under `cv/<id>/`, statistics and domains. The
  audit log keeps the action, not the content.
- **Export:** `/ucet/export.json` returns everything about the account (GDPR access and portability).
- **Backups:** D1 has Time Travel (30 days on the paid plan). R2 objects are not versioned; deleted photos and
  PDFs are gone.
- **Legal (L1, L2):** the /gdpr/ CV section and the terms are still to be written by the lawyer.
  [plan.md](plan.md) §11 lists the facts they need.
