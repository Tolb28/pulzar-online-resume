import { SUPPORTED_RANGES } from '../generated/charset';
import type { Lang } from './types';

/** Remove diacritics: "Nováková" → "Novakova". */
export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/ß/g, 'ss');
}

/**
 * Tidy text as typed or pasted: NFC, Windows line ends, tabs, zero-width characters and soft
 * hyphens. Single-line fields also collapse runs of whitespace. Nothing visible is removed.
 */
export function normalizeText(s: unknown, multiline = false): string {
  if (typeof s !== 'string') return '';
  let t = s.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[​-‍⁠﻿­]/g, '');
  t = t.replace(/\t/g, ' ');
  if (multiline) {
    t = t
      .split('\n')
      .map((line) => line.replace(/[  ]+$/g, '').replace(/ {2,}/g, ' '))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    t = t.replace(/\s+/g, ' ');
  }
  return t.trim();
}

/** Characters a template font cannot draw. Empty when everything is fine. */
export function unsupportedChars(s: string): string[] {
  const out = new Set<string>();
  for (const ch of s) {
    if (ch === '\n') continue;
    const cp = ch.codePointAt(0)!;
    if (!isSupported(cp)) out.add(ch);
  }
  return [...out];
}

function isSupported(cp: number): boolean {
  let lo = 0;
  let hi = SUPPORTED_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = SUPPORTED_RANGES[mid]!;
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Length as the holder sees it (code points, so "ů" counts once). */
export function charCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

/** Paths the app uses on the cv. host; a CV cannot take them as its address. */
export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'assets', 'auth', 'cs', 'cv', 'en', 'favicon.ico', 'gdpr', 'help', 'kontakt',
  'login', 'logout', 'media', 'napoveda', 'odhlaseni', 'pdf', 'platba', 'podminky', 'prihlaseni',
  'pulzar', 'robots.txt', 'sitemap.xml', 'static', 'studio', 'ucet', 'uchovat', 'webhook', 'www',
  'zivotopis', 'test', 'demo', 'ukazka',
]);

export function slugify(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}

export function slugProblem(slug: string): string | null {
  if (!SLUG_RE.test(slug)) {
    return 'Adresa může mít 3 až 50 znaků: malá písmena bez diakritiky, číslice a pomlčky (ne na začátku ani na konci).';
  }
  if (slug.includes('--')) return 'Adresa nemůže obsahovat dvě pomlčky za sebou.';
  if (RESERVED_SLUGS.has(slug)) return 'Tuto adresu používá samotná aplikace. Zvolte prosím jinou.';
  return null;
}

/** CV-3: "Jana-Novakova-CV.pdf", with "-EN" for English. */
export function pdfFilename(name: string, lang: Lang): string {
  const base =
    stripDiacritics(name)
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'Zivotopis';
  return `${base}-CV${lang === 'en' ? '-EN' : ''}.pdf`;
}

export function randomId(bytes = 9): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64url(b);
}

export function base64url(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** Escape for HTML text and attribute values (used outside JSX, e.g. e-mails). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** "https://www.linkedin.com/in/jana/" → "linkedin.com/in/jana" */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

/** Accept "linkedin.com/in/x" as typed; store "https://linkedin.com/in/x". */
export function normalizeUrl(input: string): string {
  const t = input.trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t; // other schemes are rejected by validation
  return `https://${t}`;
}
