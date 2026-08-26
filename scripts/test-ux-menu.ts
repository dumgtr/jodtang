import assert from 'node:assert/strict';
import { query } from '../src/db/client';
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
  console.log('🧪 JodTang M12: Rich Menu (2x2) & UX Navigation Test');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // 1. Rich Menu Balanced 2x2 Specification Validation
  // ----------------------------------------------------
  console.log('1. Testing Rich Menu JSON Specification (2x2 Balanced Grid)...');
  const richMenu = buildJodTangRichMenuRequest();

  assert.equal(richMenu.size.width, 2500, 'Rich Menu width must be 2500');
  assert.equal(richMenu.size.height, 843, 'Rich Menu height must be 843');
  assert.equal(richMenu.selected, false, 'Rich Menu should have selected=false (text input default)');
  assert(richMenu.chatBarText.length > 0, 'Chat bar text must guide user to type message or choose menu');
  assert.equal(richMenu.areas.length, 4, 'Rich Menu must have 4 balanced areas in 2x2 grid');

  // Area 1: Top-Left (✏️ เริ่มจด)
  const area1 = richMenu.areas[0];
  assert.equal(area1.bounds.x, 0);
  assert.equal(area1.bounds.y, 0);
  assert.equal(area1.bounds.width, 1250);
  assert.equal(area1.bounds.height, 421);
  assert.equal(area1.action.type, 'message');
  assert.equal((area1.action as any).text, 'เริ่มจด');

  // Area 2: Top-Right (📷 อัพสลิป)
  const area2 = richMenu.areas[1];
  assert.equal(area2.bounds.x, 1250);
  assert.equal(area2.bounds.y, 0);
  assert.equal(area2.bounds.width, 1250);
  assert.equal(area2.bounds.height, 421);
  assert.equal(area2.action.type, 'message');
  assert.equal((area2.action as any).text, 'อัพสลิป');

  // Area 3: Bottom-Left (📊 สรุปยอด)
  const area3 = richMenu.areas[2];
  assert.equal(area3.bounds.x, 0);
  assert.equal(area3.bounds.y, 421);
  assert.equal(area3.bounds.width, 1250);
  assert.equal(area3.bounds.height, 422);
  assert.equal(area3.action.type, 'message');
  assert.equal((area3.action as any).text, '📊 สรุปยอด');

  // Area 4: Bottom-Right (🔒 ความปลอดภัย)
  const area4 = richMenu.areas[3];
  assert.equal(area4.bounds.x, 1250);
  assert.equal(area4.bounds.y, 421);
  assert.equal(area4.bounds.width, 1250);
  assert.equal(area4.bounds.height, 422);
  assert.equal(area4.action.type, 'message');
  assert.equal((area4.action as any).text, '🔒 ความปลอดภัยและความเป็นส่วนตัว');

  console.log('   ✅ Rich Menu Specification verified (2x2 balanced layout with selected=false).\n');

  // ----------------------------------------------------
  // 2. Setup Test User Fixtures
  // ----------------------------------------------------
  console.log('2. Setting up test user fixtures...');
  const lineUser = 'U_M12_UX_TEST_USER';
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
  // 3. Test "เริ่มจด" (Top-Left Rich Menu Button)
  // ----------------------------------------------------
  console.log('3. Testing "เริ่มจด" button tap / message...');
  const startReplies: MockReply[] = [];
  const clientStart = createMockLineClient(startReplies);

  await handleTextMessage(lineUser, 'เริ่มจด', 'TOKEN_START_1', clientStart);

  assert.equal(startReplies.length, 1);
  const startMsg = startReplies[0].messages[0];
  assert(startMsg.text?.includes('เริ่มจดได้เลยครับ'), 'Must reply with start record guide');
  assert(startMsg.text?.includes('กินข้าว 80'), 'Must contain example transactions');

  // Verify 0 drafts created
  const draftsAfterStart = await query(`SELECT COUNT(*) as cnt FROM transaction_drafts WHERE user_id = $1;`, [user.id]);
  assert.equal(Number(draftsAfterStart.rows[0].cnt), 0, 'Must NOT create drafts for Start Record command');

  console.log('   ✅ "เริ่มจด" properly returns conversational guide without DB write.\n');

  // ----------------------------------------------------
  // 4. Test "อัพสลิป" (Top-Right Rich Menu Button)
  // ----------------------------------------------------
  console.log('4. Testing "อัพสลิป" button tap / message...');
  const slipReplies: MockReply[] = [];
  const clientSlip = createMockLineClient(slipReplies);

  await handleTextMessage(lineUser, 'อัพสลิป', 'TOKEN_SLIP_1', clientSlip);

  assert.equal(slipReplies.length, 1);
  const slipMsg = slipReplies[0].messages[0];
  assert(slipMsg.text?.includes('ถ่ายรูปหรือเลือกภาพสลิป/ใบเสร็จ'), 'Must reply with slip upload guide');
  assert(slipMsg.quickReply !== undefined, 'Must provide Quick Reply actions');

  const slipActionTypes = slipMsg.quickReply.items.map((i: any) => i.action.type);
  assert(slipActionTypes.includes('cameraRoll'), 'Must provide cameraRoll action');
  assert(slipActionTypes.includes('camera'), 'Must provide camera action');

  console.log('   ✅ "อัพสลิป" properly returns Camera/CameraRoll Quick Replies.\n');

  // ----------------------------------------------------
  // 5. Test "📊 สรุปยอด" (Bottom-Left Rich Menu Button)
  // ----------------------------------------------------
  console.log('5. Testing "📊 สรุปยอด" button tap / message...');
  const summaryReplies: MockReply[] = [];
  const clientSummary = createMockLineClient(summaryReplies);

  await handleTextMessage(lineUser, '📊 สรุปยอด', 'TOKEN_SUM_1', clientSummary);

  assert.equal(summaryReplies.length, 1);
  const sumMsg = summaryReplies[0].messages[0];
  assert(sumMsg.text?.includes('เลือกช่วงเวลาหรือหมวดหมู่'), 'Must reply with summary selector guide');
  assert(sumMsg.quickReply !== undefined, 'Must provide Quick Reply actions');
  assert(sumMsg.quickReply.items.length >= 4, 'Must provide quick query shortcuts');

  console.log('   ✅ "📊 สรุปยอด" properly returns Quick Summary shortcuts.\n');

  // ----------------------------------------------------
  // 6. Test Help / Guide ("วิธีใช้", "คู่มือ", "help")
  // ----------------------------------------------------
  console.log('6. Testing Help / Guide ("วิธีใช้", "help")...');
  const helpReplies: MockReply[] = [];
  const clientHelp = createMockLineClient(helpReplies);

  await handleTextMessage(lineUser, 'วิธีใช้', 'TOKEN_HELP_1', clientHelp);

  assert.equal(helpReplies.length, 1);
  const helpMsg = helpReplies[0].messages[0];
  assert(helpMsg.text?.includes('คู่มือการใช้งาน จดตัง'), 'Must return Help manual header');
  assert(helpMsg.text?.includes('เริ่มจดรายการ'), 'Must explain recording transactions');
  assert(helpMsg.text?.includes('ส่งรูปสลิป/ใบเสร็จ'), 'Must explain slip upload');
  assert(helpMsg.text?.includes('สรุปและดูยอด'), 'Must explain summary queries');

  console.log('   ✅ "วิธีใช้" properly returns comprehensive user guide.\n');

  // ----------------------------------------------------
  // 7. Test Recent Transactions ("ประวัติรายการ", "รายการล่าสุด")
  // ----------------------------------------------------
  console.log('7. Testing Recent Transactions ("ประวัติรายการ", "รายการล่าสุด")...');
  const recentReplies: MockReply[] = [];
  const clientRecent = createMockLineClient(recentReplies);

  await handleTextMessage(lineUser, 'รายการล่าสุด', 'TOKEN_RECENT_1', clientRecent);

  assert.equal(recentReplies.length, 1);
  const recentMsg = recentReplies[0].messages[0];
  assert(recentMsg.text?.includes('รายการล่าสุดที่บันทึกไว้'), 'Must return recent transactions header');
  assert(recentMsg.text?.includes('780.00'), 'Must display formatted transaction amount');
  assert(recentMsg.text?.includes('อาหารและเครื่องดื่ม'), 'Must display category');

  console.log('   ✅ "รายการล่าสุด" properly returns read-only recent transaction summary.\n');

  // ----------------------------------------------------
  // 8. Test Shortcut Execution ("สรุปค่าใช้จ่ายเดือนนี้")
  // ----------------------------------------------------
  console.log('8. Testing user tapping Quick Summary action "สรุปค่าใช้จ่ายเดือนนี้"...');
  const queryReplies: MockReply[] = [];
  const clientQuery = createMockLineClient(queryReplies);

  await handleTextMessage(lineUser, 'สรุปค่าใช้จ่ายเดือนนี้', 'TOKEN_QUERY_1', clientQuery);

  assert.equal(queryReplies.length, 1);
  const queryMsg = queryReplies[0].messages[0];
  assert(queryMsg.text?.includes('780 บาท'), 'Must execute query engine and return formatted total');
  assert(queryMsg.text?.includes('1 รายการ'), 'Must return transaction count');

  console.log('   ✅ Quick Summary shortcut seamlessly executes Query Path.\n');

  // ----------------------------------------------------
  // 9. Normal text input still smoothly routes to Write Path
  // ----------------------------------------------------
  console.log('9. Testing normal typing "กินข้าว 150" still creates draft...');
  const writeReplies: MockReply[] = [];
  const clientWrite = createMockLineClient(writeReplies);

  await handleTextMessage(lineUser, 'กินข้าว 150', 'TOKEN_WRITE_1', clientWrite);

  assert.equal(writeReplies.length, 1);
  const writeMsg = writeReplies[0].messages[0];
  assert.equal(writeMsg.type, 'flex', 'Must create draft and send Flex confirmation carousel');

  console.log('   ✅ Default keyboard typing creates transaction drafts as normal.\n');

  // Clean test fixtures
  await query(`DELETE FROM transaction_drafts WHERE user_id = $1;`, [user.id]);
  await query(`DELETE FROM transactions WHERE user_id = $1;`, [user.id]);
  await query(`DELETE FROM audit_logs WHERE user_id = $1;`, [user.id]);

  console.log('====================================================');
  console.log('🎉 ALL M12 UX & LINE MENU TESTS PASSED 100%!');
  console.log('====================================================\n');
}

runUxMenuTests().catch((err) => {
  console.error('❌ M12 UX Menu Test Failed:', err);
  process.exit(1);
});
