-- Fixes from the security and correctness review.

-- A renewal started from "Obnovit" brings a paused CV back online once paid.
ALTER TABLE payments ADD COLUMN resume INTEGER NOT NULL DEFAULT 0;

-- CV-12: one school mailbox verifies one account (hash of the address, not the address).
ALTER TABLE accounts ADD COLUMN student_email_hash TEXT;
CREATE INDEX accounts_student_email ON accounts(student_email_hash);

-- Old addresses: after a change they redirect to the new one, and a released address
-- (changed or deleted CV) stays reserved for a year so nobody else can take over old links.
CREATE TABLE slug_history (
  slug TEXT PRIMARY KEY,
  cv_id TEXT,
  account_id TEXT NOT NULL,
  released_at INTEGER NOT NULL
);
