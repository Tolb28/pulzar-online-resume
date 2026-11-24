import type { Child } from 'hono/jsx';

// Layout for the holder's account and the studio admin (Czech UI).

export const FLASH: Record<string, string> = {
  ulozeno: 'Uloženo.',
  zverejneno: 'Životopis je zveřejněný.',
  pozastaveno: 'Životopis je pozastavený. Odkaz zůstává, data máme uložená.',
  obnoveno: 'Životopis je znovu online.',
  zaplaceno: 'Platba přijata.',
  odeslano: 'E-mail je na cestě. Zkontrolujte prosím schránku (i spam).',
  student: 'Studentská sleva je ověřená.',
  isic: 'Číslo ISIC jsme přijali. Ověříme ho do jednoho pracovního dne a dáme vědět e-mailem.',
  domena: 'Žádost o vlastní adresu jsme přijali. Ozveme se e-mailem.',
  smazano: 'Životopis jsme smazali.',
  importovano: 'Data z LinkedInu jsou v konceptu. Projděte je a zkraťte, co je přes limit.',
  uchovano: 'Děkujeme, životopis uchováme.',
  odeslano_ke_schvaleni: 'Odesláno klientovi ke schválení.',
  sezeni: 'Sezení uloženo.',
  hotovo: 'Hotovo.',
};

export function Layout(props: { title: string; nonce: string; children: Child; nav?: Child; wide?: boolean; flash?: string | null; scripts?: string[] }) {
  return (
    <html lang="cs">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>{`${props.title} – Pulzar CV`}</title>
        <link rel="stylesheet" href="/static/app.css" />
      </head>
      <body>
        <header class="topbar">
          <a class="brand" href="/ucet">
            Pulzar <span>CV</span>
          </a>
          {props.nav}
        </header>
        <main class={props.wide ? 'wrap wide' : 'wrap'}>
          {props.flash && FLASH[props.flash] && (
            <p class="flash" role="status">
              {FLASH[props.flash]}
            </p>
          )}
          {props.children}
        </main>
        {(props.scripts ?? ['/static/editor.js']).map((s) => (
          <script src={s} defer></script>
        ))}
      </body>
    </html>
  );
}

export function HolderNav({ email }: { email: string }) {
  return (
    <nav class="topnav">
      <a href="/ucet">Můj životopis</a>
      <a href="/ucet/upravit/hlavicka">Upravit</a>
      <a href="/ucet/nastaveni">Nastavení</a>
      <form method="post" action="/odhlaseni" class="inline">
        <button class="link" type="submit" title={email}>
          Odhlásit
        </button>
      </form>
    </nav>
  );
}

export function AdminNav() {
  return (
    <nav class="topnav">
      <a href="/admin">Přehled</a>
      <a href="/admin/cv">Životopisy</a>
      <a href="/admin/studenti">Studenti</a>
      <a href="/admin/domeny">Domény</a>
      <a href="/admin/audit">Log</a>
      <a href="/ucet">Můj účet</a>
    </nav>
  );
}

export function ErrorPage({ nonce, status, message }: { nonce: string; status: number; message: string }) {
  return (
    <Layout title={status === 404 ? 'Nenalezeno' : 'Chyba'} nonce={nonce} scripts={[]}>
      <h1>{status === 404 ? 'Tady nic není' : 'Něco se pokazilo'}</h1>
      <p>{message}</p>
      <p>
        <a href="/ucet">Zpět na účet</a>
      </p>
    </Layout>
  );
}

export function Page(props: { title: string; children: Child }) {
  return (
    <>
      <h1>{props.title}</h1>
      {props.children}
    </>
  );
}
