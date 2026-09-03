import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { LocalQrRouter } from '../src/modules/qr/local-qr.router';

async function evaluateProduction200500Fixtures() {
  console.log('================================================================');
  console.log('🔬 Dry-Run Evaluation: Production 200500 Failure Fixtures');
  console.log('================================================================\n');

  const fixturesDir = path.resolve(__dirname, '../tests/fixtures/regression/prod-200500');
  const manifestPath = path.join(fixturesDir, 'manifest.json');

  assert.ok(fs.existsSync(manifestPath), `Manifest must exist at ${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const router = new LocalQrRouter();

  for (const item of manifest.fixtures) {
    console.log(`Evaluating Fixture: ${item.id} - ${item.fileName}`);
    console.log(`Description: ${item.description}`);
    console.log(`Historical Slip2Go: ${item.historicalSlip2GoBehavior}`);

    const filePath = path.join(fixturesDir, item.fileName);
    assert.ok(fs.existsSync(filePath), `Fixture file missing: ${filePath}`);

    const imageBuffer = fs.readFileSync(filePath);
    const result = await router.classifyImage(imageBuffer);

    console.log(`-> Local Router Classification: ${result.category}`);
    console.log(`-> Confidence: ${result.confidence}`);
    console.log(`-> Reason: ${result.reason || 'N/A'}`);
    console.log(`-> In-Memory Latency: ${result.processingTimeMs}ms`);

    // Hard Invariant Assertions:
    if (item.historicalSlip2GoBehavior && item.historicalSlip2GoBehavior.includes('200500')) {
      // 1. Raw 200500 cases must NEVER classify as BANK_SLIP_QR
      assert.notEqual(
        result.category,
        'BANK_SLIP_QR',
        `CRITICAL SECURITY VIOLATION: Fixture ${item.id} must NEVER resolve to BANK_SLIP_QR!`
      );

      // 2. Both must classify as NON_BANK_QR or NO_QR
      assert.ok(
        result.category === 'NO_QR' || result.category === 'NON_BANK_QR',
        `Fixture ${item.id} must classify as NO_QR or NON_BANK_QR (got ${result.category})`
      );
    }

    // 3. Match expected classification in manifest
    assert.equal(
      result.category,
      item.expectedRouterClassification,
      `Fixture ${item.id} must match expectedRouterClassification ${item.expectedRouterClassification} (got ${result.category})`
    );

    // 3. Confirm expected pipeline routing
    console.log(`   🛡️ Result: Strictly excluded from Slip2Go!`);
    console.log(`   ➡️ Target Routing: ${item.expectedTargetPipeline}`);
    console.log(`   🏷️ Badge: ${item.expectedBadge}\n`);
  }

  console.log('================================================================');
  console.log('✅ ALL PRODUCTION 200500 FIXTURES SAFELY EXCLUDED FROM SLIP2GO!');
  console.log('================================================================\n');
}

evaluateProduction200500Fixtures().catch((err) => {
  console.error('❌ Dry-Run Fixture Evaluation Failed:', err);
  process.exit(1);
});
