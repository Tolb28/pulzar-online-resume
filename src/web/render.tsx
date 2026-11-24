import type { CvDoc, Lang, Visibility } from '../cv/types';
import { CvPage, InactivePage, PinPage } from './page';

// String renderers for the public pages (used by the routes and by the daily privacy scan).

export interface RenderCvOpts {
  doc: CvDoc;
  lang: Lang;
  basePath: string;
  origin: string;
  visibility: Visibility;
  siteKey: string;
  hasPdf: boolean;
  salesUrl: string;
  nonce: string;
  publishedAt?: number;
  preview?: boolean;
  /** Where images are served from; defaults to `${origin}/media/`. */
  mediaBase?: string;
  canonical?: { origin: string; basePath: string };
}

export function renderCvHtml(o: RenderCvOpts): string {
  const mediaBase = o.mediaBase ?? `${o.origin}/media/`;
  return (
    '<!doctype html>' +
    (
      <CvPage
        doc={o.doc}
        lang={o.lang}
        basePath={o.basePath}
        origin={o.origin}
        visibility={o.visibility}
        siteKey={o.siteKey}
        hasPdf={o.hasPdf}
        salesUrl={o.salesUrl}
        nonce={o.nonce}
        publishedAt={o.publishedAt}
        preview={o.preview}
        canonical={o.canonical}
        mediaUrl={(k) => mediaBase + k}
      />
    ).toString()
  );
}

export function renderInactiveHtml(lang: Lang, nonce: string): string {
  return '<!doctype html>' + (<InactivePage lang={lang} nonce={nonce} />).toString();
}

export function renderPinHtml(lang: Lang, nonce: string, action: string, accent: string, error?: 'wrong' | 'locked'): string {
  return '<!doctype html>' + (<PinPage lang={lang} nonce={nonce} action={action} accent={accent} error={error} />).toString();
}

/** CV-4 / §8: does this HTML contain the holder's e-mail or phone, or any e-mail address? */
export function contactLeaks(html: string, email: string, phone: string): string[] {
  const found: string[] = [];
  if (email && html.toLowerCase().includes(email.toLowerCase())) found.push('email');
  const digits = phone.replace(/\D/g, '').slice(-9);
  if (digits.length === 9 && new RegExp(digits.split('').join('\\D{0,2}')).test(html)) found.push('phone');
  // Any e-mail address in the text (not just the holder's).
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ');
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text) && !found.includes('email')) found.push('email-like');
  return found;
}
