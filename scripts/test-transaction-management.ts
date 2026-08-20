import assert from 'node:assert/strict';
import { pool, query } from '../src/db/client';
import { UserRepository } from '../src/modules/user/user.repository';
import { DraftRepository } from '../src/modules/draft/draft.repository';
import { TransactionRepository } from '../src/modules/transaction/transaction.repository';
import { ConversationService } from '../src/services/conversation.service';
import { handleTextMessage } from '../src/handlers/message.handler';
import { handlePostbackEvent } from '../src/handlers/postback.handler';

type Reply = {
  replyToken: string;
  messages: Array<{ type: string; text?: string; altText?: string; contents?: any; quickReply?: any }>;
};

function createMockLineClient(replies: Reply[]) {
  return {
    replyMessage: async (reply: Reply) => {
      replies.push(reply);
    },
  } as any;
}

async function runTransactionManagementTests() {
  console.log('====================================================');
  console.log('🧪 Testing Confirmed Transaction Edit & Void Suite');
  console.log('====================================================');

  const userA = await UserRepository.findOrCreateByLineUserId('U_TEST_TX_MGMT_AAA');
  const userB = await UserRepository.findOrCreateByLineUserId('U_TEST_TX_MGMT_BBB');

  // Helper to create a confirmed transaction
  async function createConfirmedTx(amount: number, category: string, description: string, merchant: string = 'ร้านตั้งต้น') {
    const draft = await DraftRepository.createDraft({
      userId: userA.id,
      source: 'test',
      rawInput: `${description} ${amount}`,
      extractedData: {
        type: 'expense',
        amount,
        category_id: category,
        merchant_id: merchant,
        description,
        occurred_at: '2026-08-20',
      },
    });
    const result = await TransactionRepository.commitDraft(draft.id, userA.id);
    return { transaction: result.transaction, draftId: draft.id };
  }

  // 1. Test Confirmed Transaction Edit Flow with Stale Target Assertions
  console.log('\n1. Testing Confirmed Transaction Edit Flow...');
  const { transaction: tx1, draftId: draftId1 } = await createConfirmedTx(4000, 'อาหารและเครื่องดื่ม', 'ดินเนอร์', 'ร้านบาร์บีคิว');
  assert.equal(Number(tx1.amount), 4000);
  assert.equal(tx1.merchant_id, 'ร้านบาร์บีคิว');
  assert.equal(tx1.status, 'confirmed');

  // Step 1a: Select field to edit
  const replies1: Reply[] = [];
  await handlePostbackEvent(
    userA,
    `action=select_tx_for_edit&tx_id=${tx1.id}`,
    'token-edit-select',
    createMockLineClient(replies1)
  );
  assert.equal(replies1.length, 1);
  assert(replies1[0].messages[0].text?.includes('ต้องการแก้ไขข้อมูลส่วนไหน'));

  // Step 1b: Set field = amount
  await handlePostbackEvent(
    userA,
    `action=set_tx_field&field=amount&tx_id=${tx1.id}`,
    'token-edit-field',
    createMockLineClient([])
  );

  // Step 1c: User types new amount "4500"
  const repliesInput: Reply[] = [];
  await handleTextMessage(
    userA.line_user_id,
    '4500',
    'token-input-4500',
    createMockLineClient(repliesInput)
  );
  assert.equal(repliesInput.length, 1);
  assert(repliesInput[0].messages[0].type === 'flex');

  // Step 1d: Confirm edit with correct target
  const repliesConfirmEdit: Reply[] = [];
  await handlePostbackEvent(
    userA,
    `action=confirm_tx_edit&tx_id=${tx1.id}`,
    'token-confirm-edit',
    createMockLineClient(repliesConfirmEdit)
  );
  assert.equal(repliesConfirmEdit.length, 1);
  assert(repliesConfirmEdit[0].messages[0].text?.includes('อัปเดตรายการเรียบร้อยแล้ว'));

  // Verify in PostgreSQL
  const updatedTxRes = await query(`SELECT * FROM transactions WHERE id = $1;`, [tx1.id]);
  const updatedTx = updatedTxRes.rows[0];
  assert.equal(Number(updatedTx.amount), 4500);
  assert.equal(updatedTx.merchant_id, 'ร้านบาร์บีคิว', 'merchant_id must be preserved when editing amount');
  assert.equal(updatedTx.status, 'confirmed');

  // Verify Audit Log for EDIT_TRANSACTION
  const editAuditRes = await query(
    `SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'EDIT_TRANSACTION';`,
    [tx1.id]
  );
  assert.equal(editAuditRes.rowCount, 1);
  console.log('✅ Confirmed transaction edit flow verified.');

  // 1B. Test Post-Confirmation Draft Button Tap Bridges to Confirmed Tx Flow
  console.log('\n1B. Testing Post-Confirmation Draft Button Tap Bridges to Confirmed Tx Flow...');
  const repliesPostConfirmEditBtn: Reply[] = [];
  await handlePostbackEvent(
    userA,
    `action=edit&draft_id=${draftId1}`,
    'token-old-draft-edit-btn',
    createMockLineClient(repliesPostConfirmEditBtn)
  );
  assert.equal(repliesPostConfirmEditBtn.length, 1);
  assert(repliesPostConfirmEditBtn[0].messages[0].text?.includes('ต้องการแก้ไขข้อมูลส่วนไหน'));
  assert.equal(ConversationService.getState(userA.id)?.targetType, 'transaction');
  ConversationService.clearState(userA.id);

  // 2. Data Integrity: Deterministic Field Preservation Tests
  console.log('\n2. Testing Deterministic Field Preservation (merchant_id protection)...');
  const { transaction: baseTx } = await createConfirmedTx(1000, 'อาหารและเครื่องดื่ม', 'ก๋วยเตี๋ยว', 'ร้านลุงอ้วน');

  // 2A. Edit Amount only -> merchant_id preserved
  const txAfterAmount = await TransactionRepository.updateTransaction(baseTx.id, userA.id, {
    amount: 1200,
  });
  assert.equal(Number(txAfterAmount.amount), 1200);
  assert.equal(txAfterAmount.merchant_id, 'ร้านลุงอ้วน', 'merchant_id must remain unchanged on amount edit');
  assert.equal(txAfterAmount.category_id, 'อาหารและเครื่องดื่ม');
  assert.equal(txAfterAmount.description, 'ก๋วยเตี๋ยว');

  // 2B. Edit Category only -> merchant_id preserved
  const txAfterCatResult = await TransactionRepository.updateTransaction(baseTx.id, userA.id, {
    category_id: 'ช้อปปิ้ง',
  });
  assert.equal(txAfterCatResult.category_id, 'ช้อปปิ้ง');
  assert.equal(txAfterCatResult.merchant_id, 'ร้านลุงอ้วน', 'merchant_id must remain unchanged on category edit');
  assert.equal(Number(txAfterCatResult.amount), 1200);

  // 2C. Edit Date only -> merchant_id preserved
  const txAfterDate = await TransactionRepository.updateTransaction(baseTx.id, userA.id, {
    occurred_at: '2026-08-25',
  });
  assert.equal(new Date(txAfterDate.occurred_at).toISOString().startsWith('2026-08-25'), true);
  assert.equal(txAfterDate.merchant_id, 'ร้านลุงอ้วน', 'merchant_id must remain unchanged on date edit');

  // 2D. Edit Description only -> merchant_id preserved (NO description leak into merchant_id!)
  const txAfterDesc = await TransactionRepository.updateTransaction(baseTx.id, userA.id, {
    description: 'ก๋วยเตี๋ยวต้มยำพิเศษ',
  });
  assert.equal(txAfterDesc.description, 'ก๋วยเตี๋ยวต้มยำพิเศษ');
  assert.equal(txAfterDesc.merchant_id, 'ร้านลุงอ้วน', 'merchant_id must remain unchanged on description edit');

  // 2E. Explicit merchant_id update -> changes merchant_id
  const txAfterMerchant = await TransactionRepository.updateTransaction(baseTx.id, userA.id, {
    merchant_id: 'ร้านป้าสมใจ',
  });
  assert.equal(txAfterMerchant.merchant_id, 'ร้านป้าสมใจ');
  console.log('✅ Deterministic field preservation verified.');

  // 3. Stale Edit State / Target Mismatch Rejection Tests
  console.log('\n3. Testing Stale State & Target Mismatch Rejection...');
  const { transaction: txA } = await createConfirmedTx(500, 'อาหารและเครื่องดื่ม', 'ข้าวแกง', 'ร้าน A');
  const { transaction: txB } = await createConfirmedTx(800, 'อาหารและเครื่องดื่ม', 'สุกี้', 'ร้าน B');

  // Set pending edits for txA in ConversationService
  ConversationService.setState(userA.id, {
    targetType: 'transaction',
    transactionId: txA.id,
    step: 'select_tx_field',
    pendingEdits: { amount: 9999 },
  });

  // User taps confirm button for txB while state is set for txA (Mismatch!)
  const repliesMismatch: Reply[] = [];
  await handlePostbackEvent(
    userA,
    `action=confirm_tx_edit&tx_id=${txB.id}`,
    'token-mismatch',
    createMockLineClient(repliesMismatch)
  );
  assert.equal(repliesMismatch.length, 1);
  assert(repliesMismatch[0].messages[0].text?.includes('ข้อมูลการแก้ไขไม่ถูกต้อง'));

  // Verify txA and txB were NOT mutated
  const checkTxA = await TransactionRepository.findByIdAndUser(txA.id, userA.id);
  const checkTxB = await TransactionRepository.findByIdAndUser(txB.id, userA.id);
  assert.equal(Number(checkTxA?.amount), 500, 'txA must not be mutated on target mismatch');
  assert.equal(Number(checkTxB?.amount), 800, 'txB must not be mutated on target mismatch');

  // Verify conversation state was cleared
  assert.equal(ConversationService.getState(userA.id), undefined);
  console.log('✅ Stale target mismatch rejection verified.');

  // 4. Test Confirmed Transaction Void Flow
  console.log('\n4. Testing Confirmed Transaction Void Flow...');
  const { transaction: tx2, draftId: draftId2 } = await createConfirmedTx(2000, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'เสื้อเชิ้ต');
  assert.equal(tx2.status, 'confirmed');

  // Step 4a: Select tx to void -> shows confirmation bubble
  const repliesVoidPrompt: Reply[] = [];
  await handlePostbackEvent(
    userA,
    `action=select_tx_for_void&tx_id=${tx2.id}`,
    'token-void-prompt',
    createMockLineClient(repliesVoidPrompt)
  );
  assert.equal(repliesVoidPrompt.length, 1);
  assert.equal(repliesVoidPrompt[0].messages[0].type, 'flex');

  // Step 4b: Confirm void
  const repliesConfirmVoid: Reply[] = [];
  await handlePostbackEvent(
    userA,
    `action=confirm_tx_void&tx_id=${tx2.id}`,
    'token-confirm-void',
    createMockLineClient(repliesConfirmVoid)
  );
  assert.equal(repliesConfirmVoid.length, 1);
  assert(repliesConfirmVoid[0].messages[0].text?.includes('ลบ/ยกเลิกรายการเรียบร้อยแล้ว'));

  // Verify in PostgreSQL
  const voidedTxRes = await query(`SELECT * FROM transactions WHERE id = $1;`, [tx2.id]);
  const voidedTx = voidedTxRes.rows[0];
  assert.equal(voidedTx.status, 'voided');

  // Verify Audit Log for VOID_TRANSACTION
  const voidAuditRes = await query(
    `SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'VOID_TRANSACTION';`,
    [tx2.id]
  );
  assert.equal(voidAuditRes.rowCount, 1);
  console.log('✅ Confirmed transaction void flow verified.');

  // 4B. Test Post-Confirmation Draft Cancel Button Tap Bridges to Confirmed Tx Void Prompt
  console.log('\n4B. Testing Post-Confirmation Draft Cancel Button Tap Bridges to Confirmed Tx Void...');
  const { transaction: txToVoidViaDraft, draftId: draftToVoid } = await createConfirmedTx(300, 'อาหารและเครื่องดื่ม', 'กาแฟสด');
  const repliesPostConfirmCancelBtn: Reply[] = [];
  await handlePostbackEvent(
    userA,
    `action=cancel&draft_id=${draftToVoid}`,
    'token-old-draft-cancel-btn',
    createMockLineClient(repliesPostConfirmCancelBtn)
  );
  assert.equal(repliesPostConfirmCancelBtn.length, 1);
  assert.equal(repliesPostConfirmCancelBtn[0].messages[0].type, 'flex'); // Displays void confirmation card

  // 5. Test Ownership Enforcement (User B cannot edit or void User A transaction)
  console.log('\n5. Testing Cross-User Attack Rejection...');
  const { transaction: tx3 } = await createConfirmedTx(1500, 'สุขภาพ/ความงาม', 'ค่ายา');

  // User B tries to void User A transaction
  let crossUserVoidFailed = false;
  try {
    await TransactionRepository.voidTransaction(tx3.id, userB.id);
  } catch (err: any) {
    if (err.message.includes('TRANSACTION_NOT_FOUND')) {
      crossUserVoidFailed = true;
    }
  }
  assert.equal(crossUserVoidFailed, true, 'User B must not be able to void User A transaction');

  // User B tries to edit User A transaction
  let crossUserEditFailed = false;
  try {
    await TransactionRepository.updateTransaction(tx3.id, userB.id, { amount: 100 });
  } catch (err: any) {
    if (err.message.includes('TRANSACTION_NOT_FOUND')) {
      crossUserEditFailed = true;
    }
  }
  assert.equal(crossUserEditFailed, true, 'User B must not be able to edit User A transaction');
  console.log('✅ Cross-user security assertions passed.');

  // 6. Test Idempotency & Invariant on Voided Transaction
  console.log('\n6. Testing Voided Transaction Invariants...');
  // Cannot void an already voided transaction
  let doubleVoidFailed = false;
  try {
    await TransactionRepository.voidTransaction(tx2.id, userA.id);
  } catch (err: any) {
    if (err.message.includes('TRANSACTION_ALREADY_VOIDED')) {
      doubleVoidFailed = true;
    }
  }
  assert.equal(doubleVoidFailed, true, 'Cannot void an already voided transaction');

  // Cannot edit a voided transaction
  let editVoidedFailed = false;
  try {
    await TransactionRepository.updateTransaction(tx2.id, userA.id, { amount: 999 });
  } catch (err: any) {
    if (err.message.includes('TRANSACTION_NOT_EDITABLE')) {
      editVoidedFailed = true;
    }
  }
  assert.equal(editVoidedFailed, true, 'Cannot edit a voided transaction');
  console.log('✅ Voided transaction invariants passed.');

  // 7. Test Command Intent Triggers with Emojis and Natural Phrases
  console.log('\n7. Testing Natural Language Command Intent Triggers (with Emojis)...');
  await query("UPDATE transaction_drafts SET status = 'cancelled' WHERE user_id = $1 AND status = 'pending_confirmation';", [userA.id]);
  const repliesEditCommand: Reply[] = [];
  await handleTextMessage(
    userA.line_user_id,
    '✏️ ขอแก้ไขรายการ',
    'token-edit-cmd-emoji',
    createMockLineClient(repliesEditCommand)
  );
  assert.equal(repliesEditCommand.length, 1);
  assert.equal(repliesEditCommand[0].messages[0].type, 'flex');

  const repliesVoidCommand: Reply[] = [];
  await handleTextMessage(
    userA.line_user_id,
    '❌ ยกเลิกรายการ',
    'token-void-cmd-emoji',
    createMockLineClient(repliesVoidCommand)
  );
  assert.equal(repliesVoidCommand.length, 1);
  assert.equal(repliesVoidCommand[0].messages[0].type, 'flex');
  console.log('✅ Natural language command intent triggers (with emojis) passed.');

  // 8. Test Draft Precedence: Active Draft Edit Takes Precedence
  console.log('\n8. Testing Active Pending Draft Precedence...');
  const pendingDraft = await DraftRepository.createDraft({
    userId: userA.id,
    source: 'test',
    rawInput: 'กินข้าวหมูกรอบ 65',
    extractedData: {
      type: 'expense',
      amount: 65,
      category_id: 'อาหารและเครื่องดื่ม',
      description: 'ข้าวหมูกรอบ',
    },
  });

  // When user types "ขอแก้ไขรายการ" while having a pending draft -> prompts draft edit
  const repliesDraftEditCmd: Reply[] = [];
  await handleTextMessage(
    userA.line_user_id,
    'ขอแก้ไขรายการ',
    'token-edit-pending-draft',
    createMockLineClient(repliesDraftEditCmd)
  );
  assert.equal(repliesDraftEditCmd.length, 1);
  assert(repliesDraftEditCmd[0].messages[0].text?.includes('รายการที่รอยืนยัน'));
  assert.equal(ConversationService.getState(userA.id)?.targetType, 'draft');

  // Cancel the pending draft
  await DraftRepository.cancelDraft(pendingDraft.id, userA.id);
  ConversationService.clearState(userA.id);
  console.log('✅ Active pending draft precedence verified.');

  // 9. Test Atomic Rollback on Invalid Edit
  console.log('\n9. Testing Atomic Rollback on Invalid Edit...');
  const { transaction: tx4 } = await createConfirmedTx(500, 'การเดินทาง/ยานพาหนะ', 'ค่าแท็กซี่');
  let invalidEditFailed = false;
  try {
    await TransactionRepository.updateTransaction(tx4.id, userA.id, {
      amount: -50, // Invalid negative amount
    });
  } catch {
    invalidEditFailed = true;
  }
  assert.equal(invalidEditFailed, true);
  const checkTx4Res = await query(`SELECT * FROM transactions WHERE id = $1;`, [tx4.id]);
  assert.equal(Number(checkTx4Res.rows[0].amount), 500, 'Amount must remain unchanged after rollback');
  console.log('✅ Atomic rollback on invalid edit passed.');

  console.log('\n🎉 ALL HARDENED POST-COMMIT TRANSACTION TESTS PASSED SUCCESSFULLY!\n');
}

runTransactionManagementTests()
  .then(() => pool.end())
  .catch((err) => {
    console.error('❌ Test failed:', err);
    pool.end().finally(() => process.exit(1));
  });
