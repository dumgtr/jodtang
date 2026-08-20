import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

async function runDisposableMigrationGate() {
  console.log('====================================================');
  console.log('🧪 Running Disposable Database Migration Gate');
  console.log('====================================================');

  const baseConfig = {
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgrespassword',
    host: 'localhost',
    port: 5432,
  };

  const adminClient = new Client({
    ...baseConfig,
    database: 'postgres',
  });

  await adminClient.connect();

  const testDbName = 'jodtang_disposable_gate_' + Date.now();
  console.log(`[Disposable Gate] Creating isolated test database: ${testDbName}`);
  await adminClient.query(`CREATE DATABASE ${testDbName};`);

  const testClient = new Client({
    ...baseConfig,
    database: testDbName,
  });

  await testClient.connect();

  try {
    const migrationsDir = path.resolve(__dirname, '../src/db/migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    console.log(`[Disposable Gate] Applying migrations from 001 to ${files[files.length - 1]}...`);

    // First Run: Apply each migration in order
    for (const file of files) {
      console.log(`[Disposable Gate] Applying: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await testClient.query(sql);
    }
    console.log('✅ First migration pass succeeded.');

    // Verify schema after first pass
    const statusColRes = await testClient.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'transactions' AND column_name IN ('status', 'updated_at');
    `);
    assert.equal(statusColRes.rows.length, 2, 'Both status and updated_at columns must exist');
    console.log('✅ Columns verified: status and updated_at exist.');

    // Insert dummy transaction to verify default status is 'confirmed'
    const userRes = await testClient.query(`
      INSERT INTO users (line_user_id) VALUES ('U_GATE_TEST') RETURNING id;
    `);
    const userId = userRes.rows[0].id;

    const txRes = await testClient.query(`
      INSERT INTO transactions (user_id, type, amount, category_id, occurred_at)
      VALUES ($1, 'expense', 100, 'อาหาร', NOW())
      RETURNING *;
    `, [userId]);
    assert.equal(txRes.rows[0].status, 'confirmed', 'New transaction default status must be confirmed');
    console.log('✅ Default status invariant verified.');

    // Second Run: Test Idempotency by re-applying all migrations
    console.log('\n[Disposable Gate] Testing Migration Idempotency (Second Pass)...');
    for (const file of files) {
      console.log(`[Disposable Gate] Re-applying: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await testClient.query(sql);
    }
    console.log('✅ Second migration pass (idempotency) succeeded with 0 errors.');

    // Verify existing data preserved
    const checkTxRes = await testClient.query(`SELECT * FROM transactions WHERE id = $1;`, [txRes.rows[0].id]);
    assert.equal(checkTxRes.rows.length, 1);
    assert.equal(checkTxRes.rows[0].status, 'confirmed');
    assert.equal(Number(checkTxRes.rows[0].amount), 100);
    console.log('✅ Existing data preserved across migration re-runs.');

    console.log('\n🎉 DISPOSABLE DATABASE MIGRATION GATE PASSED 100%!\n');
  } finally {
    await testClient.end();
    console.log(`[Disposable Gate] Dropping isolated test database: ${testDbName}`);
    await adminClient.query(`DROP DATABASE ${testDbName};`);
    await adminClient.end();
  }
}

runDisposableMigrationGate().catch((err) => {
  console.error('❌ Disposable DB Migration Gate Failed:', err);
  process.exit(1);
});
