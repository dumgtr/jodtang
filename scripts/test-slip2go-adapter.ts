import assert from 'node:assert/strict';
import { Slip2GoAdapter } from '../src/modules/slip/slip2go.adapter';

async function runSlip2GoAdapterTests() {
  console.log('====================================================');
  console.log('🧪 Testing Slip2Go Adapter Complete Response Code Suite');
  console.log('====================================================\n');

  function createMockAdapter(
    code: string | number,
    message: string,
    data?: any,
    httpStatus: number = 200
  ) {
    const mockFetch: typeof fetch = async () => {
      return {
        status: httpStatus,
        text: async () =>
          JSON.stringify({
            code: String(code),
            message,
            data,
          }),
      } as any;
    };
    return new Slip2GoAdapter({ secret: 'dummy_secret', fetchFn: mockFetch });
  }

  // 1. Missing Secret
  console.log('1. Testing missing secret handling...');
  const noSecretAdapter = new Slip2GoAdapter({ secret: undefined });
  const noSecretRes = await noSecretAdapter.verifySlipImage(Buffer.from('fake-image'));
  assert.equal(noSecretRes.status, 'PROVIDER_ERROR');
  assert.equal(noSecretRes.errorMessage, 'SLIP2GO_API_SECRET_MISSING');
  console.log('   ✅ Missing secret safely returns PROVIDER_ERROR.');

  // 2. Success (200000)
  console.log('2. Testing successful slip verification (200000)...');
  const successAdapter = createMockAdapter('200000', 'Slip found.', {
    transRef: 'TEST_REF_12345',
    dateTime: '2026-08-31T15:52:24+07:00',
    amount: 100,
    receiver: { account: { name: 'STARBUCKS COFFEE' } },
    sender: { account: { name: 'นายทดสอบ' } },
  });
  const successRes = await successAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(successRes.status, 'SUCCESS');
  assert.equal(successRes.data?.amount, 100);
  assert.equal(successRes.data?.transRef, 'TEST_REF_12345');
  console.log('   ✅ 200000 correctly mapped to SUCCESS.');

  // 3. Valid (200200)
  console.log('3. Testing valid slip verification (200200)...');
  const validAdapter = createMockAdapter('200200', 'Slip is valid.', {
    transRef: 'TEST_REF_200200',
    dateTime: '2026-08-31T16:00:00+07:00',
    amount: 250,
    receiver: { account: { name: 'TRUE MONEY' } },
  });
  const validRes = await validAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(validRes.status, 'SUCCESS');
  assert.equal(validRes.data?.amount, 250);
  assert.equal(validRes.data?.transRef, 'TEST_REF_200200');
  console.log('   ✅ 200200 correctly mapped to SUCCESS.');

  // 4. Account Info (200001)
  console.log('4. Testing getAccountInfo (200001)...');
  const accountInfoAdapter = new Slip2GoAdapter({
    secret: 'dummy_secret',
    fetchFn: async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          code: '200001',
          message: 'Get Info Success',
          data: {
            quota: 100,
            tokenRemaining: 50,
          },
        }),
    } as any),
  });
  const accountRes = await accountInfoAdapter.getAccountInfo();
  assert.equal(accountRes.status, 'SUCCESS');
  assert.equal(accountRes.rawCode, '200001');
  assert.equal(accountRes.data?.quota, 100);
  console.log('   ✅ 200001 correctly mapped to SUCCESS for account/info context.');

  // 5. Queued / Processing (200202)
  console.log('5. Testing queued slip response (200202)...');
  const queuedAdapter = createMockAdapter('200202', 'Successfully Queue');
  const queuedRes = await queuedAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(queuedRes.status, 'QUEUED');
  assert.equal(queuedRes.rawCode, '200202');
  console.log('   ✅ 200202 correctly mapped to QUEUED.');

  // 6. Recipient Mismatch (200401)
  console.log('6. Testing recipient mismatch (200401)...');
  const recipientMismatchAdapter = createMockAdapter('200401', 'Recipient Account Not Match');
  const recipientMismatchRes = await recipientMismatchAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(recipientMismatchRes.status, 'RECIPIENT_MISMATCH');
  assert.equal(recipientMismatchRes.rawCode, '200401');
  console.log('   ✅ 200401 correctly mapped to RECIPIENT_MISMATCH.');

  // 7. Amount Mismatch (200402)
  console.log('7. Testing amount mismatch (200402)...');
  const amountMismatchAdapter = createMockAdapter('200402', 'Transfer Amount Not Match');
  const amountMismatchRes = await amountMismatchAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(amountMismatchRes.status, 'AMOUNT_MISMATCH');
  assert.equal(amountMismatchRes.rawCode, '200402');
  console.log('   ✅ 200402 correctly mapped to AMOUNT_MISMATCH.');

  // 8. Date Mismatch (200403)
  console.log('8. Testing date mismatch (200403)...');
  const dateMismatchAdapter = createMockAdapter('200403', 'Transfer Date Not Match');
  const dateMismatchRes = await dateMismatchAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(dateMismatchRes.status, 'DATE_MISMATCH');
  assert.equal(dateMismatchRes.rawCode, '200403');
  console.log('   ✅ 200403 correctly mapped to DATE_MISMATCH.');

  // 9. Slip Not Found (200404 & legacy 400001)
  console.log('9. Testing slip not found (200404 & 400001)...');
  const notFoundAdapter200404 = createMockAdapter('200404', 'Slip not found');
  const notFoundRes200404 = await notFoundAdapter200404.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(notFoundRes200404.status, 'NOT_FOUND');
  assert.equal(notFoundRes200404.rawCode, '200404');

  const notFoundAdapter400001 = createMockAdapter('400001', 'Slip not found.');
  const notFoundRes400001 = await notFoundAdapter400001.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(notFoundRes400001.status, 'NOT_FOUND');
  console.log('   ✅ 200404 and 400001 correctly mapped to NOT_FOUND.');

  // 10. Fraudulent Slip (200500)
  console.log('10. Testing fraud slip (200500)...');
  const fraudAdapter = createMockAdapter('200500', 'Slip is fraud.');
  const fraudRes = await fraudAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(fraudRes.status, 'FRAUD');
  assert.equal(fraudRes.rawCode, '200500');
  console.log('   ✅ 200500 correctly mapped to FRAUD.');

  // 11. Duplicate Slip (200501, casing variations, legacy 400004)
  console.log('11. Testing duplicate slip mappings (200501 & variations)...');
  // 11a. Exact code 200501 + standard message
  const dup1 = await createMockAdapter('200501', 'Slip is Duplicated.').verifySlipImage(Buffer.from('slip'));
  assert.equal(dup1.status, 'DUPLICATE');
  assert.equal(dup1.rawCode, '200501');

  // 11b. Code 200501 + uppercase casing
  const dup2 = await createMockAdapter('200501', 'SLIP IS DUPLICATED.').verifySlipImage(Buffer.from('slip'));
  assert.equal(dup2.status, 'DUPLICATE');

  // 11c. Code 200501 + unknown wording
  const dup3 = await createMockAdapter('200501', 'Custom duplicate notification').verifySlipImage(Buffer.from('slip'));
  assert.equal(dup3.status, 'DUPLICATE');

  // 11d. Legacy code 400004
  const dupLegacyCode = await createMockAdapter('400004', 'This slip has already been used.').verifySlipImage(Buffer.from('slip'));
  assert.equal(dupLegacyCode.status, 'DUPLICATE');

  // 11e. Legacy Thai message "สลิปซ้ำ"
  const dupThai = await createMockAdapter('400000', 'สลิปซ้ำในระบบ').verifySlipImage(Buffer.from('slip'));
  assert.equal(dupThai.status, 'DUPLICATE');
  console.log('   ✅ 200501 and duplicate variations reliably mapped to DUPLICATE.');

  // 12. HTTP 200/201 Status Priority: Provider code takes precedence over HTTP 2xx
  console.log('12. Testing HTTP 200/201 with business error codes (code precedence)...');
  // HTTP 201 with code 200501 -> DUPLICATE
  const http201Dup = await createMockAdapter('200501', 'Slip is Duplicated.', null, 201).verifySlipImage(Buffer.from('slip'));
  assert.equal(http201Dup.status, 'DUPLICATE');

  // HTTP 200 with code 200500 -> FRAUD
  const http200Fraud = await createMockAdapter('200500', 'Slip is fraud.', null, 200).verifySlipImage(Buffer.from('slip'));
  assert.equal(http200Fraud.status, 'FRAUD');

  // HTTP 200 with code 200404 -> NOT_FOUND
  const http200NotFound = await createMockAdapter('200404', 'Slip not found', null, 200).verifySlipImage(Buffer.from('slip'));
  assert.equal(http200NotFound.status, 'NOT_FOUND');
  console.log('   ✅ Provider business code correctly takes precedence over HTTP 200/201.');

  // 13. Bank Error / Retryable (200502)
  console.log('13. Testing bank error (200502)...');
  const bankErrAdapter = createMockAdapter('200502', 'Bank error, Please try again');
  const bankErrRes = await bankErrAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(bankErrRes.status, 'BANK_ERROR');
  assert.equal(bankErrRes.rawCode, '200502');
  console.log('   ✅ 200502 correctly mapped to BANK_ERROR.');

  // 14. Temporary Conflict / Concurrency Rate Lock (400409)
  console.log('14. Testing temporary conflict (400409)...');
  const conflictAdapter = createMockAdapter('400409', 'Request is conflicted.', null, 429);
  const conflictRes = await conflictAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(conflictRes.status, 'TEMPORARY_CONFLICT');
  assert.notEqual(conflictRes.status, 'DUPLICATE', 'Must NOT map to DUPLICATE');
  assert.notEqual(conflictRes.status, 'FRAUD', 'Must NOT map to FRAUD');
  assert.notEqual(conflictRes.status, 'PROVIDER_ERROR', 'Must NOT map to generic PROVIDER_ERROR');
  console.log('   ✅ 400409 correctly mapped to TEMPORARY_CONFLICT (not duplicate/fraud/provider_error).');

  // 15. Invalid Image / Unreadable QR (400002 / 400003)
  console.log('15. Testing unreadable QR / invalid image (400002 / 400003)...');
  const invalidAdapter = createMockAdapter('400002', 'Cannot read QR from image');
  const invalidRes = await invalidAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(invalidRes.status, 'INVALID_IMAGE');
  console.log('   ✅ 400002 correctly mapped to INVALID_IMAGE.');

  // 16. Quota Exhausted (400005, 429)
  console.log('16. Testing quota exhausted (400005, 429)...');
  const quotaAdapter = createMockAdapter('400005', 'Quota exceeded');
  const quotaRes = await quotaAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(quotaRes.status, 'QUOTA_EXCEEDED');

  const rateLimitAdapter = createMockAdapter('429', 'Rate limit exceeded', null, 429);
  const rateLimitRes = await rateLimitAdapter.verifySlipImage(Buffer.from('slip-bytes'));
  assert.equal(rateLimitRes.status, 'QUOTA_EXCEEDED');
  console.log('   ✅ 400005 and 429 correctly mapped to QUOTA_EXCEEDED.');

  // 17. Authentication Failure (HTTP 401)
  console.log('17. Testing authentication failure (401)...');
  const authFailAdapter = new Slip2GoAdapter({
    secret: 'invalid_secret',
    fetchFn: async () => ({ status: 401, text: async () => JSON.stringify({ message: 'Unauthorized' }) } as any),
  });
  const authFailRes = await authFailAdapter.verifySlipImage(Buffer.from('slip'));
  assert.equal(authFailRes.status, 'PROVIDER_ERROR');
  assert.equal(authFailRes.errorMessage, 'AUTHENTICATION_FAILED');
  console.log('   ✅ 401 Unauthorized safely mapped without secret leak.');

  // 18. Malformed & Missing Code Responses
  console.log('18. Testing malformed & missing code responses...');
  // 18a. Malformed non-JSON response
  const malformedAdapter = new Slip2GoAdapter({
    secret: 'dummy_secret',
    fetchFn: async () => ({ status: 502, text: async () => '<html>Bad Gateway</html>' } as any),
  });
  const malformedRes = await malformedAdapter.verifySlipImage(Buffer.from('slip'));
  assert.equal(malformedRes.status, 'PROVIDER_ERROR');
  assert.equal(malformedRes.errorMessage, 'INVALID_JSON_RESPONSE');

  // 18b. Missing code in JSON
  const missingCodeAdapter = new Slip2GoAdapter({
    secret: 'dummy_secret',
    fetchFn: async () => ({ status: 500, text: async () => JSON.stringify({ error: 'Server exploded' }) } as any),
  });
  const missingCodeRes = await missingCodeAdapter.verifySlipImage(Buffer.from('slip'));
  assert.equal(missingCodeRes.status, 'PROVIDER_ERROR');
  assert.equal(missingCodeRes.rawCode, '500');
  console.log('   ✅ Malformed non-JSON & missing code safely handled as PROVIDER_ERROR.');

  // 19. Boundary Tests
  console.log('19. Testing boundary cases...');
  // 19a. Unknown provider code -> PROVIDER_ERROR
  const unknownCodeAdapter = createMockAdapter('999999', 'Some completely unknown error code');
  const unknownRes = await unknownCodeAdapter.verifySlipImage(Buffer.from('slip'));
  assert.equal(unknownRes.status, 'PROVIDER_ERROR');
  assert.equal(unknownRes.rawCode, '999999');

  // 19b. Random message containing "duplicate" without duplicate semantics/code
  const randomMsgAdapter = createMockAdapter('888888', 'Unrelated system log mentioning duplicate buffer pointer');
  const randomMsgRes = await randomMsgAdapter.verifySlipImage(Buffer.from('slip'));
  assert.equal(randomMsgRes.status, 'PROVIDER_ERROR', 'Random message must not falsely map to DUPLICATE');
  console.log('   ✅ Boundary tests passed: unknown code & false-keyword safety preserved.');

  console.log('\n====================================================');
  console.log('🎉 ALL 19 SLIP2GO ADAPTER UNIT TESTS PASSED 100%!');
  console.log('====================================================\n');
}

runSlip2GoAdapterTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
