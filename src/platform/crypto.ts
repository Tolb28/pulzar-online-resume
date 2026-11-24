import { base64url, fromBase64url } from '../cv/text';

const enc = new TextEncoder();

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64url(b);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function hmac(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return base64url(new Uint8Array(sig));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * A signed, expiring value: "<payload>.<exp>.<sig>". Used for the 10-minute reveal pass
 * (CV-4) and the PIN cookie (CV-14). The payload must not contain dots.
 */
export async function signPass(secret: string, payload: string, expiresAt: number): Promise<string> {
  const body = `${payload}.${expiresAt}`;
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyPass(secret: string, token: string, payload: string, now: number): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [p, exp, sig] = parts as [string, string, string];
  if (p !== payload || !/^\d+$/.test(exp) || Number(exp) < now) return false;
  return timingSafeEqual(sig, await hmac(secret, `${p}.${exp}`));
}

/** PIN hashing (CV-14). A 4–6 digit PIN is weak by nature; the rate limits are the real defence. */
export async function hashPin(pin: string, salt?: string): Promise<string> {
  const s = salt ?? randomToken(12);
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64url(s), iterations: 100_000 }, key, 256);
  return `${s}$${base64url(new Uint8Array(bits))}`;
}

export async function checkPin(pin: string, stored: string): Promise<boolean> {
  const [salt] = stored.split('$');
  if (!salt) return false;
  return timingSafeEqual(await hashPin(pin, salt), stored);
}
