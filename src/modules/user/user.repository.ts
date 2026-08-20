import { PoolClient } from 'pg';
import { query } from '../../db/client';
import { User } from '../../types/database';

export class UserRepository {
  /**
   * Find existing user by LINE user ID or create a new user record.
   */
  static async findOrCreateByLineUserId(lineUserId: string, client?: PoolClient): Promise<User> {
    const q = `
      INSERT INTO users (line_user_id)
      VALUES ($1)
      ON CONFLICT (line_user_id)
      DO UPDATE SET line_user_id = EXCLUDED.line_user_id
      RETURNING *;
    `;
    const res = client ? await client.query<User>(q, [lineUserId]) : await query<User>(q, [lineUserId]);
    return res.rows[0];
  }

  static async findById(id: string, client?: PoolClient): Promise<User | null> {
    const q = 'SELECT * FROM users WHERE id = $1;';
    const res = client ? await client.query<User>(q, [id]) : await query<User>(q, [id]);
    return res.rows[0] || null;
  }
}
