ALTER TABLE customer_users ADD COLUMN verified_at INTEGER;

CREATE TABLE IF NOT EXISTS customer_email_verification_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES customer_users(id),
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS customer_email_verification_user
  ON customer_email_verification_tokens(user_id);
ALTER TABLE customer_users ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_users ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE customer_users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
