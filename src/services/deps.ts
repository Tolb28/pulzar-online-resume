import { adminEmails, isProduction, type Env } from '../env';
import { ConsoleMailer, ResendMailer, type Mailer } from '../platform/mail';
import { DevPayments, StripePayments, type PaymentProvider } from '../platform/payments';
import { turnstileVerifier, type TurnstileVerifier } from '../platform/turnstile';

/** Everything a service needs. Built from the environment; tests replace parts of it. */
export interface Deps {
  env: Env;
  db: D1Database;
  media: R2Bucket;
  mailer: Mailer;
  payments: PaymentProvider;
  turnstile: TurnstileVerifier;
  now: () => number;
  baseUrl: string;
  admins: string[];
}

export type DepsOverrides = Partial<Omit<Deps, 'env'>>;

export function makeDeps(env: Env, overrides: DepsOverrides = {}): Deps {
  const now = overrides.now ?? (() => Date.now());
  const mailer =
    overrides.mailer ??
    (env.MAIL_PROVIDER === 'resend' && env.RESEND_API_KEY ? new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : new ConsoleMailer());
  const payments =
    overrides.payments ??
    (env.PAYMENTS_PROVIDER === 'stripe' && env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
      ? new StripePayments(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET, now)
      : new DevPayments());
  if (isProduction(env) && payments.id === 'dev') throw new Error('Production needs a real payment provider (PAYMENTS_PROVIDER).');
  const turnstile =
    overrides.turnstile ?? turnstileVerifier(env.TURNSTILE_SECRET_KEY, { devBypass: !isProduction(env) && env.TURNSTILE_SITE_KEY === 'dev', expectedAction: 'reveal' });
  return {
    env,
    db: overrides.db ?? env.DB,
    media: overrides.media ?? env.MEDIA,
    mailer,
    payments,
    turnstile,
    now,
    baseUrl: (overrides.baseUrl ?? env.BASE_URL).replace(/\/+$/, ''),
    admins: overrides.admins ?? adminEmails(env),
  };
}
