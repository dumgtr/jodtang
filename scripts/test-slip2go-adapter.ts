import assert from 'node:assert/strict';
import { Slip2GoAdapter } from '../src/modules/slip/slip2go.adapter';

async function runSlip2GoAdapterTests() {
  console.log('====================================================');
  console.log('🧪 Testing Slip2Go Adapter Unit Test Suite');
  console.log('====================================================');

  // Test 1: Missing secret returns PROVIDER_ERROR without throwing
  console.log('1. Testing missing secret handling...');
  const noSecretAdapter = new Slip2GoAdapter({ secret: undefined });
  const noSecretRes = await noSecretAdapter.verifySlipImage(Buffer.from('fake-image'));
  assert.equal(noSecretRes.status, 'PROVIDER_ERROR');
  assert.equal(noSecretRes.errorMessage, 'SLIP2GO_API_SECRET_MISSING');
  console.log('   ✅ Missing secret safely returns PROVIDER_ERROR.');

  // Test 2: Successful verification (code 200000)
  console.log('2. Testing successful slip verification (200000)...');
  const mockFetchSuccess: typeof fetch = async () => {
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          code: '200000',
          message: 'Slip found.',
          data: {
            transRef: 'TEST_REF_12345',
            dateTime: '2026-08-31T15:52:24+07:00',
            amount: 100,
            receiver: { account: { name: 'STARBUCKS COFFEE' } },
            sender: { account: { name: 'นายทดสอบ' } },
          },
        }),
    } as any;
  };

  const successAdapter = new Slip2GoAdapter({ secret: 'dummy_secret', fetchFn: mockFetchSuccess });
  const successRes = await successAdapter.verifySlipImage(Buffer.from('slip-image-bytes'));
  assert.equal(successRes.status, 'SUCCESS');
  assert.equal(successRes.data?.amount, 100);
  assert.equal(successRes.data?.merchant, 'STARBUCKS COFFEE');
  assert.equal(successRes.data?.transRef, 'TEST_REF_12345');
  assert.equal(successRes.data?.occurredAt, new Date('2026-08-31T15:52:24+07:00').toISOString());
  console.log('   ✅ Success response correctly normalized.');

  // Test 3: Duplicate slip (code 400004)
  console.log('3. Testing duplicate slip handling (400004)...');
  const mockFetchDuplicate: typeof fetch = async () => {
    return {
      status: 400,
      text: async () =>
        JSON.stringify({
          code: '400004',
          message: 'This slip has already been used.',
        }),
    } as any;
  };

  const duplicateAdapter = new Slip2GoAdapter({ secret: 'dummy_secret', fetchFn: mockFetchDuplicate });
  const duplicateRes = await duplicateAdapter.verifySlipImage(Buffer.from('slip-image-bytes'));
  assert.equal(duplicateRes.status, 'DUPLICATE');
  console.log('   ✅ Duplicate response mapped to DUPLICATE.');

  // Test 4: Slip not found (code 400001)
  console.log('4. Testing slip not found (400001)...');
  const mockFetchNotFound: typeof fetch = async () => {
    return {
      status: 400,
      text: async () =>
        JSON.stringify({
          code: '400001',
          message: 'Slip not found.',
        }),
    } as any;
  };

  const notFoundAdapter = new Slip2GoAdapter({ secret: 'dummy_secret', fetchFn: mockFetchNotFound });
  const notFoundRes = await notFoundAdapter.verifySlipImage(Buffer.from('slip-image-bytes'));
  assert.equal(notFoundRes.status, 'NOT_FOUND');
  console.log('   ✅ Not found response mapped to NOT_FOUND.');

  // Test 5: Unreadable QR / blurry image (code 400002)
  console.log('5. Testing unreadable QR / invalid image (400002)...');
  const mockFetchInvalidImg: typeof fetch = async () => {
    return {
      status: 400,
      text: async () =>
        JSON.stringify({
          code: '400002',
          message: 'Cannot read QR from image',
        }),
    } as any;
  };

  const invalidImgAdapter = new Slip2GoAdapter({ secret: 'dummy_secret', fetchFn: mockFetchInvalidImg });
  const invalidImgRes = await invalidImgAdapter.verifySlipImage(Buffer.from('cat-photo'));
  assert.equal(invalidImgRes.status, 'INVALID_IMAGE');
  console.log('   ✅ Unreadable QR mapped to INVALID_IMAGE.');

  // Test 6: Quota exhausted (code 400005)
  console.log('6. Testing quota exhausted (400005)...');
  const mockFetchQuota: typeof fetch = async () => {
    return {
      status: 400,
      text: async () =>
        JSON.stringify({
          code: '400005',
          message: 'Quota exceeded',
        }),
    } as any;
  };

  const quotaAdapter = new Slip2GoAdapter({ secret: 'dummy_secret', fetchFn: mockFetchQuota });
  const quotaRes = await quotaAdapter.verifySlipImage(Buffer.from('slip'));
  assert.equal(quotaRes.status, 'QUOTA_EXCEEDED');
  console.log('   ✅ Quota exceeded mapped to QUOTA_EXCEEDED.');

  // Test 7: Authentication failure (HTTP 401)
  console.log('7. Testing authentication failure (401)...');
  const mockFetch401: typeof fetch = async () => {
    return {
      status: 401,
      text: async () => JSON.stringify({ message: 'Unauthorized' }),
    } as any;
  };

  const authFailAdapter = new Slip2GoAdapter({ secret: 'invalid_secret', fetchFn: mockFetch401 });
  const authFailRes = await authFailAdapter.verifySlipImage(Buffer.from('slip'));
  assert.equal(authFailRes.status, 'PROVIDER_ERROR');
  assert.equal(authFailRes.errorMessage, 'AUTHENTICATION_FAILED');
  console.log('   ✅ 401 Unauthorized safely mapped without secret leak.');

  // Test 8: Network error
  console.log('8. Testing network exception handling...');
  const mockFetchNetworkError: typeof fetch = async () => {
    throw new Error('Connection refused to api.slip2go.com');
  };

  const netErrAdapter = new Slip2GoAdapter({ secret: 'secret', fetchFn: mockFetchNetworkError });
  const netErrRes = await netErrAdapter.verifySlipImage(Buffer.from('slip'));
  assert.equal(netErrRes.status, 'PROVIDER_ERROR');
  console.log('   ✅ Network failure safely caught and handled.');

  console.log('\n🎉 ALL Slip2Go Adapter Unit Tests PASSED Successfully!\n');
}

runSlip2GoAdapterTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
