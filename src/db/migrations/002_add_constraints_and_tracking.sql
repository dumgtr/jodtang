-- Migration 002: Add Constraints & Relationship Tracking Idempotently

DO $$
BEGIN
    -- 1. Add amount constraint to transactions if not exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_transaction_amount_positive'
    ) THEN
        ALTER TABLE transactions
        ADD CONSTRAINT chk_transaction_amount_positive CHECK (amount > 0);
    END IF;

    -- 2. Add transaction_id column to transaction_drafts if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'transaction_drafts' AND column_name = 'transaction_id'
    ) THEN
        ALTER TABLE transaction_drafts
        ADD COLUMN transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;
    END IF;

    -- 3. Add amount constraint to transaction_drafts if not exists
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_draft_amount_positive'
    ) THEN
        ALTER TABLE transaction_drafts
        ADD CONSTRAINT chk_draft_amount_positive CHECK ((extracted_data->>'amount')::numeric > 0);
    END IF;
END $$;
