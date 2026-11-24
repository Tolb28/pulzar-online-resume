import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp, type CvApp } from '../../src/app/app';
import type { Env } from '../../src/env';
import { MemoryMailer } from '../../src/platform/mail';
import type { TurnstileVerifier } from '../../src/platform/turnstile';
import { makeDeps, type Deps } from '../../src/services/deps';

// In-memory stand-ins for D1 and R2, so the Worker's Hono app runs in Node with real SQL.

type Bindable = string | number | null | Uint8Array;

class Stmt {
  private params: Bindable[] = [];
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
  ) {}
  bind(...values: unknown[]): Stmt {
    const s = new Stmt(this.db, this.sql);
    s.params = values.map((v) => {
      if (v === undefined) throw new Error(`D1_TYPE_ERROR: undefined bound in: ${this.sql}`);
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v as Bindable;
    });
    return s;
  }
  async first<T>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    const plain = { ...row };
    return (col ? plain[col] : plain) as T;
  }
  async all<T>(): Promise<{ results: T[]; success: true; meta: object }> {
    const rows = this.db.prepare(this.sql).all(...this.params) as Record<string, unknown>[];
    return { results: rows.map((r) => ({ ...r })) as T[], success: true, meta: {} };
  }
  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  runSync() {
    return this.db.prepare(this.sql).run(...this.params);
  }
}

export class TestD1 {
  readonly sqlite = new DatabaseSync(':memory:');
  constructor() {
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    const dir = join(__dirname, '../../migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) this.sqlite.exec(readFileSync(join(dir, f), 'utf8'));
  }
  prepare(sql: string): Stmt {
    return new Stmt(this.sqlite, sql);
  }
  async batch(stmts: Stmt[]) {
    this.sqlite.exec('BEGIN');
    try {
      const out = stmts.map((s) => s.runSync());
      this.sqlite.exec('COMMIT');
      return out.map((r) => ({ success: true, meta: { changes: Number(r.changes) } }));
    } catch (e) {
      this.sqlite.exec('ROLLBACK');
      throw e;
    }
  }
  async exec(sql: string) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }
}

interface Obj {
  bytes: Uint8Array<ArrayBuffer>;
  contentType?: string;
}

export class TestR2 {
  readonly objects = new Map<string, Obj>();
  async put(key: string, value: Uint8Array | ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string } }) {
    const bytes: Uint8Array<ArrayBuffer> = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.objects.set(key, { bytes, contentType: opts?.httpMetadata?.contentType });
    return { key, size: bytes.length };
  }
  async get(key: string) {
    const o = this.objects.get(key);
    if (!o) return null;
    return {
      key,
      size: o.bytes.length,
      httpEtag: `"${o.bytes.length}"`,
      httpMetadata: { contentType: o.contentType },
      get body() {
        return new Response(o.bytes).body!;
      },
      arrayBuffer: async () => o.bytes.slice().buffer,
      text: async () => new TextDecoder().decode(o.bytes),
    };
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
  async list(opts: { prefix?: string; cursor?: string } = {}) {
    const objects = [...this.objects.entries()].filter(([k]) => !opts.prefix || k.startsWith(opts.prefix)).map(([key, o]) => ({ key, size: o.bytes.length }));
    return { objects, truncated: false, cursor: undefined, delimitedPrefixes: [] };
  }
}

export const T0 = Date.UTC(2026, 10, 24, 9, 0, 0); // 24 Nov 2026

export interface Harness {
  env: Env;
  app: CvApp;
  db: TestD1;
  r2: TestR2;
  mail: MemoryMailer;
  clock: { now: number };
  deps: Deps;
  turnstileCalls: string[];
}

export function harness(): Harness {
  const db = new TestD1();
  const r2 = new TestR2();
  const mail = new MemoryMailer();
  const clock = { now: T0 };
  const turnstileCalls: string[] = [];
  const turnstile: TurnstileVerifier = {
    async verify(token) {
      turnstileCalls.push(token);
      return token === 'good-token';
    },
  };
  const env = {
    DB: db as unknown as D1Database,
    MEDIA: r2 as unknown as R2Bucket,
    ENVIRONMENT: 'test',
    CV_HOST: 'cv.test',
    BASE_URL: 'https://cv.test',
    SALES_URL: 'https://pulzarstudio.cz/zivotopis/',
    MAIL_FROM: 'Pulzar CV <cv@pulzarstudio.cz>',
    ADMIN_EMAILS: 'studio@pulzar.test',
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    PAYMENTS_PROVIDER: 'dev',
    MAIL_PROVIDER: 'console',
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    TURNSTILE_SECRET_KEY: 'unused',
  } satisfies Env;
  const overrides = { now: () => clock.now, mailer: mail, turnstile };
  return { env, app: createApp(overrides), db, r2, mail, clock, deps: makeDeps(env, overrides), turnstileCalls };
}

/** A tiny browser: cookies per host, Origin on posts, optional redirect following. */
export class Browser {
  private jar = new Map<string, Map<string, string>>();
  constructor(
    private h: Harness,
    public origin = 'https://cv.test',
    public userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15',
  ) {}

  private cookieHeader(host: string): string {
    return [...(this.jar.get(host) ?? new Map()).entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private store(host: string, res: Response) {
    const jar = this.jar.get(host) ?? new Map<string, string>();
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim()) || (/^expires=/i.test(a.trim()) && Date.parse(a.trim().slice(8)) < Date.now()));
      if (expired || value === '') jar.delete(name!.trim());
      else jar.set(name!.trim(), value);
    }
    this.jar.set(host, jar);
  }

  async request(method: string, path: string, opts: { form?: Record<string, string | string[]>; body?: BodyInit; headers?: Record<string, string>; follow?: boolean; origin?: string | null } = {}): Promise<Response> {
    const url = new URL(path, this.origin);
    const headers = new Headers(opts.headers);
    headers.set('user-agent', this.userAgent);
    const cookies = this.cookieHeader(url.host);
    if (cookies) headers.set('cookie', cookies);
    let body = opts.body;
    if (opts.form) {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.form)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
      body = p;
      headers.set('content-type', 'application/x-www-form-urlencoded');
    }
    if (method !== 'GET' && method !== 'HEAD' && opts.origin !== null) headers.set('origin', opts.origin ?? url.origin);
    const res = await this.h.app.fetch(new Request(url, { method, headers, body, redirect: 'manual' }), this.h.env);
    this.store(url.host, res);
    if (opts.follow && res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      return this.request('GET', new URL(res.headers.get('location')!, url).toString(), { follow: true });
    }
    return res;
  }
  get(path: string, follow = false) {
    return this.request('GET', path, { follow });
  }
  post(path: string, form: Record<string, string | string[]> = {}, follow = false) {
    return this.request('POST', path, { form, follow });
  }

  /** Sign in through the magic link e-mail, as a person would. */
  async signIn(email: string): Promise<void> {
    const r = await this.post('/prihlaseni', { email });
    if (r.status !== 200) throw new Error(`sign-in form: ${r.status}`);
    const mail = this.h.mail.last('login');
    const link = /https:\/\/cv\.test(\/auth\/[A-Za-z0-9_-]+)/.exec(mail!.text)![1]!;
    const res = await this.post(link);
    if (res.status !== 303) throw new Error(`sign-in: ${res.status} ${await res.text()}`);
  }
}

export async function text(res: Response): Promise<string> {
  return res.text();
}
