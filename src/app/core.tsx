import type { Context } from 'hono';
import type { Child } from 'hono/jsx';
import type { Env } from '../env';
import type { Actor } from '../platform/audit';
import type { AccountRow } from '../platform/auth';
import type { CvActor } from '../services/cvs';
import type { Deps } from '../services/deps';
import { AdminNav, ErrorPage, HolderNav, Layout } from './views/layout';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    deps: Deps;
    nonce: string;
    account: AccountRow | null;
    isAdmin: boolean;
    sessionId: string | undefined;
  };
};
export type Ctx = Context<AppEnv>;

/** CSP for public CV pages: no inline script; styles only by nonce; Turnstile allowed (CV-4). */
export function publicCsp(nonce: string): string {
  return [
    "default-src 'none'",
    "img-src 'self' data:",
    `style-src 'nonce-${nonce}'`,
    "font-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** CSP for the account and admin. Payment redirects follow form posts, so allow Stripe Checkout. */
export const APP_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self' https://checkout.stripe.com",
  "frame-ancestors 'none'",
].join('; ');

export async function html(c: Ctx, node: Child | string, status = 200, headers: Record<string, string> = {}): Promise<Response> {
  const body = typeof node === 'string' ? node : '<!doctype html>' + (await (node as { toString(): string | Promise<string> }).toString());
  return c.html(body, status as 200, headers);
}

export async function page(
  c: Ctx,
  title: string,
  body: Child,
  opts: { status?: number; wide?: boolean; scripts?: string[]; admin?: boolean } = {},
): Promise<Response> {
  const account = c.get('account');
  const flash = c.req.query('ok') ?? null;
  const nav = account ? opts.admin ? <AdminNav /> : <HolderNav email={account.email} /> : null;
  c.header('Content-Security-Policy', APP_CSP);
  c.header('Referrer-Policy', 'same-origin');
  c.header('Cache-Control', 'private, no-store');
  return html(
    c,
    <Layout title={title} nonce={c.get('nonce')} nav={nav} wide={opts.wide} flash={flash} scripts={opts.scripts}>
      {body}
    </Layout>,
    opts.status ?? 200,
  );
}

export function errorPage(c: Ctx, status: number, message: string): Promise<Response> {
  c.header('Content-Security-Policy', APP_CSP);
  c.header('Cache-Control', 'no-store');
  return html(c, <ErrorPage nonce={c.get('nonce')} status={status} message={message} />, status);
}

export function holderActor(account: AccountRow): CvActor {
  return { id: account.id, email: account.email, role: 'holder' };
}

export function adminActor(account: AccountRow): CvActor & Actor {
  return { id: account.id, email: account.email, role: 'admin' };
}

export function clientIp(c: Ctx): string | null {
  return c.req.header('cf-connecting-ip') ?? null;
}

/** Same-origin form posts only (CSRF). The webhook and the public JSON endpoints are separate. */
export function isSameOrigin(c: Ctx): boolean {
  const origin = c.req.header('origin');
  if (origin) return origin === new URL(c.req.url).origin;
  return c.req.header('sec-fetch-site') === 'same-origin';
}
