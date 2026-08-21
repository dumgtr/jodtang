import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { query, pool } from '../src/db/client';
import { UserRepository } from '../src/modules/user/user.repository';
import { parseQueryIntent } from '../src/services/query-parser.service';
import { QueryEngineService } from '../src/services/query-engine.service';
import { formatQueryResult } from '../src/services/query-formatter.service';
import { QueryGoldenCase } from './generate-query-golden-dataset';
import { QueryResult } from '../src/types/query';

interface CaseEvalResult {
  id: string;
  tier: string;
  query: string;
  passed: boolean;
  intentPassed: boolean;
  amountPassed: boolean;
  countPassed: boolean;
  formattedPassed: boolean;
  isCriticalFailure: boolean;
  latencyMs: number;
  failureReason?: string;
  actualIntent?: any;
  actualAmount?: number;
  actualCount?: number;
  formattedText?: string;
}

async function runGoldenQueryEvaluation() {
  console.log('====================================================');
  console.log('🧪 JodTang Q4: Query Golden Dataset & Evaluator Suite');
  console.log('====================================================\n');

  const datasetPath = path.resolve(__dirname, 'query-golden-dataset.json');
  if (!fs.existsSync(datasetPath)) {
    console.error('❌ query-golden-dataset.json not found!');
    process.exit(1);
  }

  const dataset: QueryGoldenCase[] = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
  console.log(`Loaded ${dataset.length} Query Golden Cases.\n`);

  // 1. Setup Isolated Test User & Isolation Guard
  const testUser = await UserRepository.findOrCreateByLineUserId('U_GOLDEN_QUERY_TEST');
  const otherUser = await UserRepository.findOrCreateByLineUserId('U_GOLDEN_QUERY_OTHER');

  // Clean up existing data for test users
  await query(`DELETE FROM transactions WHERE user_id IN ($1, $2);`, [testUser.id, otherUser.id]);
  await query(`DELETE FROM audit_logs WHERE user_id IN ($1, $2);`, [testUser.id, otherUser.id]);

  console.log('1. Populating Deterministic Ground-Truth Dataset for Test User...');

  async function insertTx(
    userId: string,
    type: string,
    amount: number,
    category: string,
    merchant: string,
    description: string,
    occurredAt: string,
    status: 'confirmed' | 'voided' = 'confirmed'
  ) {
    await query(
      `INSERT INTO transactions (user_id, type, amount, category_id, merchant_id, description, occurred_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8);`,
      [userId, type, amount, category, merchant, description, `${occurredAt} 12:00:00+07`, status]
    );
  }

  // August 2026 Transactions (Reference: 2026-08-21)
  await insertTx(testUser.id, 'expense', 780, 'อาหารและเครื่องดื่ม', 'MK', 'พาลูกไปกิน MK', '2026-08-21'); // Today
  await insertTx(testUser.id, 'expense', 1250, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'Lotus', 'ซื้อของเข้าบ้าน', '2026-08-20'); // Yesterday
  await insertTx(testUser.id, 'expense', 399, 'อาหารและเครื่องดื่ม', 'ชาบู', 'กินชาบู', '2026-08-19'); // Specific date (19 Aug)
  await insertTx(testUser.id, 'expense', 1000, 'การเดินทาง/ยานพาหนะ', 'ปตท', 'เติมน้ำมัน', '2026-08-17'); // Specific date (17 Aug)
  await insertTx(testUser.id, 'expense', 1450, 'บิล/ค่าใช้จ่าย/สาธารณูปโภค', 'การไฟฟ้านครหลวง', 'จ่ายค่าไฟ', '2026-08-12'); // Earlier August
  await insertTx(testUser.id, 'expense', 500, 'อาหารและเครื่องดื่ม', 'MK', 'กินข้าวกลางวัน', '2026-08-05'); // Earlier August
  await insertTx(testUser.id, 'expense', 200, 'อาหารและเครื่องดื่ม', 'กาแฟ', 'กาแฟสด', '2026-08-01'); // First day of August
  await insertTx(testUser.id, 'income', 35000, 'รายรับ/เงินเดือน/ธุรกิจ', 'บริษัท', 'เงินเดือน', '2026-08-21'); // Income August
  await insertTx(testUser.id, 'transfer', 3000, 'โอนเงิน/ทั่วไป', 'แม่', 'โอนให้แม่', '2026-08-21'); // Transfer August
  await insertTx(testUser.id, 'expense', 9999, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'Apple', 'ซื้อ iPhone (Voided)', '2026-08-15', 'voided'); // VOIDED (Must be excluded)

  // July 2026 Transactions (Last Month)
  await insertTx(testUser.id, 'expense', 4500, 'อาหารและเครื่องดื่ม', 'MK', 'เลี้ยงวันเกิด', '2026-07-25');
  await insertTx(testUser.id, 'expense', 2000, 'การเดินทาง/ยานพาหนะ', 'ปตท', 'ค่าน้ำมัน ก.ค.', '2026-07-10');

  // Other User Transaction (Isolation Guard)
  await insertTx(otherUser.id, 'expense', 50000, 'อาหารและเครื่องดื่ม', 'OtherStore', 'ของ User อื่น', '2026-08-21');

  console.log('   ✅ Test fixtures loaded into PostgreSQL.\n');

  // ----------------------------------------------------
  // 2. Execute Deterministic Evaluation Pipeline
  // ----------------------------------------------------
  console.log('2. Running End-to-End Deterministic Pipeline for all cases...\n');

  const results: CaseEvalResult[] = [];
  let totalLatency = 0;

  for (let i = 0; i < dataset.length; i++) {
    const c = dataset[i];
    const startTime = Date.now();

    const evalResult: CaseEvalResult = {
      id: c.id,
      tier: c.tier,
      query: c.query,
      passed: true,
      intentPassed: true,
      amountPassed: true,
      countPassed: true,
      formattedPassed: true,
      isCriticalFailure: false,
      latencyMs: 0,
    };

    try {
      // Step A: LLM Query Intent Parser
      const intent = await parseQueryIntent(c.query, c.referenceDate);
      evalResult.actualIntent = intent;

      // Check Non-query expectations
      if (c.expectedIntent === null) {
        if (intent !== null) {
          evalResult.intentPassed = false;
          evalResult.passed = false;
          evalResult.isCriticalFailure = true;
          evalResult.failureReason = `Expected NULL (non-query), but got intent: ${intent.intent}`;
        }
      } else {
        if (!intent) {
          evalResult.intentPassed = false;
          evalResult.passed = false;
          evalResult.isCriticalFailure = true;
          evalResult.failureReason = 'Expected query intent, but got NULL';
        } else {
          // Verify Intent Type
          if (intent.intent !== c.expectedIntent.intent) {
            evalResult.intentPassed = false;
            evalResult.passed = false;
            evalResult.isCriticalFailure = true;
            evalResult.failureReason = `Intent mismatch (Expected: ${c.expectedIntent.intent}, Got: ${intent.intent})`;
          }

          // Verify DateRange Type
          if (intent.date_range.type !== c.expectedIntent.dateRangeType) {
            evalResult.intentPassed = false;
            evalResult.passed = false;
            evalResult.isCriticalFailure = true;
            evalResult.failureReason = `DateRange mismatch (Expected: ${c.expectedIntent.dateRangeType}, Got: ${intent.date_range.type})`;
          }

          // Step B: Deterministic SQL Query Engine
          const queryResult = await QueryEngineService.executeQuery(testUser.id, intent, c.referenceDate);

          let actAmount = 0;
          let actCount = 0;

          if (queryResult.type === 'SUMMARY') {
            actAmount = queryResult.totalAmount;
            actCount = queryResult.transactionCount;
          } else if (queryResult.type === 'RANKING') {
            actAmount = queryResult.totalAmount;
            actCount = queryResult.rankings.length;
            if (c.expectedResult.topName && queryResult.rankings.length > 0) {
              if (!queryResult.rankings[0].name.includes(c.expectedResult.topName) && !c.expectedResult.topName.includes(queryResult.rankings[0].name)) {
                evalResult.passed = false;
                evalResult.failureReason = `Top ranking mismatch (Expected: ${c.expectedResult.topName}, Got: ${queryResult.rankings[0].name})`;
              }
            }
          } else if (queryResult.type === 'LISTING') {
            actAmount = queryResult.totalAmount;
            actCount = queryResult.count;
          } else if (queryResult.type === 'COUNT') {
            actCount = queryResult.count;
          }

          evalResult.actualAmount = actAmount;
          evalResult.actualCount = actCount;

          // Step C: Verify Exact Math Against Ground Truth
          if (c.expectedResult.totalAmount !== undefined) {
            if (Math.abs(actAmount - c.expectedResult.totalAmount) > 0.01) {
              evalResult.amountPassed = false;
              evalResult.passed = false;
              evalResult.isCriticalFailure = true;
              evalResult.failureReason = `Amount mismatch (Expected: ${c.expectedResult.totalAmount}, Got: ${actAmount})`;
            }
          }

          if (c.expectedResult.count !== undefined) {
            if (actCount !== c.expectedResult.count) {
              evalResult.countPassed = false;
              evalResult.passed = false;
              evalResult.isCriticalFailure = true;
              evalResult.failureReason = `Count mismatch (Expected: ${c.expectedResult.count}, Got: ${actCount})`;
            }
          }

          // Step D: Result Formatter Verification
          const formatted = formatQueryResult(queryResult);
          evalResult.formattedText = formatted;

          assert(typeof formatted === 'string' && formatted.length > 0, 'Formatted text must be non-empty string');
          assert(!formatted.includes('NaN'), 'Formatted text must not contain NaN');
          assert(!formatted.includes('undefined'), 'Formatted text must not contain undefined');
        }
      }
    } catch (err: any) {
      evalResult.passed = false;
      evalResult.isCriticalFailure = true;
      evalResult.failureReason = `Runtime Error: ${err?.message || err}`;
    }

    evalResult.latencyMs = Date.now() - startTime;
    totalLatency += evalResult.latencyMs;
    results.push(evalResult);

    const statusIcon = evalResult.passed ? '✅' : '❌';
    console.log(`   ${statusIcon} [${i + 1}/${dataset.length}] ${c.id} (${evalResult.latencyMs}ms) "${c.query}"`);
    if (!evalResult.passed) {
      console.log(`      ⚠️ Failure: ${evalResult.failureReason}`);
    }
  }

  // ----------------------------------------------------
  // 3. Aggregate Metrics & Reporting
  // ----------------------------------------------------
  const totalCases = results.length;
  const passedCases = results.filter((r) => r.passed).length;
  const criticalFailures = results.filter((r) => r.isCriticalFailure).length;
  const accuracyRate = (passedCases / totalCases) * 100;
  const avgLatency = totalLatency / totalCases;

  console.log('\n================================================================================');
  console.log('📊 JODTANG Q4 QUERY GOLDEN DATASET BENCHMARK REPORT');
  console.log('================================================================================');
  console.log(`Test Cases Evaluated:       ${totalCases}`);
  console.log(`Passed Cases:               ${passedCases} / ${totalCases} (${accuracyRate.toFixed(1)}%)`);
  console.log(`Critical Failures:          ${criticalFailures}`);
  console.log(`Average Latency:            ${(avgLatency / 1000).toFixed(2)}s`);
  console.log('================================================================================\n');

  // Breakdown by Tier
  const tiers = Array.from(new Set(results.map((r) => r.tier)));
  for (const tier of tiers) {
    const tierCases = results.filter((r) => r.tier === tier);
    const tierPassed = tierCases.filter((r) => r.passed).length;
    const tierRate = (tierPassed / tierCases.length) * 100;
    console.log(`   - Tier ${tier.padEnd(24)}: ${tierPassed}/${tierCases.length} (${tierRate.toFixed(1)}%)`);
  }

  // Clean up test data
  await query(`DELETE FROM transactions WHERE user_id IN ($1, $2);`, [testUser.id, otherUser.id]);
  await query(`DELETE FROM audit_logs WHERE user_id IN ($1, $2);`, [testUser.id, otherUser.id]);

  console.log('\n====================================================');
  if (criticalFailures === 0 && accuracyRate >= 95) {
    console.log('🎉 Q4 QUERY GOLDEN EVALUATION PASSED WITH 0 CRITICAL FAILURES!');
  } else {
    console.error(`❌ Q4 Query Evaluation failed tolerance (${criticalFailures} critical failures).`);
    process.exit(1);
  }
  console.log('====================================================\n');
}

runGoldenQueryEvaluation().catch((err) => {
  console.error('❌ Query Golden Test Error:', err);
  process.exit(1);
});
