import { TIERS } from '../config/tiers';
import { defaultDesign, emptyBody, emptyProfile, GRADUATE_ORDER } from '../cv/defaults';
import { coerceBody, coerceDesign, coerceProfile } from '../cv/sanitize';
import { randomId } from '../cv/text';
import { BODY_SECTIONS, type CvBody, type CvDesign, type CvDoc, type Lang, type MediaRef, type ProfileBlock, type PublishedSnapshot, type TierId, type Visibility } from '../cv/types';
import { errorsOf, validateDoc, type Issue } from '../cv/validate';
import { renderPdf } from '../pdf/render';
import { audit, type Actor } from '../platform/audit';
import { all, DAY, one, parseJson, run } from '../platform/db';
import type { Deps } from './deps';

export interface CvRow {
  id: string;
  account_id: string;
  slug: string;
  tier: TierId;
  langs: string;
  template: string;
  accent: string;
  cover: string | null;
  visibility: Visibility;
  pin_hash: string | null;
  status: 'draft' | 'live' | 'paused';
  draft: string;
  draft_updated_at: number;
  published: string | null;
  published_at: number | null;
  first_published_at: number | null;
  paid_until: number | null;
  student_price: number;
  paused_at: number | null;
  offline_since: number | null;
  retention_prompted_at: number | null;
  retention_warned_at: number | null;
  retention_confirmed_at: number | null;
  nm_state: 'awaiting_session' | 'in_progress' | 'awaiting_approval' | 'approved' | null;
  nm_session_at: number | null;
  nm_notes: string | null;
  created_at: number;
  updated_at: number;
}

/** Who is acting: the holder themselves, or the studio in the admin (logged, PL-11). */
export interface CvActor extends Actor {
  role: 'holder' | 'admin';
}

export const getCvById = (db: D1Database, id: string) => one<CvRow>(db, 'SELECT * FROM cvs WHERE id = ?', id);
export const getCvBySlug = (db: D1Database, slug: string) => one<CvRow>(db, 'SELECT * FROM cvs WHERE slug = ?', slug);
export const getCvByAccount = (db: D1Database, accountId: string) => one<CvRow>(db, 'SELECT * FROM cvs WHERE account_id = ?', accountId);

export function langsOf(row: CvRow): Lang[] {
  const l = parseJson<string[]>(row.langs, ['cs']).filter((x): x is Lang => x === 'cs' || x === 'en');
  return l.length ? [...new Set(l)] : ['cs'];
}

export function designOf(row: CvRow): CvDesign {
  return coerceDesign({ template: row.template, accent: row.accent, cover: parseJson(row.cover, null) });
}

export function bodyOf(row: CvRow): CvBody {
  return coerceBody(parseJson(row.draft, {}));
}

export function snapshotOf(row: CvRow): PublishedSnapshot | null {
  return parseJson<PublishedSnapshot | null>(row.published, null);
}

export async function getProfile(db: D1Database, accountId: string): Promise<ProfileBlock> {
  const row = await one<{ data: string }>(db, 'SELECT data FROM profiles WHERE account_id = ?', accountId);
  return row ? coerceProfile(parseJson(row.data, {})) : emptyProfile();
}

export async function saveProfile(deps: Deps, accountId: string, profile: ProfileBlock, actor: CvActor, cvId?: string): Promise<void> {
  const now = deps.now();
  await run(
    deps.db,
    `INSERT INTO profiles (account_id, data, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    accountId,
    JSON.stringify(profile),
    now,
  );
  if (actor.role === 'admin') await audit(deps.db, now, actor, 'profile.save', cvId ?? accountId);
}

export async function draftDoc(db: D1Database, row: CvRow): Promise<CvDoc> {
  return { profile: await getProfile(db, row.account_id), body: bodyOf(row), design: designOf(row), langs: langsOf(row), tier: row.tier };
}

export type PublicState = 'online' | 'paused' | 'expired' | 'draft';

/** Online means: published, not paused, and inside the paid period. */
export function publicState(row: CvRow, now: number): PublicState {
  if (!row.published || row.status === 'draft') return 'draft';
  if (row.status === 'paused') return 'paused';
  if (!row.paid_until || row.paid_until <= now) return 'expired';
  return 'online';
}

export function isPaid(row: CvRow, now: number): boolean {
  return !!row.paid_until && row.paid_until > now;
}

export function hasUnpublishedChanges(row: CvRow, doc: CvDoc): boolean {
  const snap = snapshotOf(row);
  return !snap || JSON.stringify(snap.doc) !== JSON.stringify(doc);
}

export function publicUrl(deps: Deps, row: CvRow, lang?: Lang): string {
  const primary = langsOf(row)[0];
  return `${deps.baseUrl}/${row.slug}${lang && lang !== primary ? `/${lang}` : ''}`;
}

// ---------- create and edit ----------

export interface NewCv {
  slug: string;
  tier: TierId;
  langs: Lang[];
  template: string;
  graduate: boolean;
  name: string;
}

export async function createCv(deps: Deps, accountId: string, input: NewCv): Promise<CvRow> {
  const now = deps.now();
  const id = randomId();
  const design = coerceDesign({ ...defaultDesign(), template: input.template });
  const body = emptyBody(input.graduate ? GRADUATE_ORDER : [...BODY_SECTIONS]);
  await run(
    deps.db,
    `INSERT INTO cvs (id, account_id, slug, tier, langs, template, accent, cover, visibility, status, draft, draft_updated_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'link', 'draft', ?, ?, ?, ?)`,
    id,
    accountId,
    input.slug,
    input.tier,
    JSON.stringify(input.langs.slice(0, TIERS[input.tier].maxLangs)),
    design.template,
    design.accent,
    JSON.stringify(body),
    now,
    now,
    now,
  );
  const profile = await getProfile(deps.db, accountId);
  if (!profile.name && input.name) {
    await saveProfile(deps, accountId, { ...profile, name: input.name }, { id: accountId, email: null, role: 'holder' });
  }
  return (await getCvById(deps.db, id))!;
}

export async function saveBody(deps: Deps, row: CvRow, body: CvBody, actor: CvActor): Promise<void> {
  const now = deps.now();
  await run(deps.db, 'UPDATE cvs SET draft = ?, draft_updated_at = ?, updated_at = ? WHERE id = ?', JSON.stringify(body), now, now, row.id);
  if (actor.role === 'admin') await audit(deps.db, now, actor, 'draft.save', row.id);
}

export interface SettingsPatch {
  langs?: Lang[];
  template?: string;
  accent?: string;
  cover?: MediaRef | null;
  tier?: TierId;
  visibility?: Visibility;
  pinHash?: string | null;
  slug?: string;
}

export async function updateCv(deps: Deps, row: CvRow, patch: SettingsPatch, actor: CvActor): Promise<void> {
  const now = deps.now();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (patch.langs) set('langs', JSON.stringify(patch.langs));
  if (patch.template !== undefined) set('template', patch.template);
  if (patch.accent !== undefined) set('accent', patch.accent);
  if (patch.cover !== undefined) set('cover', patch.cover ? JSON.stringify(patch.cover) : null);
  if (patch.tier !== undefined) set('tier', patch.tier);
  if (patch.visibility !== undefined) set('visibility', patch.visibility);
  if (patch.pinHash !== undefined) set('pin_hash', patch.pinHash);
  if (patch.slug !== undefined) set('slug', patch.slug);
  if (!sets.length) return;
  set('updated_at', now);
  await run(deps.db, `UPDATE cvs SET ${sets.join(', ')} WHERE id = ?`, ...vals, row.id);
  const logged = { ...patch, pinHash: patch.pinHash === undefined ? undefined : patch.pinHash ? 'set' : 'removed' };
  if (actor.role === 'admin' || patch.slug || patch.visibility || patch.tier) await audit(deps.db, now, actor, 'cv.settings', row.id, logged);
}

// ---------- publish (CV-3) ----------

export type PublishResult =
  | { ok: true; snapshot: PublishedSnapshot }
  | { ok: false; reason: 'issues'; issues: Issue[] }
  | { ok: false; reason: 'unpaid' }
  | { ok: false; reason: 'not_owner' }
  | { ok: false; reason: 'photo_missing' };

export function mediaKeys(doc: CvDoc): string[] {
  const keys: string[] = [];
  if (doc.profile.photo) keys.push(doc.profile.photo.key);
  if (doc.design.cover) keys.push(doc.design.cover.key);
  for (const p of doc.body.projects) if (p.image) keys.push(p.image.key);
  return keys;
}

export async function loadPhoto(deps: Deps, doc: CvDoc): Promise<Uint8Array | null | 'missing'> {
  if (!doc.profile.photo) return null;
  const obj = await deps.media.get(doc.profile.photo.key);
  if (!obj) return 'missing';
  return new Uint8Array(await obj.arrayBuffer());
}

/**
 * Publish the draft: validate, render one PDF per language from the same data, store them,
 * and save the snapshot the public page reads (G2). Only the holder can publish – the studio
 * fills in a Na míru CV but cannot put it online (CV-11 AC).
 */
export async function publish(deps: Deps, row: CvRow, actor: CvActor): Promise<PublishResult> {
  if (actor.role !== 'holder' || actor.id !== row.account_id) return { ok: false, reason: 'not_owner' };
  const now = deps.now();
  const doc = await draftDoc(deps.db, row);
  const issues = validateDoc(doc);
  if (errorsOf(issues).length) return { ok: false, reason: 'issues', issues };
  if (!isPaid(row, now)) return { ok: false, reason: 'unpaid' };
  const photo = await loadPhoto(deps, doc);
  if (photo === 'missing') return { ok: false, reason: 'photo_missing' };

  const publishId = randomId();
  const pdf: PublishedSnapshot['pdf'] = {};
  for (const lang of doc.langs) {
    const out = await renderPdf({ doc, lang, photo, date: new Date(now) });
    const key = `cv/${row.id}/pdf/${publishId}-${lang}.pdf`;
    await deps.media.put(key, out.bytes, { httpMetadata: { contentType: 'application/pdf' } });
    pdf[lang] = { key, filename: out.filename, bytes: out.bytes.length, pages: out.pages };
  }
  const snapshot: PublishedSnapshot = { publishId, publishedAt: now, doc, pdf };
  const previous = snapshotOf(row);

  await run(
    deps.db,
    `UPDATE cvs SET published = ?, published_at = ?, first_published_at = COALESCE(first_published_at, ?), status = 'live',
       paused_at = NULL, offline_since = NULL,
       nm_state = CASE WHEN nm_state IN ('in_progress', 'awaiting_approval') THEN 'approved' ELSE nm_state END,
       updated_at = ? WHERE id = ?`,
    JSON.stringify(snapshot),
    now,
    now,
    now,
    row.id,
  );
  if (previous) for (const p of Object.values(previous.pdf)) if (p) await deps.media.delete(p.key);
  await cleanupMedia(deps, row.id, [...mediaKeys(doc)]);
  await audit(deps.db, now, actor, 'cv.publish', row.id, { publishId, langs: doc.langs });
  return { ok: true, snapshot };
}

/** Delete uploaded images no longer used by the draft or the published version. */
export async function cleanupMedia(deps: Deps, cvId: string, keep: string[]): Promise<void> {
  const now = deps.now();
  const row = await getCvById(deps.db, cvId);
  const keepSet = new Set(keep);
  if (row) {
    for (const k of mediaKeys(await draftDoc(deps.db, row))) keepSet.add(k);
    const snap = snapshotOf(row);
    if (snap) for (const k of mediaKeys(snap.doc)) keepSet.add(k);
  }
  // Uploads from the last hour may belong to a form still being edited.
  const media = await all<{ key: string }>(deps.db, 'SELECT key FROM media WHERE cv_id = ? AND created_at < ?', cvId, now - 3_600_000);
  for (const m of media) {
    if (keepSet.has(m.key)) continue;
    await deps.media.delete(m.key);
    await run(deps.db, 'DELETE FROM media WHERE key = ?', m.key);
  }
}

// ---------- pause and resume (CV-8) ----------

export async function pause(deps: Deps, row: CvRow, actor: CvActor): Promise<void> {
  const now = deps.now();
  await run(
    deps.db,
    `UPDATE cvs SET status = 'paused', paused_at = ?, offline_since = COALESCE(offline_since, ?), updated_at = ? WHERE id = ?`,
    now,
    now,
    now,
    row.id,
  );
  await audit(deps.db, now, actor, 'cv.pause', row.id);
}

/** Free within the paid period; after it, the renewal price (CV-8). */
export async function resume(deps: Deps, row: CvRow, actor: CvActor): Promise<'online' | 'unpaid' | 'not_published'> {
  const now = deps.now();
  if (!row.published) return 'not_published';
  if (!isPaid(row, now)) return 'unpaid';
  await run(deps.db, `UPDATE cvs SET status = 'live', paused_at = NULL, offline_since = NULL, updated_at = ? WHERE id = ?`, now, row.id);
  await audit(deps.db, now, actor, 'cv.resume', row.id);
  return 'online';
}

// ---------- delete ----------

export async function deleteCv(deps: Deps, row: CvRow, actor: Actor, reason: string): Promise<void> {
  const now = deps.now();
  let cursor: string | undefined;
  do {
    const listed = await deps.media.list({ prefix: `cv/${row.id}/`, cursor });
    for (const o of listed.objects) await deps.media.delete(o.key);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  const profile = await getProfile(deps.db, row.account_id);
  if (profile.photo) await deps.media.delete(profile.photo.key);
  await deps.db.batch([
    deps.db.prepare('DELETE FROM media WHERE cv_id = ?').bind(row.id),
    deps.db.prepare('DELETE FROM domains WHERE cv_id = ?').bind(row.id),
    deps.db.prepare('DELETE FROM stats_daily WHERE cv_id = ?').bind(row.id),
    deps.db.prepare('DELETE FROM notifications WHERE cv_id = ?').bind(row.id),
    deps.db.prepare('DELETE FROM cvs WHERE id = ?').bind(row.id),
    // A10: there is no card in this repo, so the profile block goes too. Once the card shares
    // this database, keep the profile when the account still has a card.
    deps.db.prepare('DELETE FROM profiles WHERE account_id = ?').bind(row.account_id),
    deps.db.prepare('DELETE FROM imports WHERE account_id = ?').bind(row.account_id),
  ]);
  await audit(deps.db, now, actor, 'cv.delete', row.id, { reason, slug: row.slug });
}

export const RETENTION = {
  /** After going offline, ask once a year whether to keep the data (CV-8). */
  promptAfter: 365 * DAY,
  warnAfter: 23 * DAY,
  deleteAfter: 30 * DAY,
};
