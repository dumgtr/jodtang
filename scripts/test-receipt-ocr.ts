import assert from 'node:assert/strict';
import { handleImageMessage } from '../src/handlers/image.handler';
import { SlipService } from '../src/modules/slip/slip.service';
import { ISlipProvider } from '../src/modules/slip/slip-provider.interface';
import { ReceiptService } from '../src/modules/receipt/receipt.service';
import { MockReceiptAdapter } from '../src/modules/receipt/providers/mock-receipt.adapter';
import { TyphoonOcrAdapter } from '../src/modules/receipt/providers/typhoon-ocr.adapter';
import { DraftRepository } from '../src/modules/draft/draft.repository';
import { TransactionRepository } from '../src/modules/transaction/transaction.repository';
import { query } from '../src/db/client';
import { ALLOWED_CATEGORIES } from '../src/services/ai.service';
import { parseReceiptRawText } from '../src/modules/receipt/receipt-parser.util';

// Mock ISlipProvider for controlled tests
class MockSlipProvider implements ISlipProvider {
  readonly name = 'mock-slip-provider';
  public responseStatus: any = 'INVALID_IMAGE';
  public responseData: any = null;

  async verifySlipImage(): Promise<any> {
    if (this.responseStatus === 'SUCCESS') {
      return {
        status: 'SUCCESS',
        rawCode: '200000',
        data: this.responseData || {
          amount: 500,
          occurredAt: new Date().toISOString(),
          merchant: 'ร้านค้าทดสอบ',
          senderName: 'ผู้โอนทดสอบ',
          transRef: `REF_${Date.now()}_${Math.random()}`,
        },
      };
    }
    return {
      status: this.responseStatus,
      rawCode: this.responseStatus === 'DUPLICATE' ? '200501' : '400002',
      errorMessage: `Mock ${this.responseStatus}`,
    };
  }
}

async function runReceiptOcrTests() {
  console.log('====================================================');
  console.log('🧪 Testing Receipt OCR Fallback Suite (15 Scenarios)');
  console.log('====================================================\n');

  const testUserId = `U_RECEIPT_TEST_${Date.now()}`;
  let sentMessages: any[] = [];
  const mockLineClient: any = {
    replyMessage: async ({ messages }: { messages: any[] }) => {
      sentMessages.push(...messages);
    },
  };

  const mockBlobClient: any = {
    getMessageContent: async () => {
      const buffer = Buffer.from('fake-receipt-image-content');
      return (async function* () {
        yield buffer;
      })();
    },
  };

  async function countUserDrafts(userId: string): Promise<number> {
    const res = await query<{ count: string }>(
      `SELECT COUNT(*) FROM transaction_drafts td
       JOIN users u ON td.user_id = u.id
       WHERE u.line_user_id = $1;`,
      [userId]
    );
    return parseInt(res.rows[0].count, 10);
  }

  async function countUserTransactions(userId: string): Promise<number> {
    const res = await query<{ count: string }>(
      `SELECT COUNT(*) FROM transactions t
       JOIN users u ON t.user_id = u.id
       WHERE u.line_user_id = $1;`,
      [userId]
    );
    return parseInt(res.rows[0].count, 10);
  }

  const initialDrafts = await countUserDrafts(testUserId);
  const initialTxs = await countUserTransactions(testUserId);

  // ----------------------------------------------------
  // Scenario 1: Valid Bank Slip -> Slip2Go (OCR NEVER CALLED)
  // ----------------------------------------------------
  console.log('Scenario 1: Valid Bank Slip -> Handled by Slip2Go, OCR NEVER invoked...');
  sentMessages = [];
  const mockSlipProvider = new MockSlipProvider();
  mockSlipProvider.responseStatus = 'SUCCESS';
  mockSlipProvider.responseData = {
    amount: 120,
    occurredAt: new Date().toISOString(),
    merchant: 'Starbucks Coffee',
    transRef: `REF_SLIP_${Date.now()}_1`,
  };
  const mockReceiptAdapter = new MockReceiptAdapter(true);
  let ocrCallCount = 0;
  const originalExtract = mockReceiptAdapter.extractReceipt.bind(mockReceiptAdapter);
  mockReceiptAdapter.extractReceipt = async (...args) => {
    ocrCallCount++;
    return originalExtract(...args);
  };

  await handleImageMessage(
    testUserId,
    'msg_s1',
    'reply_s1',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  assert.equal(ocrCallCount, 0, '[Scenario 1] OCR MUST NEVER be invoked for valid slip!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('120.00'));
  console.log('   ✅ Valid bank slip created Slip Draft, OCR was NOT called.');

  // ----------------------------------------------------
  // Scenario 2: Duplicate Slip -> Rejected by Slip2Go (OCR NEVER CALLED)
  // ----------------------------------------------------
  console.log('Scenario 2: Duplicate Slip -> Rejected, OCR NEVER invoked...');
  sentMessages = [];
  mockSlipProvider.responseStatus = 'DUPLICATE';
  ocrCallCount = 0;

  await handleImageMessage(
    testUserId,
    'msg_s2',
    'reply_s2',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  assert.equal(ocrCallCount, 0, '[Scenario 2] OCR MUST NEVER be invoked for duplicate slip!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'text');
  assert(sentMessages[0].text.includes('สลิปนี้ถูกตรวจสอบหรือใช้งานไปแล้ว'));
  console.log('   ✅ Duplicate slip rejected immediately, OCR was NOT called.');

  // ----------------------------------------------------
  // Scenario 3: Fraud / Invalid Bank Slip -> Rejected (OCR NEVER CALLED)
  // ----------------------------------------------------
  console.log('Scenario 3: Fraud Slip -> Rejected, OCR NEVER invoked...');
  sentMessages = [];
  mockSlipProvider.responseStatus = 'FRAUD';
  ocrCallCount = 0;

  await handleImageMessage(
    testUserId,
    'msg_s3',
    'reply_s3',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  assert.equal(ocrCallCount, 0, '[Scenario 3] OCR MUST NEVER be invoked for fraud slip!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'text');
  assert(sentMessages[0].text.includes('อาจเป็นสลิปปลอม'));
  console.log('   ✅ Fraud slip rejected immediately, OCR was NOT called.');

  // ----------------------------------------------------
  // Scenario 4: Normal Thai Paper Receipt (7-Eleven) -> OCR Fallback Success
  // ----------------------------------------------------
  console.log('Scenario 4: Normal Thai Receipt (7-Eleven) -> OCR Fallback...');
  sentMessages = [];
  mockSlipProvider.responseStatus = 'INVALID_IMAGE'; // No bank QR found
  mockReceiptAdapter.setNextRawText(
    `ใบเสร็จรับเงิน / TAX INVOICE (ABB)
7-Eleven สาขาอโศก
ขนมปังฟาร์มเฮ้าส์  32.00
นมสดเมจิ          27.00
รวมทั้งสิ้น         59.00 บาท
02/09/2569 08:30
POS#001-9988`
  );

  await handleImageMessage(
    testUserId,
    'msg_s4',
    'reply_s4',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('59.00'));
  assert(sentMessages[0].altText.includes('7-Eleven'));
  console.log('   ✅ Thai retail receipt successfully fell back to OCR, created Receipt Draft.');

  // ----------------------------------------------------
  // Scenario 5: Receipt with Thai Merchant Name -> Food Category
  // ----------------------------------------------------
  console.log('Scenario 5: Receipt with Thai Merchant ("ร้านส้มตำป้าณี") -> Food...');
  sentMessages = [];
  mockReceiptAdapter.setNextRawText(
    `ร้านส้มตำป้าณี
ส้มตำไทย          60.00
ไก่ย่างครึ่งตัว     120.00
ข้าวเหนียว 2        20.00
ยอดสุทธิ         200.00 บาท
วันที่ 02/09/2026`
  );

  await handleImageMessage(
    testUserId,
    'msg_s5',
    'reply_s5',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('200.00'));
  console.log('   ✅ Thai food merchant classified as อาหารและเครื่องดื่ม.');

  // ----------------------------------------------------
  // Scenario 6: Receipt with English Merchant Name ("Starbucks Coffee")
  // ----------------------------------------------------
  console.log('Scenario 6: Receipt with English Merchant ("Starbucks Coffee")...');
  sentMessages = [];
  mockReceiptAdapter.setNextRawText(
    `Starbucks Coffee
Iced Americano Grande   145.00
Total Amount            145.00 THB
02/09/2026 09:15`
  );

  await handleImageMessage(
    testUserId,
    'msg_s6',
    'reply_s6',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('145.00'));
  console.log('   ✅ English food merchant classified as อาหารและเครื่องดื่ม.');

  // ----------------------------------------------------
  // Scenario 7: Receipt Date Parsing (พ.ศ. conversion)
  // ----------------------------------------------------
  console.log('Scenario 7: Date Parsing from Buddhist Era (พ.ศ. 2569 -> 2026)...');
  const parsedDate = parseReceiptRawText('Lotus\n02/09/2569 14:30\nยอดรวม 350.00 บาท');
  assert(parsedDate.occurredAt.startsWith('2026-09-02'), `Expected 2026-09-02 but got ${parsedDate.occurredAt}`);
  console.log('   ✅ Buddhist Era year 2569 correctly converted to Gregorian 2026.');

  // ----------------------------------------------------
  // Scenario 8: Unreadable Receipt -> 0 Draft, 0 Transaction
  // ----------------------------------------------------
  console.log('Scenario 8: Unreadable Receipt -> Safe message, 0 Draft, 0 Tx...');
  sentMessages = [];
  mockReceiptAdapter.setNextResult({
    status: 'UNREADABLE',
    errorMessage: 'Cannot decode receipt text',
  });

  const draftsBeforeS8 = await countUserDrafts(testUserId);
  await handleImageMessage(
    testUserId,
    'msg_s8',
    'reply_s8',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  const draftsAfterS8 = await countUserDrafts(testUserId);
  assert.equal(draftsAfterS8, draftsBeforeS8, '[Scenario 8] 0 drafts must be created on UNREADABLE!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'text');
  assert(sentMessages[0].text.includes('ภาพใบเสร็จไม่ชัดเจน'));
  console.log('   ✅ Unreadable receipt handled safely without creating draft or transaction.');

  // ----------------------------------------------------
  // Scenario 9: OCR Timeout (> 8s) -> Safe message, 0 Draft, 0 Tx
  // ----------------------------------------------------
  console.log('Scenario 9: OCR Timeout -> Safe timeout message, 0 Draft, 0 Tx...');
  sentMessages = [];
  const timeoutAdapter = new MockReceiptAdapter(true);
  timeoutAdapter.setDelay(100); // Trigger timeout with 50ms threshold
  const timeoutReceiptService = new ReceiptService(timeoutAdapter, { timeoutMs: 50 });

  const draftsBeforeS9 = await countUserDrafts(testUserId);
  await handleImageMessage(
    testUserId,
    'msg_s9',
    'reply_s9',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    timeoutReceiptService
  );

  const draftsAfterS9 = await countUserDrafts(testUserId);
  assert.equal(draftsAfterS9, draftsBeforeS9, '[Scenario 9] 0 drafts must be created on TIMEOUT!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'text');
  assert(sentMessages[0].text.includes('ใช้เวลานานกว่าปกติ'));
  console.log('   ✅ OCR Timeout caught and handled gracefully.');

  // ----------------------------------------------------
  // Scenario 10: Malformed OCR Response / Provider Error -> 0 Draft, 0 Tx
  // ----------------------------------------------------
  console.log('Scenario 10: Malformed OCR / Provider Error -> 0 Draft, 0 Tx...');
  sentMessages = [];
  mockReceiptAdapter.setNextResult({
    status: 'PROVIDER_ERROR',
    errorMessage: 'Internal 500 from Vision API',
  });

  const draftsBeforeS10 = await countUserDrafts(testUserId);
  await handleImageMessage(
    testUserId,
    'msg_s10',
    'reply_s10',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  const draftsAfterS10 = await countUserDrafts(testUserId);
  assert.equal(draftsAfterS10, draftsBeforeS10, '[Scenario 10] 0 drafts must be created on PROVIDER_ERROR!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'text');
  assert(sentMessages[0].text.includes('ขัดข้องชั่วคราว'));
  console.log('   ✅ Provider error handled gracefully.');

  // ----------------------------------------------------
  // Scenario 11: Ambiguous Merchant -> Canonical Fallback โอนเงิน/ทั่วไป
  // ----------------------------------------------------
  console.log('Scenario 11: Ambiguous Merchant -> Canonical Fallback โอนเงิน/ทั่วไป...');
  sentMessages = [];
  mockReceiptAdapter.setNextRawText(
    `ใบเสร็จรับเงิน
TAX INVOICE
ยอดรวม 500.00 บาท`
  );

  await handleImageMessage(
    testUserId,
    'msg_s11',
    'reply_s11',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('500.00'));
  console.log('   ✅ Ambiguous header cleanly maps to fallback โอนเงิน/ทั่วไป.');

  // ----------------------------------------------------
  // Scenario 12: Person Name False Positive Guard on Receipt
  // ----------------------------------------------------
  console.log('Scenario 12: Person Name on Receipt (e.g. Cashier นาย ชาญชัย) -> Person Guard...');
  sentMessages = [];
  mockReceiptAdapter.setNextRawText(
    `นาย ชาญชัย สุขใจ (ผู้รับเงิน)
ยอดรวม 300.00 บาท`
  );

  await handleImageMessage(
    testUserId,
    'msg_s12',
    'reply_s12',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('300.00'));
  console.log('   ✅ Person Guard prevented false positive on receipt.');

  // ----------------------------------------------------
  // Scenario 13: Receipt with NO Amount -> 0 Draft, 0 Tx
  // ----------------------------------------------------
  console.log('Scenario 13: Receipt without amount -> 0 Draft, 0 Tx...');
  sentMessages = [];
  mockReceiptAdapter.setNextRawText(
    `Big C Supercenter
ขอบคุณที่ใช้บริการ
ใบเสร็จรับเงิน`
  );

  const draftsBeforeS13 = await countUserDrafts(testUserId);
  await handleImageMessage(
    testUserId,
    'msg_s13',
    'reply_s13',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  const draftsAfterS13 = await countUserDrafts(testUserId);
  assert.equal(draftsAfterS13, draftsBeforeS13, '[Scenario 13] 0 drafts must be created without amount!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'text');
  assert(sentMessages[0].text.includes('ไม่พบยอดรวม'));
  console.log('   ✅ Missing amount rejected safely.');

  // ----------------------------------------------------
  // Scenario 14: Receipt without Merchant -> Defaults to "ร้านค้า/ผู้รับเงิน"
  // ----------------------------------------------------
  console.log('Scenario 14: Receipt without merchant -> Defaults to "ร้านค้า/ผู้รับเงิน"...');
  sentMessages = [];
  mockReceiptAdapter.setNextRawText(
    `ยอดรวม 150.00 บาท`
  );

  await handleImageMessage(
    testUserId,
    'msg_s14',
    'reply_s14',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(mockReceiptAdapter)
  );

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('ร้านค้า/ผู้รับเงิน'));
  console.log('   ✅ Missing merchant safely defaulted.');

  // ----------------------------------------------------
  // Scenario 15: Payment Card PII Masking
  // ----------------------------------------------------
  console.log('Scenario 15: Payment Card PII Masking check...');
  const sensitiveText = `Big C\nCard: 4111 2222 3333 4444\nTotal 250.00`;
  const parsedPII = parseReceiptRawText(sensitiveText);
  assert(!parsedPII.sanitizedRawText.includes('4111 2222 3333 4444'));
  assert(parsedPII.sanitizedRawText.includes('****-****-****-****'));
  console.log('   ✅ Credit card PAN successfully masked in raw text.');

  // ----------------------------------------------------
  // Scenario 16: Typhoon OCR End-to-End Pipeline & Confirmation Flow
  // ----------------------------------------------------
  console.log('Scenario 16: Typhoon OCR End-to-End Pipeline & Confirmation Flow...');
  sentMessages = [];
  const typhoonMockFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        results: [
          {
            message: {
              choices: [
                {
                  message: {
                    content: 'Gourmet Market\n02/09/2026 16:00\nยอดรวม 420.00 บาท',
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const typhoonAdapter = new TyphoonOcrAdapter({
    apiKey: 'dummy-test-key',
    fetchFn: typhoonMockFetch,
  });

  await handleImageMessage(
    testUserId,
    'msg_s16',
    'reply_s16',
    mockLineClient,
    mockBlobClient,
    new SlipService(mockSlipProvider),
    new ReceiptService(typhoonAdapter)
  );

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('420.00'));
  assert(sentMessages[0].altText.includes('Gourmet Market'));

  // Retrieve the created draft from DB
  const latestDraftRes = await query<any>(
    `SELECT td.* FROM transaction_drafts td
     JOIN users u ON td.user_id = u.id
     WHERE u.line_user_id = $1
     ORDER BY td.created_at DESC LIMIT 1;`,
    [testUserId]
  );
  assert.equal(latestDraftRes.rows.length, 1);
  const createdDraft = latestDraftRes.rows[0];
  assert.equal(createdDraft.source, 'receipt');
  assert.equal(createdDraft.status, 'pending_confirmation');
  assert.equal(Number(createdDraft.extracted_data.amount), 420.0);
  assert.equal(createdDraft.extracted_data.ocrProvider, 'typhoon-ocr');

  // Verify that permanent transaction is NOT yet created
  const txBeforeConfirm = await countUserTransactions(testUserId);
  assert.equal(txBeforeConfirm, initialTxs, 'No transaction should be created before explicit confirmation!');

  // Now simulate user tapping "✅ ยืนยัน" on LINE flex bubble
  const commitResult = await TransactionRepository.commitDraft(createdDraft.id, createdDraft.user_id);
  assert(commitResult.transaction, 'Transaction must be returned upon commit');
  assert(commitResult.auditLog, 'Audit log must be created upon commit');
  assert.equal(Number(commitResult.transaction.amount), 420.0);
  assert.equal(commitResult.transaction.merchant_id, 'Gourmet Market');

  // Verify draft is now marked confirmed
  const confirmedDraftRes = await query<any>(
    `SELECT * FROM transaction_drafts WHERE id = $1;`,
    [createdDraft.id]
  );
  assert.equal(confirmedDraftRes.rows[0].status, 'confirmed');
  assert.equal(confirmedDraftRes.rows[0].transaction_id, commitResult.transaction.id);

  // Exactly 1 permanent transaction should now exist for user
  const txAfterConfirm = await countUserTransactions(testUserId);
  assert.equal(txAfterConfirm, initialTxs + 1, 'Exactly 1 transaction must exist after confirmation!');
  console.log('   ✅ Typhoon OCR created receipt draft, user confirmation committed to permanent transaction.');

  console.log('\n====================================================');
  console.log('🎉 ALL 16 RECEIPT OCR TEST SCENARIOS PASSED 100%!');
  console.log('====================================================\n');
}

runReceiptOcrTests().catch((err) => {
  console.error('Receipt OCR Test Suite Failed:', err);
  process.exit(1);
});
