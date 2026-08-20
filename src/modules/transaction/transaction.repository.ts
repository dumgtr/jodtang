import { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/client';
import { Transaction, AuditLog } from '../../types/database';
import { isValidPositiveAmount } from '../../utils/amount';

export interface CommitDraftResult {
  transaction: Transaction;
  auditLog: AuditLog;
}

export interface TransactionUpdateData {
  amount?: number;
  category_id?: string | null;
  description?: string | null;
  merchant_id?: string | null;
  occurred_at?: string;
}

export class TransactionRepository {
  /**
   * Find recent active confirmed transactions for a user.
   */
  static async findRecentByUser(
    userId: string,
    limit: number = 5,
    client?: PoolClient
  ): Promise<Transaction[]> {
    const q = `
      SELECT * FROM transactions
      WHERE user_id = $1 AND status = 'confirmed'
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT $2;
    `;
    const res = client
      ? await client.query<Transaction>(q, [userId, limit])
      : await query<Transaction>(q, [userId, limit]);
    return res.rows;
  }

  /**
   * Find a transaction by ID and User ID.
   */
  static async findByIdAndUser(
    transactionId: string,
    userId: string,
    client?: PoolClient
  ): Promise<Transaction | null> {
    const q = 'SELECT * FROM transactions WHERE id = $1 AND user_id = $2;';
    const res = client
      ? await client.query<Transaction>(q, [transactionId, userId])
      : await query<Transaction>(q, [transactionId, userId]);
    return res.rows[0] || null;
  }

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
      if (isNaN(occurredAt.getTime())) {
        throw new Error('INVALID_DATE: Transaction occurred_at is not a valid date.');
      }

      const txRes = await client.query<Transaction>(
        `INSERT INTO transactions (
          user_id,
          type,
          amount,
          category_id,
          merchant_id,
          account_id,
          description,
          status,
          occurred_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'confirmed', $8)
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

  /**
   * Atomically voids/cancels a confirmed transaction.
   * Preserves historical record while marking status as 'voided'.
   */
  static async voidTransaction(transactionId: string, userId: string): Promise<Transaction> {
    return await withTransaction(async (client) => {
      const txLockRes = await client.query<Transaction>(
        `SELECT * FROM transactions
         WHERE id = $1 AND user_id = $2
         FOR UPDATE;`,
        [transactionId, userId]
      );

      if (txLockRes.rowCount === 0) {
        throw new Error('TRANSACTION_NOT_FOUND: Transaction does not exist or does not belong to user.');
      }

      const prevTx = txLockRes.rows[0];

      if (prevTx.status === 'voided') {
        throw new Error('TRANSACTION_ALREADY_VOIDED: Transaction is already voided.');
      }

      const updateRes = await client.query<Transaction>(
        `UPDATE transactions
         SET status = 'voided', updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *;`,
        [transactionId, userId]
      );
      const voidedTx = updateRes.rows[0];

      await client.query<AuditLog>(
        `INSERT INTO audit_logs (
          user_id,
          entity_type,
          entity_id,
          action,
          before,
          after
        )
        VALUES ($1, $2, $3, $4, $5, $6);`,
        [
          userId,
          'transaction',
          transactionId,
          'VOID_TRANSACTION',
          JSON.stringify({ status: prevTx.status, amount: prevTx.amount, description: prevTx.description }),
          JSON.stringify(voidedTx),
        ]
      );

      return voidedTx;
    });
  }

  /**
   * Atomically updates a confirmed transaction with audit trail.
   */
  static async updateTransaction(
    transactionId: string,
    userId: string,
    updates: TransactionUpdateData
  ): Promise<Transaction> {
    return await withTransaction(async (client) => {
      const txLockRes = await client.query<Transaction>(
        `SELECT * FROM transactions
         WHERE id = $1 AND user_id = $2
         FOR UPDATE;`,
        [transactionId, userId]
      );

      if (txLockRes.rowCount === 0) {
        throw new Error('TRANSACTION_NOT_FOUND: Transaction does not exist or does not belong to user.');
      }

      const prevTx = txLockRes.rows[0];

      if (prevTx.status !== 'confirmed') {
        throw new Error(`TRANSACTION_NOT_EDITABLE: Cannot edit transaction with status "${prevTx.status}".`);
      }

      if (updates.amount !== undefined && !isValidPositiveAmount(updates.amount)) {
        throw new Error('INVALID_AMOUNT: Updated amount must be greater than 0.');
      }

      let occurredAt: Date | undefined;
      if (updates.occurred_at) {
        occurredAt = new Date(updates.occurred_at);
        if (isNaN(occurredAt.getTime())) {
          throw new Error('INVALID_DATE: Provided date is invalid.');
        }
      }

      const updateRes = await client.query<Transaction>(
        `UPDATE transactions
         SET
           amount = COALESCE($3, amount),
           category_id = COALESCE($4, category_id),
           description = COALESCE($5, description),
           merchant_id = COALESCE($6, merchant_id),
           occurred_at = COALESCE($7, occurred_at),
           updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *;`,
        [
          transactionId,
          userId,
          updates.amount ?? null,
          updates.category_id ?? null,
          updates.description ?? null,
          updates.merchant_id ?? updates.description ?? null,
          occurredAt ?? null,
        ]
      );
      const updatedTx = updateRes.rows[0];

      await client.query<AuditLog>(
        `INSERT INTO audit_logs (
          user_id,
          entity_type,
          entity_id,
          action,
          before,
          after
        )
        VALUES ($1, $2, $3, $4, $5, $6);`,
        [
          userId,
          'transaction',
          transactionId,
          'EDIT_TRANSACTION',
          JSON.stringify(prevTx),
          JSON.stringify(updatedTx),
        ]
      );

      return updatedTx;
    });
  }
}
