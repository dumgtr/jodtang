import fs from 'fs';
import path from 'path';
import { pool, withTransaction } from './client';

async function runMigrations() {
  console.log('[Migration] Starting database migrations...');

  // Check multiple possible paths (development tsx or compiled dist)
  const candidateDirs = [
    path.join(__dirname, 'migrations'),
    path.resolve(__dirname, '../../src/db/migrations'),
    path.resolve(process.cwd(), 'src/db/migrations'),
    path.resolve(process.cwd(), 'dist/db/migrations'),
  ];

  let migrationsDir = '';
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.sql'))) {
      migrationsDir = dir;
      break;
    }
  }

  if (!migrationsDir) {
    console.error('[Migration] Migrations directory not found in candidates:', candidateDirs);
    process.exit(1);
  }

  console.log(`[Migration] Using migrations directory: ${migrationsDir}`);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  await withTransaction(async (client) => {
    // Create migrations tracker table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    for (const file of files) {
      const checkRes = await client.query(
        'SELECT id FROM _migrations WHERE name = $1',
        [file]
      );

      if (checkRes.rowCount === 0) {
        console.log(`[Migration] Applying migration: ${file}`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        console.log(`[Migration] Successfully applied: ${file}`);
      } else {
        console.log(`[Migration] Skipping already applied migration: ${file}`);
      }
    }
  });

  console.log('[Migration] All migrations completed successfully.');
}

runMigrations()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[Migration] Migration failed:', err);
    await pool.end();
    process.exit(1);
  });
