-- Migration 004: Reject malformed or non-positive draft amounts at the database boundary.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_draft_amount_finite_positive'
    ) THEN
        ALTER TABLE transaction_drafts
        ADD CONSTRAINT chk_draft_amount_finite_positive CHECK (
            CASE
                WHEN jsonb_typeof(extracted_data->'amount') = 'number'
                THEN (extracted_data->>'amount')::numeric > 0
                ELSE FALSE
            END
        );
    END IF;
END $$;
