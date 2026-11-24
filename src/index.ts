import { createApp } from './app/app';
import type { Env } from './env';
import { makeDeps } from './services/deps';
import { runDaily } from './services/lifecycle';

const app = createApp();

export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  /** Daily: expiry reminders, expiry, retention (CV-8) and the privacy scan (§8). */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      runDaily(makeDeps(env)).then((r) => console.log('daily job', JSON.stringify(r))),
    );
  },
} satisfies ExportedHandler<Env>;
