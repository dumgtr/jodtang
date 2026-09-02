import sharp from 'sharp';
import { TyphoonOcrAdapter } from '../src/modules/receipt/providers/typhoon-ocr.adapter';
import { env } from '../src/config/env';

async function main() {
  console.log('====================================================');
  console.log('🌪️ Live Typhoon OCR 1.5 Smoke Test');
  console.log('====================================================\n');

  if (!env.TYPHOON_API_KEY) {
    console.error('❌ TYPHOON_API_KEY is not found in environment.');
    process.exit(1);
  }

  // Masked key display (e.g. sk-****1234)
  const keyPreview = env.TYPHOON_API_KEY.slice(0, 4) + '****' + env.TYPHOON_API_KEY.slice(-4);
  console.log(`🔑 TYPHOON_API_KEY detected: ${keyPreview}`);
  console.log(`🌐 Base URL: ${env.TYPHOON_BASE_URL || 'https://api.opentyphoon.ai/v1'}`);

  // Create synthetic receipt image with sharp
  console.log('\n📸 Rendering synthetic Thai receipt image via Sharp...');
  const svgReceipt = `
    <svg width="450" height="350" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <text x="30" y="60" font-family="sans-serif" font-size="26" font-weight="bold" fill="#111111">7-Eleven</text>
      <text x="30" y="110" font-family="sans-serif" font-size="20" fill="#333333">ขนมปังฟาร์มเฮ้าส์  32.00</text>
      <text x="30" y="150" font-family="sans-serif" font-size="20" fill="#333333">นมสดเมจิ          27.00</text>
      <text x="30" y="210" font-family="sans-serif" font-size="24" font-weight="bold" fill="#000000">ยอดรวม 59.00 บาท</text>
      <text x="30" y="260" font-family="sans-serif" font-size="16" fill="#666666">02/09/2026 12:30</text>
      <text x="30" y="300" font-family="sans-serif" font-size="14" fill="#888888">POS# 001-9988</text>
    </svg>
  `;

  const imageBuffer = await sharp(Buffer.from(svgReceipt)).jpeg({ quality: 90 }).toBuffer();
  console.log(`   ✅ Image generated (${imageBuffer.length} bytes JPEG).`);

  console.log('\n🚀 Sending request to Typhoon OCR API (https://api.opentyphoon.ai/v1/ocr)...');
  const startTime = Date.now();
  const adapter = new TyphoonOcrAdapter();
  const result = await adapter.extractReceipt(imageBuffer, 'image/jpeg');
  const durationMs = Date.now() - startTime;

  console.log(`\n⏱️ Request completed in ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`);
  console.log('📊 Result Status:', result.status);

  if (result.status === 'SUCCESS' && result.data) {
    console.log('\n✅ Structured Data Extracted Successfully:');
    console.log(`   - Merchant:       ${result.data.merchant}`);
    console.log(`   - Amount:         ฿${result.data.amount.toFixed(2)}`);
    console.log(`   - OccurredAt:     ${result.data.occurredAt}`);
    console.log(`   - Receipt Number: ${result.data.receiptNumber || 'N/A'}`);
    console.log(`   - Confidence:     ${result.data.confidence}`);
    console.log('\n📝 Sanitized Raw Text Output:');
    console.log('----------------------------------------------------');
    console.log(result.data.rawText);
    console.log('----------------------------------------------------');
  } else {
    console.error('\n❌ Extraction did not succeed:');
    console.error(`   - Error Message: ${result.errorMessage}`);
  }

  console.log('\n====================================================');
  console.log('🎉 Live Smoke Test Completed!');
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
