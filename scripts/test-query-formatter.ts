import assert from 'node:assert/strict';
import {
  formatQueryResult,
} from '../src/services/query-formatter.service';
import {
  QueryResult,
  ResolvedDateRange,
  SummaryQueryResult,
  RankingQueryResult,
  ListingQueryResult,
  CountQueryResult,
} from '../src/types/query';

/**
 * Q3 Test Suite: Deterministic Query Result Formatter
 *
 * Pure unit tests (no DB required): the formatter must render the four
 * QueryResult types deterministically WITHOUT recalculating amounts,
 * format currency in Thai, handle empty results gracefully, and use
 * 🥇🥈🥉 badges for rankings.
 */

function range(label = 'เดือนนี้ (สิงหาคม 2569)'): ResolvedDateRange {
  return { startDate: '2026-08-01', endDate: '2026-08-31', label };
}

async function runFormatterTests() {
  console.log('====================================================');
  console.log('🧪 Testing Q3: Deterministic Query Result Formatter');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // Test 1: SUMMARY - full result with category breakdown
  // ----------------------------------------------------
  console.log('1. Testing SUMMARY formatting with category breakdown...');
  const summary: SummaryQueryResult = {
    type: 'SUMMARY',
    dateRange: range('เดือนนี้ (สิงหาคม 2569)'),
    transactionType: 'EXPENSE',
    totalAmount: 5579,
    transactionCount: 7,
    categoryBreakdown: [
      { name: 'อาหารและเครื่องดื่ม', amount: 1879, count: 4, percentage: 33.68 },
      { name: 'ช้อปปิ้ง/ของใช้/อุปกรณ์', amount: 1250, count: 1, percentage: 22.4 },
    ],
    filteredCategory: null,
    filteredMerchant: null,
  };
  const summaryText = formatQueryResult(summary);
  assert(summaryText.includes('สรุป'), 'Summary header must exist');
  assert(summaryText.includes('รายจ่าย'), 'Expense type label must appear');
  assert(summaryText.includes('เดือนนี้ (สิงหาคม 2569)'), 'Date range label must appear');
  assert(summaryText.includes('5,579 บาท'), `Total must be Thai-formatted, got: ${summaryText}`);
  assert(summaryText.includes('7 รายการ'), 'Transaction count must appear');
  assert(summaryText.includes('อาหารและเครื่องดื่ม'), 'Breakdown category name must appear');
  assert(summaryText.includes('1,879 บาท'), 'Breakdown amount must be Thai-formatted');
  console.log('   ✅ Summary renders total, count, and breakdown correctly.\n');

  // ----------------------------------------------------
  // Test 2: SUMMARY - filtered by category/merchant
  // ----------------------------------------------------
  console.log('2. Testing SUMMARY with category/merchant filter...');
  const filteredSummary: SummaryQueryResult = {
    type: 'SUMMARY',
    dateRange: range(),
    transactionType: 'EXPENSE',
    totalAmount: 1879,
    transactionCount: 4,
    categoryBreakdown: undefined,
    filteredCategory: 'อาหารและเครื่องดื่ม',
    filteredMerchant: 'MK',
  };
  const filteredText = formatQueryResult(filteredSummary);
  assert(filteredText.includes('1,879 บาท'), 'Filtered total must be Thai-formatted');
  assert(filteredText.includes('อาหารและเครื่องดื่ม'), 'Filtered category must appear');
  assert(filteredText.includes('MK'), 'Filtered merchant must appear');
  console.log('   ✅ Filter context rendered.\n');

  // ----------------------------------------------------
  // Test 3: SUMMARY - income and transfer type labels
  // ----------------------------------------------------
  console.log('3. Testing SUMMARY transaction type labels...');
  const incomeSummary: SummaryQueryResult = {
    type: 'SUMMARY',
    dateRange: range(),
    transactionType: 'INCOME',
    totalAmount: 35000,
    transactionCount: 1,
  };
  const incomeText = formatQueryResult(incomeSummary);
  assert(incomeText.includes('รายรับ'), 'Income label must appear');
  assert(incomeText.includes('35,000 บาท'), 'Income total must be Thai-formatted');

  const transferSummary: SummaryQueryResult = {
    type: 'SUMMARY',
    dateRange: range(),
    transactionType: 'TRANSFER',
    totalAmount: 3000,
    transactionCount: 1,
  };
  const transferText = formatQueryResult(transferSummary);
  assert(transferText.includes('โอน'), 'Transfer label must appear');
  assert(transferText.includes('3,000 บาท'), 'Transfer total must be Thai-formatted');
  console.log('   ✅ Income and Transfer labels rendered.\n');

  // ----------------------------------------------------
  // Test 4: SUMMARY - empty result handled gracefully
  // ----------------------------------------------------
  console.log('4. Testing SUMMARY empty result...');
  const emptySummary: SummaryQueryResult = {
    type: 'SUMMARY',
    dateRange: range(),
    transactionType: 'EXPENSE',
    totalAmount: 0,
    transactionCount: 0,
    categoryBreakdown: undefined,
    filteredCategory: 'สุขภาพ/ความงาม',
    filteredMerchant: null,
  };
  const emptyText = formatQueryResult(emptySummary);
  assert(emptyText.includes('ไม่พบรายการ'), 'Empty summary must show friendly no-data message');
  assert(!emptyText.includes('NaN'), 'Output must never contain NaN');
  assert(!emptyText.includes('undefined'), 'Output must never contain undefined');
  console.log('   ✅ Empty summary handled gracefully.\n');

  // ----------------------------------------------------
  // Test 5: RANKING - badges 🥇🥈🥉 for top 3
  // ----------------------------------------------------
  console.log('5. Testing RANKING with medal badges...');
  const ranking: RankingQueryResult = {
    type: 'RANKING',
    dateRange: range(),
    transactionType: 'EXPENSE',
    groupBy: 'MERCHANT',
    rankings: [
      { rank: 1, name: 'MK', amount: 1280, count: 2 },
      { rank: 2, name: 'Lotus', amount: 1250, count: 1 },
      { rank: 3, name: 'ชาบู', amount: 399, count: 1 },
      { rank: 4, name: 'ปตท', amount: 1000, count: 1 },
    ],
    totalAmount: 3929,
  };
  const rankingText = formatQueryResult(ranking);
  assert(rankingText.includes('🥇'), 'Rank 1 must use 🥇 badge');
  assert(rankingText.includes('🥈'), 'Rank 2 must use 🥈 badge');
  assert(rankingText.includes('🥉'), 'Rank 3 must use 🥉 badge');
  assert(rankingText.includes('MK'), 'Rank 1 name must appear');
  assert(rankingText.includes('1,280 บาท'), 'Rank 1 amount must be Thai-formatted');
  assert(rankingText.includes('ปตท'), 'Rank 4 name must appear');
  assert(rankingText.includes('3,929 บาท'), 'Ranking total must be Thai-formatted');
  console.log('   ✅ Ranking badges and amounts rendered.\n');

  // ----------------------------------------------------
  // Test 6: RANKING - category grouping label
  // ----------------------------------------------------
  console.log('6. Testing RANKING grouped by category...');
  const catRanking: RankingQueryResult = {
    type: 'RANKING',
    dateRange: range(),
    transactionType: 'EXPENSE',
    groupBy: 'CATEGORY',
    rankings: [
      { rank: 1, name: 'อาหารและเครื่องดื่ม', amount: 1879, count: 4 },
    ],
    totalAmount: 1879,
  };
  const catRankingText = formatQueryResult(catRanking);
  assert(catRankingText.includes('หมวดหมู่'), 'Category grouping label must appear');
  assert(catRankingText.includes('อาหารและเครื่องดื่ม'), 'Category name must appear');
  console.log('   ✅ Category ranking label rendered.\n');

  // ----------------------------------------------------
  // Test 7: RANKING - fewer than 3 entries (no missing-badge crash)
  // ----------------------------------------------------
  console.log('7. Testing RANKING with fewer than 3 entries...');
  const twoRanking: RankingQueryResult = {
    type: 'RANKING',
    dateRange: range(),
    transactionType: 'EXPENSE',
    groupBy: 'MERCHANT',
    rankings: [
      { rank: 1, name: 'MK', amount: 1280, count: 2 },
      { rank: 2, name: 'Lotus', amount: 1250, count: 1 },
    ],
    totalAmount: 2530,
  };
  const twoRankingText = formatQueryResult(twoRanking);
  assert(twoRankingText.includes('🥇') && twoRankingText.includes('🥈'), 'Top 2 badges must appear');
  assert(!twoRankingText.includes('🥉'), 'Bronze badge must NOT appear with only 2 entries');

  const emptyRanking: RankingQueryResult = {
    type: 'RANKING',
    dateRange: range(),
    transactionType: 'EXPENSE',
    groupBy: 'MERCHANT',
    rankings: [],
    totalAmount: 0,
  };
  const emptyRankingText = formatQueryResult(emptyRanking);
  assert(emptyRankingText.includes('ไม่พบรายการ'), 'Empty ranking must show friendly message');
  console.log('   ✅ Short and empty rankings handled gracefully.\n');

  // ----------------------------------------------------
  // Test 8: LISTING - items with Thai dates and decimal amounts
  // ----------------------------------------------------
  console.log('8. Testing LISTING with Thai dates and decimals...');
  const listing: ListingQueryResult = {
    type: 'LISTING',
    dateRange: range('สัปดาห์นี้ (17 - 23 ส.ค. 2569)'),
    transactionType: 'EXPENSE',
    items: [
      {
        id: 'tx-001',
        type: 'expense',
        amount: 780,
        category: 'อาหารและเครื่องดื่ม',
        merchant: 'MK',
        description: 'พาลูกไปกิน MK',
        occurredAt: '2026-08-21',
      },
      {
        id: 'tx-002',
        type: 'expense',
        amount: 1250.5,
        category: 'ช้อปปิ้ง/ของใช้/อุปกรณ์',
        merchant: 'Lotus',
        description: 'ซื้อของเข้าบ้าน',
        occurredAt: '2026-08-20',
      },
    ],
    totalAmount: 2030.5,
    count: 2,
  };
  const listingText = formatQueryResult(listing);
  assert(listingText.includes('21/08/2569'), 'Occurred date must render in Thai Buddhist era (dd/mm/yyyy)');
  assert(listingText.includes('780 บาท'), 'Item amount must be Thai-formatted');
  assert(listingText.includes('1,250.50 บาท'), 'Decimal amount must keep 2 decimal places');
  assert(listingText.includes('2,030.50 บาท'), 'Listing total must keep decimals');
  assert(listingText.includes('MK') && listingText.includes('Lotus'), 'Merchants must appear');
  assert(listingText.includes('พาลูกไปกิน MK'), 'Description must appear');
  assert(listingText.includes('2 รายการ'), 'Listing count must appear');

  const emptyListing: ListingQueryResult = {
    type: 'LISTING',
    dateRange: range(),
    transactionType: 'EXPENSE',
    items: [],
    totalAmount: 0,
    count: 0,
  };
  const emptyListingText = formatQueryResult(emptyListing);
  assert(emptyListingText.includes('ไม่พบรายการ'), 'Empty listing must show friendly message');
  console.log('   ✅ Listing with dates, decimals, and empty case rendered.\n');

  // ----------------------------------------------------
  // Test 9: COUNT - occurrences with filters
  // ----------------------------------------------------
  console.log('9. Testing COUNT formatting...');
  const countResult: CountQueryResult = {
    type: 'COUNT',
    dateRange: range(),
    transactionType: 'EXPENSE',
    count: 3,
    filteredCategory: 'อาหารและเครื่องดื่ม',
    filteredMerchant: 'MK',
  };
  const countText = formatQueryResult(countResult);
  assert(countText.includes('3 ครั้ง'), 'Count must render as "N ครั้ง"');
  assert(countText.includes('MK'), 'Counted merchant must appear');
  assert(countText.includes('เดือนนี้ (สิงหาคม 2569)'), 'Date range label must appear');

  const emptyCount: CountQueryResult = {
    type: 'COUNT',
    dateRange: range(),
    transactionType: 'EXPENSE',
    count: 0,
    filteredMerchant: 'ไม่มีจริง',
  };
  const emptyCountText = formatQueryResult(emptyCount);
  assert(emptyCountText.includes('ไม่พบรายการ'), 'Zero count must show friendly message');
  console.log('   ✅ Count and empty count rendered.\n');

  // ----------------------------------------------------
  // Test 10: Currency formatting edge cases (decimals, thousands, zero)
  // ----------------------------------------------------
  console.log('10. Testing currency formatting edge cases...');
  const decimalSummary: SummaryQueryResult = {
    type: 'SUMMARY',
    dateRange: range(),
    transactionType: 'EXPENSE',
    totalAmount: 1234567.891, // must round to 1,234,567.89
    transactionCount: 2,
  };
  const decimalText = formatQueryResult(decimalSummary);
  assert(decimalText.includes('1,234,567.89 บาท'), 'Large decimal must group thousands and keep 2 places');

  const halfBaht: SummaryQueryResult = {
    type: 'SUMMARY',
    dateRange: range(),
    transactionType: 'EXPENSE',
    totalAmount: 0.5,
    transactionCount: 1,
  };
  const halfText = formatQueryResult(halfBaht);
  assert(halfText.includes('0.50 บาท'), 'Sub-baht amount must render as 0.50 บาท');

  const zeroBaht: SummaryQueryResult = {
    type: 'SUMMARY',
    dateRange: range(),
    transactionType: 'EXPENSE',
    totalAmount: 0,
    transactionCount: 1, // count > 0 but zero total: must still render 0 บาท, not the empty message
    filteredCategory: 'ของใช้ฟรี',
  };
  const zeroText = formatQueryResult(zeroBaht);
  assert(zeroText.includes('0 บาท'), 'Zero total with transactions must render 0 บาท');
  assert(!zeroText.includes('NaN') && !zeroText.includes('undefined'), 'No NaN/undefined allowed');
  console.log('   ✅ Decimal, thousands grouping, and zero handled.\n');

  // ----------------------------------------------------
  // Test 11: NO recalculation - inconsistent totals pass through verbatim
  // ----------------------------------------------------
  console.log('11. Testing amounts are NOT recalculated...');
  const oddRanking: RankingQueryResult = {
    type: 'RANKING',
    dateRange: range(),
    transactionType: 'EXPENSE',
    groupBy: 'MERCHANT',
    rankings: [{ rank: 1, name: 'A', amount: 500, count: 1 }],
    totalAmount: 9999, // deliberately inconsistent with item sum (500)
  };
  const oddText = formatQueryResult(oddRanking);
  assert(oddText.includes('500 บาท'), 'Item amount must pass through verbatim');
  assert(oddText.includes('9,999 บาท'), 'Total must pass through verbatim, NOT be recomputed from items');

  const frozen = Object.freeze(JSON.parse(JSON.stringify(summary)));
  const frozenText = formatQueryResult(frozen);
  assert(frozenText.includes('5,579 บาท'), 'Formatter must not mutate (or fail on frozen) input');
  console.log('   ✅ Formatter is read-only: no recalculation, no mutation.\n');

  // ----------------------------------------------------
  // Test 12: Determinism - identical input always yields identical output
  // ----------------------------------------------------
  console.log('12. Testing determinism and unknown type fallback...');
  assert.equal(formatQueryResult(summary), summaryText, 'Same input must always produce identical output');
  assert.equal(formatQueryResult(ranking), rankingText, 'Ranking output must be deterministic');

  const unknown = { type: 'MYSTERY', totalAmount: 42 } as unknown as QueryResult;
  const unknownText = formatQueryResult(unknown);
  assert(typeof unknownText === 'string' && unknownText.length > 0, 'Unknown type must return a graceful string, not throw');
  console.log('   ✅ Deterministic output and safe fallback verified.\n');

  console.log('====================================================');
  console.log('🎉 ALL 12 QUERY FORMATTER TESTS PASSED 100%!');
  console.log('====================================================\n');
}

runFormatterTests().catch((err) => {
  console.error('❌ Query Formatter Test Failed:', err);
  process.exit(1);
});
