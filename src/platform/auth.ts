import { randomId } from '../cv/text';
import { randomToken, sha256Hex } from './crypto';
import { DAY, one, run } from './db';

// A2: sign-in by e-mail magic link. Tokens and session ids are stored only as hashes.

export const SESSION_COOKIE = 'cv_session';
export const SESSION_TTL = 30 * DAY;

export type TokenPurpose = 'login' | 'student' | 'keep';
const TOKEN_TTL: Record<TokenPurpose, number> = { login: 15 * 60_000, student: DAY, keep: 45 * DAY };

export interface AccountRow {
  id: string;
  email: string;
  created_at: number;
  last_login_at: number | null;
  signup_src: string | null;
  student_verified_at: number | null;
  student_method: string | null;
  student_detail: string | null;
}

export interface TokenRow {
  token_hash: string;
  purpose: TokenPurpose;
  email: string | null;
  account_id: string | null;
  data: string | null;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

export function normalizeEmail(s: string): string {
  return s.trim().toLowerCase();
}

export async function issueToken(db: D1Database, now: number, purpose: TokenPurpose, opts: { email?: string; accountId?: string; data?: unknown; ttl?: number }): Promise<string> {
  const token = randomToken(32);
  await run(
    db,
    'INSERT INTO tokens (token_hash, purpose, email, account_id, data, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    await sha256Hex(token),
    purpose,
    opts.email ?? null,
    opts.accountId ?? null,
    opts.data === undefined ? null : JSON.stringify(opts.data),
    now,
    now + (opts.ttl ?? TOKEN_TTL[purpose]),
  );
  return token;
}

/** Look a token up without using it (the confirmation page shows before the POST). */
export async function peekToken(db: D1Database, purpose: TokenPurpose, token: string, now: number): Promise<TokenRow | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const row = await one<TokenRow>(db, 'SELECT * FROM tokens WHERE token_hash = ? AND purpose = ?', await sha256Hex(token), purpose);
  if (!row || row.used_at || row.expires_at < now) return null;
  return row;
}

/** Use a token once. Returns null if it is unknown, used or expired. */
export async function consumeToken(db: D1Database, purpose: TokenPurpose, token: string, now: number): Promise<TokenRow | null> {
  const row = await peekToken(db, purpose, token, now);
  if (!row) return null;
  const changed = await run(db, 'UPDATE tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL', now, row.token_hash);
  return changed === 1 ? row : null;
}

export async function findOrCreateAccount(db: D1Database, email: string, now: number, src?: string | null): Promise<AccountRow> {
  const e = normalizeEmail(email);
  const existing = await one<AccountRow>(db, 'SELECT * FROM accounts WHERE email = ?', e);
  if (existing) return existing;
  const id = randomId();
  await run(db, 'INSERT OR IGNORE INTO accounts (id, email, created_at, signup_src) VALUES (?, ?, ?, ?)', id, e, now, src ? src.slice(0, 40) : null);
  return (await one<AccountRow>(db, 'SELECT * FROM accounts WHERE email = ?', e))!;
}

export async function createSession(db: D1Database, accountId: string, now: number): Promise<string> {
  const id = randomToken(32);
  await run(db, 'INSERT INTO sessions (id_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)', await sha256Hex(id), accountId, now, now + SESSION_TTL);
  await run(db, 'UPDATE accounts SET last_login_at = ? WHERE id = ?', now, accountId);
  return id;
}

export async function sessionAccount(db: D1Database, sessionId: string | undefined, now: number): Promise<AccountRow | null> {
  if (!sessionId || !/^[A-Za-z0-9_-]{20,100}$/.test(sessionId)) return null;
  return one<AccountRow>(
    db,
    'SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.id_hash = ? AND s.expires_at > ?',
    await sha256Hex(sessionId),
    now,
  );
}

export async function destroySession(db: D1Database, sessionId: string | undefined): Promise<void> {
  if (sessionId) await run(db, 'DELETE FROM sessions WHERE id_hash = ?', await sha256Hex(sessionId));
}
