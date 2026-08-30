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
  classifyExportCsvIntent,
  createExportToken,
  isExportCsvCommand,
  verifyExportToken,
} from '../src/services/export-csv.service';
import { handleWebhookEvent } from '../src/handlers/webhook-event.handler';
import { handleTextMessage } from '../src/handlers/message.handler';
import { handleTransactionCsvExport } from '../src/handlers/export.handler';
import { classifySecurityFaqIntent } from '../src/services/security-faq.service';
import { query } from '../src/db/client';

assertTestDatabaseConnection(env.DATABASE_URL);
process.env.EXPORT_TOKEN_SECRET = 'test-export-token-secret-2026';

const naturalExportIntentCases = [
  // Thai
  'โหลด csv',
  'ดาวน์โหลด csv',
  'ขอ csv',
  'ขอไฟล์ csv',
  'ขอไฟล์รายการ',
  'ดาวน์โหลดไฟล์',
  'โหลดไฟล์',
  'เอาไฟล์ csv',
  'เอา csv',
  'ขอข้อมูลเป็น csv',
  'ขอรายการเป็น csv',
  'ส่งออกเป็น csv',
  'ส่งออกรายการ',
  'ส่งออกรายการทั้งหมด',
  'ดาวน์โหลดรายการ',
  'โหลดรายการ',
  'ขอรายการทั้งหมด',
  'ขอข้อมูลทั้งหมด',
  'เอาข้อมูลทั้งหมด',
  'ขอประวัติรายการ',
  'ดาวน์โหลดประวัติรายการ',
  'โหลดประวัติรายการ',
  'ช่วยส่งรายการทั้งหมดเป็น csv ให้หน่อย',
  'ดาวน์โหลดข้อมูลของฉันเป็น CSV',
  'โหลด  csv',
  'EXPORT CSV',

  // English
  'export csv',
  'download csv',
  'download the csv',
  'download file',
  'get csv',
  'get the csv',
  'get csv file',
  'export data',
  'export transactions',
  'download transactions',
  'download transaction history',
  'export transaction history',
  'get transaction history',
] as const;

const nonExportIntentCases = [
  'ข้อมูล',
  'รายการ',
  'ประวัติ',
  'ส่งออก',
  'export',
  'ไฟล์',
  'ดาวน์โหลด',
  'download',
  'ดูรายการวันนี้',
  'ดูรายการทั้งหมด',
  'ยอดใช้จ่ายเดือนนี้',
  'รายการล่าสุดมีอะไรบ้าง',
  'ข้อมูลของฉันปลอดภัยไหม',
  'ลบข้อมูลของฉันได้ไหม',
  'ขอข้อมูลทั้งหมดของเดือนนี้',
  'ขอรายการทั้งหมดวันนี้',
  'อัปโหลดไฟล์',
  'อัปโหลดไฟล์ csv',
  'CSV ของฉันปลอดภัยไหม',
  'ข้อมูล CSV ที่ส่งไปปลอดภัยไหม',
  'budget csv',
  'download profile',
  'download database',
  'กินข้าว 80',
] as const;

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

  console.log('\n0. Testing natural-language EXPORT_CSV intent precision and priority...');
  for (const phrase of naturalExportIntentCases) {
    assert.equal(
      classifyExportCsvIntent(phrase),
      'EXPORT_CSV',
      `Expected EXPORT_CSV for: ${phrase}`
    );
    assert.equal(isExportCsvCommand(phrase), true, `Expected export command for: ${phrase}`);
  }

  for (const phrase of nonExportIntentCases) {
    assert.equal(
      classifyExportCsvIntent(phrase),
      null,
      `Must not classify as EXPORT_CSV: ${phrase}`
    );
    assert.equal(isExportCsvCommand(phrase), false, `Must not export for: ${phrase}`);
  }

  const exportBeforeSecurityPhrase = 'ดาวน์โหลดข้อมูลของฉันเป็น CSV';
  assert.equal(classifyExportCsvIntent(exportBeforeSecurityPhrase), 'EXPORT_CSV');
  assert.equal(
    classifySecurityFaqIntent(exportBeforeSecurityPhrase),
    null,
    'Explicit CSV download must resolve before Security FAQ deletion_export'
  );
  assert.notEqual(classifySecurityFaqIntent('ข้อมูลของฉันปลอดภัยไหม'), null);
  assert.notEqual(classifySecurityFaqIntent('ลบข้อมูลของฉันได้ไหม'), null);
  console.log(
    `✅ ${naturalExportIntentCases.length} positive and ${nonExportIntentCases.length} negative intent cases passed.`
  );

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
  assert(url.startsWith('http://localhost:3000/exports/transactions.csv?openExternalBrowser=1&token='));
  const flex = buildExportCsvFlexMessage(url, userARows.length) as any;
  assert.equal(flex.type, 'flex');
  assert.equal(flex.contents.footer.contents[0].action.type, 'uri');
  assert.equal(flex.contents.footer.contents[0].action.uri, url);
  console.log('✅ Download URL and Flex URI action verified.');

  console.log('\n5. Testing natural-language webhook dispatch bypasses Security FAQ and generic AI/text pipeline...');
  const replies: any[] = [];
  let genericHandlerCalled = false;
  const financialRowsBefore = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM transaction_drafts WHERE user_id = $1) AS drafts,
       (SELECT COUNT(*)::int FROM transactions WHERE user_id = $1) AS transactions,
       (SELECT COUNT(*)::int FROM audit_logs WHERE user_id = $1) AS audit_logs`,
    [userA.id]
  );
  const event = {
    type: 'message',
    mode: 'active',
    timestamp: Date.now(),
    source: { type: 'user', userId: userA.line_user_id },
    replyToken: 'export-test-reply-token',
    message: {
      type: 'text',
      id: 'export-test-message-id',
      text: 'ดาวน์โหลดข้อมูลของฉันเป็น CSV',
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
  const financialRowsAfter = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM transaction_drafts WHERE user_id = $1) AS drafts,
       (SELECT COUNT(*)::int FROM transactions WHERE user_id = $1) AS transactions,
       (SELECT COUNT(*)::int FROM audit_logs WHERE user_id = $1) AS audit_logs`,
    [userA.id]
  );
  assert.deepEqual(
    financialRowsAfter.rows[0],
    financialRowsBefore.rows[0],
    'Export routing must not create drafts, transactions, or audit logs'
  );
  console.log('✅ Natural-language Export is dispatched before Security/AI with no financial mutation.');

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
      text: 'ดาวน์โหลดประวัติรายการ',
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

  console.log('\n7. Testing user with 0 transactions (empty export)...');
  const userEmpty = await UserRepository.findOrCreateByLineUserId('U_TEST_EXPORT_EMPTY_USER');
  const emptyRows = await TransactionRepository.findAllByUser(userEmpty.id);
  assert.equal(emptyRows.length, 0);
  const emptyCsv = buildTransactionsCsv(emptyRows);
  assert(emptyCsv.startsWith('\uFEFF'));
  const emptyLines = emptyCsv.replace(/^\uFEFF/u, '').split('\r\n').filter((l) => l.length > 0);
  assert.equal(emptyLines.length, 1, 'Empty export must contain exactly the 7-field header line');
  assert.equal(
    emptyLines[0],
    '"type","amount","category","merchant","account","description","occurred_at"',
    'Header must strictly match 7 fields'
  );
  const emptyFlex = buildExportCsvFlexMessage('http://localhost:3000/test', 0) as any;
  assert(JSON.stringify(emptyFlex).includes('0 รายการ'));
  console.log('✅ Empty transaction export produces valid 7-field header and 0-count Flex message.');

  console.log('\n8. Testing HTTP /exports/transactions.csv endpoint controller...');
  let responseStatus = 0;
  const responseHeaders: Record<string, string> = {};
  let responseBody: Buffer | string = '';

  const mockRes = {
    status(code: number) {
      responseStatus = code;
      return this;
    },
    set(headers: any) {
      if (typeof headers === 'string') {
        responseHeaders[headers] = arguments[1];
      } else {
        Object.assign(responseHeaders, headers);
      }
      return this;
    },
    send(body: any) {
      responseBody = body;
      return this;
    },
  } as any;

  // Valid token request (Standard Browser)
  const validToken = createExportToken(userA.id);
  const mockStandardReq = {
    query: { token: validToken },
    get: (header: string) => (header === 'user-agent' ? 'Mozilla/5.0 Chrome/115.0' : 'localhost:3000'),
  };
  await handleTransactionCsvExport(mockStandardReq as any, mockRes);
  assert.equal(responseStatus, 200);
  assert.equal(responseHeaders['Content-Type'], 'text/csv; charset=utf-8');
  assert(responseHeaders['Content-Disposition'].includes('attachment; filename="jodtang-transactions-'));
  const downloadedCsv = responseBody.toString('utf8');
  assert(downloadedCsv.startsWith('\uFEFF"type","amount","category","merchant","account","description","occurred_at"'));
  assert(downloadedCsv.includes('"1250.50"'));
  assert.equal(downloadedCsv.includes('B-only record'), false);

  // Valid token request (LINE In-App Webview fallback)
  responseStatus = 0;
  const mockLineReq = {
    query: { token: validToken },
    get: (header: string) => (header === 'user-agent' ? 'Mozilla/5.0 (Linux; Android 13) Line/13.7.1/IAB' : 'jodtang.onrender.com'),
  };
  await handleTransactionCsvExport(mockLineReq as any, mockRes);
  assert.equal(responseStatus, 200);
  assert.equal(responseHeaders['Content-Type'], 'text/html; charset=utf-8');
  assert(responseBody.toString().includes('เปิดใน Chrome เพื่อดาวน์โหลด'));

  // Invalid / Expired token request
  responseStatus = 0;
  await handleTransactionCsvExport({ query: { token: 'invalid.tampered.token' }, get: () => '' } as any, mockRes);
  assert.equal(responseStatus, 401);
  console.log('✅ HTTP Export controller returns 200 with 7-field CSV for standard browsers, HTML fallback for LINE webview, and 401 for invalid tokens.');

  console.log('\n9. Testing direct handleTextMessage dispatch with natural Export commands...');
  const directDispatchBefore = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM transaction_drafts WHERE user_id = $1) AS drafts,
       (SELECT COUNT(*)::int FROM transactions WHERE user_id = $1) AS transactions,
       (SELECT COUNT(*)::int FROM audit_logs WHERE user_id = $1) AS audit_logs`,
    [userA.id]
  );
  for (const cmd of naturalExportIntentCases) {
    const textReplies: any[] = [];
    const mockClient = {
      replyMessage: async (reply: any) => textReplies.push(reply),
    } as any;
    await handleTextMessage(userA.line_user_id, cmd, 'reply-token-test', mockClient);
    assert.equal(textReplies.length, 1, `Must reply for command: ${cmd}`);
    assert.equal(textReplies[0].messages[0].type, 'flex', `Must return Flex message for command: ${cmd}`);
    assert.equal(
      textReplies[0].messages[0].contents.footer.contents[0].action.type,
      'uri',
      `Must contain URI button for command: ${cmd}`
    );
  }
  const directDispatchAfter = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM transaction_drafts WHERE user_id = $1) AS drafts,
       (SELECT COUNT(*)::int FROM transactions WHERE user_id = $1) AS transactions,
       (SELECT COUNT(*)::int FROM audit_logs WHERE user_id = $1) AS audit_logs`,
    [userA.id]
  );
  assert.deepEqual(
    directDispatchAfter.rows[0],
    directDispatchBefore.rows[0],
    'Natural export aliases must not create drafts, transactions, or audit logs'
  );
  console.log('✅ All natural Export aliases return the live Flex message without financial mutation.');

  console.log('\n10. Testing graceful error handling without crashing...');
  const errorReplies: any[] = [];
  const mockErrorClient = {
    replyMessage: async (reply: any) => errorReplies.push(reply),
  } as any;
  // Passing an invalid lineUserId or simulating repository failure
  const originalFindAll = TransactionRepository.findAllByUser;
  (TransactionRepository as any).findAllByUser = async () => {
    throw new Error('Simulated database failure');
  };
  try {
    await handleTextMessage(userA.line_user_id, '📥 Export CSV', 'reply-token-err', mockErrorClient);
    assert.equal(errorReplies.length, 1);
    assert.equal(errorReplies[0].messages[0].type, 'text');
    assert(errorReplies[0].messages[0].text.includes('ยังไม่สามารถเตรียมไฟล์ CSV ให้ได้'));
    console.log('✅ Export error is gracefully handled with a safe Thai error message.');
  } finally {
    TransactionRepository.findAllByUser = originalFindAll;
  }

  console.log('\n🎉 Export CSV Suite: PASS');
}

runExportCsvTests().catch((error) => {
  console.error('❌ Export CSV Suite FAILED:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
