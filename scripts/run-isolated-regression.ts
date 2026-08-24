import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import path from 'node:path';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

const TEST_DATABASE_PREFIX = 'jodtang_test_';
const PRODUCTION_DATABASE_NAME = 'jodtang_db';

type DatabaseState = {
  database: string;
  users: number;
  drafts: number;
  transactions: number;
  auditLogs: number;
  migrations: number;
};

function databaseName(connectionString: string): string {
  const parsedUrl = new URL(connectionString);
  const name = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
  if (!name) throw new Error('[Isolated Regression] DATABASE_URL has no database name.');
  return name;
}

function quoteIdentifier(identifier: string): string {
  if (!/^jodtang_test_[a-z0-9_]+$/i.test(identifier)) {
    throw new Error(`[Isolated Regression] Refusing unsafe database identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseUrlFor(sourceUrl: string, targetDatabase: string): string {
  const parsedUrl = new URL(sourceUrl);
  parsedUrl.pathname = `/${encodeURIComponent(targetDatabase)}`;
  return parsedUrl.toString();
}

function connectionOptions(connectionString: string): { connectionString: string; ssl: false | { rejectUnauthorized: boolean } } {
  const parsedUrl = new URL(connectionString);
  const sslMode = parsedUrl.searchParams.get('sslmode')?.toLowerCase();
  parsedUrl.searchParams.delete('sslmode');

  const managedProvider = /(?:neon\.tech|supabase\.co|render\.com|amazonaws\.com)/i.test(connectionString);
  const useSsl =
    managedProvider ||
    ['require', 'verify-ca', 'verify-full', 'no-verify'].includes(sslMode || '');

  return {
    connectionString: parsedUrl.toString(),
    ssl: useSsl
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false,
  };
}

async function readDatabaseState(connectionString: string): Promise<DatabaseState> {
  const client = new Client(connectionOptions(connectionString));
  await client.connect();

  try {
    const result = await client.query<{
      database: string;
      users: string;
      drafts: string;
      transactions: string;
      audit_logs: string;
      migrations: string;
    }>(`
      SELECT
        current_database() AS database,
        (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM transaction_drafts) AS drafts,
        (SELECT COUNT(*) FROM transactions) AS transactions,
        (SELECT COUNT(*) FROM audit_logs) AS audit_logs,
        (SELECT COUNT(*) FROM _migrations) AS migrations;
    `);

    const row = result.rows[0];
    return {
      database: row.database,
      users: Number(row.users),
      drafts: Number(row.drafts),
      transactions: Number(row.transactions),
      auditLogs: Number(row.audit_logs),
      migrations: Number(row.migrations),
    };
  } finally {
    await client.end();
  }
}

async function connectAdmin(sourceUrl: string): Promise<Client> {
  const adminUrl = new URL(sourceUrl);
  adminUrl.pathname = '/postgres';
  const client = new Client(connectionOptions(adminUrl.toString()));
  await client.connect();
  return client;
}

async function databaseExists(adminClient: Client, name: string): Promise<boolean> {
  const result = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1;', [name]);
  return result.rowCount === 1;
}

async function createDatabase(adminClient: Client, name: string): Promise<void> {
  if (await databaseExists(adminClient, name)) {
    throw new Error(`[Isolated Regression] Refusing to reuse existing database: ${name}`);
  }
  await adminClient.query(`CREATE DATABASE ${quoteIdentifier(name)};`);
}

async function dropDatabase(adminClient: Client, name: string): Promise<void> {
  if (name.toLowerCase() === PRODUCTION_DATABASE_NAME) {
    throw new Error('[Isolated Regression] Refusing to drop production database.');
  }

  if (!(await databaseExists(adminClient, name))) return;

  await adminClient.query(
    `SELECT pg_terminate_backend(pid)
     FROM pg_stat_activity
     WHERE datname = $1 AND pid <> pg_backend_pid();`,
    [name]
  );
  await adminClient.query(`DROP DATABASE ${quoteIdentifier(name)};`);

  if (await databaseExists(adminClient, name)) {
    throw new Error(`[Isolated Regression] Disposable database was not removed: ${name}`);
  }
}

function runNpm(args: string[], childEnvironment: NodeJS.ProcessEnv): Promise<number> {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'cmd.exe' : 'npm';
  const commandArguments = isWindows ? ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArguments, {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

function sameState(left: DatabaseState, right: DatabaseState): boolean {
  return (
    left.database === right.database &&
    left.users === right.users &&
    left.drafts === right.drafts &&
    left.transactions === right.transactions &&
    left.auditLogs === right.auditLogs &&
    left.migrations === right.migrations
  );
}

async function runIsolatedRegression(): Promise<void> {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('[Isolated Regression] DATABASE_URL is required.');

  const sourceDatabase = databaseName(sourceUrl);
  if (sourceDatabase.toLowerCase() !== PRODUCTION_DATABASE_NAME) {
    throw new Error(
      `[Isolated Regression] Expected the source database to be ${PRODUCTION_DATABASE_NAME}; received ${sourceDatabase}.`
    );
  }

  const testDatabase = `${TEST_DATABASE_PREFIX}${Date.now()}_${process.pid}`;
  quoteIdentifier(testDatabase);
  const testUrl = databaseUrlFor(sourceUrl, testDatabase);
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    JODTANG_TEST_ISOLATION: '1',
    TEST_DATABASE_NAME: testDatabase,
    DATABASE_URL: testUrl,
  };

  const adminClient = await connectAdmin(sourceUrl);
  let testDatabaseCreated = false;
  let productionBefore: DatabaseState | undefined;
  let testState: DatabaseState | undefined;
  let regressionError: unknown;

  try {
    productionBefore = await readDatabaseState(sourceUrl);
    await createDatabase(adminClient, testDatabase);
    testDatabaseCreated = true;

    console.log(`[Isolated Regression] Created disposable database: ${testDatabase}`);
    console.log('[Isolated Regression] Applying migrations to the disposable database...');

    const migrationExitCode = await runNpm(['run', 'migrate'], childEnvironment);
    if (migrationExitCode !== 0) {
      throw new Error(`[Isolated Regression] Migration command failed with exit code ${migrationExitCode}.`);
    }

    const emptyTestState = await readDatabaseState(testUrl);
    if (emptyTestState.migrations !== 5) {
      throw new Error(
        `[Isolated Regression] Expected 5 migrations in ${testDatabase}; found ${emptyTestState.migrations}.`
      );
    }
    if (emptyTestState.users !== 0 || emptyTestState.drafts !== 0 || emptyTestState.transactions !== 0 || emptyTestState.auditLogs !== 0) {
      throw new Error('[Isolated Regression] Disposable database was not empty after migration.');
    }

    console.log('[Isolated Regression] Running the existing full regression suite on the disposable database...');
    const regressionExitCode = await runNpm(['run', 'test:regression:raw'], childEnvironment);
    if (regressionExitCode !== 0) {
      throw new Error(`[Isolated Regression] Regression command failed with exit code ${regressionExitCode}.`);
    }

    testState = await readDatabaseState(testUrl);
    console.log('[Isolated Regression] Disposable database state after regression:', {
      database: testState.database,
      users: testState.users,
      drafts: testState.drafts,
      transactions: testState.transactions,
      auditLogs: testState.auditLogs,
      migrations: testState.migrations,
    });
  } catch (error) {
    regressionError = error;
  } finally {
    let cleanupError: unknown;
    if (testDatabaseCreated) {
      try {
        console.log(`[Isolated Regression] Dropping disposable database: ${testDatabase}`);
        await dropDatabase(adminClient, testDatabase);
      } catch (error) {
        cleanupError = error;
      }
    }

    let productionPreservationError: unknown;
    try {
      const productionAfter = await readDatabaseState(sourceUrl);
      if (productionBefore && !sameState(productionBefore, productionAfter)) {
        productionPreservationError = new Error(
          '[Isolated Regression] Production database counts changed during isolated regression. ' +
            `Before=${JSON.stringify(productionBefore)} After=${JSON.stringify(productionAfter)}`
        );
      }
    } catch (error) {
      productionPreservationError = error;
    }

    let adminCloseError: unknown;
    try {
      await adminClient.end();
    } catch (error) {
      adminCloseError = error;
    }

    if (cleanupError) throw cleanupError;
    if (productionPreservationError) throw productionPreservationError;
    if (adminCloseError) throw adminCloseError;
  }

  if (regressionError) throw regressionError;
  if (!testState) throw new Error('[Isolated Regression] No disposable database state was captured.');

  console.log('[Isolated Regression] Production database preservation check: PASS');
  console.log('[Isolated Regression] Disposable database cleanup check: PASS');
  console.log('[Isolated Regression] Full isolated regression: PASS');
}

runIsolatedRegression().catch((error) => {
  console.error('[Isolated Regression] FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
