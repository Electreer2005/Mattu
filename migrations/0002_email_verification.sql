-- customer_users already contains verified_at, phone, address, bio and avatar.
-- Keep this migration additive and safe for the existing production schema.
CREATE TABLE IF NOT EXISTS customer_email_verification_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES customer_users(id),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS customer_email_verification_user
  ON customer_email_verification_tokens(user_id);
