import { PoolClient } from 'pg';
import { query } from '../../db/client';
import { GroupedAggregationItem } from '../../types/query';

export interface QueryDbFilter {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  transactionType?: 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'ALL';
  category?: string | null;
  merchant?: string | null;
}

export interface SummaryDbResult {
  totalAmount: number;
  totalCount: number;
}

export interface TransactionListItem {
  id: string;
  type: string;
  amount: number;
  category: string;
  merchant: string;
  description: string;
  occurredAt: string;
}

export class QueryRepository {
  /**
   * Builds the base WHERE clause with parameterized values.
   * Guaranteed READ-ONLY and SQL-injection safe.
   */
  private static buildWhereClause(
    userId: string,
    filter: QueryDbFilter,
    startParamIndex: number = 1
  ): { whereSql: string; params: any[]; nextParamIndex: number } {
    const conditions: string[] = [
      `user_id = $${startParamIndex}`,
      `status = 'confirmed'`,
      `(occurred_at AT TIME ZONE 'Asia/Bangkok')::date >= $${startParamIndex + 1}::date`,
      `(occurred_at AT TIME ZONE 'Asia/Bangkok')::date <= $${startParamIndex + 2}::date`,
    ];

    const params: any[] = [userId, filter.startDate, filter.endDate];
    let nextIndex = startParamIndex + 3;

    // Filter by transaction type
    if (filter.transactionType && filter.transactionType !== 'ALL') {
      conditions.push(`LOWER(type) = LOWER($${nextIndex})`);
      params.push(filter.transactionType.toLowerCase());
      nextIndex++;
    }

    // Filter by category
    if (filter.category && filter.category.trim().length > 0) {
      conditions.push(`(category_id ILIKE $${nextIndex} OR description ILIKE $${nextIndex})`);
      params.push(`%${filter.category.trim()}%`);
      nextIndex++;
    }

    // Filter by merchant
    if (filter.merchant && filter.merchant.trim().length > 0) {
      conditions.push(`(merchant_id ILIKE $${nextIndex} OR description ILIKE $${nextIndex})`);
      params.push(`%${filter.merchant.trim()}%`);
      nextIndex++;
    }

    return {
      whereSql: `WHERE ${conditions.join(' AND ')}`,
      params,
      nextParamIndex: nextIndex,
    };
  }

  /**
   * Computes SUM(amount) and COUNT(id) over filtered transactions.
   */
  static async getSummary(
    userId: string,
    filter: QueryDbFilter,
    client?: PoolClient
  ): Promise<SummaryDbResult> {
    const { whereSql, params } = this.buildWhereClause(userId, filter);
    const sql = `
      SELECT
        COALESCE(SUM(amount), 0)::numeric AS total_amount,
        COUNT(id)::int AS total_count
      FROM transactions
      ${whereSql};
    `;

    const res = client
      ? await client.query(sql, params)
      : await query(sql, params);

    const row = res.rows[0];
    return {
      totalAmount: row ? parseFloat(row.total_amount) : 0,
      totalCount: row ? parseInt(row.total_count, 10) : 0,
    };
  }

  /**
   * Computes GROUP BY category_id ordered by total amount descending.
   */
  static async getCategoryBreakdown(
    userId: string,
    filter: QueryDbFilter,
    limit?: number,
    client?: PoolClient
  ): Promise<GroupedAggregationItem[]> {
    const { whereSql, params, nextParamIndex } = this.buildWhereClause(userId, filter);
    let limitSql = '';
    const queryParams = [...params];

    if (limit && limit > 0) {
      limitSql = `LIMIT $${nextParamIndex}`;
      queryParams.push(limit);
    }

    const sql = `
      SELECT
        COALESCE(category_id, 'ไม่ระบุหมวดหมู่') AS name,
        COALESCE(SUM(amount), 0)::numeric AS amount,
        COUNT(id)::int AS count
      FROM transactions
      ${whereSql}
      GROUP BY category_id
      ORDER BY amount DESC, count DESC
      ${limitSql};
    `;

    const res = client
      ? await client.query(sql, queryParams)
      : await query(sql, queryParams);

    return res.rows.map((row) => ({
      name: row.name,
      amount: parseFloat(row.amount),
      count: parseInt(row.count, 10),
    }));
  }

  /**
   * Computes GROUP BY merchant_id ordered by total amount descending.
   */
  static async getMerchantBreakdown(
    userId: string,
    filter: QueryDbFilter,
    limit: number = 5,
    client?: PoolClient
  ): Promise<GroupedAggregationItem[]> {
    const { whereSql, params, nextParamIndex } = this.buildWhereClause(userId, filter);
    const queryParams = [...params, limit];

    const sql = `
      SELECT
        COALESCE(merchant_id, 'ไม่ระบุร้านค้า') AS name,
        COALESCE(SUM(amount), 0)::numeric AS amount,
        COUNT(id)::int AS count
      FROM transactions
      ${whereSql}
      GROUP BY merchant_id
      ORDER BY amount DESC, count DESC
      LIMIT $${nextParamIndex};
    `;

    const res = client
      ? await client.query(sql, queryParams)
      : await query(sql, queryParams);

    return res.rows.map((row) => ({
      name: row.name,
      amount: parseFloat(row.amount),
      count: parseInt(row.count, 10),
    }));
  }

  /**
   * Retrieves individual itemized transactions within the filtered date range.
   */
  static async getListing(
    userId: string,
    filter: QueryDbFilter,
    limit: number = 20,
    client?: PoolClient
  ): Promise<TransactionListItem[]> {
    const { whereSql, params, nextParamIndex } = this.buildWhereClause(userId, filter);
    const queryParams = [...params, limit];

    const sql = `
      SELECT
        id,
        type,
        amount::numeric AS amount,
        COALESCE(category_id, 'ทั่วไป') AS category,
        COALESCE(merchant_id, '-') AS merchant,
        COALESCE(description, '-') AS description,
        TO_CHAR(occurred_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS occurred_at
      FROM transactions
      ${whereSql}
      ORDER BY occurred_at DESC, created_at DESC
      LIMIT $${nextParamIndex};
    `;

    const res = client
      ? await client.query(sql, queryParams)
      : await query(sql, queryParams);

    return res.rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: parseFloat(row.amount),
      category: row.category,
      merchant: row.merchant,
      description: row.description,
      occurredAt: row.occurred_at,
    }));
  }

  /**
   * Computes COUNT(id) over filtered transactions.
   */
  static async getCount(
    userId: string,
    filter: QueryDbFilter,
    client?: PoolClient
  ): Promise<number> {
    const { whereSql, params } = this.buildWhereClause(userId, filter);
    const sql = `
      SELECT COUNT(id)::int AS total_count
      FROM transactions
      ${whereSql};
    `;

    const res = client
      ? await client.query(sql, params)
      : await query(sql, params);

    return res.rows[0] ? parseInt(res.rows[0].total_count, 10) : 0;
  }
}
