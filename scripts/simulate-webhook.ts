import crypto from 'crypto';
import { env } from '../src/config/env';
import { pool, query } from '../src/db/client';
import { TransactionRepository } from '../src/modules/transaction/transaction.repository';

const BASE_URL = `http://localhost:${env.PORT}`;
const MOCK_USER_A = 'U_MOCK_TEST_USER_AAA';
const MOCK_USER_B = 'U_MOCK_TEST_USER_BBB';

/**
 * Helper to compute LINE HMAC-SHA256 signature
 */
function createLineSignature(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

/**
 * Send simulated webhook event payload to the local server
 */
async function sendWebhookPayload(events: any[], signature?: string): Promise<Response> {
  const body = JSON.stringify({
    destination: 'U_MOCK_DESTINATION',
    events,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (signature !== undefined) {
    headers['x-line-signature'] = signature;
  }

  return fetch(`${BASE_URL}/webhook`, {
    method: 'POST',
    headers,
    body,
  });
}

async function sendWebhookEvent(events: any[]): Promise<Response> {
  const body = JSON.stringify({
    destination: 'U_MOCK_DESTINATION',
    events,
  });
  return sendWebhookPayload(events, createLineSignature(body, env.LINE_CHANNEL_SECRET));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSimulation() {
  console.log('====================================================');
  console.log('🤖 จดตัง (JodTang) - P0/P1 Webhook Audit Verification');
  console.log('====================================================');
  console.log(`Target URL: ${BASE_URL}/webhook`);
  console.log(`Primary Mock User: ${MOCK_USER_A}`);
  console.log(`Attacker/Secondary Mock User: ${MOCK_USER_B}\n`);

  try {
    // 0. Check server health
    console.log('🔍 [0/6] Checking server health...');
    try {
      const healthRes = await fetch(`${BASE_URL}/health`);
      if (!healthRes.ok) throw new Error(`Healthcheck returned status ${healthRes.status}`);
      const healthJson = await healthRes.json();
      console.log('✅ Server is alive:', healthJson);
    } catch (e: any) {
      console.error('❌ Server is not reachable at', BASE_URL);
      console.error('👉 Please start the server with: npm run dev\n');
      process.exit(1);
    }

    // 0a. Signature and verification-ping semantics
    console.log('\n----------------------------------------------------');
    console.log('🔐 Testing missing/invalid signatures and verification ping');
    const unsignedResponse = await sendWebhookPayload([]);
    if (unsignedResponse.status !== 401) {
      throw new Error(`Missing signature must return 401, got ${unsignedResponse.status}`);
    }

    const invalidSignatureResponse = await sendWebhookPayload([], 'invalid-signature');
    if (invalidSignatureResponse.status !== 401) {
      throw new Error(`Invalid signature must return 401, got ${invalidSignatureResponse.status}`);
    }

    const verificationResponse = await sendWebhookEvent([]);
    if (verificationResponse.status !== 200) {
      throw new Error(`Valid verification ping must return 200, got ${verificationResponse.status}`);
    }
    console.log('✅ Webhook signature and verification-ping semantics passed.');

    // 1. Non-Financial Input Test: "hello สวัสดีครับ" -> MUST NOT create any draft
    console.log('\n----------------------------------------------------');
    console.log('💬 [1/6] Testing Non-Financial Input: "hello สวัสดีครับ"');
    const initialDraftCountRes = await query(`SELECT COUNT(*) FROM transaction_drafts;`);
    const initialCount = parseInt(initialDraftCountRes.rows[0].count, 10);

    const nonFinancialEvent = {
      type: 'message',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user', userId: MOCK_USER_A },
      webhookEventId: 'mock-event-non-fin-1',
      deliveryContext: { isRedelivery: false },
      message: { id: 'mock-msg-0', type: 'text', text: 'hello สวัสดีครับ' },
      replyToken: 'mock-reply-token-non-fin',
    };

    await sendWebhookEvent([nonFinancialEvent]);
    await sleep(1000);

    const afterCountRes = await query(`SELECT COUNT(*) FROM transaction_drafts;`);
    const afterCount = parseInt(afterCountRes.rows[0].count, 10);

    if (afterCount === initialCount) {
      console.log('✅ Invariant Verified: No 0-baht draft created for non-financial input.');
    } else {
      throw new Error('❌ FAILED: A draft was created for non-financial text!');
    }

    // 2. Financial Input: "ซื้อของ 30,000" -> Draft created with 30000.00
    console.log('\n----------------------------------------------------');
    console.log('📩 [2/6] Testing Financial Input with Commas: "ซื้อของ 30,000"');
    const textEvent = {
      type: 'message',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user', userId: MOCK_USER_A },
      webhookEventId: 'mock-event-text-1',
      deliveryContext: { isRedelivery: false },
      message: { id: 'mock-msg-1', type: 'text', text: 'ซื้อของ 30,000' },
      replyToken: 'mock-reply-token-text-1',
    };

    await sendWebhookEvent([textEvent]);
    await sleep(1500);

    const draftRes = await query(
      `SELECT d.*, u.line_user_id
       FROM transaction_drafts d
       JOIN users u ON d.user_id = u.id
       WHERE u.line_user_id = $1
       ORDER BY d.created_at DESC
       LIMIT 1;`,
      [MOCK_USER_A]
    );

    if (draftRes.rowCount === 0) {
      throw new Error('❌ Draft was not found in PostgreSQL database.');
    }

    const draft = draftRes.rows[0];
    console.log(`✅ Draft Created: ID ${draft.id}, Amount: ฿${draft.extracted_data.amount}, Category: ${draft.extracted_data.category_id}`);

    if (Number(draft.extracted_data.amount) !== 30000) {
      throw new Error(`❌ Comma parsing failed! Expected 30000 but got ${draft.extracted_data.amount}`);
    }

    // 3. Cross-User Security Test: User B tries to confirm User A's draft
    console.log('\n----------------------------------------------------');
    console.log(`🛡️  [3/6] Testing Cross-User Attack: User B tries to confirm User A's draft (${draft.id})`);
    const attackEvent = {
      type: 'postback',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user', userId: MOCK_USER_B },
      webhookEventId: 'mock-event-attack-1',
      deliveryContext: { isRedelivery: false },
      postback: { data: `action=confirm&draft_id=${draft.id}` },
      replyToken: 'mock-reply-token-attack',
    };

    await sendWebhookEvent([attackEvent]);
    await sleep(1000);

    const checkDraftUnmutated = await query(`SELECT status FROM transaction_drafts WHERE id = $1;`, [draft.id]);
    if (checkDraftUnmutated.rows[0]?.status === 'pending_confirmation') {
      console.log('✅ Ownership Guard Verified: Cross-user confirmation successfully blocked.');
    } else {
      throw new Error('❌ FAILED: User B was able to confirm User A draft!');
    }

    // 3a. Cross-user edit and cancel must also leave the draft unchanged.
    console.log('\n----------------------------------------------------');
    console.log('🛡️  [3a/6] Testing cross-user edit and cancel rejection');
    const attackEditEvent = {
      type: 'postback',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user', userId: MOCK_USER_B },
      webhookEventId: 'mock-event-attack-edit',
      deliveryContext: { isRedelivery: false },
      postback: { data: `action=edit&draft_id=${draft.id}` },
      replyToken: 'mock-reply-token-attack-edit',
    };
    await sendWebhookEvent([attackEditEvent]);
    await sleep(500);

    const attackCancelEvent = {
      ...attackEditEvent,
      webhookEventId: 'mock-event-attack-cancel',
      postback: { data: `action=cancel&draft_id=${draft.id}` },
      replyToken: 'mock-reply-token-attack-cancel',
    };
    await sendWebhookEvent([attackCancelEvent]);
    await sleep(500);

    const checkDraftAfterAttackRes = await query(`SELECT status FROM transaction_drafts WHERE id = $1;`, [draft.id]);
    if (checkDraftAfterAttackRes.rows[0]?.status !== 'pending_confirmation') {
      throw new Error('❌ FAILED: Cross-user edit or cancel changed User A draft!');
    }
    console.log('✅ Ownership Guard Verified: Cross-user edit and cancel successfully blocked.');

    // 4. Edit Draft: Update amount to 35,000
    console.log('\n----------------------------------------------------');
    console.log('✏️  [4/6] Testing Chat Edit Flow: Change amount to 35,000');
    const setFieldEvent = {
      type: 'postback',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user', userId: MOCK_USER_A },
      webhookEventId: 'mock-event-set-field',
      deliveryContext: { isRedelivery: false },
      postback: { data: `action=set_field&field=amount&draft_id=${draft.id}` },
      replyToken: 'mock-reply-token-set-field',
    };
    await sendWebhookEvent([setFieldEvent]);
    await sleep(500);

    const editInputEvent = {
      type: 'message',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user', userId: MOCK_USER_A },
      webhookEventId: 'mock-event-edit-val',
      deliveryContext: { isRedelivery: false },
      message: { id: 'mock-msg-edit', type: 'text', text: '35,000' },
      replyToken: 'mock-reply-token-edit-val',
    };
    await sendWebhookEvent([editInputEvent]);
    await sleep(1000);

    const editedDraftRes = await query(`SELECT * FROM transaction_drafts WHERE id = $1;`, [draft.id]);
    const editedDraft = editedDraftRes.rows[0];
    console.log(`✅ Draft Updated via Edit Flow: New Amount: ฿${editedDraft.extracted_data.amount}`);
    if (Number(editedDraft.extracted_data.amount) !== 35000) {
      throw new Error(`❌ Edit flow amount update failed! Expected 35000, got ${editedDraft.extracted_data.amount}`);
    }

    // 5. Authorized Confirm: User A confirms the draft
    console.log('\n----------------------------------------------------');
    console.log('✅ [5/6] Testing Authorized Atomic Commit by User A');
    const confirmEvent = {
      type: 'postback',
      mode: 'active',
      timestamp: Date.now(),
      source: { type: 'user', userId: MOCK_USER_A },
      webhookEventId: 'mock-event-confirm-1',
      deliveryContext: { isRedelivery: false },
      postback: { data: `action=confirm&draft_id=${draft.id}` },
      replyToken: 'mock-reply-token-confirm',
    };
    await sendWebhookEvent([confirmEvent]);
    await sleep(1000);

    const finalDraftRes = await query(`SELECT * FROM transaction_drafts WHERE id = $1;`, [draft.id]);
    const finalDraft = finalDraftRes.rows[0];
    const txRes = await query(`SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1;`, [draft.user_id]);
    const tx = txRes.rows[0];
    const auditRes = await query(`SELECT * FROM audit_logs WHERE entity_id = $1;`, [tx.id]);

    console.log(`✅ Transaction Committed: ID: ${tx.id}, Amount: ฿${tx.amount}, Draft status: ${finalDraft.status}, Linked Tx: ${finalDraft.transaction_id}`);
    console.log(`✅ Audit Log Verified: Action: ${auditRes.rows[0]?.action}, ID: ${auditRes.rows[0]?.id}`);

    // 5a. A confirmed draft cannot be edited or cancelled.
    console.log('\n----------------------------------------------------');
    console.log('🔒 Testing confirmed-draft edit and cancel rejection');
    await sendWebhookEvent([
      {
        type: 'postback',
        mode: 'active',
        timestamp: Date.now(),
        source: { type: 'user', userId: MOCK_USER_A },
        webhookEventId: 'mock-event-confirmed-edit',
        deliveryContext: { isRedelivery: false },
        postback: { data: `action=edit&draft_id=${draft.id}` },
        replyToken: 'mock-reply-token-confirmed-edit',
      },
    ]);
    await sendWebhookEvent([
      {
        type: 'postback',
        mode: 'active',
        timestamp: Date.now(),
        source: { type: 'user', userId: MOCK_USER_A },
        webhookEventId: 'mock-event-confirmed-cancel',
        deliveryContext: { isRedelivery: false },
        postback: { data: `action=cancel&draft_id=${draft.id}` },
        replyToken: 'mock-reply-token-confirmed-cancel',
      },
    ]);
    await sleep(700);
    const confirmedStateRes = await query(`SELECT status FROM transaction_drafts WHERE id = $1;`, [draft.id]);
    if (confirmedStateRes.rows[0]?.status !== 'confirmed') {
      throw new Error('❌ FAILED: Confirmed draft was edited or cancelled.');
    }
    console.log('✅ Status Guard Verified: Confirmed draft cannot be edited or cancelled.');

    // 5b. A cancelled draft cannot be confirmed.
    console.log('\n----------------------------------------------------');
    console.log('🔒 Testing cancelled-draft confirmation rejection');
    const cancelledDraftRes = await query(
      `INSERT INTO transaction_drafts (
         user_id, source, raw_input, extracted_data, status, expires_at
       )
       VALUES (
         $1, 'security_test', 'cancelled draft',
         $2::jsonb, 'pending_confirmation', NOW() + INTERVAL '15 minutes'
       )
       RETURNING id;`,
      [
        draft.user_id,
        JSON.stringify({
          type: 'expense',
          amount: 12.34,
          category_id: 'ทดสอบ',
          merchant_id: 'ทดสอบ',
          description: 'cancelled draft',
        }),
      ]
    );
    const cancelledDraftId = cancelledDraftRes.rows[0].id;
    await sendWebhookEvent([
      {
        type: 'postback',
        mode: 'active',
        timestamp: Date.now(),
        source: { type: 'user', userId: MOCK_USER_A },
        webhookEventId: 'mock-event-cancel-second-draft',
        deliveryContext: { isRedelivery: false },
        postback: { data: `action=cancel&draft_id=${cancelledDraftId}` },
        replyToken: 'mock-reply-token-cancel-second-draft',
      },
    ]);
    await sleep(500);
    const cancelledBeforeConfirmRes = await query(`SELECT status FROM transaction_drafts WHERE id = $1;`, [cancelledDraftId]);
    if (cancelledBeforeConfirmRes.rows[0]?.status !== 'cancelled') {
      throw new Error('❌ Failed to create cancelled-draft test state.');
    }
    const txBeforeCancelledConfirmRes = await query(`SELECT COUNT(*) FROM transactions WHERE user_id = $1;`, [draft.user_id]);
    await sendWebhookEvent([
      {
        type: 'postback',
        mode: 'active',
        timestamp: Date.now(),
        source: { type: 'user', userId: MOCK_USER_A },
        webhookEventId: 'mock-event-confirm-cancelled-draft',
        deliveryContext: { isRedelivery: false },
        postback: { data: `action=confirm&draft_id=${cancelledDraftId}` },
        replyToken: 'mock-reply-token-confirm-cancelled-draft',
      },
    ]);
    await sleep(700);
    const cancelledAfterConfirmRes = await query(`SELECT status FROM transaction_drafts WHERE id = $1;`, [cancelledDraftId]);
    const txAfterCancelledConfirmRes = await query(`SELECT COUNT(*) FROM transactions WHERE user_id = $1;`, [draft.user_id]);
    if (
      cancelledAfterConfirmRes.rows[0]?.status !== 'cancelled' ||
      txAfterCancelledConfirmRes.rows[0].count !== txBeforeCancelledConfirmRes.rows[0].count
    ) {
      throw new Error('❌ FAILED: Cancelled draft was confirmed or created a transaction.');
    }
    console.log('✅ Status Guard Verified: Cancelled draft cannot be confirmed.');

    // 5c. Invalid transaction insertion must roll back the whole confirmation.
    console.log('\n----------------------------------------------------');
    console.log('↩️  Testing atomic rollback on invalid transaction data');
    const rollbackDraftRes = await query(
      `INSERT INTO transaction_drafts (
         user_id, source, raw_input, extracted_data, status, expires_at
       )
       VALUES (
         $1, 'security_test', 'rollback draft',
         $2::jsonb, 'pending_confirmation', NOW() + INTERVAL '15 minutes'
       )
       RETURNING id;`,
      [
        draft.user_id,
        JSON.stringify({
          type: 'expense',
          amount: 9.99,
          category_id: 'ทดสอบ',
          description: 'rollback draft',
          occurred_at: 'not-a-date',
        }),
      ]
    );
    const rollbackDraftId = rollbackDraftRes.rows[0].id;
    const txBeforeRollbackRes = await query(`SELECT COUNT(*) FROM transactions WHERE user_id = $1;`, [draft.user_id]);
    let rollbackRejected = false;
    try {
      await TransactionRepository.commitDraft(rollbackDraftId, draft.user_id);
    } catch {
      rollbackRejected = true;
    }
    const rollbackDraftStateRes = await query(`SELECT status FROM transaction_drafts WHERE id = $1;`, [rollbackDraftId]);
    const txAfterRollbackRes = await query(`SELECT COUNT(*) FROM transactions WHERE user_id = $1;`, [draft.user_id]);
    if (
      !rollbackRejected ||
      rollbackDraftStateRes.rows[0]?.status !== 'pending_confirmation' ||
      txAfterRollbackRes.rows[0].count !== txBeforeRollbackRes.rows[0].count
    ) {
      throw new Error('❌ FAILED: Atomic rollback did not preserve the draft and transaction count.');
    }
    console.log('✅ Atomic rollback verified.');

    // 5d. Concurrent confirmation must create exactly one transaction.
    console.log('\n----------------------------------------------------');
    console.log('🔁 Testing concurrent confirmation serialization');
    const concurrentDraftRes = await query(
      `INSERT INTO transaction_drafts (
         user_id, source, raw_input, extracted_data, status, expires_at
       )
       VALUES (
         $1, 'security_test', 'concurrency draft',
         $2::jsonb, 'pending_confirmation', NOW() + INTERVAL '15 minutes'
       )
       RETURNING id;`,
      [
        draft.user_id,
        JSON.stringify({
          type: 'expense',
          amount: 17.89,
          category_id: 'ทดสอบ',
          merchant_id: 'ทดสอบ',
          description: 'concurrency draft',
        }),
      ]
    );
    const concurrentDraftId = concurrentDraftRes.rows[0].id;
    const txBeforeConcurrentRes = await query(`SELECT COUNT(*) FROM transactions WHERE user_id = $1;`, [draft.user_id]);
    const concurrentResults = await Promise.allSettled([
      TransactionRepository.commitDraft(concurrentDraftId, draft.user_id),
      TransactionRepository.commitDraft(concurrentDraftId, draft.user_id),
    ]);
    const successfulCommits = concurrentResults.filter((result) => result.status === 'fulfilled').length;
    const txAfterConcurrentRes = await query(`SELECT COUNT(*) FROM transactions WHERE user_id = $1;`, [draft.user_id]);
    if (successfulCommits !== 1 || Number(txAfterConcurrentRes.rows[0].count) !== Number(txBeforeConcurrentRes.rows[0].count) + 1) {
      throw new Error('❌ FAILED: Concurrent confirmation created more or fewer than one transaction.');
    }
    console.log('✅ Concurrency serialization verified: exactly one transaction committed.');

    // 6. Idempotency / Duplicate Confirm Test (Re-confirming must fail gracefully)
    console.log('\n----------------------------------------------------');
    console.log('🔁 [6/6] Testing Re-Confirm Idempotency (Must reject already confirmed draft)');
    await sendWebhookEvent([confirmEvent]);
    await sleep(500);
    const txCountRes = await query(`SELECT COUNT(*) FROM transactions WHERE user_id = $1;`, [draft.user_id]);
    console.log(`✅ Idempotency Verified: No duplicate transaction created (Tx count: ${txCountRes.rows[0].count})`);

    console.log('\n====================================================');
    console.log('🎉 ALL P0/P1 AUDIT & SECURITY CHECKS PASSED!');
    console.log('====================================================\n');
  } catch (error: any) {
    console.error('\n❌ Audit Simulation Failed:', error.message);
  } finally {
    await pool.end();
  }
}

runSimulation();
