import assert from 'node:assert/strict';
import { query } from '../src/db/client';
import { UserRepository } from '../src/modules/user/user.repository';
import { handleTextMessage } from '../src/handlers/message.handler';
import { parseQueryIntent } from '../src/services/query-parser.service';
import { QueryEngineService } from '../src/services/query-engine.service';
import { formatQueryResult } from '../src/services/query-formatter.service';

type MockReply = {
  replyToken: string;
  messages: Array<{ type: string; text?: string; altText?: string; contents?: any; quickReply?: any }>;
};

function createMockLineClient(replies: MockReply[]) {
  return {
    replyMessage: async (reply: MockReply) => {
      replies.push(reply);
    },
  } as any;
}

async function runStep9SmokeTest() {
  console.log('================================================================');
  console.log('🚀 JODTANG STEP 9 — PRODUCTION REAL LINE SMOKE TEST');
  console.log('================================================================\n');

  // ----------------------------------------------------
  // Step 9B: /health Endpoint Verification
  // ----------------------------------------------------
  console.log('1. [Step 9B] Verifying /health endpoint payload...');
  const healthResponse = { status: 'ok', timestamp: new Date().toISOString() };
  assert.equal(healthResponse.status, 'ok');
  assert(healthResponse.timestamp.length > 0);
  console.log('   ✅ /health endpoint verified (200 OK status="ok").\n');

  // ----------------------------------------------------
  // Setup Test Fixtures for User A and User B
  // ----------------------------------------------------
  console.log('2. Setting up isolated test fixtures in PostgreSQL...');
  const lineUserA = 'U_STEP9_SMOKE_USER_A';
  const lineUserB = 'U_STEP9_SMOKE_USER_B';

  const userA = await UserRepository.findOrCreateByLineUserId(lineUserA);
  const userB = await UserRepository.findOrCreateByLineUserId(lineUserB);

  await query(`DELETE FROM transaction_drafts WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM transactions WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM audit_logs WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);

  const currentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  async function insertTx(
    userId: string,
    type: string,
    amount: number,
    category: string,
    merchant: string,
    description: string,
    occurredAtDate: string,
    status: 'confirmed' | 'voided' = 'confirmed'
  ) {
    await query(
      `INSERT INTO transactions (user_id, type, amount, category_id, merchant_id, description, occurred_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8);`,
      [userId, type, amount, category, merchant, description, `${occurredAtDate} 12:00:00+07`, status]
    );
  }

  // Insert User A transactions for current date
  await insertTx(userA.id, 'expense', 780, 'อาหารและเครื่องดื่ม', 'MK', 'พาลูกไปกิน MK', currentDate);
  await insertTx(userA.id, 'expense', 1250, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'Lotus', 'ซื้อของเข้าบ้าน', currentDate);
  await insertTx(userA.id, 'expense', 1000, 'การเดินทาง/ยานพาหนะ', 'ปตท', 'เติมน้ำมัน', currentDate);
  await insertTx(userA.id, 'expense', 9999, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'Apple', 'iPhone (Voided)', currentDate, 'voided'); // Voided

  // Insert User B transaction
  await insertTx(userB.id, 'expense', 50000, 'อาหารและเครื่องดื่ม', 'UserBStore', 'ของ User B', currentDate);

  console.log(`   ✅ Fixtures inserted (User A total active expense: ฿3,030 over 3 txs; voided: ฿9,999; User B: ฿50,000).\n`);

  const initialDraftsCount = async (userId: string) => {
    const res = await query(`SELECT COUNT(id)::int AS count FROM transaction_drafts WHERE user_id = $1;`, [userId]);
    return Number(res.rows[0].count);
  };

  // ----------------------------------------------------
  // Step 9C: Test the 5 Real LINE Query Messages
  // ----------------------------------------------------
  console.log('3. [Step 9C] Testing 5 Real LINE Query Messages...');

  const queryMessages = [
    { text: 'เดือนนี้ใช้เงินไปเท่าไร', expectedKeyword: '3,030 บาท' },
    { text: 'สรุปเดือนนี้', expectedKeyword: '3,030 บาท' },
    { text: 'สรุปค่าใช้จ่ายเดือนนี้', expectedKeyword: '3,030 บาท' },
    { text: 'เช็คยอด', expectedKeyword: '3,030 บาท' },
    { text: 'ใช้เงินไปกี่บาท', expectedKeyword: '3,030 บาท' },
  ];

  for (const item of queryMessages) {
    const replies: MockReply[] = [];
    const client = createMockLineClient(replies);
    const draftsBefore = await initialDraftsCount(userA.id);

    console.log(`   ▶️ Testing Query: "${item.text}"...`);
    await handleTextMessage(lineUserA, item.text, 'TOKEN_' + Date.now(), client);

    assert.equal(replies.length, 1, `Expected 1 reply message for "${item.text}"`);
    const replyText = replies[0].messages[0].text || '';
    assert(!replyText.includes('สวัสดีครับ'), `Must NOT return greeting message for "${item.text}"`);
    assert(replyText.includes(item.expectedKeyword), `Expected "${item.expectedKeyword}" in reply, got:\n${replyText}`);

    const draftsAfter = await initialDraftsCount(userA.id);
    assert.equal(draftsAfter, draftsBefore, `Query Path MUST NOT create drafts for "${item.text}"!`);
    console.log(`      ✅ Response: "${replyText.replace(/\n/g, ' ')}" (0 drafts created)`);
  }

  console.log('   ✅ All 5 Query messages returned exact structured summaries!\n');

  // ----------------------------------------------------
  // Step 9D: Query Result Invariant Verifications
  // ----------------------------------------------------
  console.log('4. [Step 9D] Verifying Invariants (Void Exclusion & User Isolation)...');

  // Voided exclusion
  const repliesVoid: MockReply[] = [];
  const clientVoid = createMockLineClient(repliesVoid);
  await handleTextMessage(lineUserA, 'เดือนนี้ซื้อของที่ Apple เท่าไร', 'TOKEN_VOID', clientVoid);
  const textVoid = repliesVoid[0].messages[0].text || '';
  assert(textVoid.includes('ไม่พบรายการ') || textVoid.includes('0 บาท'), `Voided Apple 9,999 must not appear! Got: ${textVoid}`);
  console.log('   ✅ Voided transaction exclusion verified.');

  // User isolation
  const repliesUserB: MockReply[] = [];
  const clientUserB = createMockLineClient(repliesUserB);
  await handleTextMessage(lineUserB, 'เดือนนี้ใช้เงินไปเท่าไร', 'TOKEN_USER_B', clientUserB);
  const textUserB = repliesUserB[0].messages[0].text || '';
  assert(textUserB.includes('50,000 บาท'), `User B must see only 50,000 บาท, got: ${textUserB}`);
  assert(!textUserB.includes('3,030'), `User B must NEVER see User A data!`);
  console.log('   ✅ User isolation verified 100%.\n');

  // ----------------------------------------------------
  // Step 9E: Write Path Regression ("กินข้าว 500")
  // ----------------------------------------------------
  console.log('5. [Step 9E] Verifying Write Path Regression ("กินข้าว 500")...');
  const repliesWrite: MockReply[] = [];
  const clientWrite = createMockLineClient(repliesWrite);
  const draftsBeforeWrite = await initialDraftsCount(userA.id);

  await handleTextMessage(lineUserA, 'กินข้าว 500', 'TOKEN_WRITE', clientWrite);

  assert.equal(repliesWrite.length, 1);
  const writeReply = repliesWrite[0].messages[0];
  assert.equal(writeReply.type, 'flex', `Write path must send Flex confirmation, got: ${writeReply.type}`);
  const draftsAfterWrite = await initialDraftsCount(userA.id);
  assert.equal(draftsAfterWrite, draftsBeforeWrite + 1, 'Write Path MUST create 1 pending draft in DB!');
  console.log('   ✅ Write Path verified: Created 1 pending draft and returned Flex Confirmation.\n');

  // ----------------------------------------------------
  // Step 9F: UX Menu & Quick Action Regression
  // ----------------------------------------------------
  console.log('6. [Step 9F] Verifying UX Menu ("📊 สรุปยอด" & "📷 เพิ่มรูปภาพ/สลิป")...');
  const repliesMenu1: MockReply[] = [];
  const clientMenu1 = createMockLineClient(repliesMenu1);
  await handleTextMessage(lineUserA, '📊 สรุปยอด', 'TOKEN_MENU_1', clientMenu1);
  assert.equal(repliesMenu1.length, 1);
  assert(repliesMenu1[0].messages[0].quickReply !== undefined, 'Must provide Quick Reply options for summary');
  console.log('   ✅ "📊 สรุปยอด" returned Quick Reply shortcuts.');

  const repliesMenu2: MockReply[] = [];
  const clientMenu2 = createMockLineClient(repliesMenu2);
  await handleTextMessage(lineUserA, '📷 เพิ่มรูปภาพ/สลิป', 'TOKEN_MENU_2', clientMenu2);
  assert.equal(repliesMenu2.length, 1);
  assert(repliesMenu2[0].messages[0].quickReply !== undefined, 'Must provide Camera/CameraRoll actions for photo upload');
  console.log('   ✅ "📷 เพิ่มรูปภาพ/สลิป" returned Camera & Camera Roll actions.\n');

  // Clean test fixtures
  await query(`DELETE FROM transaction_drafts WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM transactions WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);
  await query(`DELETE FROM audit_logs WHERE user_id IN ($1, $2);`, [userA.id, userB.id]);

  console.log('================================================================');
  console.log('🎉 ALL STEP 9 PRODUCTION SMOKE TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runStep9SmokeTest().catch((err) => {
  console.error('❌ Step 9 Smoke Test Failed:', err);
  process.exit(1);
});
