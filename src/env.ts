// Bindings, variables and secrets (wrangler.toml, .dev.vars, `wrangler secret put`).

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS?: Fetcher;

  /** "production" | "development" | "test" */
  ENVIRONMENT: string;
  /** The CV host, e.g. "cv.pulzarstudio.cz". */
  CV_HOST: string;
  /** "https://cv.pulzarstudio.cz" – used in e-mails and canonical URLs. */
  BASE_URL: string;
  /** The sales page (O2). */
  SALES_URL: string;
  /** "Pulzar CV <cv@pulzarstudio.cz>" */
  MAIL_FROM: string;
  /** Comma-separated e-mails with admin rights; also where studio notifications go. */
  ADMIN_EMAILS: string;
  /** Turnstile site key for the cv. host (E3), or "dev". */
  TURNSTILE_SITE_KEY: string;
  /** "dev" | "stripe" */
  PAYMENTS_PROVIDER: string;
  /** "console" | "resend" */
  MAIL_PROVIDER: string;

  // Secrets
  /** HMAC key for passes and PIN cookies (32+ random bytes). */
  SESSION_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RESEND_API_KEY?: string;
}

export function adminEmails(env: Env): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isProduction(env: Env): boolean {
  return env.ENVIRONMENT === 'production';
}
