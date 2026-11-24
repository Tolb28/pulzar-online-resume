import { TEMPLATES, TEMPLATE_IDS } from '../../config/templates';
import { formatCzk, initialPrice, PRICES, TIERS, TIER_IDS } from '../../config/tiers';
import { formatDateCs } from '../../cv/i18n';
import type { CvDoc, Lang, TierId, Visibility } from '../../cv/types';
import type { Issue } from '../../cv/validate';
import type { AccountRow } from '../../platform/auth';
import type { DayStats } from '../../platform/stats';
import type { CvRow, PublicState } from '../../services/cvs';
import type { DomainRow } from '../../services/domains';
import { IssueList } from './fields';

const STATE_LABEL: Record<PublicState, string> = {
  draft: 'Koncept – zatím není online',
  online: 'Online',
  paused: 'Pozastavený – není online',
  expired: 'Zaplacené období skončilo – není online',
};

const NM_LABEL: Record<NonNullable<CvRow['nm_state']>, string> = {
  awaiting_session: 'Ozveme se a domluvíme 60minutové sezení.',
  in_progress: 'Na vašem životopisu pracujeme.',
  awaiting_approval: 'Studio připravilo váš životopis. Zkontrolujte ho a zveřejněte – bez vás se nic nezveřejní.',
  approved: 'Hotovo – zveřejnili jste životopis připravený se studiem.',
};

// ---------- sign-in ----------

export function LoginView({ sent, src, error }: { sent?: boolean; src?: string; error?: string }) {
  if (sent) {
    return (
      <div class="narrow">
        <h1>Zkontrolujte e-mail</h1>
        <p>Poslali jsme vám odkaz pro přihlášení. Platí 15 minut a jde použít jen jednou.</p>
      </div>
    );
  }
  return (
    <div class="narrow">
      <h1>Přihlášení</h1>
      <p>Pošleme vám odkaz pro přihlášení. Bez hesla. Účet se založí sám při prvním přihlášení.</p>
      {error && <p class="flash error">{error}</p>}
      <form method="post" action="/prihlaseni" class="stack">
        <div class="field">
          <label for="email">E-mail</label>
          <input id="email" name="email" type="email" autocomplete="email" required autofocus />
        </div>
        {src && <input type="hidden" name="src" value={src} />}
        <button class="btn" type="submit">
          Poslat odkaz
        </button>
      </form>
      <p class="sub">Pulzar CV doplňuje LinkedIn: jeden odkaz pro LinkedIn a přihlášky, PDF ze stejného obsahu.</p>
    </div>
  );
}

export function ConfirmView({ title, text, action, button }: { title: string; text: string; action: string; button: string }) {
  return (
    <div class="narrow">
      <h1>{title}</h1>
      <p>{text}</p>
      <form method="post" action={action}>
        <button class="btn" type="submit">
          {button}
        </button>
      </form>
    </div>
  );
}

// ---------- new CV ----------

export function NewCvView({ name, slug, tier, error }: { name: string; slug: string; tier: TierId; error?: string }) {
  return (
    <div class="narrow">
      <h1>Nový životopis</h1>
      {error && <p class="flash error">{error}</p>}
      <form method="post" action="/ucet/novy" class="stack">
        <div class="field">
          <label for="name">Jméno a příjmení</label>
          <input id="name" name="name" value={name} required autocomplete="name" />
        </div>
        <div class="field">
          <label for="slug">Adresa</label>
          <div class="prefixed">
            <span>cv.pulzarstudio.cz/</span>
            <input id="slug" name="slug" value={slug} required pattern="[a-z0-9-]{3,50}" data-slug />
          </div>
          <p class="help">Malá písmena bez diakritiky, číslice a pomlčky. Odkaz zůstane stejný, i když životopis pozastavíte.</p>
        </div>
        <fieldset class="choices">
          <legend>Balíček</legend>
          {TIER_IDS.map((t) => (
            <label class="choice">
              <input type="radio" name="tier" value={t} checked={t === tier} />
              <strong>
                {TIERS[t].name} · {formatCzk(initialPrice(t, false))} / 12 měsíců
              </strong>
              <span>{TIER_SUMMARY[t]}</span>
            </label>
          ))}
          <p class="help">Platíte až při zveřejnění. Do té doby můžete balíček změnit. Studenti mají Základ za {formatCzk(PRICES.zakladStudent)}.</p>
        </fieldset>
        <fieldset class="choices">
          <legend>Jazyk</legend>
          <label class="check">
            <input type="radio" name="lang" value="cs" checked /> Česky
          </label>
          <label class="check">
            <input type="radio" name="lang" value="en" /> Anglicky
          </label>
          <label class="check">
            <input type="radio" name="lang" value="cs,en" /> Česky i anglicky (Profi a Na míru)
          </label>
        </fieldset>
        <fieldset class="choices">
          <legend>Šablona</legend>
          {TEMPLATE_IDS.map((t, i) => (
            <label class="check">
              <input type="radio" name="template" value={t} checked={i === 1} /> {TEMPLATES[t].name}
            </label>
          ))}
        </fieldset>
        <label class="check">
          <input type="checkbox" name="graduate" value="1" /> Jsem student nebo absolvent – dát vzdělání a projekty napřed
        </label>
        <button class="btn" type="submit">
          Založit životopis
        </button>
      </form>
    </div>
  );
}

export const TIER_SUMMARY: Record<TierId, string> = {
  zaklad: 'Jeden jazyk (CS nebo EN), 3 šablony a 6 barev, 3 projekty, PDF.',
  profi: 'Česky i anglicky, vlastní barva, 8 projektů s obrázky, PDF v obou jazycích, statistiky, vlastní doména.',
  na_miru: 'Jako Profi a k tomu 60 minut se studiem: text napíšeme nebo upravíme s vámi a vyplníme ho. Zveřejníte ho vy.',
};

// ---------- dashboard ----------

export function DashboardView(p: {
  account: AccountRow;
  row: CvRow;
  doc: CvDoc;
  issues: Issue[];
  state: PublicState;
  url: string;
  ownUrl: string | null;
  unpublished: boolean;
  paid: boolean;
  stats: { views: number; pdf_downloads: number; contact_reveals: number } | null;
}) {
  const { row, state } = p;
  const errors = p.issues.filter((i) => i.severity === 'error');
  const tier = TIERS[row.tier];
  return (
    <>
      <div class="panel-head">
        <h1>Můj životopis</h1>
        <span class={`state state-${state}`}>{STATE_LABEL[state]}</span>
      </div>
      {row.nm_state && (
        <p class={row.nm_state === 'awaiting_approval' ? 'flash' : 'note'}>
          <strong>Na míru: </strong>
          {NM_LABEL[row.nm_state]}
        </p>
      )}
      <div class="cards">
        <section class="card">
          <h2>Odkaz</h2>
          <p class="url">
            <a href={p.url} target="_blank" rel="noopener">
              {p.url.replace(/^https?:\/\//, '')}
            </a>
          </p>
          {p.ownUrl && (
            <p class="url">
              <a href={p.ownUrl} target="_blank" rel="noopener">
                {p.ownUrl.replace(/^https?:\/\//, '')}
              </a>
            </p>
          )}
          <p class="sub">
            {row.visibility === 'public' ? 'Veřejný – vyhledávače ho mohou najít.' : row.visibility === 'pin' ? 'Chráněný PINem.' : 'Jen s odkazem – vyhledávače ho nenajdou.'}{' '}
            <a href="/ucet/nastaveni">Změnit</a>
          </p>
          <p class="sub">
            <a href="/ucet/napoveda/linkedin">Jak přidat odkaz na LinkedIn</a>
          </p>
        </section>
        <section class="card">
          <h2>Balíček {tier.name}</h2>
          {row.paid_until ? (
            <p>
              Zaplaceno do <strong>{formatDateCs(row.paid_until)}</strong>
              {row.student_price ? ' (studentská cena)' : ''}.
            </p>
          ) : (
            <p>Zatím nezaplaceno. Platíte až při zveřejnění.</p>
          )}
          {row.paid_until && (
            <form method="post" action="/ucet/prodlouzit">
              <button class="btn quiet small" type="submit">
                Prodloužit o rok za {formatCzk(PRICES.renewal)}
              </button>
            </form>
          )}
        </section>
        {p.stats && (
          <section class="card">
            <h2>Posledních 30 dní</h2>
            <p class="stats">
              <span>
                <strong>{p.stats.views}</strong> zobrazení
              </span>
              <span>
                <strong>{p.stats.pdf_downloads}</strong> PDF
              </span>
              <span>
                <strong>{p.stats.contact_reveals}</strong> kontaktů
              </span>
            </p>
            <a href="/ucet/statistiky">Podrobně</a>
          </section>
        )}
      </div>
      <section class="card">
        <h2>Obsah</h2>
        {errors.length ? (
          <>
            <p>Před zveřejněním je potřeba upravit {errors.length === 1 ? 'jednu věc' : `${errors.length} věcí`}:</p>
            <IssueList issues={errors.slice(0, 8)} />
          </>
        ) : (
          <p>Vše je v limitu. {p.unpublished && state !== 'draft' ? 'Máte změny, které ještě nejsou zveřejněné.' : ''}</p>
        )}
        <p class="actions">
          <a class="btn" href="/ucet/upravit/hlavicka">
            Upravit
          </a>
          <a class="btn quiet" href="/ucet/nahled" target="_blank" rel="noopener">
            Náhled webu
          </a>
          <a class="btn quiet" href={`/ucet/nahled.pdf?lang=${p.doc.langs[0]}`} target="_blank" rel="noopener">
            Náhled PDF
          </a>
          <a class="btn quiet" href="/ucet/import">
            Načíst z LinkedInu
          </a>
        </p>
      </section>
      <section class="card">
        <h2>Zveřejnění</h2>
        {state === 'online' ? (
          <p class="actions">
            {p.unpublished && (
              <a class="btn" href="/ucet/zverejnit">
                Zveřejnit změny
              </a>
            )}
            <form method="post" action="/ucet/pozastavit" class="inline">
              <button class="btn quiet" type="submit" data-confirm="Pozastavit životopis? Hned přestane být online. Odkaz i data zůstanou.">
                Pozastavit
              </button>
            </form>
          </p>
        ) : state === 'paused' ? (
          <>
            <p>Pozastavený životopis není online. Data i odkaz zůstávají, zdarma.</p>
            <form method="post" action="/ucet/obnovit">
              <button class="btn" type="submit">
                {p.paid ? 'Znovu zveřejnit' : `Obnovit za ${formatCzk(PRICES.renewal)}`}
              </button>
            </form>
          </>
        ) : state === 'expired' ? (
          <>
            <p>Zaplacené období skončilo. Prodloužením životopis hned vrátíte na stejný odkaz.</p>
            <form method="post" action="/ucet/prodlouzit">
              <button class="btn" type="submit">
                Prodloužit o rok za {formatCzk(PRICES.renewal)}
              </button>
            </form>
          </>
        ) : (
          <p>
            <a class="btn" href="/ucet/zverejnit">
              {row.paid_until ? 'Zveřejnit' : 'Zaplatit a zveřejnit'}
            </a>
          </p>
        )}
      </section>
    </>
  );
}

// ---------- publish and pay ----------

export function PublishView(p: { account: AccountRow; row: CvRow; issues: Issue[]; paid: boolean; amount: number; studentEligible: boolean; canStudent: boolean; cancelled?: boolean }) {
  const errors = p.issues.filter((i) => i.severity === 'error');
  return (
    <div class="narrow">
      <h1>{p.paid ? 'Zveřejnit životopis' : 'Zaplatit a zveřejnit'}</h1>
      {p.cancelled && <p class="flash error">Platba se nedokončila. Můžete to zkusit znovu.</p>}
      {errors.length > 0 && (
        <>
          <p>Před zveřejněním je potřeba upravit tohle (koncept se ukládá i tak):</p>
          <IssueList issues={errors} />
          <p>
            <a class="btn quiet" href="/ucet/upravit/hlavicka">
              Upravit
            </a>
          </p>
        </>
      )}
      {!p.paid && (
        <form method="post" action="/ucet/tarif" class="stack">
          <fieldset class="choices">
            <legend>Balíček</legend>
            {TIER_IDS.map((t) => (
              <label class="choice">
                <input type="radio" name="tier" value={t} checked={p.row.tier === t} />
                <strong>
                  {TIERS[t].name} · {formatCzk(initialPrice(t, t === 'zaklad' && p.canStudent))}
                  {t === 'zaklad' && p.canStudent ? ' (studentská cena)' : ''}
                </strong>
                <span>{TIER_SUMMARY[t]}</span>
              </label>
            ))}
          </fieldset>
          <button class="btn quiet small" type="submit">
            Změnit balíček
          </button>
          {!p.canStudent && (
            <p class="help">
              Studujete? <a href="/ucet/student">Ověřte se</a> a Základ máte první rok za {formatCzk(PRICES.zakladStudent)}.
            </p>
          )}
        </form>
      )}
      <form method="post" action="/ucet/zverejnit" class="stack">
        {p.paid ? (
          <button class="btn" type="submit" disabled={errors.length > 0}>
            Zveřejnit
          </button>
        ) : (
          <>
            <p>
              Zaplatíte <strong class="num">{formatCzk(p.amount)}</strong> za 12 měsíců ({TIERS[p.row.tier].name}
              {p.studentEligible ? ', studentská cena' : ''}). Pak stačí obnova za {formatCzk(PRICES.renewal)} ročně, nebo bezplatné pozastavení.
            </p>
            <button class="btn" type="submit">
              Zaplatit {formatCzk(p.amount)}
            </button>
            {p.row.tier !== 'na_miru' && <p class="sub">Je-li vše v limitu, životopis se po zaplacení rovnou zveřejní.</p>}
          </>
        )}
      </form>
    </div>
  );
}

export function TestPaymentView({ id, amount, label }: { id: string; amount: number; label: string }) {
  return (
    <div class="narrow">
      <h1>Testovací platba</h1>
      <p class="note">Toto je vývojový platební modul. V produkci tu je platební brána.</p>
      <p>
        {label}: <strong class="num">{formatCzk(amount)}</strong>
      </p>
      <form method="post" action={`/ucet/platba/test/${id}`}>
        <button class="btn" type="submit">
          Zaplatit (test)
        </button>
      </form>
    </div>
  );
}

export function PaymentDoneView({ status, outcome }: { status: 'paid' | 'pending' | 'failed'; outcome?: string }) {
  return (
    <div class="narrow">
      <h1>{status === 'paid' ? 'Platba přijata' : status === 'pending' ? 'Čekáme na potvrzení platby' : 'Platba se nepovedla'}</h1>
      {status === 'pending' && <p>Obvykle to trvá pár sekund. Stránku můžete obnovit.</p>}
      {outcome === 'published' && <p>Životopis je zveřejněný.</p>}
      {outcome === 'na_miru' && <p>Děkujeme. Do dvou pracovních dnů se ozveme a domluvíme sezení.</p>}
      {outcome === 'paid' && <p>Až bude vše v limitu, zveřejníte životopis jedním kliknutím.</p>}
      <p>
        <a class="btn" href="/ucet">
          Na můj životopis
        </a>
      </p>
    </div>
  );
}

// ---------- settings ----------

export function SettingsView(p: { row: CvRow; langs: Lang[]; slugError?: string; domains: DomainRow[]; pinSet: boolean; problem?: string }) {
  const tier = TIERS[p.row.tier];
  const v: Visibility = p.row.visibility;
  return (
    <div class="narrow">
      <h1>Nastavení</h1>
      {p.problem && <p class="flash error">{p.problem}</p>}
      <form method="post" action="/ucet/nastaveni/viditelnost" class="card stack">
        <h2>Kdo životopis uvidí</h2>
        <label class="choice">
          <input type="radio" name="visibility" value="link" checked={v === 'link'} />
          <strong>Jen s odkazem (doporučeno)</strong>
          <span>Uvidí ho ten, komu pošlete odkaz. Vyhledávače ho nenajdou, takže ho třeba nenajde ani současný zaměstnavatel.</span>
        </label>
        <label class="choice">
          <input type="radio" name="visibility" value="public" checked={v === 'public'} />
          <strong>Veřejný</strong>
          <span>Vyhledávače (Google, Seznam) ho mohou zařadit do výsledků. Kdokoli, kdo hledá vaše jméno, ho může najít. Kontakt zůstává skrytý za kliknutím.</span>
        </label>
        <label class="choice">
          <input type="radio" name="visibility" value="pin" checked={v === 'pin'} />
          <strong>Chráněný PINem</strong>
          <span>Návštěvník zadá PIN, který uvedete v přihlášce. Vyhledávače ho nenajdou.</span>
        </label>
        <div class="field">
          <label for="pin">PIN (4–6 číslic){p.pinSet ? ' – nastavený, pro změnu zadejte nový' : ''}</label>
          <input id="pin" name="pin" inputmode="numeric" pattern="[0-9]{4,6}" autocomplete="off" />
        </div>
        <button class="btn small" type="submit">
          Uložit
        </button>
      </form>

      <form method="post" action="/ucet/nastaveni/jazyky" class="card stack">
        <h2>Jazyk</h2>
        {tier.maxLangs > 1 ? (
          <>
            <label class="check">
              <input type="radio" name="langs" value="cs,en" checked={p.langs.join(',') === 'cs,en'} /> Česky i anglicky, hlavní čeština
            </label>
            <label class="check">
              <input type="radio" name="langs" value="en,cs" checked={p.langs.join(',') === 'en,cs'} /> Anglicky i česky, hlavní angličtina
            </label>
          </>
        ) : null}
        <label class="check">
          <input type="radio" name="langs" value="cs" checked={p.langs.join(',') === 'cs'} /> Jen česky
        </label>
        <label class="check">
          <input type="radio" name="langs" value="en" checked={p.langs.join(',') === 'en'} /> Jen anglicky
        </label>
        {tier.maxLangs === 1 && <p class="help">Dvojjazyčný životopis (CS + EN) je v Profi a Na míru. Text v druhém jazyce zůstává uložený.</p>}
        <button class="btn small" type="submit">
          Uložit
        </button>
      </form>

      <form method="post" action="/ucet/nastaveni/adresa" class="card stack">
        <h2>Adresa</h2>
        {p.slugError && <p class="flash error">{p.slugError}</p>}
        <div class="prefixed">
          <span>cv.pulzarstudio.cz/</span>
          <input name="slug" value={p.row.slug} required pattern="[a-z0-9-]{3,50}" />
        </div>
        {p.row.published && <p class="help">Pozor: starý odkaz přestane fungovat. Kdo ho má, uvidí chybu.</p>}
        <button class="btn small" type="submit">
          Změnit adresu
        </button>
      </form>

      <section class="card stack">
        <h2>Vlastní doména</h2>
        {tier.ownDomain ? (
          <>
            {p.domains.map((d) => (
              <p>
                <strong>{d.hostname}</strong> – {d.status === 'active' ? 'aktivní' : 'čeká na nastavení studiem'}
              </p>
            ))}
            <form method="post" action="/ucet/nastaveni/domena" class="stack">
              <div class="field">
                <label for="hostname">Doména (např. jananovakova.cz nebo cv.jananovakova.cz)</label>
                <input id="hostname" name="hostname" required />
              </div>
              <label class="check">
                <input type="radio" name="mode" value="studio_registers" checked /> Zaregistrujte ji prosím za mě (od {formatCzk(PRICES.domainFrom)} ročně)
              </label>
              <label class="check">
                <input type="radio" name="mode" value="holder_moves_dns" /> Doménu mám a přesunu její DNS na Cloudflare studia
              </label>
              <button class="btn small" type="submit">
                Požádat o doménu
              </button>
            </form>
          </>
        ) : (
          <p>Vlastní doménu má Profi a Na míru.</p>
        )}
      </section>

      <section class="card stack">
        <h2>Vaše data</h2>
        <p>
          <a href="/ucet/export.json">Stáhnout všechna data (JSON)</a>
        </p>
        <form method="post" action="/ucet/smazat" class="stack">
          <div class="field">
            <label for="confirm">Smazat životopis natrvalo – pro potvrzení napište jeho adresu „{p.row.slug}“</label>
            <input id="confirm" name="confirm" autocomplete="off" />
          </div>
          <button class="btn danger small" type="submit">
            Smazat životopis
          </button>
        </form>
      </section>
    </div>
  );
}

// ---------- student price (CV-12) ----------

export function StudentView({ account, pending, problem }: { account: AccountRow; pending: boolean; problem?: string }) {
  return (
    <div class="narrow">
      <h1>Studentská cena</h1>
      <p>
        Základ za {formatCzk(PRICES.zakladStudent)} místo {formatCzk(PRICES.zaklad)} na první rok. Obnova pak stojí běžných {formatCzk(PRICES.renewal)} ročně.
      </p>
      {problem && <p class="flash error">{problem}</p>}
      {account.student_verified_at ? (
        <p class="flash">Jste ověření ({account.student_method === 'isic' ? 'ISIC' : `školní e-mail, ${account.student_detail}`}).</p>
      ) : (
        <>
          <form method="post" action="/ucet/student/skola" class="card stack">
            <h2>Přes školní e-mail</h2>
            <div class="field">
              <label for="school">Školní e-mail</label>
              <input id="school" name="email" type="email" placeholder="jmeno@student.cuni.cz" required />
            </div>
            <button class="btn small" type="submit">
              Poslat ověřovací odkaz
            </button>
          </form>
          <form method="post" action="/ucet/student/isic" class="card stack">
            <h2>Přes ISIC</h2>
            {pending ? (
              <p>Vaše ISIC čeká na ověření studiem (do jednoho pracovního dne).</p>
            ) : (
              <>
                <div class="field">
                  <label for="isic">Číslo ISIC (např. S 420 123 456 789 A)</label>
                  <input id="isic" name="isic" required autocomplete="off" />
                </div>
                <button class="btn small" type="submit">
                  Odeslat ke kontrole
                </button>
              </>
            )}
          </form>
        </>
      )}
      <p>
        <a href="/ucet/zverejnit">Zpět ke zveřejnění</a>
      </p>
    </div>
  );
}

// ---------- help (CV-7) ----------

export function LinkedInHelpView({ url }: { url: string }) {
  return (
    <div class="narrow prose">
      <h1>Odkaz na životopis v LinkedInu</h1>
      <p>Pulzar CV LinkedIn nenahrazuje, doplňuje ho. Přidejte odkaz na dvě místa:</p>
      <h2>1. Kontaktní údaje → Web</h2>
      <ol>
        <li>Na svém profilu klikněte na ikonu tužky u úvodní karty.</li>
        <li>Sjeďte ke kontaktním údajům a zvolte „Upravit kontaktní údaje“ (Contact info).</li>
        <li>
          U „Web“ (Website) klikněte na „Přidat web“, vložte <code>{url}</code> a jako typ zvolte „Portfolio“ nebo „Osobní“.
        </li>
      </ol>
      <h2>2. Sekce Doporučené (Featured)</h2>
      <ol>
        <li>Na profilu zvolte „Přidat sekci“ → „Doporučené“ → „Přidat odkaz“.</li>
        <li>Vložte odkaz. LinkedIn načte název a fotku ze stránky životopisu.</li>
      </ol>
      <p class="note">Názvy tlačítek se v LinkedInu občas mění. Text naposledy porovnán s rozhraním LinkedInu: před spuštěním ověřit (CV-7).</p>
      <p>
        <a href="/ucet">Zpět</a>
      </p>
    </div>
  );
}

// ---------- statistics (CV-15) ----------

export function StatsView({ days, total }: { days: DayStats[]; total: Omit<DayStats, 'day'> }) {
  const max = Math.max(1, ...days.map((d) => d.views));
  return (
    <div class="narrow">
      <h1>Statistiky</h1>
      <p class="sub">Za posledních 30 dní. Bez cookies; roboti a vaše vlastní návštěvy se nepočítají.</p>
      <p class="stats">
        <span>
          <strong>{total.views}</strong> zobrazení
        </span>
        <span>
          <strong>{total.pdf_downloads}</strong> stažení PDF
        </span>
        <span>
          <strong>{total.contact_reveals}</strong> zobrazení kontaktu
        </span>
      </p>
      <div class="bars" role="img" aria-label={`Zobrazení po dnech, nejvíc ${max} za den`}>
        {days.map((d) => (
          <span class={`bar h${Math.round((d.views / max) * 10)}`} title={`${d.day}: ${d.views}`}></span>
        ))}
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Den</th>
            <th class="num">Zobrazení</th>
            <th class="num">PDF</th>
            <th class="num">Kontakt</th>
          </tr>
        </thead>
        <tbody>
          {[...days]
            .reverse()
            .filter((d) => d.views || d.pdf_downloads || d.contact_reveals)
            .map((d) => (
              <tr>
                <td>{d.day}</td>
                <td class="num">{d.views}</td>
                <td class="num">{d.pdf_downloads}</td>
                <td class="num">{d.contact_reveals}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

