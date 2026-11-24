import { audit, type Actor } from '../platform/audit';
import { one, run } from '../platform/db';
import { mails } from '../platform/mail';
import type { CvRow } from './cvs';
import type { Deps } from './deps';

// CV-11: after paying, the holder books a 60-minute session (by e-mail for now, Pulz booking
// later). The studio fills in the CV through the admin – every save is logged (PL-11) – and
// sends it for approval. Only the holder can publish it (see publish() in cvs.ts).

export async function markSessionBooked(deps: Deps, row: CvRow, at: number | null, notes: string, admin: Actor): Promise<void> {
  const now = deps.now();
  await run(deps.db, `UPDATE cvs SET nm_state = 'in_progress', nm_session_at = ?, nm_notes = ?, updated_at = ? WHERE id = ?`, at, notes.slice(0, 2000), now, row.id);
  await audit(deps.db, now, admin, 'namiru.session', row.id, { at, notes: notes ? 'updated' : undefined });
}

export async function sendForApproval(deps: Deps, row: CvRow, admin: Actor): Promise<void> {
  const now = deps.now();
  await run(deps.db, `UPDATE cvs SET nm_state = 'awaiting_approval', updated_at = ? WHERE id = ?`, now, row.id);
  await audit(deps.db, now, admin, 'namiru.sent_for_approval', row.id);
  const account = await one<{ email: string }>(deps.db, 'SELECT email FROM accounts WHERE id = ?', row.account_id);
  if (account) await deps.mailer.send(mails.naMiruReady(account.email, `${deps.baseUrl}/ucet`));
}
