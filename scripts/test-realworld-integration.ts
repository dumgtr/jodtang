import assert from 'node:assert/strict';
import { query, pool } from '../src/db/client';
import { env } from '../src/config/env';
import { assertTestDatabaseConnection } from '../src/db/test-isolation';
import { UserRepository } from '../src/modules/user/user.repository';
import { DraftRepository } from '../src/modules/draft/draft.repository';
import { TransactionRepository } from '../src/modules/transaction/transaction.repository';
import { handleTextMessage } from '../src/handlers/message.handler';

assertTestDatabaseConnection(env.DATABASE_URL);

type MockReply = {
  replyToken: string;
  messages: Array<{ type: string; text?: string; altText?: string; contents?: any; quickReply?: any }>;
};

const Q5_REFERENCE_DATE = '2026-08-21';

function createMockLineClient(replies: MockReply[]) {
  return {
    replyMessage: async (reply: MockReply) => {
      replies.push(reply);
    },
  } as any;
}

async function runRealWorldIntegrationTests() {
  console.log('====================================================');
  console.log('🧪 JodTang Q5: Real-World Integration Test Suite');
  console.log('====================================================\n');

  // Setup isolated test users
  const lineUserA = 'U_Q5_INTEGRATION_USER_A';
  const lineUserB = 'U_Q5_INTEGRATION_USER_B';

  const userA = await UserRepository.findOrCreateByLineUserId(lineUserA);
  const userB = await UserRepository.findOrCreateByLineUserId(lineUserB);

  // Clean existing fixtures
  await query(`DELETE FROM transaction_drafts WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM transactions WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM audit_logs WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);

  console.log('1. Setting up Test Fixtures for User A and User B in PostgreSQL...');

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

  // User A August 2026 transactions
  await insertTx(userA.id, 'expense', 780, 'อาหารและเครื่องดื่ม', 'MK', 'พาลูกไปกิน MK', '2026-08-21');
  await insertTx(userA.id, 'expense', 1250, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'Lotus', 'ซื้อของเข้าบ้าน', '2026-08-20');
  await insertTx(userA.id, 'expense', 399, 'อาหารและเครื่องดื่ม', 'ชาบู', 'กินชาบู', '2026-08-19');
  await insertTx(userA.id, 'expense', 1000, 'การเดินทาง/ยานพาหนะ', 'ปตท', 'เติมน้ำมัน', '2026-08-17');
  await insertTx(userA.id, 'expense', 1450, 'บิล/ค่าใช้จ่าย/สาธารณูปโภค', 'การไฟฟ้านครหลวง', 'จ่ายค่าไฟ', '2026-08-12');
  await insertTx(userA.id, 'expense', 500, 'อาหารและเครื่องดื่ม', 'MK', 'กินข้าวกลางวัน', '2026-08-05');
  await insertTx(userA.id, 'expense', 200, 'อาหารและเครื่องดื่ม', 'กาแฟ', 'กาแฟสด', '2026-08-01');
  await insertTx(userA.id, 'income', 35000, 'รายรับ/เงินเดือน/ธุรกิจ', 'บริษัท', 'เงินเดือน', '2026-08-21');
  await insertTx(userA.id, 'transfer', 3000, 'โอนเงิน/ทั่วไป', 'แม่', 'โอนให้แม่', '2026-08-21');
  await insertTx(userA.id, 'expense', 9999, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'Apple', 'ซื้อ iPhone (Voided)', '2026-08-15', 'voided'); // Voided

  // User B transaction (Isolation guard)
  await insertTx(userB.id, 'expense', 50000, 'อาหารและเครื่องดื่ม', 'UserBStore', 'ของ User B', '2026-08-21');

  console.log('   ✅ Test fixtures ready.\n');

  // Count initial drafts
  const initialDraftsCount = async (userId: string) => {
    const res = await query(`SELECT COUNT(id)::int AS count FROM transaction_drafts WHERE user_id = $1;`, [userId]);
    return res.rows[0].count;
  };

  // ----------------------------------------------------
  // Test A: Monthly Summary Query ("เดือนนี้ใช้เงินไปเท่าไร")
  // ----------------------------------------------------
  console.log('2. [Test A] Query: "เดือนนี้ใช้เงินไปเท่าไร"...');
  const repliesA: MockReply[] = [];
  const clientA = createMockLineClient(repliesA);
  const draftsBeforeA = await initialDraftsCount(userA.id);

  await handleTextMessage(lineUserA, 'เดือนนี้ใช้เงินไปเท่าไร', 'TOKEN_A', clientA, Q5_REFERENCE_DATE);

  assert.equal(repliesA.length, 1);
  const textA = repliesA[0].messages[0].text || '';
  assert(textA.includes('5,579 บาท'), `Expected 5,579 บาท in summary, got: ${textA}`);
  assert(textA.includes('7 รายการ'), `Expected 7 รายการ in summary, got: ${textA}`);
  const draftsAfterA = await initialDraftsCount(userA.id);
  assert.equal(draftsAfterA, draftsBeforeA, 'Query Path MUST NOT create any draft records!');
  console.log('   ✅ Test A Passed (Read-only, exact ฿5,579 sum rendered).\n');

  // ----------------------------------------------------
  // Test B: Category Filtered Query ("เดือนนี้กินข้าวไปเท่าไร")
  // ----------------------------------------------------
  console.log('3. [Test B] Category Query: "เดือนนี้กินข้าวไปเท่าไร"...');
  const repliesB: MockReply[] = [];
  const clientB = createMockLineClient(repliesB);

  await handleTextMessage(lineUserA, 'เดือนนี้กินข้าวไปเท่าไร', 'TOKEN_B', clientB, Q5_REFERENCE_DATE);

  assert.equal(repliesB.length, 1);
  const textB = repliesB[0].messages[0].text || '';
  assert(textB.includes('1,879 บาท'), `Expected 1,879 บาท, got: ${textB}`);
  console.log('   ✅ Test B Passed (Category filtered summary rendered).\n');

  // ----------------------------------------------------
  // Test C: Ranking Query ("เดือนนี้ร้านไหนใช้เงินเยอะที่สุด")
  // ----------------------------------------------------
  console.log('4. [Test C] Ranking Query: "เดือนนี้ร้านไหนใช้เงินเยอะที่สุด"...');
  const repliesC: MockReply[] = [];
  const clientC = createMockLineClient(repliesC);

  await handleTextMessage(lineUserA, 'เดือนนี้ร้านไหนใช้เงินเยอะที่สุด', 'TOKEN_C', clientC, Q5_REFERENCE_DATE);

  assert.equal(repliesC.length, 1);
  const textC = repliesC[0].messages[0].text || '';
  assert(textC.includes('🥇') || textC.includes('อันดับ'), `Expected ranking badges, got: ${textC}`);
  assert(textC.includes('การไฟฟ้านครหลวง'), `Expected top merchant MEA, got: ${textC}`);
  assert(textC.includes('1,450 บาท'), `Expected 1,450 บาท, got: ${textC}`);
  console.log('   ✅ Test C Passed (Top merchant ranking with badges rendered).\n');

  // ----------------------------------------------------
  // Test D: Listing Query ("อาทิตย์นี้มีค่าใช้จ่ายอะไรบ้าง")
  // ----------------------------------------------------
  console.log('5. [Test D] Listing Query: "อาทิตย์นี้มีค่าใช้จ่ายอะไรบ้าง"...');
  const repliesD: MockReply[] = [];
  const clientD = createMockLineClient(repliesD);

  await handleTextMessage(lineUserA, 'อาทิตย์นี้มีค่าใช้จ่ายอะไรบ้าง', 'TOKEN_D', clientD, Q5_REFERENCE_DATE);

  assert.equal(repliesD.length, 1);
  const textD = repliesD[0].messages[0].text || '';
  assert(textD.includes('รายการ'), `Expected itemized header, got: ${textD}`);
  assert(textD.includes('3,429 บาท'), `Expected weekly total 3,429 บาท, got: ${textD}`);
  console.log('   ✅ Test D Passed (Weekly itemized listing rendered).\n');

  // ----------------------------------------------------
  // Test E: Count Query ("เดือนนี้มีรายจ่ายกี่รายการ")
  // ----------------------------------------------------
  console.log('6. [Test E] Count Query: "เดือนนี้มีรายจ่ายกี่รายการ"...');
  const repliesE: MockReply[] = [];
  const clientE = createMockLineClient(repliesE);

  await handleTextMessage(lineUserA, 'เดือนนี้มีรายจ่ายกี่รายการ', 'TOKEN_E', clientE, Q5_REFERENCE_DATE);

  assert.equal(repliesE.length, 1);
  const textE = repliesE[0].messages[0].text || '';
  assert(textE.includes('7'), `Expected 7 count, got: ${textE}`);
  console.log('   ✅ Test E Passed (Transaction count rendered).\n');

  // ----------------------------------------------------
  // Test F: Income Query ("เดือนนี้มีรายรับเท่าไร")
  // ----------------------------------------------------
  console.log('7. [Test F] Income Query: "เดือนนี้มีรายรับเท่าไร"...');
  const repliesF: MockReply[] = [];
  const clientF = createMockLineClient(repliesF);

  await handleTextMessage(lineUserA, 'เดือนนี้มีรายรับเท่าไร', 'TOKEN_F', clientF, Q5_REFERENCE_DATE);

  assert.equal(repliesF.length, 1);
  const textF = repliesF[0].messages[0].text || '';
  assert(textF.includes('35,000 บาท'), `Expected 35,000 บาท, got: ${textF}`);
  assert(textF.includes('รายรับ'), `Expected income label, got: ${textF}`);
  console.log('   ✅ Test F Passed (Income summary rendered).\n');

  // ----------------------------------------------------
  // Test G: Transfer Query ("เดือนนี้โอนเงินไปเท่าไร")
  // ----------------------------------------------------
  console.log('8. [Test G] Transfer Query: "เดือนนี้โอนเงินไปเท่าไร"...');
  const repliesG: MockReply[] = [];
  const clientG = createMockLineClient(repliesG);

  await handleTextMessage(lineUserA, 'เดือนนี้โอนเงินไปเท่าไร', 'TOKEN_G', clientG, Q5_REFERENCE_DATE);

  assert.equal(repliesG.length, 1);
  const textG = repliesG[0].messages[0].text || '';
  assert(textG.includes('3,000 บาท'), `Expected 3,000 บาท, got: ${textG}`);
  assert(textG.includes('โอน'), `Expected transfer label, got: ${textG}`);
  console.log('   ✅ Test G Passed (Transfer summary rendered).\n');

  // ----------------------------------------------------
  // Test H: Normal Transaction ("กินข้าว 500") -> WRITE PATH!
  // ----------------------------------------------------
  console.log('9. [Test H] Normal Transaction: "กินข้าว 500" (WRITE PATH)...');
  const repliesH: MockReply[] = [];
  const clientH = createMockLineClient(repliesH);
  const draftsBeforeH = await initialDraftsCount(userA.id);

  await handleTextMessage(lineUserA, 'กินข้าว 500', 'TOKEN_H', clientH, Q5_REFERENCE_DATE);

  assert.equal(repliesH.length, 1);
  const replyH = repliesH[0].messages[0];
  // Normal transaction should send a flex message (or carousel)
  assert.equal(replyH.type, 'flex', `Normal transaction must return Flex confirmation, got: ${replyH.type}`);
  const draftsAfterH = await initialDraftsCount(userA.id);
  assert.equal(draftsAfterH, draftsBeforeH + 1, 'Write Path MUST create exactly 1 pending draft in DB!');
  console.log('   ✅ Test H Passed (Transaction successfully routed to Write Path, draft created).\n');

  // ----------------------------------------------------
  // Test I: Greeting / Non-query ("สวัสดีครับ")
  // ----------------------------------------------------
  console.log('10. [Test I] Greeting / Non-query: "สวัสดีครับ"...');
  const repliesI: MockReply[] = [];
  const clientI = createMockLineClient(repliesI);
  const draftsBeforeI = await initialDraftsCount(userA.id);

  await handleTextMessage(lineUserA, 'สวัสดีครับ', 'TOKEN_I', clientI, Q5_REFERENCE_DATE);

  assert.equal(repliesI.length, 1);
  const textI = repliesI[0].messages[0].text || '';
  assert(textI.includes('สวัสดีครับ'), `Expected greeting guide, got: ${textI}`);
  const draftsAfterI = await initialDraftsCount(userA.id);
  assert.equal(draftsAfterI, draftsBeforeI, 'Greeting must NOT create drafts!');
  console.log('   ✅ Test I Passed (Greeting safely routed, zero drafts created).\n');

  // ----------------------------------------------------
  // Test J: Voided Transaction Exclusion
  // ----------------------------------------------------
  console.log('11. [Test J] Voided Transaction Exclusion (Apple ฿9,999)...');
  const repliesJ: MockReply[] = [];
  const clientJ = createMockLineClient(repliesJ);

  await handleTextMessage(lineUserA, 'เดือนนี้ซื้อของที่ Apple เท่าไร', 'TOKEN_J', clientJ, Q5_REFERENCE_DATE);

  assert.equal(repliesJ.length, 1);
  const textJ = repliesJ[0].messages[0].text || '';
  assert(textJ.includes('ไม่พบรายการ') || textJ.includes('0 บาท'), `Voided tx must not appear, got: ${textJ}`);
  console.log('   ✅ Test J Passed (Voided transactions strictly excluded from summaries).\n');

  // ----------------------------------------------------
  // Test K: Multi-Tenant User Isolation
  // ----------------------------------------------------
  console.log('12. [Test K] Multi-Tenant User Isolation (User B cannot see User A)...');
  const repliesK: MockReply[] = [];
  const clientK = createMockLineClient(repliesK);

  await handleTextMessage(lineUserB, 'เดือนนี้ใช้เงินไปเท่าไร', 'TOKEN_K', clientK, Q5_REFERENCE_DATE);

  assert.equal(repliesK.length, 1);
  const textK = repliesK[0].messages[0].text || '';
  assert(textK.includes('50,000 บาท'), `User B must see only 50,000 บาท, got: ${textK}`);
  assert(!textK.includes('5,579'), `User B must NEVER see User A data!`);
  console.log('   ✅ Test K Passed (100% User Isolation verified).\n');

  // Clean test fixtures
  await query(`DELETE FROM transaction_drafts WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM transactions WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM audit_logs WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);

  console.log('====================================================');
  console.log('🎉 ALL Q5 REAL-WORLD INTEGRATION TESTS PASSED 100%!');
  console.log('====================================================\n');
}

runRealWorldIntegrationTests().catch((err) => {
  console.error('❌ Q5 Integration Test Failed:', err);
  process.exit(1);
});
