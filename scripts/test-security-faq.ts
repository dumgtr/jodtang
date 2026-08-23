import assert from 'node:assert/strict';
import { query } from '../src/db/client';
import { UserRepository } from '../src/modules/user/user.repository';
import { handleTextMessage } from '../src/handlers/message.handler';
import { buildSecurityFaqText, buildJodTangRichMenuRequest } from '../src/utils/menu.builder';

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
    '🔒 ความปลอดภัยและความเป็นส่วนตัว',
    'ความปลอดภัย',
    'ความเป็นส่วนตัว',
    'security',
    'privacy',
  ];

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
  console.log('\n4. Verifying Write Path regression ("กินข้าว 60")...');
  const repliesWrite: MockReply[] = [];
  const clientWrite = createMockLineClient(repliesWrite);
  const draftsBeforeWrite = await countDrafts();

  await handleTextMessage(lineUserId, 'กินข้าว 60', 'TOKEN_WRITE', clientWrite);

  assert.equal(repliesWrite.length, 1);
  assert.equal(repliesWrite[0].messages[0].type, 'flex', 'Write Path must return Flex confirmation');
  const draftsAfterWrite = await countDrafts();
  assert.equal(draftsAfterWrite, draftsBeforeWrite + 1, 'Write Path must create 1 draft');
  console.log('   ✅ Write Path verified (created 1 draft).');

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
