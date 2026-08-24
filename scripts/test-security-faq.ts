import assert from 'node:assert/strict';
import { query } from '../src/db/client';
import { env } from '../src/config/env';
import { assertTestDatabaseConnection } from '../src/db/test-isolation';
import { UserRepository } from '../src/modules/user/user.repository';
import { handleTextMessage } from '../src/handlers/message.handler';
import {
  classifySecurityFaqIntent,
  isSecurityFaqCommand,
  type SecurityFaqTopic,
} from '../src/services/security-faq.service';
import { buildSecurityFaqText, buildJodTangRichMenuRequest } from '../src/utils/menu.builder';

assertTestDatabaseConnection(env.DATABASE_URL);

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

async function runSecurityFaqTests() {
  console.log('====================================================');
  console.log('🧪 Testing Security & Privacy FAQ Flow in JodTang');
  console.log('====================================================\n');

  // 0. Deterministic natural-language intent recognition.
  console.log('0. Testing Security FAQ intent recognition and routing boundaries...');
  const topicMarkers: Record<SecurityFaqTopic, string> = {
    overview: 'จดตังเป็นสมุดบันทึกรายรับรายจ่าย',
    stored_data: 'จดตังเก็บข้อมูลที่จำเป็น',
    data_access: 'รายการของคุณถูกผูกกับ LINE User ID',
    ai_processing: 'ระบบอาจใช้ AI ที่ตั้งค่าไว้บนเซิร์ฟเวอร์',
    data_location: 'ฐานข้อมูล PostgreSQL บนเซิร์ฟเวอร์',
    user_control: 'มี Draft ให้ตรวจสอบ',
    banking_boundary: 'จดตังทำหน้าที่บันทึกรายการ ไม่ใช่ธนาคาร',
    line_account: 'จดตังใช้ LINE User ID',
  };

  const securityIntentCases: Array<{ phrase: string; topic: SecurityFaqTopic }> = [
    { phrase: 'ตรวจสอบความปลอดภัย', topic: 'overview' },
    { phrase: 'สอบถามความปลอดภัย', topic: 'overview' },
    { phrase: 'นโยบายความปลอดภัย', topic: 'overview' },
    { phrase: 'ระบบปลอดภัยไหม', topic: 'overview' },
    { phrase: 'ข้อมูลของฉันปลอดภัยไหม', topic: 'stored_data' },
    { phrase: 'ข้อมูลส่วนตัวปลอดภัยหรือเปล่า', topic: 'stored_data' },
    { phrase: 'จดตังเก็บข้อมูลอะไรบ้าง', topic: 'stored_data' },
    { phrase: 'จดตังรู้ข้อมูลส่วนตัวแค่ไหน', topic: 'stored_data' },
    { phrase: 'ข้อมูลที่ผมพิมพ์ถูกเก็บไหม', topic: 'stored_data' },
    { phrase: 'เก็บรายการรายรับรายจ่ายอะไรบ้าง', topic: 'stored_data' },
    { phrase: 'ข้อมูลฉันถูกเก็บไว้ที่ไหน', topic: 'data_location' },
    { phrase: 'ข้อมูลผมอยู่ที่ไหน', topic: 'data_location' },
    { phrase: 'เก็บในมือถือหรือบน server', topic: 'data_location' },
    { phrase: 'ถ้าลบแชต LINE ข้อมูลหายไหม', topic: 'data_location' },
    { phrase: 'จดตังเอาข้อมูลไปใช้ไหม', topic: 'stored_data' },
    { phrase: 'AI เอาข้อมูลไปเทรนไหม', topic: 'ai_processing' },
    { phrase: 'AI เห็นข้อมูลไหม', topic: 'ai_processing' },
    { phrase: 'ส่งข้อมูลให้ AI หรือเปล่า', topic: 'ai_processing' },
    { phrase: 'AI เอาข้อมูลผมไปทำอะไร', topic: 'ai_processing' },
    { phrase: 'AI จำข้อมูลของผมไหม', topic: 'ai_processing' },
    { phrase: 'ข้อมูลผมไปอยู่กับ AI หรือเปล่า', topic: 'ai_processing' },
    { phrase: 'จดตังเห็นบัญชีธนาคารไหม', topic: 'banking_boundary' },
    { phrase: 'ต้องให้รหัสผ่านไหม', topic: 'banking_boundary' },
    { phrase: 'ต้องใช้รหัสธนาคารไหม', topic: 'banking_boundary' },
    { phrase: 'ต้องให้ OTP ไหม', topic: 'banking_boundary' },
    { phrase: 'จดตังเข้าบัญชีธนาคารได้ไหม', topic: 'banking_boundary' },
    { phrase: 'จดตังดูยอดบัญชีได้ไหม', topic: 'banking_boundary' },
    { phrase: 'จดตังโอนเงินให้ผมไหม', topic: 'banking_boundary' },
    { phrase: 'จดตังรู้เลขบัญชีผมไหม', topic: 'banking_boundary' },
    { phrase: 'จดตังเป็นธนาคารหรือไม่', topic: 'banking_boundary' },
    { phrase: 'มีใครเห็นรายการของฉันไหม', topic: 'data_access' },
    { phrase: 'ใครเห็นข้อมูลผม', topic: 'data_access' },
    { phrase: 'ข้อมูลผมปนกับคนอื่นไหม', topic: 'data_access' },
    { phrase: 'ใครเห็นข้อมูลผมได้บ้าง', topic: 'data_access' },
    { phrase: 'ข้อมูลผมจะไปโผล่ของคนอื่นไหม', topic: 'data_access' },
    { phrase: 'คนอื่นค้นหารายการของผมได้ไหม', topic: 'data_access' },
    { phrase: 'แอดมินเห็นเงินผมไหม', topic: 'data_access' },
    { phrase: 'ถ้าพิมพ์ผิดทำยังไง', topic: 'user_control' },
    { phrase: 'แก้รายการได้ไหม', topic: 'user_control' },
    { phrase: 'ลบข้อมูลได้ไหม', topic: 'user_control' },
    { phrase: 'ลบรายการได้ไหม', topic: 'user_control' },
    { phrase: 'ลบข้อมูลทั้งหมดได้ไหม', topic: 'user_control' },
    { phrase: 'ก่อนบันทึกมีให้ตรวจไหม', topic: 'user_control' },
    { phrase: 'ถ้าเปลี่ยนมือถือข้อมูลยังอยู่ไหม', topic: 'line_account' },
    { phrase: 'ถ้าเปลี่ยน LINE account ข้อมูลจะเป็นอย่างไร', topic: 'line_account' },
    { phrase: 'ถ้ามีคนเข้า LINE ผมจะเห็นข้อมูลไหม', topic: 'line_account' },
    { phrase: 'ความเป็นส่วนตัว', topic: 'overview' },
    { phrase: 'privacy', topic: 'overview' },
    { phrase: 'security', topic: 'overview' },
    { phrase: 'data privacy', topic: 'overview' },
    { phrase: 'ปลอดภัยไหม', topic: 'overview' },
    { phrase: 'เรื่องความปลอดภัย', topic: 'overview' },
    { phrase: 'ขอข้อมูลความปลอดภัย', topic: 'overview' },
  ];

  for (const testCase of securityIntentCases) {
    assert.equal(isSecurityFaqCommand(testCase.phrase), true, `Expected SECURITY_FAQ for "${testCase.phrase}"`);
    assert.equal(classifySecurityFaqIntent(testCase.phrase), testCase.topic, `Unexpected topic for "${testCase.phrase}"`);
  }

  const nonSecurityIntentCases = [
    'กินข้าว 80',
    'จ่ายค่าไฟ 500',
    'ได้เงินเดือน 30000',
    'ซื้อ Apple 40000',
    'ค่าโทรศัพท์ 599',
    'สรุปเดือนนี้',
    'เดือนนี้ใช้เงินไปเท่าไร',
    'สรุปค่าใช้จ่าย',
    'ดูรายการวันนี้',
    'รายการอาหาร',
    'ค่าใช้จ่ายทั้งหมด',
    'ซื้อของปลอดภัยไหม',
    'สวัสดี',
    'หวัดดี',
  ];

  for (const phrase of nonSecurityIntentCases) {
    assert.equal(isSecurityFaqCommand(phrase), false, `Must not route "${phrase}" to SECURITY_FAQ`);
  }
  console.log(`   ✅ ${securityIntentCases.length} Security FAQ cases and ${nonSecurityIntentCases.length} boundary cases passed.\n`);

  // A first-time FAQ request must not create even the user row.
  console.log('   Testing strict read-only behavior for a new LINE user...');
  const countAllRecords = async () => {
    const res = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT COUNT(*)::int FROM transaction_drafts) AS drafts,
        (SELECT COUNT(*)::int FROM transactions) AS transactions,
        (SELECT COUNT(*)::int FROM audit_logs) AS audit_logs;
    `);
    return res.rows[0];
  };
  const readOnlyBefore = await countAllRecords();
  const readOnlyReplies: MockReply[] = [];
  await handleTextMessage(
    'U_SECURITY_FAQ_NEW_READ_ONLY',
    'ใครเห็นข้อมูลผม',
    'TOKEN_READ_ONLY',
    createMockLineClient(readOnlyReplies)
  );
  const readOnlyAfter = await countAllRecords();
  assert.deepEqual(readOnlyAfter, readOnlyBefore, 'Security FAQ must not write users or financial records');
  assert.equal(readOnlyReplies.length, 1);
  assert(readOnlyReplies[0].messages[0].text?.includes(topicMarkers.data_access));
  console.log('   ✅ New-user Security FAQ did not change users, drafts, transactions, or audit logs.\n');

  // 1. Test Rich Menu Request Spec
  console.log('1. Testing Rich Menu JSON Specification...');
  const menuReq = buildJodTangRichMenuRequest();
  assert.equal(menuReq.size.width, 2500);
  assert.equal(menuReq.size.height, 843);
  assert.equal(menuReq.selected, false, 'Default display MUST be collapsed (selected=false)!');
  assert.equal(menuReq.chatBarText, 'เมนูจดตัง');
  assert.equal(menuReq.areas.length, 2, 'Must have 2 areas: Top (Summary) and Bottom (Security FAQ)');

  const topArea = menuReq.areas[0];
  assert.equal(topArea.bounds.y, 0);
  assert.equal(topArea.bounds.height, 562);
  assert.equal((topArea.action as any).text, '📊 สรุปยอด');

  const bottomArea = menuReq.areas[1];
  assert.equal(bottomArea.bounds.y, 562);
  assert.equal(bottomArea.bounds.height, 281);
  assert.equal((bottomArea.action as any).text, '🔒 ความปลอดภัยและความเป็นส่วนตัว');
  console.log('   ✅ Rich Menu Specification verified (2-row layout with selected=false).\n');

  // 2. Setup Test User
  console.log('2. Setting up test user fixtures in PostgreSQL...');
  const lineUserId = 'U_SECURITY_FAQ_TEST';
  const user = await UserRepository.findOrCreateByLineUserId(lineUserId);

  await query(`DELETE FROM transaction_drafts WHERE user_id = $1;`, [user.id]);
  await query(`DELETE FROM transactions WHERE user_id = $1;`, [user.id]);

  const countDrafts = async () => {
    const res = await query(`SELECT COUNT(id)::int AS count FROM transaction_drafts WHERE user_id = $1;`, [user.id]);
    return Number(res.rows[0].count);
  };

  // 3. Test Security FAQ Trigger Messages
  console.log('3. Testing Security FAQ command triggers...');
  const testPhrases = [
    { phrase: '🔒 ความปลอดภัยและความเป็นส่วนตัว', topic: 'overview' as SecurityFaqTopic },
    ...securityIntentCases,
  ];

  for (const testCase of testPhrases) {
    const replies: MockReply[] = [];
    const client = createMockLineClient(replies);
    const draftsBefore = await countDrafts();

    await handleTextMessage(lineUserId, testCase.phrase, 'TOKEN_' + Date.now(), client);

    assert.equal(replies.length, 1, `Expected 1 reply for "${testCase.phrase}"`);
    const replyText = replies[0].messages[0].text || '';
    assert(replyText.includes('🔒 ความปลอดภัยและความเป็นส่วนตัวของ จดตัง'), `Must include Security header for "${testCase.phrase}"`);
    assert(replyText.includes(topicMarkers[testCase.topic]), `Must include topic answer for "${testCase.phrase}"`);
    assert(!replyText.includes('HTTPS/TLS'), 'FAQ must not claim transport security not proven by source');
    assert(!replyText.includes('ปลอดภัย 100%'), 'FAQ must not promise absolute security');

    const draftsAfter = await countDrafts();
    assert.equal(draftsAfter, draftsBefore, 'Security FAQ MUST NOT create drafts (strictly Read-only)!');
    console.log(`   ✅ Phrase "${testCase.phrase}" returned the ${testCase.topic} FAQ.`);
  }

  // 4. Verify Write Path is Untouched
  console.log('\n4. Verifying Write Path regression...');
  const writePhrases = ['กินข้าว 80', 'จ่ายค่าไฟ 500', 'ได้เงินเดือน 30000'];
  for (const phrase of writePhrases) {
    const repliesWrite: MockReply[] = [];
    const clientWrite = createMockLineClient(repliesWrite);
    const draftsBeforeWrite = await countDrafts();

    await handleTextMessage(lineUserId, phrase, `TOKEN_WRITE_${Date.now()}`, clientWrite);

    assert.equal(repliesWrite.length, 1, `Expected one Write reply for "${phrase}"`);
    assert.equal(repliesWrite[0].messages[0].type, 'flex', 'Write Path must return Flex confirmation');
    const draftsAfterWrite = await countDrafts();
    assert.equal(draftsAfterWrite, draftsBeforeWrite + 1, `Write Path must create 1 draft for "${phrase}"`);
    console.log(`   ✅ Write Path verified for "${phrase}".`);
  }

  // Clean test fixtures
  await query(`DELETE FROM transaction_drafts WHERE user_id = $1;`, [user.id]);
  await query(`DELETE FROM transactions WHERE user_id = $1;`, [user.id]);

  console.log('\n====================================================');
  console.log('🎉 ALL SECURITY FAQ TESTS PASSED 100%!');
  console.log('====================================================\n');
}

runSecurityFaqTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
