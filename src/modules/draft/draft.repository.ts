import { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/client';
import { DraftStatus, ExtractedData, TransactionDraft, AuditLog } from '../../types/database';
import { isValidPositiveAmount } from '../../utils/amount';

export class DraftRepository {
  /**
   * Create a new transaction draft with expiration time (default 15 minutes).
   * Enforces amount > 0 invariant.
   */
  static async createDraft(
    data: {
      userId: string;
      source: string;
      rawInput: string;
      extractedData: ExtractedData;
      expiresInMinutes?: number;
    },
    client?: PoolClient
  ): Promise<TransactionDraft> {
    if (!data.extractedData || !isValidPositiveAmount(data.extractedData.amount)) {
      throw new Error('INVALID_DRAFT_AMOUNT: Draft amount must be a positive number greater than 0.');
    }

    const minutes = data.expiresInMinutes ?? 15;
    const q = `
      INSERT INTO transaction_drafts (
        user_id,
        source,
        raw_input,
        extracted_data,
        status,
        expires_at
      )
      VALUES ($1, $2, $3, $4, 'pending_confirmation', NOW() + ($5 || ' minutes')::INTERVAL)
      RETURNING *;
    `;
    const params = [
      data.userId,
      data.source,
      data.rawInput,
      JSON.stringify(data.extractedData),
      minutes.toString(),
    ];
    const res = client
      ? await client.query<TransactionDraft>(q, params)
      : await query<TransactionDraft>(q, params);
    return res.rows[0];
  }

  /**
   * Find a draft by ID with strict user ownership enforcement.
   */
  static async findById(
    id: string,
    userId: string,
    client?: PoolClient
  ): Promise<TransactionDraft | null> {
    const q = 'SELECT * FROM transaction_drafts WHERE id = $1 AND user_id = $2';

    const res = client
      ? await client.query<TransactionDraft>(q, [id, userId])
      : await query<TransactionDraft>(q, [id, userId]);
    return res.rows[0] || null;
  }

  /**
   * Find latest active pending draft for a user.
   */
  static async findLatestPendingByUser(
    userId: string,
    client?: PoolClient
  ): Promise<TransactionDraft | null> {
    const q = `
      SELECT * FROM transaction_drafts
      WHERE user_id = $1 AND status = 'pending_confirmation' AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1;
    `;
    const res = client
      ? await client.query<TransactionDraft>(q, [userId])
      : await query<TransactionDraft>(q, [userId]);
    return res.rows[0] || null;
  }

  /**
   * Update draft status with strict user ownership verification.
   */
  static async updateStatus(
    id: string,
    userId: string,
    status: DraftStatus,
    client?: PoolClient
  ): Promise<TransactionDraft | null> {
    const q = `
      UPDATE transaction_drafts
      SET status = $1
      WHERE id = $2 AND user_id = $3
      RETURNING *;
    `;
    const res = client
      ? await client.query<TransactionDraft>(q, [status, id, userId])
      : await query<TransactionDraft>(q, [status, id, userId]);
    return res.rows[0] || null;
  }

  /**
   * Atomically cancel a draft and record an audit log.
   */
  static async cancelDraft(id: string, userId: string): Promise<TransactionDraft> {
    return await withTransaction(async (client) => {
      const lockRes = await client.query<TransactionDraft>(
        `SELECT * FROM transaction_drafts
         WHERE id = $1 AND user_id = $2
         FOR UPDATE;`,
        [id, userId]
      );

      if (lockRes.rowCount === 0) {
        throw new Error('DRAFT_NOT_FOUND: Draft does not exist or does not belong to user.');
      }

      const draft = lockRes.rows[0];

      if (draft.status !== 'pending_confirmation') {
        throw new Error(`INVALID_DRAFT_STATUS: Draft is already ${draft.status}.`);
      }

      const updateRes = await client.query<TransactionDraft>(
        `UPDATE transaction_drafts
         SET status = 'cancelled'
         WHERE id = $1 AND user_id = $2
         RETURNING *;`,
        [id, userId]
      );

      const cancelledDraft = updateRes.rows[0];

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
          'transaction_draft',
          id,
          'CANCEL_DRAFT',
          JSON.stringify({ status: draft.status }),
          JSON.stringify({ status: 'cancelled' }),
        ]
      );

      return cancelledDraft;
    });
  }

  /**
   * Update draft extracted data (e.g. during edit flow) with ownership verification and audit trail.
   */
  static async updateExtractedData(
    id: string,
    userId: string,
    extractedData: ExtractedData,
    client?: PoolClient
  ): Promise<TransactionDraft | null> {
    if (!extractedData || !isValidPositiveAmount(extractedData.amount)) {
      throw new Error('INVALID_DRAFT_AMOUNT: Updated amount must be a positive number greater than 0.');
    }

    const runner = async (c: PoolClient) => {
      const lockRes = await c.query<TransactionDraft>(
        `SELECT * FROM transaction_drafts
         WHERE id = $1 AND user_id = $2 AND status = 'pending_confirmation' AND expires_at > NOW()
         FOR UPDATE;`,
        [id, userId]
      );

      if (lockRes.rowCount === 0) {
        throw new Error('DRAFT_NOT_FOUND_OR_EXPIRED: Draft cannot be edited.');
      }

      const prevDraft = lockRes.rows[0];

      const q = `
        UPDATE transaction_drafts
        SET extracted_data = $1
        WHERE id = $2 AND user_id = $3
        RETURNING *;
      `;
      const res = await c.query<TransactionDraft>(q, [JSON.stringify(extractedData), id, userId]);
      const updatedDraft = res.rows[0];

      await c.query<AuditLog>(
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
          'transaction_draft',
          id,
          'EDIT_DRAFT',
          JSON.stringify(prevDraft.extracted_data),
          JSON.stringify(extractedData),
        ]
      );

      return updatedDraft;
    };

    if (client) {
      return await runner(client);
    } else {
      return await withTransaction(runner);
    }
  }
}
