import assert from 'node:assert/strict';
import { parseNaturalThaiDate } from '../src/utils/date';

function runDateParserTests() {
  console.log('====================================================');
  console.log('🧪 Testing Natural Thai Date Parser');
  console.log('====================================================');

  const refDate = new Date('2026-08-21T12:00:00+07:00');

  // 1. Relative keywords
  assert.equal(parseNaturalThaiDate('วันนี้', refDate), '2026-08-21');
  assert.equal(parseNaturalThaiDate('today', refDate), '2026-08-21');
  assert.equal(parseNaturalThaiDate('เมื่อวาน', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('เมื่อวานนี้', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('yesterday', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('พรุ่งนี้', refDate), '2026-08-22');
  assert.equal(parseNaturalThaiDate('tomorrow', refDate), '2026-08-22');
  console.log('✅ Relative keywords parsed correctly.');

  // 2. Format YYYY-MM-DD (CE and BE)
  assert.equal(parseNaturalThaiDate('2026-08-20', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('2026/08/20', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('2569-08-20', refDate), '2026-08-20', 'BE year 2569 must convert to CE 2026');
  assert.equal(parseNaturalThaiDate('2569/8/20', refDate), '2026-08-20');
  console.log('✅ YYYY-MM-DD (CE & BE) parsed correctly.');

  // 3. Format DD/MM/YYYY (CE and BE)
  assert.equal(parseNaturalThaiDate('20/08/2026', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('20/8/2026', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('5/5/2026', refDate), '2026-05-05');
  assert.equal(parseNaturalThaiDate('20/08/2569', refDate), '2026-08-20', 'BE DD/MM/YYYY must convert to CE YYYY-MM-DD');
  assert.equal(parseNaturalThaiDate('20/8/2569', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('20-08-2569', refDate), '2026-08-20');
  console.log('✅ DD/MM/YYYY (CE & BE) parsed correctly.');

  // 4. Invalid dates
  assert.equal(parseNaturalThaiDate(''), null);
  assert.equal(parseNaturalThaiDate('invalid_text'), null);
  assert.equal(parseNaturalThaiDate('32/01/2026'), null, 'Day 32 must be rejected');
  assert.equal(parseNaturalThaiDate('20/13/2026'), null, 'Month 13 must be rejected');
  console.log('✅ Invalid dates rejected safely.');

  console.log('\n🎉 ALL NATURAL THAI DATE PARSER TESTS PASSED!\n');
}

runDateParserTests();
