import { SlipParserService } from '../src/services/slip-parser.service';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function testSlipPipeline() {
  console.log('====================================================');
  console.log('🧪 Testing Slip Parser with Real SCB Slip Text');
  console.log('====================================================');

  const scbSlipText = `
SCB EASY
โอนเงินสำเร็จ
19 ส.ค. 2569 - 14:10
รหัสอ้างอิง: 202608191234567890
จาก: นาย ธนิต จิตต์
ไปยัง: พระวรงคต วริยธโร
ธ.ไทยพาณิชย์: xxx-xxx123-4
จำนวนเงิน: 22.00 บาท
ค่าธรรมเนียม: 0.00 บาท
  `;

  const parsed = SlipParserService.parseViaDeterministicRegex(scbSlipText, '2026-08-19');
  console.log('Extracted Amount (CODE):', parsed.amount);
  console.log('Extracted Receiver (CODE):', parsed.receiver);
  console.log('Extracted Date (CODE):', parsed.transDate);

  assert(parsed.amount === 22, 'deterministic parser must preserve the 22.00 amount');
  assert(parsed.receiver.includes('พระวรงคต'), 'deterministic parser must identify the receiver');
  assert(parsed.transDate === '19 ส.ค. 2569', 'deterministic parser must identify the transfer date');

  console.log('\n✅ Deterministic slip parsing test passed.');
}

testSlipPipeline().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
