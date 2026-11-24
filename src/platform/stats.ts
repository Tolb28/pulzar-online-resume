import { all, pragueDay, run } from './db';

// PL-16 / CV-15: views, PDF downloads and contact reveals, counted on the server.
// No cookies, no IPs stored. Bots, link previews, prefetches and the holder's own visits
// are not counted.

export type StatField = 'views' | 'pdf_downloads' | 'contact_reveals';

// Link-preview fetchers (LinkedInBot, Slackbot, Discordbot, TelegramBot, SkypeUriPreview…) match
// "bot" or "preview". Do not match "linkedin": LinkedIn's in-app browser ("LinkedInApp") is a
// recruiter reading the CV.
const BOT_UA =
  /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|httpclient|java\/|go-http|node-fetch|axios/i;

export function isCountable(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'POST') return false;
  const ua = req.headers.get('user-agent') ?? '';
  if (!ua || BOT_UA.test(ua)) return false;
  const purpose = req.headers.get('sec-purpose') ?? req.headers.get('purpose') ?? '';
  if (/prefetch|prerender/i.test(purpose)) return false;
  return true;
}

export async function bump(db: D1Database, cvId: string, field: StatField, now: number): Promise<void> {
  await run(
    db,
    `INSERT INTO stats_daily (cv_id, day, ${field}) VALUES (?, ?, 1)
     ON CONFLICT(cv_id, day) DO UPDATE SET ${field} = ${field} + 1`,
    cvId,
    pragueDay(now),
  );
}

export interface DayStats {
  day: string;
  views: number;
  pdf_downloads: number;
  contact_reveals: number;
}

export async function statsFor(db: D1Database, cvId: string, now: number, days = 30): Promise<{ days: DayStats[]; total: Omit<DayStats, 'day'> }> {
  const from = pragueDay(now - (days - 1) * 86_400_000);
  const rows = await all<DayStats>(db, 'SELECT day, views, pdf_downloads, contact_reveals FROM stats_daily WHERE cv_id = ? AND day >= ? ORDER BY day', cvId, from);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const list: DayStats[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = pragueDay(now - i * 86_400_000);
    list.push(byDay.get(day) ?? { day, views: 0, pdf_downloads: 0, contact_reveals: 0 });
  }
  const total = list.reduce(
    (t, d) => ({ views: t.views + d.views, pdf_downloads: t.pdf_downloads + d.pdf_downloads, contact_reveals: t.contact_reveals + d.contact_reveals }),
    { views: 0, pdf_downloads: 0, contact_reveals: 0 },
  );
  return { days: list, total };
}
