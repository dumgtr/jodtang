import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { query } from '../src/db/client';
import { UserRepository } from '../src/modules/user/user.repository';
import { DraftRepository } from '../src/modules/draft/draft.repository';
import { TransactionRepository } from '../src/modules/transaction/transaction.repository';
import { handleImageMessage } from '../src/handlers/image.handler';
import { handlePostbackEvent } from '../src/handlers/postback.handler';
import { handleWebhookEvent } from '../src/handlers/webhook-event.handler';
import { ISlipProvider, NormalizedSlipResult } from '../src/modules/slip/slip-provider.interface';
import { SlipService } from '../src/modules/slip/slip.service';

type MockReply = {
  replyToken: string;
  messages: any[];
};

function createMockLineClient(replies: MockReply[]): any {
  return {
    replyMessage: async (req: MockReply) => {
      replies.push(req);
      return {};
    },
  };
}

function createMockBlobClient(imageBytes: Buffer = Buffer.from('mock-slip-image-bytes')): any {
  return {
    getMessageContent: async (_messageId: string) => {
      return Readable.from(imageBytes);
    },
  };
}

class MockSlipProvider implements ISlipProvider {
  readonly name = 'MockSlipProvider';
  nextResult: NormalizedSlipResult;

  constructor(initialResult: NormalizedSlipResult) {
    this.nextResult = initialResult;
  }

  async verifySlipImage(): Promise<NormalizedSlipResult> {
    return this.nextResult;
  }
}

async function runSlipPipelineIntegrationTests() {
  console.log('====================================================');
  console.log('🧪 Testing Slip Pipeline & Slip2Go Integration Suite');
  console.log('====================================================\n');

  // Setup test user
  const lineUserId = `U_SLIP_TEST_${Date.now()}`;
  const user = await UserRepository.findOrCreateByLineUserId(lineUserId);

  // ----------------------------------------------------
  console.log('1. Testing Image Message -> Slip Verification -> Draft Creation...');
  const mockReplies1: MockReply[] = [];
  const lineClient1 = createMockLineClient(mockReplies1);
  const blobClient1 = createMockBlobClient();

  const mockProvider = new MockSlipProvider({
    status: 'SUCCESS',
    data: {
      amount: 100.0,
      occurredAt: new Date().toISOString(),
      merchant: 'STARBUCKS COFFEE',
      transRef: 'INT_TEST_REF_001',
      senderName: 'นายฐาณิสร์',
    },
  });

  const slipService = new SlipService(mockProvider);

  await handleImageMessage(
    lineUserId,
    'msg_123',
    'reply_token_1',
    lineClient1,
    blobClient1,
    slipService
  );

  assert.equal(mockReplies1.length, 1);
  const reply1 = mockReplies1[0].messages[0];
  assert.equal(reply1.type, 'flex', 'Must reply with a Flex message');
  assert(reply1.altText.includes('100.00'), 'Alt text should include amount');

  // Verify Draft in PostgreSQL
  const draft1 = await DraftRepository.findLatestPendingByUser(user.id);
  assert(draft1 !== null, 'Draft must be created in PostgreSQL');
  assert.equal(draft1.source, 'slip');
  assert.equal(Number(draft1.extracted_data.amount), 100);
  assert.equal(draft1.extracted_data.merchant_id, 'STARBUCKS COFFEE');
  assert.equal(draft1.extracted_data.category_id, 'อาหารและเครื่องดื่ม');
  assert.equal(draft1.status, 'pending_confirmation');

  // STRICT INVARIANT: Slip verification must NEVER create a permanent transaction directly!
  const txCheck = await query(
    'SELECT * FROM transactions WHERE user_id = $1;',
    [user.id]
  );
  assert.equal(txCheck.rowCount, 0, 'INVARIANT VIOLATION: Transaction was created before user confirmation!');

  console.log('   ✅ Slip verified and Draft created without creating permanent transaction.\n');

  // ----------------------------------------------------
  console.log('2. Testing Database-Level Duplicate Slip Protection...');
  const mockReplies2: MockReply[] = [];
  const lineClient2 = createMockLineClient(mockReplies2);

  // Send same slip again (same transRef 'INT_TEST_REF_001')
  await handleImageMessage(
    lineUserId,
    'msg_124',
    'reply_token_2',
    lineClient2,
    blobClient1,
    slipService
  );

  assert.equal(mockReplies2.length, 1);
  const reply2 = mockReplies2[0].messages[0];
  assert.equal(reply2.type, 'text');
  assert(reply2.text.includes('สลิปนี้ถูกตรวจสอบหรือใช้งานไปแล้ว'), 'Must notify user of duplicate slip');

  // Verify no additional draft was created
  const draftCountRes = await query(
    'SELECT COUNT(*)::int as cnt FROM transaction_drafts WHERE user_id = $1;',
    [user.id]
  );
  assert.equal(draftCountRes.rows[0].cnt, 1, 'Duplicate slip must not create additional drafts');
  console.log('   ✅ Duplicate slip rejected cleanly by database transRef check.\n');

  // ----------------------------------------------------
  console.log('3. Testing Provider-Level Duplicate Rejection (200501 / 400004)...');
  mockProvider.nextResult = {
    status: 'DUPLICATE',
    rawCode: '200501',
    errorMessage: 'Slip is Duplicated.',
  };

  const mockReplies3: MockReply[] = [];
  const lineClient3 = createMockLineClient(mockReplies3);

  await handleImageMessage(
    lineUserId,
    'msg_125',
    'reply_token_3',
    lineClient3,
    blobClient1,
    slipService
  );

  assert.equal(mockReplies3.length, 1);
  const reply3 = mockReplies3[0].messages[0];
  assert.equal(reply3.type, 'text');
  assert(reply3.text.includes('สลิปนี้ถูกตรวจสอบหรือใช้งานไปแล้ว'));
  console.log('   ✅ Provider DUPLICATE response mapped and handled gracefully.\n');

  // ----------------------------------------------------
  console.log('4. Testing Group Chat Privacy Guard...');
  const groupEvent: any = {
    type: 'message',
    message: { id: 'img_group_msg', type: 'image' },
    source: { type: 'group', groupId: 'G_TEST_123', userId: lineUserId },
    replyToken: 'reply_token_group',
  };

  const mockReplies4: MockReply[] = [];
  const lineClient4 = createMockLineClient(mockReplies4);

  let providerCalledInGroup = false;
  const spyProvider: ISlipProvider = {
    name: 'SpyProvider',
    verifySlipImage: async () => {
      providerCalledInGroup = true;
      return { status: 'SUCCESS' };
    },
  };

  await handleWebhookEvent(groupEvent, {
    lineClient: lineClient4,
    findOrCreateByLineUserId: async (uid) => UserRepository.findOrCreateByLineUserId(uid),
    handleTextMessage: async () => {},
    handleImageMessage: async (uid, msgId, replyToken, lc, bc) => {
      await handleImageMessage(uid, msgId, replyToken, lc, bc, new SlipService(spyProvider));
    },
    handlePostbackEvent: async () => {},
  });

  assert.equal(mockReplies4.length, 1);
  assert(mockReplies4[0].messages[0].text.includes('เพื่อความเป็นส่วนตัวและความปลอดภัย'));
  assert.equal(providerCalledInGroup, false, 'Provider must NEVER be called from group chats!');
  console.log('   ✅ Group chats rejected with privacy notice before calling provider.\n');

  // ----------------------------------------------------
  console.log('5. Testing User Confirmation Flow (action=confirm)...');
  const mockReplies5: MockReply[] = [];
  const lineClient5 = createMockLineClient(mockReplies5);

  // User taps "✅ ยืนยัน"
  await handlePostbackEvent(
    user,
    `action=confirm&draft_id=${draft1.id}`,
    'reply_token_confirm',
    lineClient5
  );

  assert.equal(mockReplies5.length, 1);
  assert(mockReplies5[0].messages[0].text.includes('บันทึกรายการเรียบร้อย!'));
  assert(mockReplies5[0].messages[0].text.includes('100.00'));
  assert(mockReplies5[0].messages[0].text.includes('STARBUCKS COFFEE'));

  // Verify permanent transaction in DB
  const confirmedDraft = await DraftRepository.findById(draft1.id, user.id);
  assert.equal(confirmedDraft?.status, 'confirmed');
  assert(confirmedDraft?.transaction_id !== null);

  const tx = await TransactionRepository.findByIdAndUser(confirmedDraft!.transaction_id!, user.id);
  assert(tx !== null, 'Permanent transaction must exist');
  assert.equal(Number(tx.amount), 100);
  assert.equal(tx.merchant_id, 'STARBUCKS COFFEE');
  assert.equal(tx.status, 'confirmed');

  // Verify audit log
  const auditRes = await query(
    "SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'COMMIT_DRAFT';",
    [tx.id]
  );
  assert.equal(auditRes.rowCount, 1, 'Audit log must be recorded for committed transaction');
  console.log('   ✅ User confirmation atomically commits draft into permanent transaction with audit log.\n');

  // ----------------------------------------------------
  console.log('6. Testing Draft Cancellation Flow (action=cancel)...');
  // Create another draft
  mockProvider.nextResult = {
    status: 'SUCCESS',
    data: {
      amount: 45.0,
      occurredAt: new Date().toISOString(),
      merchant: '7-ELEVEN',
      transRef: 'INT_TEST_REF_002',
    },
  };

  const mockReplies6: MockReply[] = [];
  await handleImageMessage(
    lineUserId,
    'msg_126',
    'reply_token_6',
    createMockLineClient(mockReplies6),
    blobClient1,
    slipService
  );

  const draft2 = await DraftRepository.findLatestPendingByUser(user.id);
  assert(draft2 !== null);
  assert.equal(Number(draft2.extracted_data.amount), 45);

  // Cancel draft
  const mockRepliesCancel: MockReply[] = [];
  await handlePostbackEvent(
    user,
    `action=cancel&draft_id=${draft2.id}`,
    'reply_token_cancel',
    createMockLineClient(mockRepliesCancel)
  );

  assert.equal(mockRepliesCancel.length, 1);
  assert(mockRepliesCancel[0].messages[0].text.includes('ยกเลิกรายการแล้ว'));

  const cancelledDraft = await DraftRepository.findById(draft2.id, user.id);
  assert.equal(cancelledDraft?.status, 'cancelled');

  // Verify no new transaction was created for draft 2
  const tx2Check = await query(
    'SELECT * FROM transactions WHERE user_id = $1 AND amount = 45;',
    [user.id]
  );
  assert.equal(tx2Check.rowCount, 0, 'Cancelled draft must not produce a transaction');
  console.log('   ✅ Cancelled draft correctly marked cancelled without creating transaction.\n');

  // ----------------------------------------------------
  console.log('7. Testing Negative & Specific Response Cases...');

  // Record initial draft count
  const initialDrafts = await query('SELECT COUNT(*)::int as cnt FROM transaction_drafts WHERE user_id = $1;', [user.id]);
  const initialTx = await query('SELECT COUNT(*)::int as cnt FROM transactions WHERE user_id = $1;', [user.id]);

  // 7a. Not Found (200404)
  mockProvider.nextResult = { status: 'NOT_FOUND', rawCode: '200404' };
  const mockReplies7a: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7a', 'token_7a', createMockLineClient(mockReplies7a), blobClient1, slipService);
  assert(mockReplies7a[0].messages[0].text.includes('ไม่พบข้อมูลสลิปนี้'));

  // 7b. Blurry image (400002)
  mockProvider.nextResult = { status: 'INVALID_IMAGE', rawCode: '400002' };
  const mockReplies7b: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7b', 'token_7b', createMockLineClient(mockReplies7b), blobClient1, slipService);
  assert(mockReplies7b[0].messages[0].text.includes('ภาพไม่ชัดหรือไม่พบ QR Code'));

  // 7c. Fraudulent slip (200500)
  mockProvider.nextResult = { status: 'FRAUD', rawCode: '200500' };
  const mockReplies7c: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7c', 'token_7c', createMockLineClient(mockReplies7c), blobClient1, slipService);
  assert(mockReplies7c[0].messages[0].text.includes('ไม่สามารถยืนยันสลิปนี้ได้'));

  // 7d. Recipient mismatch (200401)
  mockProvider.nextResult = { status: 'RECIPIENT_MISMATCH', rawCode: '200401' };
  const mockReplies7d: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7d', 'token_7d', createMockLineClient(mockReplies7d), blobClient1, slipService);
  assert(mockReplies7d[0].messages[0].text.includes('บัญชีผู้รับเงินไม่ตรง'));

  // 7e. Amount mismatch (200402)
  mockProvider.nextResult = { status: 'AMOUNT_MISMATCH', rawCode: '200402' };
  const mockReplies7e: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7e', 'token_7e', createMockLineClient(mockReplies7e), blobClient1, slipService);
  assert(mockReplies7e[0].messages[0].text.includes('ยอดเงินในสลิปไม่ตรง'));

  // 7f. Date mismatch (200403)
  mockProvider.nextResult = { status: 'DATE_MISMATCH', rawCode: '200403' };
  const mockReplies7f: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7f', 'token_7f', createMockLineClient(mockReplies7f), blobClient1, slipService);
  assert(mockReplies7f[0].messages[0].text.includes('วันที่โอนในสลิปไม่ตรง'));

  // 7g. Bank error / retryable (200502)
  mockProvider.nextResult = { status: 'BANK_ERROR', rawCode: '200502' };
  const mockReplies7g: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7g', 'token_7g', createMockLineClient(mockReplies7g), blobClient1, slipService);
  assert(mockReplies7g[0].messages[0].text.includes('ธนาคารปลายทางขัดข้องชั่วคราว'));

  // 7h. Temporary conflict (400409)
  mockProvider.nextResult = { status: 'TEMPORARY_CONFLICT', rawCode: '400409' };
  const mockReplies7h: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7h', 'token_7h', createMockLineClient(mockReplies7h), blobClient1, slipService);
  assert(mockReplies7h[0].messages[0].text.includes('ระบบกำลังตรวจสอบรายการหรือมีคำขอซ้อนกัน'));

  // 7i. Queued (200202)
  mockProvider.nextResult = { status: 'QUEUED', rawCode: '200202' };
  const mockReplies7i: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7i', 'token_7i', createMockLineClient(mockReplies7i), blobClient1, slipService);
  assert(mockReplies7i[0].messages[0].text.includes('ระบบกำลังประมวลผลสลิป'));

  // 7j. Quota exceeded (400005)
  mockProvider.nextResult = { status: 'QUOTA_EXCEEDED', rawCode: '400005' };
  const mockReplies7j: MockReply[] = [];
  await handleImageMessage(lineUserId, 'msg_7j', 'token_7j', createMockLineClient(mockReplies7j), blobClient1, slipService);
  assert(mockReplies7j[0].messages[0].text.includes('ระบบตรวจสลิปชั่วคราวไม่พร้อมให้บริการ'));

  // Verify STRICT INVARIANT: NONE of these error/edge cases created any drafts or transactions
  const finalDrafts = await query('SELECT COUNT(*)::int as cnt FROM transaction_drafts WHERE user_id = $1;', [user.id]);
  const finalTx = await query('SELECT COUNT(*)::int as cnt FROM transactions WHERE user_id = $1;', [user.id]);
  assert.equal(finalDrafts.rows[0].cnt, initialDrafts.rows[0].cnt, 'Error cases must NOT create any Drafts!');
  assert.equal(finalTx.rows[0].cnt, initialTx.rows[0].cnt, 'Error cases must NOT create any Transactions!');

  console.log('   ✅ All 10 negative & edge cases handled gracefully with accurate Thai messages.');
  console.log('   ✅ STRICT INVARIANT: 0 drafts and 0 transactions created across all error cases.\n');

  console.log('====================================================');
  console.log('🎉 ALL SLIP PIPELINE INTEGRATION TESTS PASSED 100%!');
  console.log('====================================================');
}

runSlipPipelineIntegrationTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
