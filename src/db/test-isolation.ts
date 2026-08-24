const TEST_DATABASE_NAME_PATTERN = /^jodtang_test_[a-z0-9_]+$/i;

export function getDatabaseName(connectionString: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(connectionString);
  } catch {
    throw new Error('[Test Isolation] DATABASE_URL is not a valid PostgreSQL URL.');
  }

  const databaseName = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ''));
  if (!databaseName) {
    throw new Error('[Test Isolation] DATABASE_URL does not specify a database name.');
  }

  return databaseName;
}

export function assertTestDatabaseUrl(connectionString: string): void {
  const databaseName = getDatabaseName(connectionString);

  if (databaseName.toLowerCase() === 'jodtang_db') {
    throw new Error(
      '[Test Isolation] Refusing to run tests against production database "jodtang_db". ' +
        'Use the disposable isolated test database runner.'
    );
  }

  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(
      `[Test Isolation] Refusing test database "${databaseName}". ` +
        'Test databases must use the jodtang_test_<unique-name> convention.'
    );
  }
}

export function assertTestDatabaseConnection(connectionString: string): void {
  const testModeEnabled = process.env.NODE_ENV === 'test' || process.env.JODTANG_TEST_ISOLATION === '1';

  if (!testModeEnabled) {
    throw new Error(
      '[Test Isolation] Database-backed tests must run with NODE_ENV=test or ' +
        'JODTANG_TEST_ISOLATION=1.'
    );
  }

  assertTestDatabaseUrl(connectionString);
}
