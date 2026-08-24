import assert from 'node:assert/strict';
import { QueryIntentSchema, QueryIntent } from '../src/types/query';
import { resolveQueryDateRange } from '../src/utils/query-date-resolver';
import {
  parseQueryIntent,
  parseDeterministicQueryIntentFallback,
} from '../src/services/query-parser.service';

async function runQueryIntentContractTests() {
  console.log('====================================================');
  console.log('🧪 Testing Q1: Query Intent Contract & Date Resolver');
  console.log('====================================================\n');

  const refDate = '2026-08-21'; // Friday, 21 Aug 2026

  // ----------------------------------------------------
  // Part 1: Zod Contract Schema Validation
  // ----------------------------------------------------
  console.log('1. Testing Zod Contract Schema Validation...');

  const validIntent: QueryIntent = {
    intent: 'SUMMARY',
    date_range: { type: 'CURRENT_MONTH' },
    transaction_type: 'EXPENSE',
    aggregation: 'SUM',
    category: 'อาหารและเครื่องดื่ม',
  };

  const parsedValid = QueryIntentSchema.parse(validIntent);
  assert.equal(parsedValid.intent, 'SUMMARY');
  assert.equal(parsedValid.transaction_type, 'EXPENSE');
  assert.equal(parsedValid.aggregation, 'SUM');
  assert.equal(parsedValid.category, 'อาหารและเครื่องดื่ม');

  // Test invalid intent
  const invalidIntent = { intent: 'INVALID_INTENT' };
  const invalidResult = QueryIntentSchema.safeParse(invalidIntent);
  assert.equal(invalidResult.success, false, 'Invalid intent must fail validation');

  console.log('   ✅ Schema validation assertions passed.\n');

  // ----------------------------------------------------
  // Part 2: Deterministic Date Range Resolver
  // ----------------------------------------------------
  console.log('2. Testing Deterministic Date Range Resolver (Ref: 2026-08-21)...');

  // 2.1 TODAY
  const todayRange = resolveQueryDateRange({ type: 'TODAY' }, refDate);
  assert.equal(todayRange.startDate, '2026-08-21');
  assert.equal(todayRange.endDate, '2026-08-21');
  assert(todayRange.label.includes('วันนี้'));

  // 2.2 YESTERDAY
  const yesterdayRange = resolveQueryDateRange({ type: 'YESTERDAY' }, refDate);
  assert.equal(yesterdayRange.startDate, '2026-08-20');
  assert.equal(yesterdayRange.endDate, '2026-08-20');
  assert(yesterdayRange.label.includes('เมื่อวาน'));

  // 2.3 THIS_WEEK (2026-08-21 is Friday -> Monday is 17 Aug, Sunday is 23 Aug)
  const thisWeekRange = resolveQueryDateRange({ type: 'THIS_WEEK' }, refDate);
  assert.equal(thisWeekRange.startDate, '2026-08-17');
  assert.equal(thisWeekRange.endDate, '2026-08-23');

  // 2.4 LAST_WEEK (10 Aug to 16 Aug 2026)
  const lastWeekRange = resolveQueryDateRange({ type: 'LAST_WEEK' }, refDate);
  assert.equal(lastWeekRange.startDate, '2026-08-10');
  assert.equal(lastWeekRange.endDate, '2026-08-16');

  // 2.5 CURRENT_MONTH (August 2026: 01 to 31)
  const currentMonthRange = resolveQueryDateRange({ type: 'CURRENT_MONTH' }, refDate);
  assert.equal(currentMonthRange.startDate, '2026-08-01');
  assert.equal(currentMonthRange.endDate, '2026-08-31');
  assert(currentMonthRange.label.includes('สิงหาคม 2569'));

  // 2.6 LAST_MONTH (July 2026: 01 to 31)
  const lastMonthRange = resolveQueryDateRange({ type: 'LAST_MONTH' }, refDate);
  assert.equal(lastMonthRange.startDate, '2026-07-01');
  assert.equal(lastMonthRange.endDate, '2026-07-31');
  assert(lastMonthRange.label.includes('กรกฎาคม 2569'));

  // 2.7 THIS_YEAR (2026-01-01 to 2026-12-31)
  const thisYearRange = resolveQueryDateRange({ type: 'THIS_YEAR' }, refDate);
  assert.equal(thisYearRange.startDate, '2026-01-01');
  assert.equal(thisYearRange.endDate, '2026-12-31');

  // 2.8 SPECIFIC_DATE ("2026-08-19")
  const specificDateRange = resolveQueryDateRange({ type: 'SPECIFIC_DATE', specific_date: '2026-08-19' }, refDate);
  assert.equal(specificDateRange.startDate, '2026-08-19');
  assert.equal(specificDateRange.endDate, '2026-08-19');

  console.log('   ✅ All 8 date range interval assertions passed.\n');

  // ----------------------------------------------------
  // Part 3: Canonical Query Parsing Assertions
  // ----------------------------------------------------
  console.log('3. Testing Canonical Query Intent Parser (Prompt Requirements)...');

  const cases = [
    {
      input: 'เดือนนี้ใช้เงินไปเท่าไร',
      verify: (intent: QueryIntent | null) => {
        assert(intent !== null, 'Must parse as valid query');
        assert.equal(intent.intent, 'SUMMARY');
        assert.equal(intent.date_range.type, 'CURRENT_MONTH');
        assert.equal(intent.transaction_type, 'EXPENSE');
        assert.equal(intent.aggregation, 'SUM');
      },
    },
    {
      input: 'สรุปเดือนนี้',
      verify: (intent: QueryIntent | null) => {
        assert(intent !== null, 'Must parse as valid query');
        assert.equal(intent.intent, 'SUMMARY');
        assert.equal(intent.date_range.type, 'CURRENT_MONTH');
        assert.equal(intent.transaction_type, 'EXPENSE');
        assert.equal(intent.aggregation, 'SUM');
      },
    },
    {
      input: 'เดือนนี้กินข้าวไปเท่าไร',
      verify: (intent: QueryIntent | null) => {
        assert(intent !== null, 'Must parse as valid query');
        assert.equal(intent.intent, 'SUMMARY');
        assert.equal(intent.date_range.type, 'CURRENT_MONTH');
        assert.equal(intent.transaction_type, 'EXPENSE');
        assert.equal(intent.category, 'อาหารและเครื่องดื่ม');
        assert.equal(intent.aggregation, 'SUM');
      },
    },
    {
      input: 'เดือนนี้ร้านไหนใช้เงินเยอะที่สุด',
      verify: (intent: QueryIntent | null) => {
        assert(intent !== null, 'Must parse as valid query');
        assert.equal(intent.intent, 'RANKING');
        assert.equal(intent.date_range.type, 'CURRENT_MONTH');
        assert.equal(intent.transaction_type, 'EXPENSE');
        assert.equal(intent.group_by, 'MERCHANT');
        assert.equal(intent.sort_order, 'DESC');
      },
    },
    {
      input: 'อาทิตย์นี้มีค่าใช้จ่ายอะไรบ้าง',
      verify: (intent: QueryIntent | null) => {
        assert(intent !== null, 'Must parse as valid query');
        assert.equal(intent.intent, 'LISTING');
        assert.equal(intent.date_range.type, 'THIS_WEEK');
        assert.equal(intent.transaction_type, 'EXPENSE');
      },
    },
    {
      input: 'เมื่อวานใช้เงินเท่าไร',
      verify: (intent: QueryIntent | null) => {
        assert(intent !== null, 'Must parse as valid query');
        assert.equal(intent.intent, 'SUMMARY');
        assert.equal(intent.date_range.type, 'YESTERDAY');
        assert.equal(intent.aggregation, 'SUM');
      },
    },
    {
      input: 'เดือนนี้มีรายจ่ายกี่รายการ',
      verify: (intent: QueryIntent | null) => {
        assert(intent !== null, 'Must parse as valid query');
        assert.equal(intent.intent, 'COUNT');
        assert.equal(intent.date_range.type, 'CURRENT_MONTH');
        assert.equal(intent.aggregation, 'COUNT');
      },
    },
    {
      input: 'สวัสดีครับ',
      verify: (intent: QueryIntent | null) => {
        assert.equal(intent, null, 'Non-query greeting must return null');
      },
    },
    {
      input: 'สวัสดี',
      verify: (intent: QueryIntent | null) => {
        assert.equal(intent, null, 'Greeting must return null');
      },
    },
    {
      input: 'หวัดดี',
      verify: (intent: QueryIntent | null) => {
        assert.equal(intent, null, 'Greeting must return null');
      },
    },
    {
      input: 'กินข้าว 50',
      verify: (intent: QueryIntent | null) => {
        assert.equal(intent, null, 'Standard transaction logging input must return null');
      },
    },
  ];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const parsed = await parseQueryIntent(c.input, refDate);
    console.log(`Debug [${i + 1}] "${c.input}":`, JSON.stringify(parsed));
    c.verify(parsed);
    console.log(`   ✅ [${i + 1}/${cases.length}] "${c.input}" -> intent validated.`);
  }

  console.log('\n====================================================');
  console.log('🎉 ALL Q1 QUERY INTENT CONTRACT TESTS PASSED 100%!');
  console.log('====================================================\n');
}

runQueryIntentContractTests().catch((err) => {
  console.error('❌ Q1 Contract Test Failed:', err);
  process.exit(1);
});
