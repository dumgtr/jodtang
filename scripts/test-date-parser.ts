import assert from 'node:assert/strict';
import { parseNaturalThaiDate, normalizeYear } from '../src/utils/date';

function runDateParserTests() {
  console.log('====================================================');
  console.log('🧪 Testing Conversational Natural Thai Date Parser');
  console.log('====================================================');

  const refDate = new Date('2026-08-21T12:00:00+07:00'); // Bangkok reference time (August 2026 / 2569)

  // 1. Relative keywords
  assert.equal(parseNaturalThaiDate('วันนี้', refDate), '2026-08-21');
  assert.equal(parseNaturalThaiDate('today', refDate), '2026-08-21');
  assert.equal(parseNaturalThaiDate('เมื่อวาน', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('เมื่อวานนี้', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('yesterday', refDate), '2026-08-20');
  assert.equal(parseNaturalThaiDate('พรุ่งนี้', refDate), '2026-08-22');
  assert.equal(parseNaturalThaiDate('tomorrow', refDate), '2026-08-22');
  console.log('✅ 1. Relative keywords passed.');

  // 2. "วันที่ + วัน" without month/year (defaults to current month August and current year 2026)
  assert.equal(parseNaturalThaiDate('วันที่ 19', refDate), '2026-08-19');
  assert.equal(parseNaturalThaiDate('วันที่19', refDate), '2026-08-19');
  assert.equal(parseNaturalThaiDate('วันที่ 1', refDate), '2026-08-01');
  assert.equal(parseNaturalThaiDate('วันที่ 31', refDate), '2026-08-31', 'August has 31 days -> valid');

  const refDateApril = new Date('2026-04-15T12:00:00+07:00'); // April has 30 days
  assert.equal(parseNaturalThaiDate('วันที่ 31', refDateApril), null, 'April has only 30 days -> day 31 must be rejected');
  assert.equal(parseNaturalThaiDate('วันที่ 30', refDateApril), '2026-04-30');

  assert.equal(parseNaturalThaiDate('วันที่ 32', refDate), null, 'Day 32 must be rejected');
  assert.equal(parseNaturalThaiDate('วันที่ 0', refDate), null, 'Day 0 must be rejected');
  assert.equal(parseNaturalThaiDate('19', refDate), null, 'Bare number 19 must be rejected (ambiguity guard)');
  console.log('✅ 2. "วันที่ + วัน" with current month/year defaults passed.');

  // 3. Numeric without year (defaults to current year 2026)
  assert.equal(parseNaturalThaiDate('17/8', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17-8', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17/08', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17-08', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('17.8', refDate), '2026-08-17');
  assert.equal(parseNaturalThaiDate('5/5', refDate), '2026-05-05');
  console.log('✅ 3. Numeric without year (current year default) passed.');

  // 4. Thai month without year (defaults to current year 2026)
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
  console.log('✅ 4. Thai month without year passed.');

  // 5. Formats with explicit year (4-digit and 2-digit, CE and BE)
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
  console.log('✅ 5. Formats with explicit year (4-digit & 2-digit, CE & BE) passed.');

  // 6. Invalid / Ambiguous inputs (must be rejected safely)
  assert.equal(parseNaturalThaiDate('32/8', refDate), null, 'Day 32 must be rejected');
  assert.equal(parseNaturalThaiDate('31/2', refDate), null, 'Feb 31 must be rejected');
  assert.equal(parseNaturalThaiDate('29/2/2026', refDate), null, 'Feb 29 in non-leap year must be rejected');
  assert.equal(parseNaturalThaiDate('13/13', refDate), null, 'Month 13 must be rejected');
  assert.equal(parseNaturalThaiDate('17', refDate), null, 'Bare number 17 must be rejected');
  assert.equal(parseNaturalThaiDate('', refDate), null);
  assert.equal(parseNaturalThaiDate('random non-date text', refDate), null);
  console.log('✅ 6. Invalid and ambiguous inputs rejected safely.');

  // 7. Year normalization unit tests
  assert.equal(normalizeYear('2569', 2026), 2026);
  assert.equal(normalizeYear('2026', 2026), 2026);
  assert.equal(normalizeYear('69', 2026), 2026);
  assert.equal(normalizeYear('26', 2026), 2026);
  assert.equal(normalizeYear('67', 2026), 2024);
  assert.equal(normalizeYear('24', 2026), 2024);
  console.log('✅ 7. Year normalization unit assertions passed.');

  console.log('\n🎉 ALL CONVERSATIONAL THAI DATE PARSER TESTS PASSED SUCCESSFULLY!\n');
}

runDateParserTests();
