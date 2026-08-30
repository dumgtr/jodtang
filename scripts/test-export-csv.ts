import assert from 'node:assert/strict';
import type { WebhookEvent } from '@line/bot-sdk';
import { env } from '../src/config/env';
import { assertTestDatabaseConnection } from '../src/db/test-isolation';
import { UserRepository } from '../src/modules/user/user.repository';
import { DraftRepository } from '../src/modules/draft/draft.repository';
import { TransactionRepository } from '../src/modules/transaction/transaction.repository';
import {
  buildExportCsvFlexMessage,
  buildExportDownloadUrl,
  buildTransactionsCsv,
  createExportToken,
  verifyExportToken,
} from '../src/services/export-csv.service';
import { handleWebhookEvent } from '../src/handlers/webhook-event.handler';

assertTestDatabaseConnection(env.DATABASE_URL);
process.env.EXPORT_TOKEN_SECRET = 'test-export-token-secret-2026';

async function createConfirmedTransaction(
  userId: string,
  description: string,
  category: string,
  merchant: string,
  amount: number
) {
  const draft = await DraftRepository.createDraft({
    userId,
    source: 'test-export-csv',
    rawInput: description,
    extractedData: {
      type: 'expense',
      amount,
      category_id: category,
      merchant_id: merchant,
      description,
      occurred_at: '2026-08-28',
    },
  });
  const result = await TransactionRepository.commitDraft(draft.id, userId);
  return result.transaction;
}

async function runExportCsvTests(): Promise<void> {
  console.log('====================================================');
  console.log('🧪 Testing Export CSV Suite');
  console.log('====================================================');

  const userA = await UserRepository.findOrCreateByLineUserId('U_TEST_EXPORT_CSV_AAA');
  const userB = await UserRepository.findOrCreateByLineUserId('U_TEST_EXPORT_CSV_BBB');

  const formulaTx = await createConfirmedTransaction(
    userA.id,
    '=HYPERLINK("http://example.invalid","x")',
    '+danger',
    '@merchant',
    1250.5
  );
  await createConfirmedTransaction(userB.id, 'B-only record', 'B-category', 'B-merchant', 999);

  console.log('\n1. Testing strict user ownership / multi-tenant isolation...');
  const userARows = await TransactionRepository.findAllByUser(userA.id);
  const userBRows = await TransactionRepository.findAllByUser(userB.id);
  assert.equal(userARows.length, 1);
  assert.equal(userBRows.length, 1);
  assert.equal(userARows[0].id, formulaTx.id);
  assert.notEqual(userARows[0].id, userBRows[0].id);
  assert.equal(userARows.some((row) => row.description === 'B-only record'), false);
  console.log('✅ Multi-tenant export query isolation verified.');

  console.log('\n2. Testing UTF-8 BOM, 7-field projection, CSV quoting, field preservation, and formula-injection hardening...');
  const csv = buildTransactionsCsv(userARows);
  assert(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM');

  const rawLines = csv.replace(/^\uFEFF/u, '').split('\r\n').filter((line) => line.length > 0);
  assert.equal(rawLines.length, 2, 'Must contain 1 header line and 1 transaction data line');

  // Exact 7-field Header assertion
  assert.equal(
    rawLines[0],
    '"type","amount","category","merchant","account","description","occurred_at"',
    'Header must match exactly 7 fields in specified order'
  );

  // Technical & audit fields must NOT be exported
  assert.equal(csv.includes('"transaction_id"'), false, 'transaction_id must not be in export');
  assert.equal(csv.includes('"status"'), false, 'status must not be in export');
  assert.equal(csv.includes('"created_at"'), false, 'created_at must not be in export');
  assert.equal(csv.includes('"updated_at"'), false, 'updated_at must not be in export');
  assert.equal(csv.includes(formulaTx.id), false, 'Internal UUID must not be in export');

  // Exact 7-field Row content assertion
  assert.equal(
    rawLines[1],
    `"expense","1250.50","\t+danger","\t@merchant","","\t=HYPERLINK(""http://example.invalid"",""x"")","${new Date(formulaTx.occurred_at).toISOString()}"`
  );
  assert.equal(csv.includes('B-only record'), false, 'Must not include other user records');
  console.log('✅ 7-field CSV projection, encoding, escaping, and security invariants verified.');

  console.log('\n3. Testing opaque short-lived export tokens...');
  const now = 1_760_000_000_000;
  const token = createExportToken(userA.id, now);
  assert.equal(verifyExportToken(token, now + 1), userA.id);
  assert.equal(verifyExportToken(token, now + 15 * 60 * 1000), null);
  assert.equal(verifyExportToken(`${token}tampered`, now + 1), null);
  assert.equal(token.includes(userA.id), false);
  console.log('✅ Export token confidentiality, expiry, and tamper checks verified.');

  console.log('\n4. Testing export download URL and LINE Flex response contract...');
  const url = buildExportDownloadUrl(userA.id);
  assert(url.startsWith('http://localhost:3000/exports/transactions.csv?token='));
  const flex = buildExportCsvFlexMessage(url, userARows.length) as any;
  assert.equal(flex.type, 'flex');
  assert.equal(flex.contents.footer.contents[0].action.type, 'uri');
  assert.equal(flex.contents.footer.contents[0].action.uri, url);
  console.log('✅ Download URL and Flex URI action verified.');

  console.log('\n5. Testing real webhook dispatch bypasses generic AI/text pipeline...');
  const replies: any[] = [];
  let genericHandlerCalled = false;
  const event = {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user', userId: userA.line_user_id },
    replyToken: 'export-test-reply-token',
    message: {
      type: 'text',
      id: 'export-test-message-id',
      text: '📥 Export CSV',
    },
  } as WebhookEvent;

  await handleWebhookEvent(event, {
    lineClient: {
      replyMessage: async (reply: any) => replies.push(reply),
    } as any,
    findOrCreateByLineUserId: async () => userA,
    handleTextMessage: async () => {
      genericHandlerCalled = true;
    },
    handleImageMessage: async () => undefined,
    handlePostbackEvent: async () => undefined,
  });

  assert.equal(genericHandlerCalled, false);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].messages[0].type, 'flex');
  assert.equal(replies[0].messages[0].contents.footer.contents[0].action.type, 'uri');
  console.log('✅ Export command is dispatched as a user-scoped read-only path.');

  console.log('\n6. Testing group-chat privacy guard...');
  const groupReplies: any[] = [];
  const groupEvent = {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'group', groupId: 'C_TEST_EXPORT_GROUP', userId: userA.line_user_id },
    replyToken: 'export-group-reply-token',
    message: {
      type: 'text',
      id: 'export-group-message-id',
      text: 'Export CSV',
    },
  } as WebhookEvent;

  await handleWebhookEvent(groupEvent, {
    lineClient: {
      replyMessage: async (reply: any) => groupReplies.push(reply),
    } as any,
    findOrCreateByLineUserId: async () => userA,
    handleTextMessage: async () => {
      throw new Error('Generic text pipeline must not run for group export.');
    },
    handleImageMessage: async () => undefined,
    handlePostbackEvent: async () => undefined,
  });

  assert.equal(groupReplies.length, 1);
  assert.equal(groupReplies[0].messages[0].type, 'text');
  assert(groupReplies[0].messages[0].text.includes('แชตส่วนตัว'));
  console.log('✅ Group-chat export is blocked to prevent link leakage.');

  console.log('\n🎉 Export CSV Suite: PASS');
}

runExportCsvTests().catch((error) => {
  console.error('❌ Export CSV Suite FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
