import { schoolDomainOf } from '../config/schools';
import { formatCzk, initialPrice, PAID_PERIOD_MONTHS, PRICES, TIERS } from '../config/tiers';
import { randomId } from '../cv/text';
import type { TierId } from '../cv/types';
import { errorsOf, validateDoc } from '../cv/validate';
import { audit, SYSTEM, type Actor } from '../platform/audit';
import { issueToken, type AccountRow } from '../platform/auth';
import { addMonths, one, run } from '../platform/db';
import { mails } from '../platform/mail';
import { draftDoc, getCvById, publicUrl, publish, type CvRow } from './cvs';
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

export async function startCheckout(deps: Deps, account: AccountRow, row: CvRow): Promise<{ url: string; paymentId: string }> {
  const now = deps.now();
  const q = quote(account, row);
  const id = randomId();
  await run(
    deps.db,
    `INSERT INTO payments (id, account_id, cv_id, kind, tier, student, amount_czk, provider, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    id,
    account.id,
    row.id,
    q.kind,
    row.tier,
    q.student ? 1 : 0,
    q.amount,
    deps.payments.id,
    now,
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

/**
 * Mark a payment paid and extend the paid period. Idempotent: the provider may call twice.
 * After a first payment the CV goes live straight away if the draft is ready.
 */
export async function completePayment(deps: Deps, paymentId: string, ref: string | null): Promise<CompletionOutcome | null> {
  const now = deps.now();
  const changed = await run(
    deps.db,
    `UPDATE payments SET status = 'paid', paid_at = ?, provider_ref = COALESCE(?, provider_ref) WHERE id = ? AND status = 'pending'`,
    now,
    ref,
    paymentId,
  );
  const p = await one<PaymentRow>(deps.db, 'SELECT * FROM payments WHERE id = ?', paymentId);
  if (!p) return null;
  if (!changed) return 'already';
  const row = await getCvById(deps.db, p.cv_id);
  const account = await one<AccountRow>(deps.db, 'SELECT * FROM accounts WHERE id = ?', p.account_id);
  if (!row || !account) return null;

  const base = row.paid_until && row.paid_until > now ? row.paid_until : now;
  const until = addMonths(base, PAID_PERIOD_MONTHS);
  await run(
    deps.db,
    `UPDATE cvs SET paid_until = ?, student_price = CASE WHEN ? = 1 THEN 1 ELSE student_price END,
       nm_state = CASE WHEN ? = 'initial' AND tier = 'na_miru' AND nm_state IS NULL THEN 'awaiting_session' ELSE nm_state END,
       offline_since = CASE WHEN status = 'live' AND published IS NOT NULL THEN NULL ELSE offline_since END,
       retention_prompted_at = NULL, retention_warned_at = NULL, retention_confirmed_at = ?, updated_at = ? WHERE id = ?`,
    until,
    p.student,
    p.kind,
    now,
    now,
    row.id,
  );
  await audit(deps.db, now, SYSTEM, 'payment.paid', row.id, { paymentId, kind: p.kind, amount: p.amount_czk, student: !!p.student, until });
  await deps.mailer.send(mails.paid(account.email, p.kind === 'renewal' ? 'prodloužení životopisu' : `balíček ${TIERS[p.tier].name}`, formatCzk(p.amount_czk), until));

  if (p.kind === 'renewal') return 'renewed';
  if (row.tier === 'na_miru') {
    await deps.mailer.send(mails.naMiruBooked(account.email));
    for (const admin of deps.admins) await deps.mailer.send(mails.naMiruStudio(admin, account.email, `${deps.baseUrl}/admin/cv/${row.id}`));
    return 'na_miru';
  }
  // The holder clicked "Zaplatit a zveřejnit": publish now if the draft is ready.
  const fresh = (await getCvById(deps.db, row.id))!;
  if (errorsOf(validateDoc(await draftDoc(deps.db, fresh))).length === 0) {
    const r = await publish(deps, fresh, { id: account.id, email: account.email, role: 'holder' });
    if (r.ok) {
      await deps.mailer.send(mails.published(account.email, publicUrl(deps, fresh)));
      return 'published';
    }
  }
  return 'paid';
}

// ---------- student price (CV-12) ----------

export async function requestSchoolEmail(deps: Deps, account: AccountRow, email: string): Promise<'sent' | 'not_school'> {
  const domain = schoolDomainOf(email);
  if (!domain) return 'not_school';
  const token = await issueToken(deps.db, deps.now(), 'student', { accountId: account.id, email: email.trim().toLowerCase(), data: { domain } });
  await deps.mailer.send(mails.studentVerify(email.trim(), `${deps.baseUrl}/ucet/student/overit/${token}`));
  return 'sent';
}

export async function markStudent(deps: Deps, accountId: string, method: 'school_email' | 'isic', detail: string, actor: Actor): Promise<void> {
  const now = deps.now();
  await run(deps.db, 'UPDATE accounts SET student_verified_at = ?, student_method = ?, student_detail = ? WHERE id = ?', now, method, detail, accountId);
  await audit(deps.db, now, actor, 'student.verified', accountId, { method, detail });
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
  await run(deps.db, 'UPDATE student_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?', approve ? 'approved' : 'rejected', now, admin.email, requestId);
  const masked = `${req.value.slice(0, 4)}…${req.value.slice(-3)}`;
  if (approve) await markStudent(deps, req.account_id, 'isic', masked, admin);
  else await audit(deps.db, now, admin, 'student.rejected', req.account_id, { method: 'isic', detail: masked });
  const account = await one<AccountRow>(deps.db, 'SELECT * FROM accounts WHERE id = ?', req.account_id);
  if (account) await deps.mailer.send(mails.studentDecision(account.email, approve));
  return true;
}
