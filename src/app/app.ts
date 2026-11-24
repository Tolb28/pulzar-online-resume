import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { isProduction, type Env } from '../env';
import { SESSION_COOKIE, sessionAccount } from '../platform/auth';
import { randomToken } from '../platform/crypto';
import { makeDeps, type DepsOverrides } from '../services/deps';
import { cvIdForHost } from '../services/domains';
import { errorPage, isSameOrigin, type AppEnv, type Ctx } from './core';
import { registerAccount } from './routes-account';
import { registerAdmin } from './routes-admin';
import { registerDomain, registerPublic } from './routes-public';

function base(overrides: DepsOverrides, withSession: boolean): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    const deps = makeDeps(c.env, overrides);
    c.set('deps', deps);
    c.set('nonce', randomToken(16));
    const sid = withSession ? getCookie(c, SESSION_COOKIE) : undefined;
    c.set('sessionId', sid);
    const account = sid ? await sessionAccount(deps.db, sid, deps.now()) : null;
    c.set('account', account);
    c.set('isAdmin', !!account && deps.admins.includes(account.email));
    // CSRF: form posts must come from this origin. Webhooks are signed by the provider.
    if (c.req.method === 'POST' && !c.req.path.startsWith('/webhooks/') && !isSameOrigin(c)) {
      return c.text('Forbidden', 403);
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()');
    if (isProduction(c.env)) c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });
  app.notFound((c) => errorPage(c as Ctx, 404, 'Stránka neexistuje.'));
  app.onError((err, c) => {
    console.error(err);
    return errorPage(c as Ctx, 500, 'Zkuste to prosím za chvíli znovu. Pokud to nepomůže, napište nám.');
  });
  return app;
}

export function isMainHost(host: string, env: Env): boolean {
  const h = host.split(':')[0]!.toLowerCase();
  return h === env.CV_HOST.toLowerCase() || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.workers.dev');
}

export interface CvApp {
  fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response>;
}

export function createApp(overrides: DepsOverrides = {}): CvApp {
  const main = base(overrides, true);
  // Holder and admin first, then the catch-all CV routes.
  registerAccount(main);
  registerAdmin(main);
  registerPublic(main);

  const own = base(overrides, false);
  const cvIdOf = async (c: Ctx) => cvIdForHost(c.get('deps').db, new URL(c.req.url).hostname.toLowerCase());
  registerDomain(own, cvIdOf);

  return {
    fetch: async (req, env, ctx) => {
      const host = new URL(req.url).host;
      const app = isMainHost(host, env) ? main : own;
      return app.fetch(req, env, ctx);
    },
  };
}
