-- Pulzar CV – initial schema (D1 / SQLite). Times are Unix milliseconds.

-- Accounts are shared with the card (D1, PL-2). Admin rights come from ADMIN_EMAILS.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  signup_src TEXT,
  student_verified_at INTEGER,
  student_method TEXT CHECK (student_method IN ('school_email', 'isic')),
  student_detail TEXT
);

-- PL-2: the profile block (name, headline, location, photo, links, e-mail, phone) shared by
-- a person's card and CV. JSON, see ProfileBlock in src/cv/types.ts.
CREATE TABLE profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions(account_id);

-- One-time e-mail tokens: sign-in, school e-mail check (CV-12), "keep my CV" (CV-8).
CREATE TABLE tokens (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'student', 'keep')),
  email TEXT,
  account_id TEXT,
  data TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- One CV per account (A9).
CREATE TABLE cvs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL CHECK (tier IN ('zaklad', 'profi', 'na_miru')),
  langs TEXT NOT NULL,                       -- JSON ["cs"] | ["en"] | ["cs","en"], primary first
  template TEXT NOT NULL,
  accent TEXT NOT NULL,
  cover TEXT,                                -- JSON MediaRef (Na míru)
  visibility TEXT NOT NULL DEFAULT 'link' CHECK (visibility IN ('link', 'public', 'pin')),  -- CV-5: link-only by default
  pin_hash TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'paused')),
  draft TEXT NOT NULL,                       -- JSON CvBody
  draft_updated_at INTEGER NOT NULL,
  published TEXT,                            -- JSON PublishedSnapshot
  published_at INTEGER,
  first_published_at INTEGER,
  paid_until INTEGER,
  student_price INTEGER NOT NULL DEFAULT 0,
  paused_at INTEGER,
  offline_since INTEGER,                     -- when it went offline (pause or expiry); null while online
  retention_prompted_at INTEGER,
  retention_warned_at INTEGER,
  retention_confirmed_at INTEGER,
  nm_state TEXT CHECK (nm_state IN ('awaiting_session', 'in_progress', 'awaiting_approval', 'approved')),
  nm_session_at INTEGER,
  nm_notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX cvs_paid_until ON cvs(paid_until);
CREATE INDEX cvs_status ON cvs(status);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  cv_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('initial', 'renewal')),
  tier TEXT NOT NULL,
  student INTEGER NOT NULL DEFAULT 0,
  amount_czk INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed')),
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX payments_cv ON payments(cv_id);

-- CV-12: ISIC numbers wait here for the studio; school e-mails are verified by magic link.
CREATE TABLE student_requests (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('isic')),
  value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT
);

-- CV-10: own domains. Phase 1: DNS on the studio's Cloudflare account.
CREATE TABLE domains (
  hostname TEXT PRIMARY KEY,
  cv_id TEXT NOT NULL REFERENCES cvs(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('studio_registers', 'holder_moves_dns')),
  status TEXT NOT NULL CHECK (status IN ('requested', 'active', 'removed')),
  created_at INTEGER NOT NULL,
  activated_at INTEGER
);
CREATE INDEX domains_cv ON domains(cv_id);

-- PL-11: everything the studio does in the admin is logged.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,                       -- account id, or "system"
  actor_email TEXT,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT
);
CREATE INDEX audit_target ON audit_log(target);

-- PL-16 / CV-15: counted on the server, no cookies.
CREATE TABLE stats_daily (
  cv_id TEXT NOT NULL,
  day TEXT NOT NULL,                         -- YYYY-MM-DD (Europe/Prague)
  views INTEGER NOT NULL DEFAULT 0,
  pdf_downloads INTEGER NOT NULL DEFAULT 0,
  contact_reveals INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (cv_id, day)
);

-- Makes e-mails from the daily job idempotent.
CREATE TABLE notifications (
  cv_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (cv_id, kind, ref)
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE media (
  key TEXT PRIMARY KEY,
  cv_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('photo', 'project', 'cover')),
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX media_cv ON media(cv_id);

-- §8: "e-mail addresses found in public HTML – 0, always".
CREATE TABLE privacy_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  pages INTEGER NOT NULL,
  findings TEXT NOT NULL                     -- JSON [{cvId, lang, what}]
);

-- CV-13: a LinkedIn import waiting for the holder's review.
CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
