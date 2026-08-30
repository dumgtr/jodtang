import assert from 'node:assert/strict';
import { query } from '../src/db/client';
import { env } from '../src/config/env';
import { assertTestDatabaseConnection } from '../src/db/test-isolation';
import { UserRepository } from '../src/modules/user/user.repository';
import { handleTextMessage } from '../src/handlers/message.handler';
import { handleWebhookEvent } from '../src/handlers/webhook-event.handler';
import {
  classifySecurityFaqIntent,
  isSecurityFaqCommand,
  type SecurityFaqTopic,
} from '../src/services/security-faq.service';
import {
  buildJodTangRichMenuRequest,
  buildSecurityFaqText,
  SECURITY_FAQ_TOPIC_LABELS,
} from '../src/utils/menu.builder';

assertTestDatabaseConnection(env.DATABASE_URL);

type MockReply = {
  replyToken: string;
  messages: Array<{ type: string; text?: string; altText?: string; contents?: any; quickReply?: any }>;
};

function createMockLineClient(replies: MockReply[]) {
  return {
    replyMessage: async (reply: MockReply) => {
      replies.push(reply);
    },
  } as any;
}

type SecurityIntentCase = {
  phrase: string;
  topic: SecurityFaqTopic;
};

const securityIntentCases: SecurityIntentCase[] = [
  // overview — retain the original generic security/privacy language.
  { phrase: 'ตรวจสอบความปลอดภัย', topic: 'overview' },
  { phrase: 'สอบถามความปลอดภัย', topic: 'overview' },
  { phrase: 'นโยบายความปลอดภัย', topic: 'overview' },
  { phrase: 'ระบบปลอดภัยไหม', topic: 'overview' },
  { phrase: 'ระบบปลอดภัยหรือเปล่า', topic: 'overview' },
  { phrase: 'จดตังปลอดภัยไหม', topic: 'overview' },
  { phrase: 'ความปลอดภัยของข้อมูลเป็นยังไง', topic: 'overview' },
  { phrase: 'ความเป็นส่วนตัว', topic: 'overview' },
  { phrase: 'ความเป็นส่วนตัวของข้อมูล', topic: 'overview' },
  { phrase: 'privacy', topic: 'overview' },
  { phrase: 'security', topic: 'overview' },
  { phrase: 'data privacy', topic: 'overview' },
  { phrase: 'เรื่องความปลอดภัย', topic: 'overview' },
  { phrase: 'ขอข้อมูลความปลอดภัย', topic: 'overview' },
  { phrase: 'ปลอดภัยไหม', topic: 'overview' },
  { phrase: 'ระบบปลอดภัยมั้ย', topic: 'overview' },
  { phrase: 'ความปลอดภ้ย', topic: 'overview' },
  { phrase: 'DATA PRIVACY', topic: 'overview' },
  { phrase: '🔒 ความปลอดภัยและความเป็นส่วนตัว', topic: 'overview' },

  // encryption.
  { phrase: 'มีการเข้ารหัสข้อมูลไหม', topic: 'encryption' },
  { phrase: 'ข้อมูลเข้ารหัสไหม', topic: 'encryption' },
  { phrase: 'การเข้ารหัส', topic: 'encryption' },
  { phrase: 'ข้อมูลถูกเข้ารหัสหรือเปล่า', topic: 'encryption' },
  { phrase: 'ตอนส่งข้อมูลมีเข้ารหัสไหม', topic: 'encryption' },
  { phrase: 'เก็บข้อมูลแบบเข้ารหัสไหม', topic: 'encryption' },
  { phrase: 'ข้อมูลปลอดภัยด้วยการเข้ารหัสหรือไม่', topic: 'encryption' },
  { phrase: 'ใช้ encryption ไหม', topic: 'encryption' },
  { phrase: 'ใช้ HTTPS ไหม', topic: 'encryption' },
  { phrase: 'ส่งข้อมูลปลอดภัยไหม', topic: 'encryption' },
  { phrase: 'ระบบใช้ SSL หรือไม่', topic: 'encryption' },
  { phrase: 'เข้ารหัสตอนเก็บข้อมูลไหม', topic: 'encryption' },
  { phrase: 'มีการเข้ารหัสข้อมูลไหม!!! 🔐', topic: 'encryption' },

  // stored_data.
  { phrase: 'จดตังเก็บข้อมูลอะไรบ้าง', topic: 'stored_data' },
  { phrase: 'เก็บข้อมูลอะไร', topic: 'stored_data' },
  { phrase: 'จดตังรู้ข้อมูลส่วนตัวแค่ไหน', topic: 'stored_data' },
  { phrase: 'ข้อมูลที่ฉันส่งไปถูกเก็บไหม', topic: 'stored_data' },
  { phrase: 'ข้อมูลที่ผมพิมพ์ถูกเก็บไหม', topic: 'stored_data' },
  { phrase: 'จดตังบันทึกอะไรไว้', topic: 'stored_data' },
  { phrase: 'เก็บรายการรายรับรายจ่ายอะไรบ้าง', topic: 'stored_data' },
  { phrase: 'ข้อมูลของฉันปลอดภัยไหม', topic: 'stored_data' },
  { phrase: 'ข้อมูลส่วนตัวปลอดภัยหรือเปล่า', topic: 'stored_data' },
  { phrase: 'จดตังเอาข้อมูลไปใช้ไหม', topic: 'stored_data' },
  { phrase: 'ข้อมูลที่ส่งเข้าระบบเก็บเป็นข้อความไหม', topic: 'stored_data' },
  { phrase: 'จดตังเก็บอะไรไว้บ้าง', topic: 'stored_data' },
  { phrase: 'ข้อมูลของผมถูกเก็บอย่างไร', topic: 'stored_data' },
  { phrase: 'ระบบเอาข้อมูลฉันไปใช้ไหม', topic: 'stored_data' },

  // data_location.
  { phrase: 'ข้อมูลผมอยู่ที่ไหน', topic: 'data_location' },
  { phrase: 'ข้อมูลฉันถูกเก็บไว้ที่ไหน', topic: 'data_location' },
  { phrase: 'เก็บในมือถือหรือบน server', topic: 'data_location' },
  { phrase: 'เก็บบน cloud หรือในเครื่อง', topic: 'data_location' },
  { phrase: 'ฐานข้อมูลอยู่ที่ไหน', topic: 'data_location' },
  { phrase: 'ข้อมูลอยู่เซิร์ฟเวอร์ไหน', topic: 'data_location' },
  { phrase: 'ถ้าลบแชต LINE ข้อมูลหายไหม', topic: 'data_location' },
  { phrase: 'ข้อมูลอยู่บนมือถือหรือเซิร์ฟเวอร์', topic: 'data_location' },
  { phrase: 'ข้อมูลถูกเก็บบน cloud ไหม', topic: 'data_location' },
  { phrase: 'ข้อมูล ฉัน ถูก เก็บ ไว้ ที่ไหน', topic: 'data_location' },

  // data_access.
  { phrase: 'ใครเห็นข้อมูลผม', topic: 'data_access' },
  { phrase: 'มีใครเห็นรายการของฉันไหม', topic: 'data_access' },
  { phrase: 'คนอื่นเห็นข้อมูลฉันไหม', topic: 'data_access' },
  { phrase: 'ข้อมูลจะไปโผล่ของคนอื่นไหม', topic: 'data_access' },
  { phrase: 'ข้อมูลปนกับคนอื่นไหม', topic: 'data_access' },
  { phrase: 'แอดมินเห็นข้อมูลไหม', topic: 'data_access' },
  { phrase: 'ใครเข้าถึงรายการได้บ้าง', topic: 'data_access' },
  { phrase: 'คนอื่นค้นหารายการของผมได้ไหม', topic: 'data_access' },
  { phrase: 'ข้อมูลของฉันจะหลุดไหม', topic: 'data_access' },
  { phrase: 'ใครดูข้อมูลเราได้บ้าง', topic: 'data_access' },
  { phrase: 'ข้อมูลส่วนตัวหลุดไปไหม', topic: 'data_access' },
  { phrase: 'ผู้ดูแลระบบเห็นข้อมูลหรือไม่', topic: 'data_access' },

  // ai_processing.
  { phrase: 'AI เห็นข้อมูลไหม', topic: 'ai_processing' },
  { phrase: 'ส่งข้อมูลให้ AI หรือเปล่า', topic: 'ai_processing' },
  { phrase: 'ข้อมูลไปอยู่กับ AI ไหม', topic: 'ai_processing' },
  { phrase: 'AI เอาข้อมูลไปทำอะไร', topic: 'ai_processing' },
  { phrase: 'ส่งให้ผู้ให้บริการ AI ไหม', topic: 'ai_processing' },
  { phrase: 'ข้อมูลส่งไปหา provider ไหน', topic: 'ai_processing' },
  { phrase: 'จดตังส่งข้อความให้ AI หรือไม่', topic: 'ai_processing' },
  { phrase: 'AI ประมวลผลรายการอย่างไร', topic: 'ai_processing' },

  // ai_training_retention.
  { phrase: 'AI เอาข้อมูลไปเทรนไหม', topic: 'ai_training_retention' },
  { phrase: 'ข้อมูลถูกใช้ฝึก AI หรือไม่', topic: 'ai_training_retention' },
  { phrase: 'AI จำข้อมูลของผมไหม', topic: 'ai_training_retention' },
  { phrase: 'AI เก็บข้อความไว้นานแค่ไหน', topic: 'ai_training_retention' },
  { phrase: 'ผู้ให้บริการ AI ฝึกโมเดลจากข้อความไหม', topic: 'ai_training_retention' },
  { phrase: 'AI เอาข้อมูลไปเทรนหรือเปล่า', topic: 'ai_training_retention' },
  { phrase: 'AI จำข้อความของฉันไหม', topic: 'ai_training_retention' },
  { phrase: 'AI เก็บข้อมูลไว้นานไหม', topic: 'ai_training_retention' },
  { phrase: 'AI เอาข้อมูลไปเทรนไหม 🤖', topic: 'ai_training_retention' },

  // line_account.
  { phrase: 'ถ้าเปลี่ยนเครื่องแล้วข้อมูลหายไหม', topic: 'line_account' },
  { phrase: 'ถ้าเปลี่ยนมือถือข้อมูลยังอยู่ไหม', topic: 'line_account' },
  { phrase: 'ถ้าเข้า LINE ไม่ได้ข้อมูลจะเป็นอย่างไร', topic: 'line_account' },
  { phrase: 'LINE มีปัญหาข้อมูลจะหายไหม', topic: 'line_account' },
  { phrase: 'ถ้าเปลี่ยน LINE account ข้อมูลจะเป็นอย่างไร', topic: 'line_account' },
  { phrase: 'ถ้ามีคนเข้า LINE ผมจะเห็นข้อมูลไหม', topic: 'line_account' },
  { phrase: 'จดตังผูกกับบัญชีอะไร', topic: 'line_account' },
  { phrase: 'ข้อมูลของฉันผูกกับ LINE ไหม', topic: 'line_account' },
  { phrase: 'ข้อมูลของฉันผูกกับไลน์ไอดีไหม', topic: 'line_account' },
  { phrase: 'เปลี่ยนโทรศัพท์ข้อมูลยังอยู่หรือไม่', topic: 'line_account' },

  // banking_credentials.
  { phrase: 'จดตังเห็นบัญชีธนาคารไหม', topic: 'banking_credentials' },
  { phrase: 'จดตังเชื่อมธนาคารไหม', topic: 'banking_credentials' },
  { phrase: 'ต้องให้รหัสผ่านไหม', topic: 'banking_credentials' },
  { phrase: 'ต้องให้รหัสผ่านธนาคารไหม', topic: 'banking_credentials' },
  { phrase: 'ต้องใช้ PIN หรือ OTP ไหม', topic: 'banking_credentials' },
  { phrase: 'จดตังดูยอดบัญชีได้ไหม', topic: 'banking_credentials' },
  { phrase: 'จดตังโอนเงินแทนได้ไหม', topic: 'banking_credentials' },
  { phrase: 'จดตังหักเงินจากบัญชีไหม', topic: 'banking_credentials' },
  { phrase: 'ระบบต่อธนาคารได้หรือไม่', topic: 'banking_credentials' },
  { phrase: 'จดตังอ่านข้อมูลบัตรเครดิตไหม', topic: 'banking_credentials' },

  // user_control.
  { phrase: 'ถ้าพิมพ์ผิดทำยังไง', topic: 'user_control' },
  { phrase: 'แก้รายการได้ไหม', topic: 'user_control' },
  { phrase: 'แก้จำนวนเงินใน draft ได้ไหม', topic: 'user_control' },
  { phrase: 'ยกเลิกรายการได้ไหม', topic: 'user_control' },
  { phrase: 'แก้ไขข้อมูลรายการได้หรือไม่', topic: 'user_control' },

  // deletion_export.
  { phrase: 'ลบข้อมูลได้ไหม', topic: 'deletion_export' },
  { phrase: 'ลบรายการได้ไหม', topic: 'deletion_export' },
  { phrase: 'ลบข้อมูลทั้งหมดได้ไหม', topic: 'deletion_export' },
  { phrase: 'ส่งออกข้อมูลได้ไหม', topic: 'deletion_export' },
  { phrase: 'ขอไฟล์ข้อมูลของฉันได้ไหม', topic: 'deletion_export' },
  { phrase: 'ช่วยลบรายการเก่าได้ไหม', topic: 'deletion_export' },

  // transaction_confirmation.
  { phrase: 'ก่อนบันทึกมีให้ตรวจไหม', topic: 'transaction_confirmation' },
  { phrase: 'รายการที่บันทึกจริงต้องยืนยันไหม', topic: 'transaction_confirmation' },
  { phrase: 'มี Draft ให้ดูก่อนไหม', topic: 'transaction_confirmation' },
  { phrase: 'กดยืนยันก่อนบันทึกหรือไม่', topic: 'transaction_confirmation' },
  { phrase: 'ต้องกดยืนยันรายการไหม', topic: 'transaction_confirmation' },
];

const nonSecurityIntentCases = [
  // Write-path examples, including security-looking words that are not FAQ questions.
  'กินข้าว 80',
  'จ่ายค่าไฟ 500',
  'ได้เงินเดือน 30000',
  'โอนเงิน 100',
  'บันทึกค่าใช้จ่าย 80',
  'ซื้อ Apple 40000',
  'ค่าโทรศัพท์ 599',
  'เติมน้ำมัน 1200',
  'ซื้อของปลอดภัยไหม',
  'จ่ายเงินปลอดภัยไหม',
  'โอนเงินปลอดภัยไหม',
  'ซื้อข้อมูลปลอดภัยไหม',
  'บันทึกข้อมูล 80',
  'มีข้อมูล 80',
  '✏️ ขอแก้ไขรายการ',
  '❌ ยกเลิกรายการ',
  // Query-path examples.
  'สรุปเดือนนี้',
  'เดือนนี้ใช้เงินไปเท่าไร',
  'ดูรายการวันนี้',
  'เดือนนี้มีรายการอะไรบ้าง',
  'รายการอาหาร',
  'ค่าใช้จ่ายทั้งหมด',
  'มีเงินเท่าไร',
  // Export CSV examples (live feature commands, not Security FAQ).
  '📥 Export CSV',
  'Export CSV',
  'export csv',
  'ส่งออก CSV',
  'ดาวน์โหลด CSV',
  // Greeting/unrelated examples.
  'สวัสดี',
  'หวัดดี',
  'อากาศวันนี้เป็นยังไง',
  'ช่วยแต่งประโยคให้หน่อย',
];

const readOnlyTopicPhrases: Record<SecurityFaqTopic, string> = {
  overview: 'ตรวจสอบความปลอดภัย',
  stored_data: 'จดตังเก็บข้อมูลอะไรบ้าง',
  data_location: 'ข้อมูลฉันถูกเก็บไว้ที่ไหน',
  data_access: 'ใครเห็นข้อมูลผม',
  encryption: 'มีการเข้ารหัสข้อมูลไหม',
  ai_processing: 'AI เห็นข้อมูลไหม',
  ai_training_retention: 'AI เอาข้อมูลไปเทรนไหม',
  line_account: 'เปลี่ยนเครื่องแล้วข้อมูลหายไหม',
  banking_credentials: 'จดตังเชื่อมธนาคารไหม',
  user_control: 'แก้รายการได้ไหม',
  deletion_export: 'ส่งออกข้อมูลได้ไหม',
  transaction_confirmation: 'ต้องกดยืนยันรายการไหม',
};

function assertContentContracts(): void {
  console.log('1. Testing the 12-topic FAQ content contract...');

  const overviewText = buildSecurityFaqText('overview');
  for (const topic of Object.keys(SECURITY_FAQ_TOPIC_LABELS) as SecurityFaqTopic[]) {
    assert(overviewText.includes(SECURITY_FAQ_TOPIC_LABELS[topic]), 'Overview is missing ' + topic);
  }

  for (const topic of Object.keys(SECURITY_FAQ_TOPIC_LABELS) as SecurityFaqTopic[]) {
    const focusedText = buildSecurityFaqText(topic);
    assert(focusedText.includes(SECURITY_FAQ_TOPIC_LABELS[topic]), 'Focused FAQ is missing ' + topic);
    if (topic !== 'overview') {
      assert(focusedText.includes('หัวข้อที่เกี่ยวข้อง:'), 'Focused FAQ is missing related topics for ' + topic);
    }
  }

  const contentContracts: Array<{
    topic: SecurityFaqTopic;
    supported: string[];
    limitations: string[];
    forbidden: RegExp[];
  }> = [
    {
      topic: 'encryption',
      supported: ['PostgreSQL client', 'SSL'],
      limitations: ['ยังยืนยันไม่ได้', 'HTTPS/TLS', 'encryption at rest'],
      forbidden: [/เข้ารหัสทุกจุด/u, /การสื่อสารทั้งหมดถูกเข้ารหัส/u, /รับรองว่า.*HTTPS/u],
    },
    {
      topic: 'ai_processing',
      supported: ['ผู้ให้บริการ AI', 'Draft'],
      limitations: ['นโยบายของผู้ให้บริการภายนอก'],
      forbidden: [/AI ไม่เห็นข้อมูล/u, /ไม่ถูกเทรน/u],
    },
    {
      topic: 'ai_training_retention',
      supported: ['ยังไม่มีข้อมูลยืนยัน', 'ผู้ให้บริการ AI'],
      limitations: ['ไม่ขอรับรอง', 'ระยะเวลาเก็บข้อมูล'],
      forbidden: [/ไม่ถูกนำไปฝึก/u, /เก็บข้อมูลเป็นศูนย์/u, /zero retention ได้/u],
    },
    {
      topic: 'data_access',
      supported: ['LINE User ID', 'ไม่มีเมนูผู้ใช้ทั่วไป'],
      limitations: ['ไม่สามารถยืนยันสิทธิ์'],
      forbidden: [/ไม่มีใครเข้าถึง/u, /ผู้ดูแลไม่มีสิทธิ์/u],
    },
    {
      topic: 'deletion_export',
      supported: ['ยังไม่มีเมนู self-service', 'เปลี่ยนสถานะ'],
      limitations: ['ไม่สามารถรับรอง', 'ลบถาวร'],
      forbidden: [/ลบถาวรได้/u, /ส่งออกข้อมูลได้/u],
    },
    {
      topic: 'line_account',
      supported: ['LINE User ID', 'เปลี่ยนเครื่อง'],
      limitations: ['ไม่มีขั้นตอนรวมข้อมูล', 'backup/recovery'],
      forbidden: [/กู้คืนได้อัตโนมัติ/u, /รวมข้อมูลให้อัตโนมัติ/u],
    },
    {
      topic: 'banking_credentials',
      supported: ['ไม่มี flow', 'ไม่ใช่การโอนเงินจริง'],
      limitations: ['อย่าส่งรหัสผ่านธนาคาร', 'PIN', 'OTP'],
      forbidden: [/เชื่อมบัญชีธนาคารได้/u, /โอนเงินจริงแทนคุณได้/u],
    },
  ];

  for (const contract of contentContracts) {
    const text = buildSecurityFaqText(contract.topic);
    for (const marker of [...contract.supported, ...contract.limitations]) {
      assert(text.includes(marker), contract.topic + ' is missing content marker "' + marker + '"');
    }
    for (const forbidden of contract.forbidden) {
      assert(!forbidden.test(text), contract.topic + ' contains unsupported positive claim ' + forbidden);
    }
  }

  console.log('   ✅ Overview contains all 12 topics; focused content and claim boundaries passed.\n');
}

async function runSecurityFaqTests() {
  console.log('====================================================');
  console.log('🧪 Testing Security & Privacy FAQ v2 Flow in JodTang');
  console.log('====================================================\n');

  // Layer 1: every canonical phrase must resolve to the expected topic.
  console.log('0. Testing 12-topic natural-language intent recognition and boundaries...');
  for (const testCase of securityIntentCases) {
    assert.equal(
      isSecurityFaqCommand(testCase.phrase),
      true,
      'Expected SECURITY_FAQ for "' + testCase.phrase + '"',
    );
    assert.equal(
      classifySecurityFaqIntent(testCase.phrase),
      testCase.topic,
      'Unexpected topic for "' + testCase.phrase + '"',
    );
  }

  for (const phrase of nonSecurityIntentCases) {
    assert.equal(classifySecurityFaqIntent(phrase), null, 'Must not route "' + phrase + '" to SECURITY_FAQ');
    assert.equal(isSecurityFaqCommand(phrase), false, 'Must not route "' + phrase + '" to SECURITY_FAQ');
  }

  console.log('   ✅ ' + securityIntentCases.length + ' Security FAQ cases and ' + nonSecurityIntentCases.length + ' boundary cases passed.\n');

  // Layer 2: content contract and unsupported-claim checks.
  assertContentContracts();

  // Layer 3: a first-time FAQ request must not create even the user row.
  console.log('2. Testing strict read-only behavior for multiple topics and a new LINE user...');
  const countAllRecords = async () => {
    const res = await query(
      'SELECT\n' +
      '  (SELECT COUNT(*)::int FROM users) AS users,\n' +
      '  (SELECT COUNT(*)::int FROM transaction_drafts) AS drafts,\n' +
      '  (SELECT COUNT(*)::int FROM transactions) AS transactions,\n' +
      '  (SELECT COUNT(*)::int FROM audit_logs) AS audit_logs;',
    );
    return res.rows[0];
  };

  const readOnlyBefore = await countAllRecords();
  for (const topic of Object.keys(readOnlyTopicPhrases) as SecurityFaqTopic[]) {
    const replies: MockReply[] = [];
    await handleTextMessage(
      'U_SECURITY_FAQ_NEW_READ_ONLY_' + topic,
      readOnlyTopicPhrases[topic],
      'TOKEN_READ_ONLY_' + topic,
      createMockLineClient(replies),
    );

    assert.equal(replies.length, 1, 'Expected one read-only reply for ' + topic);
    const replyText = replies[0].messages[0].text || '';
    assert(replyText.includes('🔒 ความปลอดภัยและความเป็นส่วนตัวของ จดตัง'));
    assert(replyText.includes(SECURITY_FAQ_TOPIC_LABELS[topic]), 'Reply did not focus on ' + topic);
  }
  const readOnlyAfter = await countAllRecords();
  assert.deepEqual(readOnlyAfter, readOnlyBefore, 'Security FAQ must not write users or financial records');
  console.log('   ✅ First-time FAQ requests for all 12 topics left users, drafts, transactions, and audit logs unchanged.\n');

  // 3. Test Rich Menu Request Spec.
  console.log('3. Testing Rich Menu JSON Specification...');
  const menuReq = buildJodTangRichMenuRequest();
  assert.equal(menuReq.size.width, 2500);
  assert.equal(menuReq.size.height, 1686);
  assert.equal(menuReq.selected, false, 'Default display MUST be collapsed (selected=false)!');
  assert.equal(menuReq.chatBarText, 'เมนูจดตัง');
  assert.equal(menuReq.areas.length, 6, 'Must have 6 balanced areas in 2x3 grid');

  // Area 1: Row 1, Col 1 (✏️ เริ่มจด)
  assert.equal(menuReq.areas[0].bounds.x, 0);
  assert.equal(menuReq.areas[0].bounds.y, 0);
  assert.equal(menuReq.areas[0].bounds.width, 1250);
  assert.equal(menuReq.areas[0].bounds.height, 562);
  assert.equal((menuReq.areas[0].action as any).text, 'เริ่มจด');

  // Area 2: Row 1, Col 2 (📷 อัพสลิป)
  assert.equal(menuReq.areas[1].bounds.x, 1250);
  assert.equal(menuReq.areas[1].bounds.y, 0);
  assert.equal(menuReq.areas[1].bounds.width, 1250);
  assert.equal(menuReq.areas[1].bounds.height, 562);
  assert.equal((menuReq.areas[1].action as any).text, 'อัพสลิป');

  // Area 3: Row 2, Col 1 (📊 สรุปยอด)
  assert.equal(menuReq.areas[2].bounds.x, 0);
  assert.equal(menuReq.areas[2].bounds.y, 562);
  assert.equal(menuReq.areas[2].bounds.width, 1250);
  assert.equal(menuReq.areas[2].bounds.height, 562);
  assert.equal((menuReq.areas[2].action as any).text, '📊 สรุปยอด');

  // Area 4: Row 2, Col 2 (📥 Export CSV)
  assert.equal(menuReq.areas[3].bounds.x, 1250);
  assert.equal(menuReq.areas[3].bounds.y, 562);
  assert.equal(menuReq.areas[3].bounds.width, 1250);
  assert.equal(menuReq.areas[3].bounds.height, 562);
  assert.equal((menuReq.areas[3].action as any).text, '📥 Export CSV');

  // Area 5: Row 3, Col 1 (❤️ โดเนท)
  assert.equal(menuReq.areas[4].bounds.x, 0);
  assert.equal(menuReq.areas[4].bounds.y, 1124);
  assert.equal(menuReq.areas[4].bounds.width, 1250);
  assert.equal(menuReq.areas[4].bounds.height, 562);
  assert.equal((menuReq.areas[4].action as any).text, '❤️ โดเนท');

  // Area 6: Row 3, Col 2 (🔒 ความปลอดภัย)
  assert.equal(menuReq.areas[5].bounds.x, 1250);
  assert.equal(menuReq.areas[5].bounds.y, 1124);
  assert.equal(menuReq.areas[5].bounds.width, 1250);
  assert.equal(menuReq.areas[5].bounds.height, 562);
  assert.equal((menuReq.areas[5].action as any).text, '🔒 ความปลอดภัยและความเป็นส่วนตัว');
  console.log('   ✅ Rich Menu specification verified (6-button 2x3 balanced layout with selected=false).\n');

  // 4. Exercise the production webhook boundary before any user lookup.
  console.log('4. Testing production webhook Security FAQ ordering...');
  const webhookReplies: MockReply[] = [];
  let userLookupCalls = 0;
  let downstreamTextHandlerCalls = 0;

  await handleWebhookEvent(
    {
      type: 'message',
      replyToken: 'TOKEN_WEBHOOK_SECURITY_ORDER',
      source: { type: 'user', userId: 'U_WEBHOOK_SECURITY_ORDER' },
      message: {
        type: 'text',
        id: 'MESSAGE_WEBHOOK_SECURITY_ORDER',
        text: 'มีการเข้ารหัสข้อมูลไหม',
      },
    } as any,
    {
      lineClient: createMockLineClient(webhookReplies),
      findOrCreateByLineUserId: async () => {
        userLookupCalls += 1;
        throw new Error('Security FAQ must not call user lookup');
      },
      handleTextMessage: async () => {
        downstreamTextHandlerCalls += 1;
        throw new Error('Security FAQ must terminate before downstream text handling');
      },
      handleImageMessage: async () => undefined,
      handlePostbackEvent: async () => undefined,
    }
  );

  assert.equal(userLookupCalls, 0, 'Security FAQ must not call findOrCreateByLineUserId');
  assert.equal(downstreamTextHandlerCalls, 0, 'Security FAQ must not call handleTextMessage');
  assert.equal(webhookReplies.length, 1, 'Security FAQ must produce one webhook reply');
  assert(webhookReplies[0].messages[0].text?.includes(SECURITY_FAQ_TOPIC_LABELS.encryption));
  console.log('   ✅ Production webhook routed Security FAQ before user lookup with no downstream call.\n');

  // 5. Exercise the existing handler route on a disposable test database.
  console.log('5. Testing handler routing and strict FAQ read-only behavior...');
  const lineUserId = 'U_SECURITY_FAQ_TEST';
  const user = await UserRepository.findOrCreateByLineUserId(lineUserId);

  await query('DELETE FROM transaction_drafts WHERE user_id = $1;', [user.id]);
  await query('DELETE FROM transactions WHERE user_id = $1;', [user.id]);

  const countDrafts = async () => {
    const res = await query('SELECT COUNT(id)::int AS count FROM transaction_drafts WHERE user_id = $1;', [user.id]);
    return Number(res.rows[0].count);
  };

  for (const topic of Object.keys(readOnlyTopicPhrases) as SecurityFaqTopic[]) {
    const replies: MockReply[] = [];
    const draftsBefore = await countDrafts();
    await handleTextMessage(
      lineUserId,
      readOnlyTopicPhrases[topic],
      'TOKEN_TOPIC_' + topic,
      createMockLineClient(replies),
    );

    assert.equal(replies.length, 1, 'Expected one reply for ' + topic);
    const replyText = replies[0].messages[0].text || '';
    assert(replyText.includes(SECURITY_FAQ_TOPIC_LABELS[topic]));
    assert(!replyText.includes('ปลอดภัย 100%'));
    const draftsAfter = await countDrafts();
    assert.equal(draftsAfter, draftsBefore, 'FAQ topic ' + topic + ' must not create drafts');
  }
  console.log('   ✅ Handler routed all 12 topics to focused, read-only FAQ responses.\n');

  // 6. Verify the normal Write Path is untouched.
  console.log('6. Verifying Write Path regression...');
  const writePhrases = ['กินข้าว 80', 'จ่ายค่าไฟ 500', 'ได้เงินเดือน 30000'];
  for (const phrase of writePhrases) {
    const repliesWrite: MockReply[] = [];
    const clientWrite = createMockLineClient(repliesWrite);
    const draftsBeforeWrite = await countDrafts();

    await handleTextMessage(lineUserId, phrase, 'TOKEN_WRITE_' + Date.now(), clientWrite);

    assert.equal(repliesWrite.length, 1, 'Expected one Write reply for "' + phrase + '"');
    assert.equal(repliesWrite[0].messages[0].type, 'flex', 'Write Path must return Flex confirmation');
    const draftsAfterWrite = await countDrafts();
    assert.equal(draftsAfterWrite, draftsBeforeWrite + 1, 'Write Path must create 1 draft for "' + phrase + '"');
    console.log('   ✅ Write Path verified for "' + phrase + '".');
  }

  // Clean only the disposable test fixtures.
  await query('DELETE FROM transaction_drafts WHERE user_id = $1;', [user.id]);
  await query('DELETE FROM transactions WHERE user_id = $1;', [user.id]);

  console.log('\n====================================================');
  console.log('🎉 ALL SECURITY FAQ v2 TESTS PASSED (' + securityIntentCases.length + ' canonical topics)!');
  console.log('====================================================\n');
}

runSecurityFaqTests().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
