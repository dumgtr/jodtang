import assert from 'node:assert/strict';
import { pool, query } from '../src/db/client';
import { UserRepository } from '../src/modules/user/user.repository';
import { DraftRepository } from '../src/modules/draft/draft.repository';
import { TransactionRepository } from '../src/modules/transaction/transaction.repository';
import { handleTextMessage } from '../src/handlers/message.handler';
import { handlePostbackEvent } from '../src/handlers/postback.handler';

type Reply = {
  replyToken: string;
  messages: Array<{ type: string; text?: string; altText?: string; contents?: any }>;
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
  async function createConfirmedTx(amount: number, category: string, description: string) {
    const draft = await DraftRepository.createDraft({
      userId: userA.id,
      source: 'test',
      rawInput: `${description} ${amount}`,
      extractedData: {
        type: 'expense',
        amount,
        category_id: category,
        description,
        occurred_at: '2026-08-20',
      },
    });
    const result = await TransactionRepository.commitDraft(draft.id, userA.id);
    return result.transaction;
  }

  // 1. Test Confirmed Transaction Edit Flow
  console.log('\n1. Testing Confirmed Transaction Edit Flow...');
  const tx1 = await createConfirmedTx(4000, 'อาหารและเครื่องดื่ม', 'ดินเนอร์');
  assert.equal(Number(tx1.amount), 4000);
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

  // Step 1d: Confirm edit
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
  assert.equal(updatedTx.status, 'confirmed');

  // Verify Audit Log for EDIT_TRANSACTION
  const editAuditRes = await query(
    `SELECT * FROM audit_logs WHERE entity_id = $1 AND action = 'EDIT_TRANSACTION';`,
    [tx1.id]
  );
  assert.equal(editAuditRes.rowCount, 1);
  console.log('✅ Confirmed transaction edit flow verified.');

  // 2. Test Confirmed Transaction Void Flow
  console.log('\n2. Testing Confirmed Transaction Void Flow...');
  const tx2 = await createConfirmedTx(2000, 'ช้อปปิ้ง/ของใช้/อุปกรณ์', 'เสื้อเชิ้ต');
  assert.equal(tx2.status, 'confirmed');

  // Step 2a: Select tx to void -> shows confirmation bubble
  const repliesVoidPrompt: Reply[] = [];
  await handlePostbackEvent(
    userA,
    `action=select_tx_for_void&tx_id=${tx2.id}`,
    'token-void-prompt',
    createMockLineClient(repliesVoidPrompt)
  );
  assert.equal(repliesVoidPrompt.length, 1);
  assert.equal(repliesVoidPrompt[0].messages[0].type, 'flex');

  // Step 2b: Confirm void
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

  // 3. Test Ownership Enforcement (User B cannot edit or void User A transaction)
  console.log('\n3. Testing Cross-User Attack Rejection...');
  const tx3 = await createConfirmedTx(1500, 'สุขภาพ/ความงาม', 'ค่ายา');

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

  // 4. Test Idempotency & Invariant on Voided Transaction
  console.log('\n4. Testing Voided Transaction Invariants...');
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

  // 5. Test Command Intent Triggers
  console.log('\n5. Testing Natural Language Command Intent Triggers...');
  const repliesEditCommand: Reply[] = [];
  await handleTextMessage(
    userA.line_user_id,
    'ขอแก้ไขรายการ',
    'token-edit-cmd',
    createMockLineClient(repliesEditCommand)
  );
  assert.equal(repliesEditCommand.length, 1);
  assert.equal(repliesEditCommand[0].messages[0].type, 'flex');

  const repliesVoidCommand: Reply[] = [];
  await handleTextMessage(
    userA.line_user_id,
    'ขอลบรายการ',
    'token-void-cmd',
    createMockLineClient(repliesVoidCommand)
  );
  assert.equal(repliesVoidCommand.length, 1);
  assert.equal(repliesVoidCommand[0].messages[0].type, 'flex');
  console.log('✅ Natural language command intent triggers passed.');

  // 6. Test Atomic Rollback on Invalid Edit
  console.log('\n6. Testing Atomic Rollback on Invalid Edit...');
  const tx4 = await createConfirmedTx(500, 'การเดินทาง/ยานพาหนะ', 'ค่าแท็กซี่');
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

  console.log('\n🎉 ALL POST-COMMIT TRANSACTION TESTS PASSED SUCCESSFULLY!\n');
}

runTransactionManagementTests()
  .then(() => pool.end())
  .catch((err) => {
    console.error('❌ Test failed:', err);
    pool.end().finally(() => process.exit(1));
  });
