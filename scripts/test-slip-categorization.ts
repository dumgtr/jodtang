import assert from 'node:assert/strict';
import { ALLOWED_CATEGORIES } from '../src/services/ai.service';
import { resolveSlipCategory, SlipCategorizationInput } from '../src/modules/slip/slip.service';

async function runSlipCategorizationTests() {
  console.log('====================================================');
  console.log('🧪 Testing Slip Categorization & Decision Tree Suite');
  console.log('====================================================\n');

  function assertValidCategory(category: string, expected: string, label: string) {
    assert.equal(
      category,
      expected,
      `[${label}] Expected "${expected}" but got "${category}"`
    );
    assert(
      (ALLOWED_CATEGORIES as readonly string[]).includes(category),
      `[${label}] Category "${category}" is not in ALLOWED_CATEGORIES!`
    );
  }

  // ----------------------------------------------------
  // 1. Food & Beverage Merchants
  // ----------------------------------------------------
  console.log('1. Testing verified Food & Beverage merchants...');
  const foodCases = [
    'STARBUCKS COFFEE',
    'Starbucks',
    'Cafe Amazon',
    'คาเฟ่ อเมซอน',
    'KFC',
    'McDonald\'s',
    'MK Restaurant',
    'Bar B Q Plaza',
    'Shabushi',
    'ชาตรามือ (ChaTraMue)',
    'ร้านอาหารครัวเจ๊ง้อ',
    'ร้านก๋วยเตี๋ยวเรืออยุธยา',
    'ข้าวมันไก่โกอ่าง ประตูน้ำ',
    'ส้มตำเจ๊น้อย ข้าวเหนียวไก่ย่าง',
  ];

  for (const merchant of foodCases) {
    const cat = resolveSlipCategory(merchant);
    assertValidCategory(cat, 'อาหารและเครื่องดื่ม', `Food: ${merchant}`);
  }
  console.log(`   ✅ All ${foodCases.length} Food & Beverage merchants correctly categorized.`);

  // ----------------------------------------------------
  // 2. Individual Persons (Person Guard - Anti-False-Positive)
  // ----------------------------------------------------
  console.log('2. Testing Individual Persons (Must NOT be Food & Beverage)...');
  const personCases: Array<{ input: string | SlipCategorizationInput; label: string }> = [
    { input: 'นาย ชาญชัย สุขใจ', label: 'Person with ชา (ชาญชัย)' },
    { input: 'น.ส. กานต์พิชชา รัตนวงศ์', label: 'Person with ชา (กานต์พิชชา)' },
    { input: 'นาย ชาคริต จันทร', label: 'Person with ชา (ชาคริต)' },
    { input: 'นาย บิลลี่ พูลผล', label: 'Person with บิล (บิลลี่)' },
    { input: 'น.ส. ข้าวสวย มณีรัตน์', label: 'Person with ข้าว (ข้าวสวย)' },
    { input: 'นาง ชาบู บุญส่ง', label: 'Person with ชาบู (ชาบู บุญส่ง)' },
    { input: 'นาย ป้อม สุขภาพดี', label: 'Person with สุขภาพ (นาย ป้อม)' },
    { input: 'MR. JOHN DOE', label: 'English Mr. title' },
    { input: 'MISS MARY JANE', label: 'English Miss title' },
    { input: 'พระครูวิมลคุณากร', label: 'Monk title (พระครู)' },
    {
      input: {
        merchantName: 'สมชาย แสงจันทร์',
        rawPayload: { receiver: { proxy: { type: 'NATID' } } },
      },
      label: 'Citizen ID (NATID) without title',
    },
  ];

  for (const { input, label } of personCases) {
    const cat = resolveSlipCategory(input);
    assert.notEqual(
      cat,
      'อาหารและเครื่องดื่ม',
      `[${label}] MUST NOT be categorized as Food & Beverage!`
    );
    assert.notEqual(
      cat,
      'บิล/ค่าใช้จ่าย/สาธารณูปโภค',
      `[${label}] MUST NOT be categorized as Bills!`
    );
    assertValidCategory(cat, 'โอนเงิน/ทั่วไป', label);
  }
  console.log(`   ✅ All ${personCases.length} individual persons safely mapped to โอนเงิน/ทั่วไป.`);

  // ----------------------------------------------------
  // 3. Banks & Credit Cards & Financial Institutions
  // ----------------------------------------------------
  console.log('3. Testing Banks & Credit Cards (Must NOT be Food & Beverage)...');
  const financialCases = [
    { name: 'ธนาคารกสิกรไทย จำกัด (มหาชน)', expected: 'โอนเงิน/ทั่วไป', label: 'Bank Transfer' },
    { name: 'ธนาคารไทยพาณิชย์', expected: 'โอนเงิน/ทั่วไป', label: 'Bank Transfer' },
    { name: 'บัตรเครดิตกรุงศรีอยุธยา', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค', label: 'Credit Card' },
    { name: 'บมจ. อิออน ธนสินทรัพย์', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค', label: 'Aeon Loan/Card' },
    { name: 'อีซี่บาย (ยูเมะพลัส)', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค', label: 'Umay+ Loan' },
    { name: 'เมืองไทย แคปปิตอล', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค', label: 'MTC Loan' },
    { name: 'เงินติดล้อ', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค', label: 'TIDLOR Loan' },
  ];

  for (const { name, expected, label } of financialCases) {
    const cat = resolveSlipCategory(name);
    assert.notEqual(
      cat,
      'อาหารและเครื่องดื่ม',
      `[${label}: ${name}] MUST NOT be Food & Beverage!`
    );
    assertValidCategory(cat, expected, `${label}: ${name}`);
  }
  console.log(`   ✅ All ${financialCases.length} financial institutions safely categorized.`);

  // ----------------------------------------------------
  // 4. Utilities, Telecom, Taxes, and Billers
  // ----------------------------------------------------
  console.log('4. Testing Utilities & Billers...');
  const billerCases = [
    { name: 'การไฟฟ้านครหลวง (MEA)', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค' },
    { name: 'การไฟฟ้าส่วนภูมิภาค (PEA)', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค' },
    { name: 'การประปานครหลวง', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค' },
    { name: 'บจก. ทรู ดิสทริบิวชั่นส์ แอนด์ โลจิสติกส์', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค' },
    { name: 'บมจ. แอดวานซ์ อินโฟร์ เซอร์วิส (AIS)', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค' },
    { name: '3BB Triple T Broadband', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค' },
    { name: 'กรมสรรพากร (Tax)', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค' },
    { name: 'สำนักงานประกันสังคม', expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค' },
    {
      name: {
        merchantName: 'Unknown Enterprise Biller',
        rawPayload: { receiver: { proxy: { type: 'BILLERID' } } },
      },
      expected: 'บิล/ค่าใช้จ่าย/สาธารณูปโภค',
    },
  ];

  for (const { name, expected } of billerCases) {
    const cat = resolveSlipCategory(name as any);
    const label = typeof name === 'string' ? name : name.merchantName;
    assertValidCategory(cat, expected, `Biller: ${label}`);
  }
  console.log(`   ✅ All ${billerCases.length} billers correctly mapped to บิล/ค่าใช้จ่าย/สาธารณูปโภค.`);

  // ----------------------------------------------------
  // 5. Transportation & Vehicle & Fuel
  // ----------------------------------------------------
  console.log('5. Testing Transportation & Fuel...');
  const transitCases = [
    'บริษัท ปตท. น้ำมันและการค้าปลีก จำกัด (มหาชน)',
    'สถานีบริการน้ำมัน บางจาก',
    'Shell Station',
    'Caltex',
    'BTS Skytrain',
    'MRT รถไฟฟ้ากรุงเทพ',
    'Grab Taxi',
    'Bolt Thailand',
    'การทางพิเศษแห่งประเทศไทย (Easy Pass)',
    'สมบัติทัวร์',
    'Thai AirAsia',
  ];

  for (const merchant of transitCases) {
    const cat = resolveSlipCategory(merchant);
    assertValidCategory(cat, 'การเดินทาง/ยานพาหนะ', `Transit: ${merchant}`);
  }
  console.log(`   ✅ All ${transitCases.length} transit merchants mapped to การเดินทาง/ยานพาหนะ.`);

  // ----------------------------------------------------
  // 6. Shopping & Retail
  // ----------------------------------------------------
  console.log('6. Testing Shopping & Retail...');
  const shoppingCases = [
    '7-Eleven',
    'CP ALL (7-Eleven)',
    'Lotus\'s Go Fresh',
    'Big C Supercenter',
    'Central Department Store',
    'ShopeePay Thailand',
    'Lazada Thailand',
    'Watsons',
    'Boots Retail',
    'Uniqlo Thailand',
    'MR. D.I.Y. (Thailand)',
    'HomePro',
  ];

  for (const merchant of shoppingCases) {
    const cat = resolveSlipCategory(merchant);
    assertValidCategory(cat, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', `Shopping: ${merchant}`);
  }
  console.log(`   ✅ All ${shoppingCases.length} retail stores mapped to ช้อปปิ้ง/ของใช้/อุปกรณ์.`);

  // ----------------------------------------------------
  // 7. Health & Entertainment
  // ----------------------------------------------------
  console.log('7. Testing Health & Entertainment...');
  assertValidCategory(resolveSlipCategory('โรงพยาบาลกรุงเทพ'), 'สุขภาพ/ความงาม', 'Bangkok Hospital');
  assertValidCategory(resolveSlipCategory('คลินิกทันตกรรมสไมล์'), 'สุขภาพ/ความงาม', 'Dental Clinic');
  assertValidCategory(resolveSlipCategory('Major Cineplex'), 'ความบันเทิง/สังสรรค์', 'Major Cineplex');
  assertValidCategory(resolveSlipCategory('Netflix Thailand'), 'ความบันเทิง/สังสรรค์', 'Netflix');
  console.log('   ✅ Health and Entertainment verified.');

  // ----------------------------------------------------
  // 8. Ambiguous / Unknown / Empty Recipient
  // ----------------------------------------------------
  console.log('8. Testing Ambiguous & Fallback cases...');
  assertValidCategory(resolveSlipCategory('ร้านค้า/ผู้รับเงิน'), 'โอนเงิน/ทั่วไป', 'Default Fallback');
  assertValidCategory(resolveSlipCategory(''), 'โอนเงิน/ทั่วไป', 'Empty String');
  assertValidCategory(resolveSlipCategory('บริษัท สยามแกรนด์อินเตอร์เนชั่นแนล จำกัด'), 'โอนเงิน/ทั่วไป', 'Unclassified Corporate');
  assertValidCategory(resolveSlipCategory('หจก. รุ่งเรืองอนันต์'), 'โอนเงิน/ทั่วไป', 'Unclassified Partnership');
  console.log('   ✅ Ambiguous cases safely default to canonical โอนเงิน/ทั่วไป.');

  // ----------------------------------------------------
  // 9. Determinism Check (Consistency across 100 iterations)
  // ----------------------------------------------------
  console.log('9. Testing Determinism (100 repetitions)...');
  for (let i = 0; i < 100; i++) {
    const r1 = resolveSlipCategory('STARBUCKS COFFEE');
    assert.equal(r1, 'อาหารและเครื่องดื่ม');
    const r2 = resolveSlipCategory('นาย ชาญชัย สุขใจ');
    assert.equal(r2, 'โอนเงิน/ทั่วไป');
    const r3 = resolveSlipCategory('BTS Skytrain');
    assert.equal(r3, 'การเดินทาง/ยานพาหนะ');
  }
  console.log('   ✅ 100% Deterministic consistency verified.');

  // ----------------------------------------------------
  // 10. Backward Compatibility (string input vs object input)
  // ----------------------------------------------------
  console.log('10. Testing Signature Compatibility (string vs object)...');
  const catFromString = resolveSlipCategory('STARBUCKS COFFEE');
  const catFromObj = resolveSlipCategory({ merchantName: 'STARBUCKS COFFEE' });
  assert.equal(catFromString, catFromObj);
  console.log('   ✅ Backward compatibility verified.');

  console.log('\n====================================================');
  console.log('🎉 ALL SLIP CATEGORIZATION TEST SCENARIOS PASSED 100%!');
  console.log('====================================================\n');
}

runSlipCategorizationTests().catch((err) => {
  console.error('Categorization Test Suite Failed:', err);
  process.exit(1);
});
