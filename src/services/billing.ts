import { schoolDomainOf } from '../config/schools';
import { formatCzk, initialPrice, PAID_PERIOD_MONTHS, PRICES, TIERS } from '../config/tiers';
import { randomId } from '../cv/text';
import type { TierId } from '../cv/types';
import { errorsOf, validateDoc } from '../cv/validate';
import { audit, SYSTEM, type Actor } from '../platform/audit';
import { issueToken, type AccountRow } from '../platform/auth';
import { sha256Hex } from '../platform/crypto';
import { addMonths, one, run } from '../platform/db';
import { mails } from '../platform/mail';
import { draftDoc, getCvById, langsOf, publicUrl, publish, type CvRow } from './cvs';
import type { Deps } from './deps';

// D3: a one-off price covers 12 months, then a low yearly renewal. CV-12: the student price
// applies to Základ, for the first year only.

export interface PaymentRow {
  id: string;
  account_id: string;
  cv_id: string;
  kind: 'initial' | 'renewal';
  tier: TierId;
  student: number;
  amount_czk: number;
  provider: string;
  provider_ref: string | null;
  status: 'pending' | 'paid' | 'failed';
  created_at: number;
  paid_at: number | null;
}

export function studentEligible(account: AccountRow, row: CvRow): boolean {
  return !!account.student_verified_at && row.tier === 'zaklad' && !row.paid_until;
}

/** What the next payment for this CV would be. */
export function quote(account: AccountRow, row: CvRow): { kind: 'initial' | 'renewal'; amount: number; student: boolean; label: string } {
  if (row.paid_until) return { kind: 'renewal', amount: PRICES.renewal, student: false, label: `prodloužení o rok (${TIERS[row.tier].name})` };
  const student = studentEligible(account, row);
  return { kind: 'initial', amount: initialPrice(row.tier, student), student, label: `${TIERS[row.tier].name}${student ? ', studentská cena' : ''} na 12 měsíců` };
}

export async function startCheckout(deps: Deps, account: AccountRow, row: CvRow, opts: { resume?: boolean } = {}): Promise<{ url: string; paymentId: string }> {
  const now = deps.now();
  const q = quote(account, row);
  const id = randomId();
  await run(
    deps.db,
    `INSERT INTO payments (id, account_id, cv_id, kind, tier, student, amount_czk, provider, status, created_at, resume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    id,
    account.id,
    row.id,
    q.kind,
    row.tier,
    q.student ? 1 : 0,
    q.amount,
    deps.payments.id,
    now,
    opts.resume ? 1 : 0,
  );
  const checkout = await deps.payments.createCheckout({
    paymentId: id,
    amountCzk: q.amount,
    description: `Pulzar CV – ${q.label}`,
    email: account.email,
    successUrl: `${deps.baseUrl}/ucet/platba/hotovo?p=${id}`,
    cancelUrl: `${deps.baseUrl}/ucet/zverejnit?zruseno=1`,
  });
  await run(deps.db, 'UPDATE payments SET provider_ref = ? WHERE id = ?', checkout.ref, id);
  return { url: checkout.url, paymentId: id };
}

export type CompletionOutcome = 'published' | 'paid' | 'na_miru' | 'renewed' | 'already';

/** Side effects after a payment (e-mails, auto-publish) must never undo or block the payment itself. */
async function bestEffort(what: string, f: () => Promise<unknown>): Promise<void> {
  try {
    await f();
  } catch (e) {
    console.error(`after payment: ${what} failed`, e);
  }
}

/**
 * Mark a payment paid and extend the paid period – both in one transaction, so a provider
 * retry can never find the payment "paid" without its effect. Idempotent.
 *
 * The tier that was paid for (p.tier) is what the CV gets, whatever the CV says now: the tier
 * can be switched while a checkout is still open, and nobody gets Profi for the Základ price.
 */
export async function completePayment(deps: Deps, paymentId: string, ref: string | null): Promise<CompletionOutcome | null> {
  const now = deps.now();
  const p = await one<PaymentRow & { resume: number }>(deps.db, 'SELECT * FROM payments WHERE id = ?', paymentId);
  if (!p) return null;
  if (p.status !== 'pending') return 'already';
  const row = await getCvById(deps.db, p.cv_id);
  const account = await one<AccountRow>(deps.db, 'SELECT * FROM accounts WHERE id = ?', p.account_id);
  if (!row || !account) return null;

  const base = row.paid_until && row.paid_until > now ? row.paid_until : now;
  const until = addMonths(base, PAID_PERIOD_MONTHS);
  const tier = TIERS[p.tier] ?? TIERS[row.tier];
  const langs = langsOf(row).slice(0, tier.maxLangs);
  const results = await deps.db.batch([
    deps.db
      .prepare(`UPDATE payments SET status = 'paid', paid_at = ?, provider_ref = COALESCE(?, provider_ref) WHERE id = ? AND status = 'pending'`)
      .bind(now, ref, paymentId),
    deps.db
      .prepare(
        `UPDATE cvs SET paid_until = ?,
           tier = CASE WHEN ? = 'initial' THEN ? ELSE tier END,
           langs = CASE WHEN ? = 'initial' THEN ? ELSE langs END,
           student_price = CASE WHEN ? = 1 THEN 1 ELSE student_price END,
           nm_state = CASE WHEN ? = 'initial' AND ? = 'na_miru' AND nm_state IS NULL THEN 'awaiting_session' ELSE nm_state END,
           status = CASE WHEN ? = 1 AND status = 'paused' AND published IS NOT NULL THEN 'live' ELSE status END,
           paused_at = CASE WHEN ? = 1 AND status = 'paused' AND published IS NOT NULL THEN NULL ELSE paused_at END,
           offline_since = CASE WHEN (status = 'live' OR ? = 1) AND published IS NOT NULL THEN NULL ELSE offline_since END,
           retention_prompted_at = NULL, retention_warned_at = NULL, retention_confirmed_at = ?, updated_at = ?
         WHERE id = ? AND (SELECT changes()) = 1`,
      )
      .bind(until, p.kind, tier.id, p.kind, JSON.stringify(langs), p.student, p.kind, tier.id, p.resume, p.resume, p.resume, now, now, row.id),
  ]);
  // Another delivery of the same webhook got there first.
  if (!results[0] || (results[0] as { meta?: { changes?: number } }).meta?.changes === 0) return 'already';
  await audit(deps.db, now, SYSTEM, 'payment.paid', row.id, { paymentId, kind: p.kind, tier: tier.id, amount: p.amount_czk, student: !!p.student, until });
  await bestEffort('paid e-mail', () =>
    deps.mailer.send(mails.paid(account.email, p.kind === 'renewal' ? 'prodloužení životopisu' : `balíček ${tier.name}`, formatCzk(p.amount_czk), until)),
  );

  if (p.kind === 'renewal') return 'renewed';
  if (tier.id === 'na_miru') {
    await bestEffort('Na míru e-mails', async () => {
      await deps.mailer.send(mails.naMiruBooked(account.email));
      for (const admin of deps.admins) await deps.mailer.send(mails.naMiruStudio(admin, account.email, `${deps.baseUrl}/admin/cv/${row.id}`));
    });
    return 'na_miru';
  }
  // The holder clicked "Zaplatit a zveřejnit": publish now if the draft is ready. If this fails,
  // the CV is paid and the holder publishes from the dashboard.
  let outcome: CompletionOutcome = 'paid';
  await bestEffort('auto-publish', async () => {
    const fresh = (await getCvById(deps.db, row.id))!;
    if (errorsOf(validateDoc(await draftDoc(deps.db, fresh))).length) return;
    const r = await publish(deps, fresh, { id: account.id, email: account.email, role: 'holder' });
    if (!r.ok) return;
    outcome = 'published';
    await deps.mailer.send(mails.published(account.email, publicUrl(deps, fresh)));
  });
  return outcome;
}

// ---------- student price (CV-12) ----------

export async function requestSchoolEmail(deps: Deps, account: AccountRow, email: string): Promise<'sent' | 'not_school'> {
  const domain = schoolDomainOf(email);
  if (!domain) return 'not_school';
  const token = await issueToken(deps.db, deps.now(), 'student', { accountId: account.id, email: email.trim().toLowerCase(), data: { domain } });
  await deps.mailer.send(mails.studentVerify(email.trim(), `${deps.baseUrl}/ucet/student/overit/${token}`));
  return 'sent';
}

/** Hash of a verified school address: enough to spot reuse, without keeping the address. */
export async function schoolEmailHash(email: string): Promise<string> {
  return sha256Hex(`school:${email.trim().toLowerCase()}`);
}

export async function markStudent(
  deps: Deps,
  accountId: string,
  method: 'school_email' | 'isic',
  detail: string,
  actor: Actor,
  schoolEmail?: string,
): Promise<'ok' | 'mailbox_used'> {
  const now = deps.now();
  const hash = schoolEmail ? await schoolEmailHash(schoolEmail) : null;
  if (hash) {
    // CV-12: one school mailbox verifies one account (a forwarded link cannot verify a friend).
    const other = await one<{ id: string }>(deps.db, 'SELECT id FROM accounts WHERE student_email_hash = ? AND id != ?', hash, accountId);
    if (other) {
      await audit(deps.db, now, actor, 'student.mailbox_reused', accountId, { method, detail });
      return 'mailbox_used';
    }
  }
  await run(
    deps.db,
    'UPDATE accounts SET student_verified_at = ?, student_method = ?, student_detail = ?, student_email_hash = COALESCE(?, student_email_hash) WHERE id = ?',
    now,
    method,
    detail,
    hash,
    accountId,
  );
  await audit(deps.db, now, actor, 'student.verified', accountId, { method, detail });
  return 'ok';
}

export async function requestIsic(deps: Deps, account: AccountRow, isic: string): Promise<void> {
  await run(
    deps.db,
    `INSERT INTO student_requests (id, account_id, method, value, status, created_at) VALUES (?, ?, 'isic', ?, 'pending', ?)`,
    randomId(),
    account.id,
    isic,
    deps.now(),
  );
}

export async function decideIsic(deps: Deps, requestId: string, approve: boolean, admin: Actor): Promise<boolean> {
  const now = deps.now();
  const req = await one<{ id: string; account_id: string; value: string; status: string }>(deps.db, 'SELECT * FROM student_requests WHERE id = ?', requestId);
  if (!req || req.status !== 'pending') return false;
  const masked = `${req.value.slice(0, 4)}…${req.value.slice(-3)}`;
  // The full number is needed only for the check; afterwards keep a masked one.
  await run(deps.db, 'UPDATE student_requests SET status = ?, decided_at = ?, decided_by = ?, value = ? WHERE id = ?', approve ? 'approved' : 'rejected', now, admin.email, masked, requestId);
  if (approve) await markStudent(deps, req.account_id, 'isic', masked, admin);
  else await audit(deps.db, now, admin, 'student.rejected', req.account_id, { method: 'isic', detail: masked });
  const account = await one<AccountRow>(deps.db, 'SELECT * FROM accounts WHERE id = ?', req.account_id);
  if (account) await deps.mailer.send(mails.studentDecision(account.email, approve));
  return true;
}
