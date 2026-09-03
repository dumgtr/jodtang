import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { handleImageMessage } from '../src/handlers/image.handler';
import { SlipService } from '../src/modules/slip/slip.service';
import { ISlipProvider } from '../src/modules/slip/slip-provider.interface';
import { ReceiptService } from '../src/modules/receipt/receipt.service';
import { MockReceiptAdapter } from '../src/modules/receipt/providers/mock-receipt.adapter';
import { TyphoonOcrAdapter } from '../src/modules/receipt/providers/typhoon-ocr.adapter';
import { DraftRepository } from '../src/modules/draft/draft.repository';
import { query } from '../src/db/client';

class MockSlipProvider implements ISlipProvider {
  readonly name = 'mock-slip-provider';
  public responseStatus: any = 'SUCCESS';
  public responseCode: string = '200000';
  public callCount: number = 0;

  async verifySlipImage(): Promise<any> {
    this.callCount++;
    if (this.responseStatus === 'SUCCESS') {
      return {
        status: 'SUCCESS',
        rawCode: '200000',
        data: {
          amount: 100.0,
          occurredAt: new Date().toISOString(),
          merchant: 'STARBUCKS COFFEE',
          senderName: 'นายฐานิสร์ จ***',
          transRef: `REF_TEST_${Date.now()}`,
        },
      };
    }
    return {
      status: this.responseStatus,
      rawCode: this.responseCode,
      errorMessage: `Mock ${this.responseStatus} Error`,
    };
  }
}

async function runImageRoutingIntegrationTests() {
  console.log('================================================================');
  console.log('🧪 Testing Image Routing Integration Suite');
  console.log('================================================================\n');

  const testUserId = `U_INTEG_TEST_${Date.now()}`;
  let sentMessages: any[] = [];
  const mockLineClient: any = {
    replyMessage: async ({ messages }: { messages: any[] }) => {
      sentMessages.push(...messages);
    },
  };

  const fixtureDir = path.resolve(__dirname, '../tests/fixtures/regression/prod-200500');
  const genuineSlipBuf = fs.readFileSync(path.join(fixtureDir, 'case-003-ktb-slip-genuine.jpg'));
  const paoTangBuf = fs.readFileSync(path.join(fixtureDir, 'case-001-pao-tang-32thb.jpg'));
  const ktcBillBuf = fs.readFileSync(path.join(fixtureDir, 'case-002-ktc-bill-8715thb.jpg'));
  const croppedSlipBuf = fs.readFileSync(path.join(fixtureDir, 'case-004-ktb-slip-cropped.jpg'));

  function createMockBlobClient(buffer: Buffer) {
    return {
      getMessageContent: async () => {
        return (async function* () {
          yield buffer;
        })();
      },
    } as any;
  }

  async function countUserDrafts(userId: string): Promise<number> {
    const res = await query<{ count: string }>(
      `SELECT COUNT(*) FROM transaction_drafts td
       JOIN users u ON td.user_id = u.id
       WHERE u.line_user_id = $1;`,
      [userId]
    );
    return parseInt(res.rows[0].count, 10);
  }

  const typhoonAdapter = new TyphoonOcrAdapter();
  const isLiveOcr = typhoonAdapter.isConfigured();
  console.log(`Typhoon OCR Provider Configured: ${isLiveOcr ? 'YES (Live API)' : 'NO'}\n`);

  // ---------------------------------------------------------------------------
  // TEST 1: Real Bank Slip -> Classified as BANK_SLIP_QR -> Direct to Slip2Go
  // ---------------------------------------------------------------------------
  console.log('Test 1: Genuine Bank Slip (case-003) -> BANK_SLIP_QR -> Slip2Go Invoked (OCR NOT Called)...');
  sentMessages = [];
  const mockSlip1 = new MockSlipProvider();
  let ocrCallCount1 = 0;
  const mockReceipt1 = new MockReceiptAdapter(true);
  const origExtract1 = mockReceipt1.extractReceipt.bind(mockReceipt1);
  mockReceipt1.extractReceipt = async (...args) => {
    ocrCallCount1++;
    return origExtract1(...args);
  };

  await handleImageMessage(
    testUserId,
    'msg_t1',
    'reply_t1',
    mockLineClient,
    createMockBlobClient(genuineSlipBuf),
    new SlipService(mockSlip1),
    new ReceiptService(mockReceipt1)
  );

  assert.equal(mockSlip1.callCount, 1, '[Test 1] SlipService MUST be called for BANK_SLIP_QR!');
  assert.equal(ocrCallCount1, 0, '[Test 1] Receipt OCR MUST NEVER be called for BANK_SLIP_QR!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('100.00'));
  console.log('   ✅ Genuine bank slip routed directly to Slip2Go, created Slip Draft, OCR was NOT called.\n');

  // ---------------------------------------------------------------------------
  // TEST 2: Production Fixture 001 (Pao Tang 32 THB) -> NO_QR -> Policy B e-Wallet
  // ---------------------------------------------------------------------------
  console.log('Test 2: Production Fixture 001 (Pao Tang) -> NO_QR -> OCR -> [Unverified e-Wallet ⚠️] Draft...');
  sentMessages = [];
  const mockSlip2 = new MockSlipProvider();

  await handleImageMessage(
    testUserId,
    'msg_t2',
    'reply_t2',
    mockLineClient,
    createMockBlobClient(paoTangBuf),
    new SlipService(mockSlip2),
    new ReceiptService(typhoonAdapter)
  );

  assert.equal(mockSlip2.callCount, 0, '[Test 2] Slip2Go MUST NOT be called for NO_QR e-Wallet!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('[Unverified e-Wallet ⚠️]'));
  assert(sentMessages[0].altText.includes('32.00'));
  console.log('   ✅ Pao Tang G-Wallet bypassed Slip2Go, OCR extracted 32 THB, created [Unverified e-Wallet ⚠️] Draft.\n');

  // ---------------------------------------------------------------------------
  // TEST 3: Production Fixture 002 (KTC Bill 8,715.89 THB) -> NO_QR -> Policy B Bill Payment
  // ---------------------------------------------------------------------------
  console.log('Test 3: Production Fixture 002 (KTC Bill) -> NO_QR -> OCR -> [Unverified Bill Payment ⚠️] Draft...');
  sentMessages = [];
  const mockSlip3 = new MockSlipProvider();

  await handleImageMessage(
    testUserId,
    'msg_t3',
    'reply_t3',
    mockLineClient,
    createMockBlobClient(ktcBillBuf),
    new SlipService(mockSlip3),
    new ReceiptService(typhoonAdapter)
  );

  assert.equal(mockSlip3.callCount, 0, '[Test 3] Slip2Go MUST NOT be called for NO_QR Bill Payment!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'flex');
  assert(sentMessages[0].altText.includes('[Unverified Bill Payment ⚠️]'));
  assert(sentMessages[0].altText.includes('8,715.89') || sentMessages[0].altText.includes('8715.89'));
  console.log('   ✅ KTC Bill bypassed Slip2Go, OCR extracted 8,715.89 THB, created [Unverified Bill Payment ⚠️] Draft.\n');

  // ---------------------------------------------------------------------------
  // TEST 4: Cropped Slip Fixture 004 -> NO_QR -> OCR -> Bank-Slip Guard HARD STOP
  // ---------------------------------------------------------------------------
  console.log('Test 4: Cropped Bank Slip (case-004) -> NO_QR -> OCR -> Guard HARD STOP (0 Draft Created)...');
  sentMessages = [];
  const mockSlip4 = new MockSlipProvider();
  const draftsBefore4 = await countUserDrafts(testUserId);

  await handleImageMessage(
    testUserId,
    'msg_t4',
    'reply_t4',
    mockLineClient,
    createMockBlobClient(croppedSlipBuf),
    new SlipService(mockSlip4),
    new ReceiptService(typhoonAdapter)
  );

  assert.equal(mockSlip4.callCount, 0, '[Test 4] Slip2Go MUST NOT be called for cropped slip!');
  const draftsAfter4 = await countUserDrafts(testUserId);
  assert.equal(draftsAfter4, draftsBefore4, '[Test 4] EXACTLY 0 drafts must be created for suspected bank slip without QR!');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'text');
  assert(sentMessages[0].text.includes('ตรวจพบสลิปธนาคารที่ไม่มี QR') || sentMessages[0].text.includes('เพื่อความปลอดภัย'));
  console.log('   ✅ Cropped bank slip was caught by Bank-Slip Likelihood Guard, enforced HARD STOP, 0 drafts created.\n');

  // ---------------------------------------------------------------------------
  // TEST 5: Hard Invariant: Simulated Slip2Go 200500 Error NEVER Falls Back to OCR
  // ---------------------------------------------------------------------------
  console.log('Test 5: Hard Invariant: Slip2Go 200500 Fraud Error MUST NEVER Fall Back to OCR...');
  sentMessages = [];
  const mockSlip5 = new MockSlipProvider();
  mockSlip5.responseStatus = 'FRAUD';
  mockSlip5.responseCode = '200500';

  let ocrCallCount5 = 0;
  const mockReceipt5 = new MockReceiptAdapter(true);
  mockReceipt5.extractReceipt = async () => {
    ocrCallCount5++;
    throw new Error('SECURITY VIOLATION: OCR MUST NEVER BE INVOKED ON 200500!');
  };

  const draftsBefore5 = await countUserDrafts(testUserId);
  await handleImageMessage(
    testUserId,
    'msg_t5',
    'reply_t5',
    mockLineClient,
    createMockBlobClient(genuineSlipBuf), // Image has genuine Mini-QR
    new SlipService(mockSlip5),
    new ReceiptService(mockReceipt5)
  );

  assert.equal(mockSlip5.callCount, 1, '[Test 5] Slip2Go was invoked.');
  assert.equal(ocrCallCount5, 0, '[Test 5] CRITICAL SECURITY INVARIANT: OCR was NEVER called on 200500!');
  const draftsAfter5 = await countUserDrafts(testUserId);
  assert.equal(draftsAfter5, draftsBefore5, '[Test 5] Zero drafts created on 200500.');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, 'text');
  console.log('   ✅ Slip2Go 200500 rejection stopped immediately, OCR was NEVER invoked (Invariant Preserved).\n');

  console.log('================================================================');
  console.log('🎉 ALL 5 IMAGE ROUTING INTEGRATION TESTS PASSED 100%!');
  console.log('================================================================\n');
}

runImageRoutingIntegrationTests().catch((err) => {
  console.error('Fatal Integration Test Error:', err);
  process.exit(1);
});
