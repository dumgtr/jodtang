import assert from 'node:assert/strict';
import { query } from '../src/db/client';
import { env } from '../src/config/env';
import { assertTestDatabaseConnection } from '../src/db/test-isolation';
import { UserRepository } from '../src/modules/user/user.repository';
import { handleTextMessage } from '../src/handlers/message.handler';
import { isSecurityFaqCommand } from '../src/services/security-faq.service';
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
  const securityIntentCases = [
    'ตรวจสอบความปลอดภัย',
    'สอบถามความปลอดภัย',
    'นโยบายความปลอดภัย',
    'ระบบปลอดภัยไหม',
    'ข้อมูลของฉันปลอดภัยไหม',
    'ข้อมูลส่วนตัวปลอดภัยหรือเปล่า',
    'จดตังเก็บข้อมูลอะไรบ้าง',
    'ข้อมูลฉันถูกเก็บไว้ที่ไหน',
    'จดตังเอาข้อมูลไปใช้ไหม',
    'AI เอาข้อมูลไปเทรนไหม',
    'จดตังเห็นบัญชีธนาคารไหม',
    'ต้องให้รหัสผ่านไหม',
    'มีใครเห็นรายการของฉันไหม',
    'ความเป็นส่วนตัว',
    'privacy',
    'security',
    'data privacy',
    'ปลอดภัยไหม',
    'เรื่องความปลอดภัย',
    'ขอข้อมูลความปลอดภัย',
  ];

  for (const phrase of securityIntentCases) {
    assert.equal(isSecurityFaqCommand(phrase), true, `Expected SECURITY_FAQ for "${phrase}"`);
  }

  const nonSecurityIntentCases = [
    'กินข้าว 80',
    'จ่ายค่าไฟ 500',
    'ได้เงินเดือน 30000',
    'สรุปเดือนนี้',
    'เดือนนี้ใช้เงินไปเท่าไร',
    'สวัสดี',
    'หวัดดี',
  ];

  for (const phrase of nonSecurityIntentCases) {
    assert.equal(isSecurityFaqCommand(phrase), false, `Must not route "${phrase}" to SECURITY_FAQ`);
  }
  console.log(`   ✅ ${securityIntentCases.length} Security FAQ cases and ${nonSecurityIntentCases.length} boundary cases passed.\n`);

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
  const testPhrases = ['🔒 ความปลอดภัยและความเป็นส่วนตัว', ...securityIntentCases];

  for (const phrase of testPhrases) {
    const replies: MockReply[] = [];
    const client = createMockLineClient(replies);
    const draftsBefore = await countDrafts();

    await handleTextMessage(lineUserId, phrase, 'TOKEN_' + Date.now(), client);

    assert.equal(replies.length, 1, `Expected 1 reply for "${phrase}"`);
    const replyText = replies[0].messages[0].text || '';
    assert(replyText.includes('🔒 ความปลอดภัยและความเป็นส่วนตัวของ จดตัง'), `Must include Security header for "${phrase}"`);
    assert(replyText.includes('ไม่เชื่อมต่อบัญชีธนาคาร'), 'Must include No Bank Connection statement');
    assert(replyText.includes('HTTPS/TLS'), 'Must include HTTPS/TLS statement');
    assert(replyText.includes('Draft'), 'Must include Draft confirmation statement');

    const draftsAfter = await countDrafts();
    assert.equal(draftsAfter, draftsBefore, 'Security FAQ MUST NOT create drafts (strictly Read-only)!');
    console.log(`   ✅ Phrase "${phrase}" returned Security FAQ.`);
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
