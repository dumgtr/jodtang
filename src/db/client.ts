import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env';
import { logInternalError } from '../utils/errors';

function getDatabaseSslMode(connectionString: string): string | undefined {
  try {
    return new URL(connectionString).searchParams.get('sslmode')?.toLowerCase();
  } catch {
    return undefined;
  }
}

function withoutDatabaseSslMode(connectionString: string): string {
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

const databaseSslMode = getDatabaseSslMode(env.DATABASE_URL);
const managedProvider = /(?:neon\.tech|supabase\.co|render\.com|amazonaws\.com)/i.test(env.DATABASE_URL);
const useSSL =
  env.NODE_ENV === 'production' ||
  managedProvider ||
  ['require', 'verify-ca', 'verify-full', 'no-verify'].includes(databaseSslMode || '');

export const pool = new Pool({
  // Remove sslmode so the explicit application setting below cannot be silently overwritten by pg.
  connectionString: withoutDatabaseSslMode(env.DATABASE_URL),
  ssl: useSSL ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED } : false,
});

pool.on('error', (err) => {
  logInternalError('[PostgreSQL] Unexpected error on idle client', err);
});

/**
 * Execute a query directly with the pool.
 */
export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (env.NODE_ENV === 'development') {
    console.log('[PostgreSQL Query]', { duration: `${duration}ms`, rows: res.rowCount });
  }
  return res;
}

/**
 * Executes a callback within a strict atomic database transaction.
 * Automatically handles BEGIN, COMMIT, and ROLLBACK.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
