import { formatCzk, TIERS, TIER_IDS } from '../../config/tiers';
import { formatDateCs } from '../../cv/i18n';
import type { AuditRow } from '../../platform/audit';
import type { CvRow, PublicState } from '../../services/cvs';
import type { DomainRow } from '../../services/domains';
import type { Metrics } from '../../services/metrics';
import type { PaymentRow } from '../../services/billing';

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)} %`);
const dt = (ms: number | null) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '–');

function Target({ label, value, goal }: { label: string; value: string; goal: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td class="num">
        <strong>{value}</strong>
      </td>
      <td class="num sub">{goal}</td>
    </tr>
  );
}

export function AdminDashboardView(p: {
  m: Metrics;
  nm: Array<CvRow & { email: string }>;
  isic: Array<{ id: string; email: string; value: string; created_at: number }>;
  domains: Array<DomainRow & { slug: string }>;
  scan: { at: number; pages: number; findings: string } | null;
}) {
  const findings = p.scan ? (JSON.parse(p.scan.findings) as unknown[]).length : null;
  return (
    <>
      <h1>Přehled</h1>
      <div class="cards">
        <section class="card">
          <h2>Úkoly</h2>
          <ul class="plain">
            <li>
              <a href="#namiru">Na míru</a>: {p.nm.length}
            </li>
            <li>
              <a href="/admin/studenti">ISIC ke kontrole</a>: {p.isic.length}
            </li>
            <li>
              <a href="/admin/domeny">Domény k nastavení</a>: {p.domains.length}
            </li>
          </ul>
          <form method="post" action="/admin/cron">
            <button class="btn quiet small" type="submit">
              Spustit denní úlohu teď
            </button>
          </form>
        </section>
        <section class="card">
          <h2>Kontrola soukromí</h2>
          {p.scan ? (
            <p>
              {dt(p.scan.at)}: {p.scan.pages} stránek, <strong class={findings ? 'over' : ''}>{findings} nálezů</strong> (cíl: 0, vždy).{' '}
              <a href="/admin/soukromi">Detail</a>
            </p>
          ) : (
            <p>Zatím neproběhla.</p>
          )}
        </section>
      </div>
      <section class="card">
        <h2>Ukazatele (§8)</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Ukazatel</th>
              <th class="num">Teď</th>
              <th class="num">Cíl / stretch</th>
            </tr>
          </thead>
          <tbody>
            <Target label="Založené životopisy zveřejněné do 7 dní" value={pct(p.m.publishedWithin7d)} goal="35 % / 50 %" />
            <Target label="Medián doby do zveřejnění" value={p.m.medianMinutesToPublish === null ? '–' : `${Math.round(p.m.medianMinutesToPublish)} min`} goal="≤ 20 / ≤ 12 min" />
            <Target label="Zveřejněné a přečtené někým jiným do 30 dní" value={pct(p.m.readWithin30d)} goal="70 % / 85 %" />
            <Target label="E-maily ve veřejném HTML" value={findings === null ? '–' : String(findings)} goal="0, vždy" />
            <Target label="Zaplacené životopisy (6 měsíců)" value={String(p.m.paidLast6m)} goal="40 / 80" />
            <Target label="Podíl za studentskou cenu" value={pct(p.m.studentShare)} goal="≥ 30 %" />
            <Target label="Pozastavené nebo obnovené na konci roku" value={pct(p.m.keptAtYearEnd)} goal="50 % / 65 %" />
            <Target label="Na míru (6 měsíců)" value={String(p.m.naMiruLast6m)} goal="5 / 10" />
            <Target label="Držitelé CV, kteří koupí i vizitku" value="–" goal="15 % / 25 % (až s platformou vizitky)" />
          </tbody>
        </table>
        <p class="sub">Medián: od založení životopisu po první zveřejnění, jen u zveřejněných do 7 dní.</p>
      </section>
      <section class="card" id="namiru">
        <h2>Na míru</h2>
        {p.nm.length ? (
          <table class="table">
            <thead>
              <tr>
                <th>Klient</th>
                <th>Stav</th>
                <th>Sezení</th>
              </tr>
            </thead>
            <tbody>
              {p.nm.map((r) => (
                <tr>
                  <td>
                    <a href={`/admin/cv/${r.id}`}>{r.email}</a>
                  </td>
                  <td>{NM[r.nm_state ?? 'awaiting_session']}</td>
                  <td>{r.nm_session_at ? formatDateCs(r.nm_session_at) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>Nic nečeká.</p>
        )}
      </section>
    </>
  );
}

const NM: Record<string, string> = {
  awaiting_session: 'Domluvit sezení',
  in_progress: 'Vyplňujeme',
  awaiting_approval: 'Čeká na schválení klientem',
  approved: 'Zveřejněno klientem',
};

export function AdminCvListView({ rows, q }: { rows: Array<CvRow & { email: string; state: PublicState }>; q: string }) {
  return (
    <>
      <h1>Životopisy</h1>
      <form method="get" action="/admin/cv" class="row">
        <input name="q" value={q} placeholder="E-mail nebo adresa" aria-label="Hledat" />
        <button class="btn small" type="submit">
          Hledat
        </button>
      </form>
      <table class="table">
        <thead>
          <tr>
            <th>Adresa</th>
            <th>E-mail</th>
            <th>Balíček</th>
            <th>Stav</th>
            <th>Zaplaceno do</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td>
                <a href={`/admin/cv/${r.id}`}>{r.slug}</a>
              </td>
              <td>{r.email}</td>
              <td>{TIERS[r.tier].name}</td>
              <td>{r.state}</td>
              <td>{r.paid_until ? formatDateCs(r.paid_until) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function AdminCvView(p: { row: CvRow; email: string; state: PublicState; payments: PaymentRow[]; audit: AuditRow[]; domains: DomainRow[]; url: string }) {
  const { row } = p;
  return (
    <>
      <div class="panel-head">
        <h1>{row.slug}</h1>
        <span class={`state state-${p.state}`}>{p.state}</span>
      </div>
      <p>
        {p.email} · {TIERS[row.tier].name} · zaplaceno do {row.paid_until ? formatDateCs(row.paid_until) : '–'} ·{' '}
        <a href={p.url} target="_blank" rel="noopener">
          veřejná stránka
        </a>{' '}
        ·{' '}
        <a href={`/admin/cv/${row.id}/nahled`} target="_blank" rel="noopener">
          náhled konceptu
        </a>
      </p>
      <div class="cards">
        <section class="card stack">
          <h2>Upravit obsah</h2>
          <p class="sub">Každé uložení se zapíše do logu. Zveřejnit může jen klient.</p>
          <p>
            <a class="btn" href={`/admin/cv/${row.id}/upravit/hlavicka`}>
              Otevřít editor
            </a>
          </p>
        </section>
        {row.tier === 'na_miru' && (
          <section class="card stack">
            <h2>Na míru</h2>
            <p>Stav: {NM[row.nm_state ?? 'awaiting_session']}</p>
            <form method="post" action={`/admin/cv/${row.id}/namiru/sezeni`} class="stack">
              <div class="field">
                <label for="at">Termín sezení</label>
                <input id="at" name="at" type="datetime-local" />
              </div>
              <div class="field">
                <label for="notes">Poznámky ze sezení</label>
                <textarea id="notes" name="notes" rows={3}>
                  {row.nm_notes ?? ''}
                </textarea>
              </div>
              <button class="btn small quiet" type="submit">
                Uložit sezení
              </button>
            </form>
            <form method="post" action={`/admin/cv/${row.id}/namiru/schvaleni`}>
              <button class="btn small" type="submit" data-confirm="Odeslat klientovi e-mail, že je životopis připravený ke schválení?">
                Odeslat ke schválení
              </button>
            </form>
          </section>
        )}
        <section class="card stack">
          <h2>Balíček</h2>
          <form method="post" action={`/admin/cv/${row.id}/tarif`} class="row">
            <select name="tier" aria-label="Balíček">
              {TIER_IDS.map((t) => (
                <option value={t} selected={t === row.tier}>
                  {TIERS[t].name}
                </option>
              ))}
            </select>
            <button class="btn small quiet" type="submit">
              Změnit
            </button>
          </form>
        </section>
      </div>
      <section class="card">
        <h2>Platby</h2>
        <table class="table">
          <tbody>
            {p.payments.map((x) => (
              <tr>
                <td>{dt(x.created_at)}</td>
                <td>{x.kind}</td>
                <td>{TIERS[x.tier]?.name}</td>
                <td class="num">{formatCzk(x.amount_czk)}</td>
                <td>{x.student ? 'student' : ''}</td>
                <td>{x.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section class="card">
        <h2>Domény</h2>
        {p.domains.length ? p.domains.map((d) => <p>{`${d.hostname} – ${d.status}`}</p>) : <p>Žádné.</p>}
      </section>
      <AuditTable rows={p.audit} />
    </>
  );
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  return (
    <section class="card">
      <h2>Log (PL-11)</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Kdy</th>
            <th>Kdo</th>
            <th>Co</th>
            <th>Cíl</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td>{dt(r.at)}</td>
              <td>{r.actor_email ?? r.actor}</td>
              <td>{r.action}</td>
              <td>{r.target ? <a href={`/admin/cv/${r.target}`}>{r.target}</a> : ''}</td>
              <td class="sub">{r.details ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function AdminStudentsView({ rows }: { rows: Array<{ id: string; email: string; value: string; created_at: number }> }) {
  return (
    <>
      <h1>Ověření ISIC (CV-12)</h1>
      {rows.length ? (
        <table class="table">
          <tbody>
            {rows.map((r) => (
              <tr>
                <td>{dt(r.created_at)}</td>
                <td>{r.email}</td>
                <td>
                  <code>{r.value}</code>
                </td>
                <td>
                  <form method="post" action={`/admin/studenti/${r.id}`} class="row">
                    <button class="btn small" name="decision" value="approve" type="submit">
                      Ověřit
                    </button>
                    <button class="btn small danger" name="decision" value="reject" type="submit">
                      Zamítnout
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Nic nečeká.</p>
      )}
    </>
  );
}

export function AdminDomainsView({ rows }: { rows: Array<DomainRow & { slug: string }> }) {
  return (
    <>
      <h1>Vlastní domény (CV-10)</h1>
      <p class="sub">Postup nastavení je v docs/ops.md. Aktivujte doménu až potom, co na ni Worker odpovídá.</p>
      <table class="table">
        <tbody>
          {rows.map((d) => (
            <tr>
              <td>
                <strong>{d.hostname}</strong>
              </td>
              <td>
                <a href={`/admin/cv/${d.cv_id}`}>{d.slug}</a>
              </td>
              <td>{d.mode === 'studio_registers' ? 'registruje studio' : 'klient přesune DNS'}</td>
              <td>{d.status}</td>
              <td>
                <form method="post" action={`/admin/domeny/${encodeURIComponent(d.hostname)}`} class="row">
                  {d.status !== 'active' && (
                    <button class="btn small" name="status" value="active" type="submit">
                      Aktivovat
                    </button>
                  )}
                  {d.status !== 'removed' && (
                    <button class="btn small danger" name="status" value="removed" type="submit">
                      Odebrat
                    </button>
                  )}
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function AdminPrivacyView({ scans }: { scans: Array<{ at: number; pages: number; findings: string }> }) {
  return (
    <>
      <h1>Kontrola soukromí</h1>
      <p class="sub">Každý den se vykreslí všechny veřejné stránky a hledají se v nich e-maily a telefony držitelů (§8: 0, vždy).</p>
      <table class="table">
        <tbody>
          {scans.map((s) => (
            <tr>
              <td>{dt(s.at)}</td>
              <td class="num">{s.pages} stránek</td>
              <td>{s.findings === '[]' ? 'bez nálezů' : <code>{s.findings}</code>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
