import assert from 'node:assert/strict';
import { parseNaturalThaiDate, normalizeYear, isValidDateComponents } from '../src/utils/date';

function runDateParserTests() {
  console.log('====================================================');
  console.log('🧪 Testing Conversational Natural Thai Date Parser');
  console.log('====================================================');

  const refDate = new Date('2026-08-21T12:00:00+07:00'); // Bangkok reference time (Year 2026 / 2569)

  // 1. Relative keywords
  assert.equal(parseNaturalThaiDate('วันนี้', refDate), '2026-08-21');
  assert.equal(parseNaturalThaiDate('today', refDate), '2026-08-21');
  assert.equal(parseNaturalThaiDate('เมื่อวาน', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('เมื่อวานนี้', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('yesterday', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('พรุ่งนี้', refDate), '2026-08-22');
  assert.equal(parseNaturalThaiDate('tomorrow', refDate), '2026-08-22');
  console.log('✅ 1. Relative keywords passed.');

  // 2. Numeric without year (defaults to current year 2026)
  assert.equal(parseNaturalThaiDate('17/8', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17-8', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17/08', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17-08', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17.8', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('5/5', refDate), '2026-05-05');
  console.log('✅ 2. Numeric without year (current year default) passed.');

  // 3. Thai month without year (defaults to current year 2026)
  assert.equal(parseNaturalThaiDate('17 สิงหาคม', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17 สิงหา', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17 ส.ค.', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17 ส.ค', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('วันที่ 17 สิงหาคม', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('วันที่ 17 ส.ค.', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('1 มกราคม', refDate), '2026-01-01');
  assert.equal(parseNaturalThaiDate('1 ม.ค.', refDate), '2026-01-01');
  assert.equal(parseNaturalThaiDate('14 กุมภา', refDate), '2026-02-14');
  assert.equal(parseNaturalThaiDate('31 ธ.ค.', refDate), '2026-12-31');
  assert.equal(parseNaturalThaiDate('31 ธันวา', refDate), '2026-12-31');
  console.log('✅ 3. Thai month without year passed.');

  // 4. Formats with explicit year (4-digit and 2-digit, CE and BE)
  assert.equal(parseNaturalThaiDate('17/8/2026', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17/8/2569', refDate), '2026-08-17', '4-digit BE 2569 -> 2026');
  assert.equal(parseNaturalThaiDate('17/8/26', refDate), '2026-08-17', '2-digit CE 26 -> 2026');
  assert.equal(parseNaturalThaiDate('17/8/69', refDate), '2026-08-17', '2-digit BE 69 -> 2026');
  assert.equal(parseNaturalThaiDate('17-8-69', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17.8.69', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17 สิงหาคม 2569', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17 สิงหาคม 69', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17 สิงหาคม 2026', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17 สิงหาคม 26', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17 ส.ค. 69', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17 ส.ค. 2569', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('2026-08-17', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('2569-08-17', refDate), '2026-08-17');
  console.log('✅ 4. Formats with explicit year (4-digit & 2-digit, CE & BE) passed.');

  // 5. Invalid / Ambiguous inputs (must be rejected safely)
  assert.equal(parseNaturalThaiDate('32/8', refDate), null, 'Day 32 must be rejected');
  assert.equal(parseNaturalThaiDate('31/2', refDate), null, 'Feb 31 must be rejected');
  assert.equal(parseNaturalThaiDate('29/2/2026', refDate), null, 'Feb 29 in non-leap year must be rejected');
  assert.equal(parseNaturalThaiDate('13/13', refDate), null, 'Month 13 must be rejected');
  assert.equal(parseNaturalThaiDate('วันที่ 17', refDate), null, 'Bare day without month must be rejected');
  assert.equal(parseNaturalThaiDate('17', refDate), null, 'Bare number 17 must be rejected');
  assert.equal(parseNaturalThaiDate('', refDate), null);
  assert.equal(parseNaturalThaiDate('random non-date text', refDate), null);
  console.log('✅ 5. Invalid and ambiguous inputs rejected safely.');

  // 6. Year normalization unit tests
  assert.equal(normalizeYear('2569', 2026), 2026);
  assert.equal(normalizeYear('2026', 2026), 2026);
  assert.equal(normalizeYear('69', 2026), 2026);
  assert.equal(normalizeYear('26', 2026), 2026);
  assert.equal(normalizeYear('67', 2026), 2024);
  assert.equal(normalizeYear('24', 2026), 2024);
  console.log('✅ 6. Year normalization unit assertions passed.');

  console.log('\n🎉 ALL CONVERSATIONAL THAI DATE PARSER TESTS PASSED SUCCESSFULLY!\n');
}

runDateParserTests();
