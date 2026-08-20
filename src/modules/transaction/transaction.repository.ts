import { withTransaction } from '../../db/client';
import { Transaction, AuditLog } from '../../types/database';
import { isValidPositiveAmount } from '../../utils/amount';

export interface CommitDraftResult {
  transaction: Transaction;
  auditLog: AuditLog;
}

export class TransactionRepository {
  /**
   * Atomically commits a pending draft into a permanent transaction and logs to audit_logs.
   * Ensures strict transaction isolation, user ownership, and idempotent integrity.
   */
  static async commitDraft(draftId: string, userId: string): Promise<CommitDraftResult> {
    return await withTransaction(async (client) => {
      // 1. Lock and retrieve draft with strict ownership and expiry check
      const draftRes = await client.query(
        `SELECT * FROM transaction_drafts
         WHERE id = $1 AND user_id = $2
         FOR UPDATE;`,
        [draftId, userId]
      );

      if (draftRes.rowCount === 0) {
        throw new Error('DRAFT_NOT_FOUND: Draft does not exist or does not belong to user.');
      }

      const draft = draftRes.rows[0];

      if (draft.status !== 'pending_confirmation') {
        throw new Error(`INVALID_DRAFT_STATUS: Draft is already ${draft.status}.`);
      }

      const now = new Date();
      if (new Date(draft.expires_at) < now) {
        await client.query(
          `UPDATE transaction_drafts SET status = 'expired' WHERE id = $1 AND user_id = $2;`,
          [draftId, userId]
        );
        throw new Error('DRAFT_EXPIRED: Draft confirmation window has expired.');
      }

      const extracted = draft.extracted_data;
      const amount = Number(extracted.amount);
      if (!isValidPositiveAmount(amount)) {
        throw new Error('INVALID_AMOUNT: Transaction amount must be greater than 0.');
      }

      // 2. Insert transaction
      const occurredAt = extracted.occurred_at ? new Date(extracted.occurred_at) : new Date();
      const txRes = await client.query<Transaction>(
        `INSERT INTO transactions (
          user_id,
          type,
          amount,
          category_id,
          merchant_id,
          account_id,
          description,
          occurred_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;`,
        [
          userId,
          extracted.type || 'expense',
          amount,
          extracted.category_id || null,
          extracted.merchant_id || null,
          extracted.account_id || null,
          extracted.description || draft.raw_input,
          occurredAt,
        ]
      );
      const transaction = txRes.rows[0];

      // 3. Mark draft as confirmed and link transaction_id
      await client.query(
        `UPDATE transaction_drafts
         SET status = 'confirmed', transaction_id = $1
         WHERE id = $2 AND user_id = $3;`,
        [transaction.id, draftId, userId]
      );

      // 4. Record Audit Log
      const auditRes = await client.query<AuditLog>(
        `INSERT INTO audit_logs (
          user_id,
          entity_type,
          entity_id,
          action,
          before,
          after
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;`,
        [
          userId,
          'transaction',
          transaction.id,
          'COMMIT_DRAFT',
          JSON.stringify({ draft_id: draft.id, draft_status: draft.status }),
          JSON.stringify(transaction),
        ]
      );
      const auditLog = auditRes.rows[0];

      return {
        transaction,
        auditLog,
      };
    });
  }
}
