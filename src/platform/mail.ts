import { formatDateCs } from '../cv/i18n';
import { escapeHtml } from '../cv/text';

// E-mail (A6): the provider is a platform decision, so it sits behind an interface.

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** For logs and tests: which template. */
  tag: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  async send(m: Mail) {
    console.log(`[mail] to=${m.to} tag=${m.tag} subject="${m.subject}"\n${m.text}`);
  }
}

export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  async send(m: Mail) {
    this.sent.push(m);
  }
  last(tag?: string): Mail | undefined {
    return [...this.sent].reverse().find((m) => !tag || m.tag === tag);
  }
}

/** Resend-compatible HTTP API (https://api.resend.com/emails). */
export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(m: Mail) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, html: m.html, tags: [{ name: 'template', value: m.tag }] }),
    });
    if (!r.ok) throw new Error(`mail failed: ${r.status} ${await r.text()}`);
  }
}

// ---------- templates (Czech) ----------

interface Part {
  p?: string;
  button?: { href: string; label: string };
  small?: string;
}

function compose(to: string, tag: string, subject: string, parts: Part[]): Mail {
  const text = parts
    .map((x) => (x.p ?? x.small ?? (x.button ? `${x.button.label}: ${x.button.href}` : '')))
    .filter(Boolean)
    .join('\n\n');
  const html =
    `<!doctype html><html lang="cs"><body style="margin:0;background:#f5f6f8;font:16px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border-radius:14px;padding:28px">` +
    `<p style="margin:0 0 18px;font-weight:700;color:#1d4ed8">Pulzar CV</p>` +
    parts
      .map((x) => {
        if (x.p) return `<p style="margin:0 0 14px">${escapeHtml(x.p).replace(/\n/g, '<br>')}</p>`;
        if (x.small) return `<p style="margin:18px 0 0;font-size:13px;color:#59636e">${escapeHtml(x.small)}</p>`;
        if (x.button)
          return `<p style="margin:22px 0"><a href="${escapeHtml(x.button.href)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(x.button.label)}</a></p>`;
        return '';
      })
      .join('') +
    `</div><p style="font-size:12px;color:#8b949e;text-align:center;margin-top:16px">Studio Pulzar · cv.pulzarstudio.cz</p></div></body></html>`;
  return { to, subject, text, html, tag };
}

export const mails = {
  login: (to: string, url: string) =>
    compose(to, 'login', 'Přihlášení do Pulzar CV', [
      { p: 'Dobrý den,\nklikněte na tlačítko a jste přihlášeni. Odkaz platí 15 minut a jde použít jen jednou.' },
      { button: { href: url, label: 'Přihlásit se' } },
      { small: 'Pokud jste o přihlášení nežádali, e-mail klidně smažte. Bez kliknutí se nic nestane.' },
    ]),

  studentVerify: (to: string, url: string) =>
    compose(to, 'student', 'Ověření studentské slevy', [
      { p: 'Dobrý den,\npotvrďte prosím, že je tato školní adresa vaše. Pak u balíčku Základ uvidíte studentskou cenu.' },
      { button: { href: url, label: 'Ověřit adresu' } },
      { small: 'Odkaz platí 24 hodin.' },
    ]),

  studentDecision: (to: string, approved: boolean) =>
    compose(
      to,
      approved ? 'student_ok' : 'student_no',
      approved ? 'Studentská sleva je ověřená' : 'Studentskou slevu jsme neověřili',
      approved
        ? [{ p: 'Dobrý den,\nvaše ISIC jsme ověřili. U balíčku Základ teď uvidíte studentskou cenu na první rok.' }]
        : [{ p: 'Dobrý den,\nčíslo ISIC se nám nepodařilo ověřit. Zkuste prosím ověření přes školní e-mail, nebo nám odpovězte na tento e-mail.' }],
    ),

  paid: (to: string, what: string, amount: string, until: number) =>
    compose(to, 'paid', 'Platba přijata', [
      { p: `Dobrý den,\nděkujeme, platbu ${amount} za ${what} jsme přijali. Životopis máte zaplacený do ${formatDateCs(until)}.` },
    ]),

  published: (to: string, url: string) =>
    compose(to, 'published', 'Váš životopis je zveřejněný', [
      { p: `Dobrý den,\nváš životopis je na adrese:\n${url}` },
      { p: 'Odkaz si přidejte na LinkedIn (Kontaktní údaje → Web a sekce Doporučené) a posílejte ho s přihláškami.' },
      { button: { href: url, label: 'Otevřít životopis' } },
    ]),

  naMiruBooked: (to: string) =>
    compose(to, 'nm_booking', 'Na míru: domluvíme sezení', [
      {
        p: 'Dobrý den,\nděkujeme za objednávku Na míru. Do dvou pracovních dnů se vám ozveme a domluvíme 60minutové sezení po telefonu nebo videu. Text spolu napíšeme nebo upravíme (česky i anglicky) a vyplníme ho za vás.',
      },
      { p: 'Než se ozveme, můžete si připravit starý životopis, odkaz na LinkedIn a seznam práce, na kterou jste hrdí.' },
    ]),

  naMiruStudio: (to: string, holder: string, adminUrl: string) =>
    compose(to, 'nm_studio', `Nová objednávka Na míru: ${holder}`, [
      { p: `${holder} zaplatil(a) Na míru. Domluvte prosím sezení.` },
      { button: { href: adminUrl, label: 'Otevřít v administraci' } },
    ]),

  naMiruReady: (to: string, url: string) =>
    compose(to, 'nm_ready', 'Váš životopis je připravený ke schválení', [
      { p: 'Dobrý den,\nváš životopis je připravený ke schválení. Projděte si ho, případně upravte, a až bude podle vás, zveřejněte ho. Bez vašeho kliknutí se nic nezveřejní.' },
      { button: { href: url, label: 'Zkontrolovat a zveřejnit' } },
    ]),

  expiring: (to: string, days: number, until: number, renewUrl: string) =>
    compose(to, `expiring_${days}`, `Životopis vyprší za ${days} dní`, [
      {
        p: `Dobrý den,\nváš životopis je zaplacený do ${formatDateCs(until)}. Pak přestane být online.\nMůžete ho prodloužit o rok, nebo ho zdarma pozastavit a vrátit, až budete znovu hledat práci (odkaz zůstane stejný).`,
      },
      { button: { href: renewUrl, label: 'Prodloužit nebo pozastavit' } },
    ]),

  expired: (to: string, renewUrl: string) =>
    compose(to, 'expired', 'Životopis teď není online', [
      { p: 'Dobrý den,\nzaplacené období skončilo a životopis teď není online. Data máme uložená a odkaz zůstává stejný. Prodloužením ho hned vrátíte.' },
      { button: { href: renewUrl, label: 'Prodloužit' } },
    ]),

  keepPrompt: (to: string, keepUrl: string, deleteOn: number) =>
    compose(to, 'keep_prompt', 'Chcete životopis dál uchovat?', [
      {
        p: `Dobrý den,\nváš životopis v Pulzar CV teď není online, ale jeho data uchováváme. Chcete je uchovat i dál? Je to zdarma a odkaz zůstane stejný.\nPokud neodpovíte, ${formatDateCs(deleteOn)} životopis smažeme.`,
      },
      { button: { href: keepUrl, label: 'Ano, uchovat' } },
    ]),

  keepWarning: (to: string, keepUrl: string, deleteOn: number) =>
    compose(to, 'keep_warning', 'Za týden životopis smažeme', [
      { p: `Dobrý den,\nna otázku, jestli chcete životopis uchovat, jsme odpověď nedostali. ${formatDateCs(deleteOn)} ho proto smažeme i s fotkou a PDF.` },
      { button: { href: keepUrl, label: 'Uchovat životopis' } },
    ]),

  deleted: (to: string) =>
    compose(to, 'deleted', 'Životopis jsme smazali', [
      { p: 'Dobrý den,\nváš životopis jsme smazali, včetně fotky a PDF. Kdybyste ho chtěli znovu, stačí se přihlásit a začít nový.' },
    ]),

  domainRequest: (to: string, holder: string, hostname: string, mode: string, adminUrl: string) =>
    compose(to, 'domain_request', `Vlastní doména: ${hostname}`, [
      { p: `${holder} chce adresu ${hostname} (${mode === 'studio_registers' ? 'zaregistrovat přes studio' : 'přesune DNS na Cloudflare studia'}).` },
      { button: { href: adminUrl, label: 'Otevřít v administraci' } },
    ]),

  privacyAlert: (to: string, count: number, adminUrl: string) =>
    compose(to, 'privacy_alert', `Kontrola soukromí: ${count} nález(y)`, [
      { p: `Denní kontrola našla kontaktní údaje ve veřejném HTML (${count}×). Cíl je 0, vždy.` },
      { button: { href: adminUrl, label: 'Zobrazit nálezy' } },
    ]),
};
