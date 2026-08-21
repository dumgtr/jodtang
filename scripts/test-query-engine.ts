import assert from 'node:assert/strict';
import { query, pool } from '../src/db/client';
import { UserRepository } from '../src/modules/user/user.repository';
import { QueryEngineService } from '../src/services/query-engine.service';
import { QueryIntent, SummaryQueryResult, RankingQueryResult, ListingQueryResult, CountQueryResult } from '../src/types/query';

async function runQueryEngineTests() {
  console.log('====================================================');
  console.log('🧪 Testing Q2: Deterministic Query Engine Suite');
  console.log('====================================================\n');

  const refDate = '2026-08-21'; // Reference Date: Friday 21 Aug 2026

  // 1. Setup Isolated Test Users
  const userA = await UserRepository.findOrCreateByLineUserId('U_TEST_QE_USER_A');
  const userB = await UserRepository.findOrCreateByLineUserId('U_TEST_QE_USER_B');

  // Clean up existing test data for idempotency
  await query(`DELETE FROM transactions WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM audit_logs WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);

  console.log('1. Populating Isolated Test Fixture Data for User A & User B...');

  // Helper to insert test transaction directly into transactions table
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

  // Insert User A Test Transactions (August & July 2026)
  await insertTx(userA.id, 'expense', 780, 'อาหารและเครื่องดื่ม', 'MK', 'พาลูกไปกิน MK', '2026-08-21'); // Today
  await insertTx(userA.id, 'expense', 1250, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'Lotus', 'ซื้อของเข้าบ้าน', '2026-08-20'); // Yesterday
  await insertTx(userA.id, 'expense', 399, 'อาหารและเครื่องดื่ม', 'ชาบู', 'กินชาบู', '2026-08-19'); // This week
  await insertTx(userA.id, 'expense', 1000, 'การเดินทาง/ยานพาหนะ', 'ปตท', 'เติมน้ำมัน', '2026-08-17'); // This week Monday
  await insertTx(userA.id, 'expense', 1450, 'บิล/ค่าใช้จ่าย/สาธารณูปโภค', 'การไฟฟ้านครหลวง', 'จ่ายค่าไฟ', '2026-08-12'); // Last week
  await insertTx(userA.id, 'expense', 500, 'อาหารและเครื่องดื่ม', 'MK', 'กินข้าวกลางวัน', '2026-08-05'); // Earlier this month
  await insertTx(userA.id, 'expense', 200, 'อาหารและเครื่องดื่ม', 'กาแฟ', 'กาแฟสด', '2026-08-01'); // First day of month
  await insertTx(userA.id, 'income', 35000, 'รายรับ/เงินเดือน/ธุรกิจ', 'บริษัท', 'เงินเดือน', '2026-08-21'); // Income
  await insertTx(userA.id, 'transfer', 3000, 'โอนเงิน/ทั่วไป', 'แม่', 'โอนให้แม่', '2026-08-21'); // Transfer
  await insertTx(userA.id, 'expense', 9999, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'Apple', 'ซื้อ iPhone (Voided)', '2026-08-15', 'voided'); // Voided (MUST BE EXCLUDED)
  await insertTx(userA.id, 'expense', 4500, 'อาหารและเครื่องดื่ม', 'MK', 'เลี้ยงวันเกิด', '2026-07-25'); // Last month
  await insertTx(userA.id, 'expense', 2000, 'การเดินทาง/ยานพาหนะ', 'ปตท', 'ค่าน้ำมัน ก.ค.', '2026-07-10'); // Last month

  // Insert User B Test Transaction (to test User Isolation)
  await insertTx(userB.id, 'expense', 50000, 'อาหารและเครื่องดื่ม', 'UserBStore', 'รายการของ User B', '2026-08-21');

  console.log('   ✅ Test fixtures inserted.\n');

  // ----------------------------------------------------
  // Test 1: SUM - Month Expenses (SUM, COUNT, VOID EXCLUSION, USER ISOLATION)
  // ----------------------------------------------------
  console.log('2. Testing SUM - Current Month Total Expenses...');
  const sumIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'EXPENSE',
    aggregation: 'SUM',
  };

  const sumResult = (await QueryEngineService.executeQuery(userA.id, sumIntent, refDate)) as SummaryQueryResult;
  assert.equal(sumResult.type, 'SUMMARY');
  assert.equal(sumResult.totalAmount, 5579); // 780 + 1250 + 399 + 1000 + 1450 + 500 + 200
  assert.equal(sumResult.transactionCount, 7);
  assert(sumResult.categoryBreakdown !== undefined);
  assert.equal(sumResult.categoryBreakdown.length, 4);
  console.log(`   ✅ Total Amount: ฿${sumResult.totalAmount} (Count: ${sumResult.transactionCount}) matches exact DB sum.`);

  // ----------------------------------------------------
  // Test 2: Category Filtered SUM
  // ----------------------------------------------------
  console.log('3. Testing Category-Filtered SUM ("เดือนนี้กินข้าวไปเท่าไร")...');
  const catSumIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'EXPENSE',
    category: 'อาหารและเครื่องดื่ม',
    aggregation: 'SUM',
  };

  const catSumResult = (await QueryEngineService.executeQuery(userA.id, catSumIntent, refDate)) as SummaryQueryResult;
  assert.equal(catSumResult.totalAmount, 1879); // 780 + 399 + 500 + 200
  assert.equal(catSumResult.transactionCount, 4);
  console.log(`   ✅ Category Total: ฿${catSumResult.totalAmount} matches food expenses.`);

  // ----------------------------------------------------
  // Test 3: Date Range Boundary - Yesterday & Today
  // ----------------------------------------------------
  console.log('4. Testing Date Range Boundary - Today & Yesterday...');
  const todayIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'TODAY' },
    transaction_type: 'EXPENSE',
    aggregation: 'SUM',
  };
  const todayResult = (await QueryEngineService.executeQuery(userA.id, todayIntent, refDate)) as SummaryQueryResult;
  assert.equal(todayResult.totalAmount, 780);
  assert.equal(todayResult.transactionCount, 1);

  const yesterdayIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'YESTERDAY' },
    transaction_type: 'EXPENSE',
    aggregation: 'SUM',
  };
  const yesterdayResult = (await QueryEngineService.executeQuery(userA.id, yesterdayIntent, refDate)) as SummaryQueryResult;
  assert.equal(yesterdayResult.totalAmount, 1250);
  assert.equal(yesterdayResult.transactionCount, 1);
  console.log('   ✅ Today and Yesterday exact date boundaries verified.');

  // ----------------------------------------------------
  // Test 4: Weekly Boundary - This Week (17 Aug - 23 Aug)
  // ----------------------------------------------------
  console.log('5. Testing Weekly Boundary - This Week...');
  const thisWeekIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'THIS_WEEK' },
    transaction_type: 'EXPENSE',
    aggregation: 'SUM',
  };
  const thisWeekResult = (await QueryEngineService.executeQuery(userA.id, thisWeekIntent, refDate)) as SummaryQueryResult;
  assert.equal(thisWeekResult.totalAmount, 3429); // 780 + 1250 + 399 + 1000 (excludes 12 Aug which is last week)
  assert.equal(thisWeekResult.transactionCount, 4);
  console.log('   ✅ Weekly ISO boundary (Monday-Sunday) verified.');

  // ----------------------------------------------------
  // Test 5: TOP / RANKING by Merchant ("เดือนนี้ร้านไหนใช้เงินเยอะที่สุด")
  // ----------------------------------------------------
  console.log('6. Testing Merchant Ranking...');
  const merchantRankingIntent: QueryIntent = {
    intent: 'RANKING',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'EXPENSE',
    group_by: 'MERCHANT',
    aggregation: 'SUM',
    sort_order: 'DESC',
    limit: 5,
  };

  const merchantRankingResult = (await QueryEngineService.executeQuery(userA.id, merchantRankingIntent, refDate)) as RankingQueryResult;
  assert.equal(merchantRankingResult.type, 'RANKING');
  assert.equal(merchantRankingResult.groupBy, 'MERCHANT');
  assert.equal(merchantRankingResult.rankings.length, 5);
  // Rank 1: การไฟฟ้านครหลวง (1450)
  assert.equal(merchantRankingResult.rankings[0].name, 'การไฟฟ้านครหลวง');
  assert.equal(merchantRankingResult.rankings[0].amount, 1450);
  // Rank 2: MK (780 + 500 = 1280)
  assert.equal(merchantRankingResult.rankings[1].name, 'MK');
  assert.equal(merchantRankingResult.rankings[1].amount, 1280);
  assert.equal(merchantRankingResult.rankings[1].count, 2);
  // Rank 3: Lotus (1250)
  assert.equal(merchantRankingResult.rankings[2].name, 'Lotus');
  assert.equal(merchantRankingResult.rankings[2].amount, 1250);
  console.log('   ✅ Merchant ranking ordered correctly by total amount descending.');

  // ----------------------------------------------------
  // Test 6: TOP / RANKING by Category ("หมวดไหนใช้เงินเยอะที่สุด")
  // ----------------------------------------------------
  console.log('7. Testing Category Ranking...');
  const categoryRankingIntent: QueryIntent = {
    intent: 'RANKING',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'EXPENSE',
    group_by: 'CATEGORY',
    aggregation: 'SUM',
    limit: 3,
  };

  const catRankingResult = (await QueryEngineService.executeQuery(userA.id, categoryRankingIntent, refDate)) as RankingQueryResult;
  assert.equal(catRankingResult.groupBy, 'CATEGORY');
  assert.equal(catRankingResult.rankings.length, 3);
  // Rank 1: อาหารและเครื่องดื่ม (1879)
  assert.equal(catRankingResult.rankings[0].name, 'อาหารและเครื่องดื่ม');
  assert.equal(catRankingResult.rankings[0].amount, 1879);
  console.log('   ✅ Category ranking ordered correctly.');

  // ----------------------------------------------------
  // Test 7: LISTING - Itemized Transactions ("อาทิตย์นี้มีค่าใช้จ่ายอะไรบ้าง")
  // ----------------------------------------------------
  console.log('8. Testing LISTING Itemized Transactions...');
  const listingIntent: QueryIntent = {
    intent: 'LISTING',
    date_range: { type: 'THIS_WEEK' },
    transaction_type: 'EXPENSE',
    aggregation: 'NONE',
    limit: 10,
  };

  const listingResult = (await QueryEngineService.executeQuery(userA.id, listingIntent, refDate)) as ListingQueryResult;
  assert.equal(listingResult.type, 'LISTING');
  assert.equal(listingResult.items.length, 4);
  assert.equal(listingResult.totalAmount, 3429);
  assert.equal(listingResult.items[0].occurredAt, '2026-08-21'); // Latest first
  assert.equal(listingResult.items[0].amount, 780);
  console.log('   ✅ Itemized listing returned in reverse chronological order.');

  // ----------------------------------------------------
  // Test 8: COUNT - Transaction Count Query ("เดือนนี้มีรายจ่ายกี่รายการ")
  // ----------------------------------------------------
  console.log('9. Testing COUNT Query...');
  const countIntent: QueryIntent = {
    intent: 'COUNT',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'EXPENSE',
    aggregation: 'COUNT',
  };

  const countResult = (await QueryEngineService.executeQuery(userA.id, countIntent, refDate)) as CountQueryResult;
  assert.equal(countResult.type, 'COUNT');
  assert.equal(countResult.count, 7);
  console.log('   ✅ Count query returned exact integer count.');

  // ----------------------------------------------------
  // Test 9: Transaction Type Isolation (EXPENSE vs INCOME vs TRANSFER)
  // ----------------------------------------------------
  console.log('10. Testing Type Isolation (Income & Transfer)...');
  const incomeIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'INCOME',
    aggregation: 'SUM',
  };
  const incomeResult = (await QueryEngineService.executeQuery(userA.id, incomeIntent, refDate)) as SummaryQueryResult;
  assert.equal(incomeResult.totalAmount, 35000);
  assert.equal(incomeResult.transactionCount, 1);

  const transferIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'TRANSFER',
    aggregation: 'SUM',
  };
  const transferResult = (await QueryEngineService.executeQuery(userA.id, transferIntent, refDate)) as SummaryQueryResult;
  assert.equal(transferResult.totalAmount, 3000);
  assert.equal(transferResult.transactionCount, 1);
  console.log('   ✅ Income and Transfer properly isolated from Expense.');

  // ----------------------------------------------------
  // Test 10: Empty Result Handling (Non-existent category or period)
  // ----------------------------------------------------
  console.log('11. Testing Empty Result Handling...');
  const emptyIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'EXPENSE',
    category: 'สุขภาพ/ความงาม',
    aggregation: 'SUM',
  };
  const emptyResult = (await QueryEngineService.executeQuery(userA.id, emptyIntent, refDate)) as SummaryQueryResult;
  assert.equal(emptyResult.totalAmount, 0);
  assert.equal(emptyResult.transactionCount, 0);
  console.log('   ✅ Empty results safely return 0 amount without error.');

  // ----------------------------------------------------
  // Test 11: SQL Injection Safety & Parameterization
  // ----------------------------------------------------
  console.log('12. Testing SQL Injection Safety & Parameterization...');
  const injectionIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'EXPENSE',
    category: "อาหาร' OR '1'='1",
    merchant: "'; DROP TABLE transactions; --",
    aggregation: 'SUM',
  };
  const injectionResult = (await QueryEngineService.executeQuery(userA.id, injectionIntent, refDate)) as SummaryQueryResult;
  assert.equal(injectionResult.totalAmount, 0);
  assert.equal(injectionResult.transactionCount, 0);

  // Verify table is intact
  const tableCheck = await query(`SELECT COUNT(id) FROM transactions;`);
  assert(Number(tableCheck.rows[0].count) > 0, 'Table must remain completely intact.');
  console.log('   ✅ SQL injection payloads neutralized safely by parameterized queries.');

  // ----------------------------------------------------
  // Test 12: User Isolation (User B cannot see User A, User A cannot see User B)
  // ----------------------------------------------------
  console.log('13. Testing User Isolation...');
  const userBSum = (await QueryEngineService.executeQuery(userB.id, sumIntent, refDate)) as SummaryQueryResult;
  assert.equal(userBSum.totalAmount, 50000);
  assert.equal(userBSum.transactionCount, 1);
  console.log('   ✅ Multi-tenant user isolation verified 100%.');

  // Clean up test data
  await query(`DELETE FROM transactions WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM audit_logs WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);

  console.log('\n====================================================');
  console.log('🎉 ALL 14 DETERMINISTIC QUERY ENGINE TESTS PASSED 100%!');
  console.log('====================================================\n');
}

runQueryEngineTests().catch((err) => {
  console.error('❌ Query Engine Test Failed:', err);
  process.exit(1);
});
