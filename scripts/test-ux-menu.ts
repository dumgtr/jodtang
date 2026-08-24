import assert from 'node:assert/strict';
import { query, pool } from '../src/db/client';
import { env } from '../src/config/env';
import { assertTestDatabaseConnection } from '../src/db/test-isolation';
import { UserRepository } from '../src/modules/user/user.repository';
import { handleTextMessage } from '../src/handlers/message.handler';
import {
  buildJodTangRichMenuRequest,
  buildQuickSummaryQuickReply,
  buildSlipUploadQuickReply,
} from '../src/utils/menu.builder';

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

async function runUxMenuTests() {
  console.log('====================================================');
  console.log('🧪 JodTang Q6: Query/Summary UX + LINE Menu UI Test');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // 1. Rich Menu Specification Validation
  // ----------------------------------------------------
  console.log('1. Testing Rich Menu JSON Specification...');
  const richMenu = buildJodTangRichMenuRequest();

  assert.equal(richMenu.size.width, 2500, 'Rich Menu width must be 2500');
  assert.equal(richMenu.size.height, 843, 'Rich Menu height must be 843');
  assert.equal(richMenu.selected, false, 'Rich Menu should have selected=false (text input default)');
  assert(richMenu.chatBarText.length > 0, 'Chat bar text must guide user to type message or choose menu');
  assert.equal(richMenu.areas.length, 2, 'Rich Menu must have 2 main areas');

  // Top Area: 📊 สรุปยอด
  const topArea = richMenu.areas[0];
  assert.equal(topArea.bounds.x, 0);
  assert.equal(topArea.bounds.y, 0);
  assert.equal(topArea.bounds.width, 2500);
  assert.equal(topArea.bounds.height, 562);
  assert.equal(topArea.action.type, 'message');
  assert.equal((topArea.action as any).text, '📊 สรุปยอด');

  // Bottom Area: 🔒 ความปลอดภัยและความเป็นส่วนตัว
  const bottomArea = richMenu.areas[1];
  assert.equal(bottomArea.bounds.x, 0);
  assert.equal(bottomArea.bounds.y, 562);
  assert.equal(bottomArea.bounds.width, 2500);
  assert.equal(bottomArea.bounds.height, 281);
  assert.equal(bottomArea.action.type, 'message');
  assert.equal((bottomArea.action as any).text, '🔒 ความปลอดภัยและความเป็นส่วนตัว');

  console.log('   ✅ Rich Menu Specification verified (2-row layout with text input default).\n');

  // ----------------------------------------------------
  // 2. Setup Test User Fixtures
  // ----------------------------------------------------
  console.log('2. Setting up test user fixtures...');
  const lineUser = 'U_Q6_UX_TEST_USER';
  const user = await UserRepository.findOrCreateByLineUserId(lineUser);

  await query(`DELETE FROM transaction_drafts WHERE user_id = $1;`, [user.id]);
  await query(`DELETE FROM transactions WHERE user_id = $1;`, [user.id]);
  await query(`DELETE FROM audit_logs WHERE user_id = $1;`, [user.id]);

  // Insert fixture transactions for August 2026
  await query(
    `INSERT INTO transactions (user_id, type, amount, category_id, merchant_id, description, occurred_at, status)
     VALUES ($1, 'expense', 780, 'อาหารและเครื่องดื่ม', 'MK', 'กินข้าว MK', '2026-08-21 12:00:00+07', 'confirmed');`,
    [user.id]
  );
  console.log('   ✅ Fixture data loaded.\n');

  // ----------------------------------------------------
  // 3. Quick Summary Menu Command Trigger
  // ----------------------------------------------------
  console.log('3. Testing "📊 สรุปยอด" button tap / message...');
  const summaryReplies: MockReply[] = [];
  const client1 = createMockLineClient(summaryReplies);

  await handleTextMessage(lineUser, '📊 สรุปยอด', 'TOKEN_MENU_1', client1);

  assert.equal(summaryReplies.length, 1);
  const msg1 = summaryReplies[0].messages[0];
  assert(msg1.text?.includes('เลือกช่วงเวลาหรือหมวดหมู่'), 'Must reply with summary selector guide');
  assert(msg1.quickReply !== undefined, 'Must provide Quick Reply actions');
  assert(msg1.quickReply.items.length >= 4, 'Must provide at least 4 quick query shortcuts');

  const shortcutLabels = msg1.quickReply.items.map((i: any) => i.action.label);
  assert(shortcutLabels.some((l: string) => l.includes('สรุปเดือนนี้')), 'Must contain "สรุปเดือนนี้"');
  assert(shortcutLabels.some((l: string) => l.includes('สรุปสัปดาห์นี้')), 'Must contain "สรุปสัปดาห์นี้"');
  assert(shortcutLabels.some((l: string) => l.includes('ร้านจ่ายเยอะสุด')), 'Must contain "ร้านจ่ายเยอะสุด"');

  console.log('   ✅ "📊 สรุปยอด" command properly returns Quick Reply query shortcuts.\n');

  // ----------------------------------------------------
  // 4. Slip & Receipt Upload Menu Command Trigger
  // ----------------------------------------------------
  console.log('4. Testing "📷 เพิ่มรูปภาพ/สลิป" button tap / message...');
  const slipReplies: MockReply[] = [];
  const client2 = createMockLineClient(slipReplies);

  await handleTextMessage(lineUser, '📷 เพิ่มรูปภาพ/สลิป', 'TOKEN_MENU_2', client2);

  assert.equal(slipReplies.length, 1);
  const msg2 = slipReplies[0].messages[0];
  assert(msg2.text?.includes('ถ่ายรูปหรือเลือกภาพสลิป/ใบเสร็จ'), 'Must reply with slip upload instructions');
  assert(msg2.quickReply !== undefined, 'Must provide Quick Reply actions for photo upload');

  const slipActions = msg2.quickReply.items.map((i: any) => i.action.type);
  assert(slipActions.includes('cameraRoll'), 'Must provide cameraRoll action');
  assert(slipActions.includes('camera'), 'Must provide camera action');

  console.log('   ✅ "📷 เพิ่มรูปภาพ/สลิป" command properly returns Camera/CameraRoll actions.\n');

  // ----------------------------------------------------
  // 5. Selecting a Quick Summary shortcut executes Query Engine
  // ----------------------------------------------------
  console.log('5. Testing user tapping Quick Summary action "สรุปค่าใช้จ่ายเดือนนี้"...');
  const queryReplies: MockReply[] = [];
  const client3 = createMockLineClient(queryReplies);

  await handleTextMessage(lineUser, 'สรุปค่าใช้จ่ายเดือนนี้', 'TOKEN_MENU_3', client3);

  assert.equal(queryReplies.length, 1);
  const msg3 = queryReplies[0].messages[0];
  assert(msg3.text?.includes('780 บาท'), 'Must execute query engine and return formatted total');
  assert(msg3.text?.includes('1 รายการ'), 'Must return transaction count');

  console.log('   ✅ Quick Summary shortcut seamlessly executes Query Path.\n');

  // ----------------------------------------------------
  // 6. Normal text input still smoothly routes to Write Path
  // ----------------------------------------------------
  console.log('6. Testing normal typing "กินข้าว 150" still creates draft...');
  const writeReplies: MockReply[] = [];
  const client4 = createMockLineClient(writeReplies);

  await handleTextMessage(lineUser, 'กินข้าว 150', 'TOKEN_MENU_4', client4);

  assert.equal(writeReplies.length, 1);
  const msg4 = writeReplies[0].messages[0];
  assert.equal(msg4.type, 'flex', 'Must create draft and send Flex confirmation carousel');

  console.log('   ✅ Default keyboard typing creates transaction drafts as normal.\n');

  // Clean test fixtures
  await query(`DELETE FROM transaction_drafts WHERE user_id = $1;`, [user.id]);
  await query(`DELETE FROM transactions WHERE user_id = $1;`, [user.id]);
  await query(`DELETE FROM audit_logs WHERE user_id = $1;`, [user.id]);

  console.log('====================================================');
  console.log('🎉 ALL Q6 UX & LINE MENU TESTS PASSED 100%!');
  console.log('====================================================\n');
}

runUxMenuTests().catch((err) => {
  console.error('❌ Q6 UX Menu Test Failed:', err);
  process.exit(1);
});
