import assert from 'node:assert/strict';
import { extractTransactions } from '../src/services/ai.service';
import { env } from '../src/config/env';

async function runProductionSmokeTest() {
  console.log('====================================================');
  console.log('🧪 JodTang Production Smoke Test with deepseek-v4-flash');
  console.log('====================================================');
  console.log(`Base URL: ${env.OPENAI_BASE_URL}`);
  console.log(`Model:    ${env.OPENAI_MODEL}`);
  console.log('----------------------------------------------------\n');

  const refDate = '2026-08-21';

  const testCases = [
    {
      name: 'Case 1: Natural restaurant expense with yesterday date',
      input: 'เมื่อวานพาลูกไปกิน MK 780 บาท',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 1);
        assert.equal(txs[0].amount, 780);
        assert.equal(txs[0].category, 'อาหารและเครื่องดื่ม');
        assert.equal(txs[0].type, 'EXPENSE');
        assert.equal(txs[0].date, '2026-08-20');
        assert(txs[0].merchant.toLowerCase().includes('mk'));
      },
    },
    {
      name: 'Case 2: Shopping with comma number',
      input: 'ซื้อของเข้าบ้านที่ Lotus 1,250 บาท',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 1);
        assert.equal(txs[0].amount, 1250);
        assert.equal(txs[0].category, 'ช้อปปิ้ง/ของใช้/อุปกรณ์');
        assert.equal(txs[0].type, 'EXPENSE');
        assert(txs[0].merchant.toLowerCase().includes('lotus'));
      },
    },
    {
      name: 'Case 3: Transportation and fuel',
      input: 'เติมน้ำมัน ปตท 1,000',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 1);
        assert.equal(txs[0].amount, 1000);
        assert.equal(txs[0].category, 'การเดินทาง/ยานพาหนะ');
        assert.equal(txs[0].type, 'EXPENSE');
      },
    },
    {
      name: 'Case 4: Date input "วันที่ 19"',
      input: 'วันที่ 19 กินชาบู 399',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 1);
        assert.equal(txs[0].amount, 399);
        assert.equal(txs[0].category, 'อาหารและเครื่องดื่ม');
        assert.equal(txs[0].date, '2026-08-19');
      },
    },
    {
      name: 'Case 5: Utility bill payment',
      input: 'จ่ายค่าไฟ 1,450 บาท',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 1);
        assert.equal(txs[0].amount, 1450);
        assert.equal(txs[0].category, 'บิล/ค่าใช้จ่าย/สาธารณูปโภค');
        assert.equal(txs[0].type, 'EXPENSE');
      },
    },
    {
      name: 'Case 6: Money Transfer to mother',
      input: 'โอนเงินให้แม่ 3,000',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 1);
        assert.equal(txs[0].amount, 3000);
        assert.equal(txs[0].category, 'โอนเงิน/ทั่วไป');
        assert.equal(txs[0].type, 'TRANSFER');
      },
    },
    {
      name: 'Case 7: Monthly Salary Income',
      input: 'ได้เงินเดือน 35,000 บาท',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 1);
        assert.equal(txs[0].amount, 35000);
        assert.equal(txs[0].category, 'รายรับ/เงินเดือน/ธุรกิจ');
        assert.equal(txs[0].type, 'INCOME');
      },
    },
    {
      name: 'Case 8: Thai month date with shopping brand',
      input: '17 สิงหา ซื้อเสื้อ Uniqlo 790',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 1);
        assert.equal(txs[0].amount, 790);
        assert.equal(txs[0].category, 'ช้อปปิ้ง/ของใช้/อุปกรณ์');
        assert.equal(txs[0].date, '2026-08-17');
        assert(txs[0].merchant.toLowerCase().includes('uniqlo'));
      },
    },
    {
      name: 'Case 9: Multi-item transaction extraction',
      input: 'กินข้าว 200 \n ล้างรถ 300',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 2);
        assert.equal(txs[0].amount, 200);
        assert.equal(txs[0].category, 'อาหารและเครื่องดื่ม');
        assert.equal(txs[1].amount, 300);
        assert.equal(txs[1].category, 'การเดินทาง/ยานพาหนะ');
      },
    },
    {
      name: 'Case 10: Non-financial greeting (Must extract 0 items)',
      input: 'สวัสดีครับ',
      validate: (txs: any[]) => {
        assert.equal(txs.length, 0, 'Non-financial text must return empty array');
      },
    },
  ];

  let passed = 0;
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const startTime = Date.now();
    try {
      const txs = await extractTransactions(tc.input, refDate);
      tc.validate(txs);
      const duration = Date.now() - startTime;
      console.log(`✅ [${i + 1}/10] ${tc.name} (${duration}ms)`);
      console.log(`   Input:    "${tc.input}"`);
      console.log(`   Output:   ${JSON.stringify(txs)}\n`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [${i + 1}/10] ${tc.name} FAILED!`);
      console.error(`   Input: "${tc.input}"`);
      console.error(`   Error:`, err.message || err);
      process.exit(1);
    }
  }

  console.log('====================================================');
  console.log(`🎉 ALL ${passed}/10 PRODUCTION SMOKE TESTS PASSED WITH DEEPSEEK-V4-FLASH!`);
  console.log('====================================================\n');
}

runProductionSmokeTest().catch((err) => {
  console.error('Smoke test error:', err);
  process.exit(1);
});
