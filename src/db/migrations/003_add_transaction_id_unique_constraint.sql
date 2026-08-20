-- Migration 003: Enforce one-to-one draft-to-transaction tracking.

CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_drafts_transaction_id_unique
ON transaction_drafts(transaction_id)
WHERE transaction_id IS NOT NULL;
