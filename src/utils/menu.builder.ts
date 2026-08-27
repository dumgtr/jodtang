import { messagingApi } from '@line/bot-sdk';
import type { SecurityFaqTopic } from '../services/security-faq.service';
import type { Transaction } from '../types/database';

/**
 * Q6 / M12: Query/Summary UX + LINE Menu UI Builder
 *
 * Provides:
 * 1. Quick Reply action sets for Quick Summary & Slip Upload entrypoint.
 * 2. Conversational guides for Start Record, Help Manual, and Recent Transactions.
 * 3. Balanced 2x2 Rich Menu JSON specifications with default keyboard text input.
 */

/**
 * Builds conversational start-record prompt guide.
 */
export function buildStartRecordGuideText(): string {
  return [
    '✏️ เริ่มจดได้เลยครับ!',
    'พิมพ์บอกรายการได้เลย เช่น:',
    '• "กินข้าว 80"',
    '• "เงินเดือนเข้า 30,000"',
    '• "โอนเงิน 500 บาท"',
  ].join('\n');
}

/**
 * Builds conversational help & guide manual.
 */
export function buildHelpGuideText(): string {
  return [
    '📖 คู่มือการใช้งาน จดตัง (JodTang)',
    '',
    '1. ✏️ เริ่มจดรายการ (พิมพ์บอกได้ทันที)',
    '• รายจ่าย: "กินข้าว 80", "ซื้อของ 450"',
    '• รายรับ: "เงินเดือนเข้า 30,000"',
    '• โอนเงิน: "โอนให้แม่ 500 บาท"',
    '',
    '2. 📷 ส่งรูปสลิป/ใบเสร็จ',
    '• กดปุ่ม "อัพสลิป" เพื่อเลือกรูปจากอัลบั้มหรือถ่ายรูปส่งให้ระบบ',
    '',
    '3. 📊 สรุปและดูยอด',
    '• "สรุปเดือนนี้", "วันนี้ใช้ไปเท่าไร"',
    '• "ร้านไหนจ่ายเยอะสุด", "อาทิตย์นี้มีค่าใช้จ่ายอะไรบ้าง"',
    '',
    '4. 📋 ดูประวัติ / แก้ไข / ยกเลิก',
    '• พิมพ์ "รายการล่าสุด" เพื่อดูประวัติการจด',
    '• พิมพ์ "ขอแก้ไขรายการ" หรือ "ขอลบรายการ"',
    '',
    '5. 🔒 ความปลอดภัยและความเป็นส่วนตัว',
    '• พิมพ์ "ความปลอดภัย" หรือแตะปุ่มในเมนูเพื่อดูนโยบาย',
  ].join('\n');
}

/**
 * Formats recent confirmed transactions for read-only history view.
 */
export function buildRecentTransactionsText(txs: Transaction[]): string {
  if (!txs || txs.length === 0) {
    return '📭 ยังไม่มีรายการที่บันทึกไว้ในระบบครับ\nพิมพ์บอกรายการได้เลย เช่น "กินข้าว 80" หรือ "เงินเดือนเข้า 30,000" ✨';
  }

  const lines = ['📋 รายการล่าสุดที่บันทึกไว้:'];
  txs.forEach((tx, index) => {
    const amountStr = Number(tx.amount).toLocaleString('th-TH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const typeIcon = tx.type === 'income' ? '🟢' : tx.type === 'transfer' ? '🔵' : '🔴';
    const dateStr = new Date(tx.occurred_at).toLocaleDateString('th-TH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
    const category = tx.category_id || 'ทั่วไป';
    const desc = tx.description || tx.merchant_id || '-';
    lines.push(`${index + 1}. ${typeIcon} ฿${amountStr} · ${category} (${desc}) · ${dateStr}`);
  });

  lines.push('');
  lines.push('💡 พิมพ์ "ขอแก้ไขรายการ" หรือ "ขอลบรายการ" เพื่อจัดการรายการ');
  return lines.join('\n');
}

/**
 * Builds Quick Reply items for Quick Summary queries.
 */
export function buildQuickSummaryQuickReply(): messagingApi.QuickReply {
  return {
    items: [
      {
        type: 'action',
        action: {
          type: 'message',
          label: '📊 สรุปเดือนนี้',
          text: 'สรุปค่าใช้จ่ายเดือนนี้',
        },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: '📅 สรุปสัปดาห์นี้',
          text: 'สรุปค่าใช้จ่ายสัปดาห์นี้',
        },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: '🏆 ร้านจ่ายเยอะสุด',
          text: 'เดือนนี้ร้านไหนใช้เงินเยอะที่สุด',
        },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: '📋 รายการสัปดาห์นี้',
          text: 'อาทิตย์นี้มีค่าใช้จ่ายอะไรบ้าง',
        },
      },
      {
        type: 'action',
        action: {
          type: 'cameraRoll',
          label: '📷 แนบสลิป/ใบเสร็จ',
        },
      },
    ],
  };
}

/**
 * Builds Quick Reply items for Slip & Receipt Upload entrypoint.
 */
export function buildSlipUploadQuickReply(): messagingApi.QuickReply {
  return {
    items: [
      {
        type: 'action',
        action: {
          type: 'cameraRoll',
          label: '🖼️ เลือกรูปจากอัลบั้ม',
        },
      },
      {
        type: 'action',
        action: {
          type: 'camera',
          label: '📷 ถ่ายรูปใบเสร็จ',
        },
      },
      {
        type: 'action',
        action: {
          type: 'message',
          label: '📊 สรุปเดือนนี้',
          text: 'สรุปค่าใช้จ่ายเดือนนี้',
        },
      },
    ],
  };
}

/**
 * The public topic labels keep the classifier and the user-facing FAQ on the
 * same deterministic taxonomy. Every claim below is intentionally limited to
 * behavior evidenced by the current source/configuration.
 */
export const SECURITY_FAQ_TOPIC_LABELS: Record<SecurityFaqTopic, string> = {
  overview: '🔒 ภาพรวมความปลอดภัยและความเป็นส่วนตัว',
  stored_data: '🗂️ จดตังเก็บข้อมูลอะไร',
  data_location: '🗄️ ข้อมูลเก็บไว้ที่ไหน',
  data_access: '👀 ใครเข้าถึงข้อมูลได้บ้าง',
  encryption: '🔐 การเข้ารหัสและการรับส่งข้อมูล',
  ai_processing: '🤖 AI ประมวลผลข้อมูลอย่างไร',
  ai_training_retention: '🧠 AI การฝึกและระยะเวลาเก็บข้อมูล',
  line_account: '📱 LINE และการเปลี่ยนเครื่อง',
  banking_credentials: '🏦 บัญชีธนาคารและข้อมูลลับ',
  user_control: '✏️ การแก้ไขและยกเลิกรายการ',
  deletion_export: '🗑️ การลบและส่งออกข้อมูล',
  transaction_confirmation: '🧾 Draft และการยืนยันรายการ',
};

const SECURITY_FAQ_TOPIC_ORDER: readonly SecurityFaqTopic[] = [
  'overview',
  'stored_data',
  'data_location',
  'data_access',
  'encryption',
  'ai_processing',
  'ai_training_retention',
  'line_account',
  'banking_credentials',
  'user_control',
  'deletion_export',
  'transaction_confirmation',
];

type SecurityFaqSection = {
  readonly lines: readonly string[];
  readonly related: readonly SecurityFaqTopic[];
};

const SECURITY_FAQ_SECTIONS: Record<SecurityFaqTopic, SecurityFaqSection> = {
  overview: {
    lines: [
      'จดตังเป็นสมุดบันทึกรายรับรายจ่าย ไม่ใช่ธนาคาร และไม่มี flow ให้เชื่อมบัญชีธนาคารหรือทำธุรกรรมแทนคุณครับ',
      'หน้านี้สรุปสิ่งที่ยืนยันได้จากการทำงานของแอป พร้อมระบุข้อจำกัดที่ source/config ปัจจุบันยังยืนยันไม่ได้',
    ],
    related: SECURITY_FAQ_TOPIC_ORDER.filter((topic) => topic !== 'overview'),
  },
  stored_data: {
    lines: [
      'จากโครงสร้างปัจจุบัน จดตังเก็บ LINE User ID, ข้อความที่ส่งเพื่อบันทึกรายการ, จำนวนเงิน, ประเภท, หมวดหมู่, ร้านค้า, รายละเอียด และวันที่ตามข้อมูลที่ระบบแยกได้',
      'ระบบยังเก็บสถานะ Draft/รายการที่ยืนยันแล้ว และประวัติการเปลี่ยนแปลงบางอย่าง เช่น ยืนยัน แก้ไข หรือยกเลิก เพื่อใช้ตรวจสอบรายการ',
      'การถาม FAQ เป็นเส้นทางอ่านอย่างเดียว ไม่สร้าง Draft, Transaction หรือ Audit Log ของรายการครับ',
    ],
    related: ['data_location', 'data_access', 'ai_processing', 'deletion_export'],
  },
  data_location: {
    lines: [
      'รายการของจดตังถูกเก็บในฐานข้อมูล PostgreSQL ที่แอปเชื่อมต่อผ่านเซิร์ฟเวอร์ ไม่ได้อยู่เฉพาะในมือถือครับ',
      'ประเทศหรือผู้ให้บริการฐานข้อมูลจริงขึ้นกับการตั้งค่าของระบบ จึงไม่ควรสรุปตำแหน่งจากตัวแอปอย่างเดียว',
      'source ปัจจุบันไม่มีหลักฐานรับรอง backup/recovery หรือระยะเวลาเก็บข้อมูลเป็นตัวเลข และการลบแชต LINE ไม่ได้ถูกระบุว่าเป็นคำสั่งลบฐานข้อมูล',
    ],
    related: ['stored_data', 'line_account', 'encryption', 'deletion_export'],
  },
  data_access: {
    lines: [
      'เส้นทางอ่านและแก้ไขรายการของผู้ใช้ในแอปตรวจสอบเจ้าของข้อมูลตาม LINE User ID จึงไม่มีเมนูผู้ใช้ทั่วไปสำหรับค้นหารายการของคนอื่น',
      'จาก source ปัจจุบันยังไม่พบฟังก์ชัน user-facing สำหรับค้นข้ามผู้ใช้ แต่ไม่สามารถยืนยันสิทธิ์ของผู้ดูแลฐานข้อมูล ผู้ให้บริการโฮสติ้ง หรือผู้ให้บริการภายนอกได้',
      'หากบัญชี LINE หรืออุปกรณ์ถูกผู้อื่นควบคุม ความเสี่ยงนั้นอยู่นอกขอบเขตการแยกข้อมูลของแอปครับ',
    ],
    related: ['line_account', 'stored_data', 'ai_processing'],
  },
  encryption: {
    lines: [
      'จาก source/config ปัจจุบันยืนยันได้เฉพาะว่า PostgreSQL client ตั้งค่า SSL เมื่อรัน production หรือเมื่อ connection/provider ระบุเงื่อนไขที่รองรับ',
      'ยังยืนยันไม่ได้ว่าการสื่อสารทุกเส้นทางหรือข้อมูลที่เก็บอยู่ถูกเข้ารหัสทั้งหมด จึงไม่ขอรับรอง HTTPS/TLS ครบทุกจุดหรือ encryption at rest ครับ',
    ],
    related: ['data_location', 'data_access', 'ai_processing'],
  },
  ai_processing: {
    lines: [
      'เมื่อคุณส่งข้อความรายการการเงิน ระบบอาจส่งข้อความนั้นให้ผู้ให้บริการ AI ที่ตั้งค่าไว้บนเซิร์ฟเวอร์ เพื่อช่วยแยกประเภท จำนวนเงิน ร้านค้า หมวดหมู่ รายละเอียด และวันที่',
      'ถ้าไม่ได้ตั้งค่าผู้ให้บริการ AI หรือเรียกใช้ไม่สำเร็จ ระบบจะใช้ตัวแยกข้อมูลตามกฎในแอปแทน และผลลัพธ์จะถูกทำเป็น Draft ให้ตรวจสอบก่อนยืนยัน',
      'การส่งข้อมูลและนโยบายของผู้ให้บริการภายนอกเป็นคนละประเด็นกับสิ่งที่ source ของจดตังยืนยันได้ จึงไม่ควรสรุปเกินข้อเท็จจริงนี้ครับ',
    ],
    related: ['ai_training_retention', 'stored_data', 'data_access', 'transaction_confirmation'],
  },
  ai_training_retention: {
    lines: [
      'source/config ของจดตังยังไม่มีข้อมูลยืนยันว่าผู้ให้บริการ AI นำข้อความไปฝึกโมเดลหรือเก็บไว้นานเท่าใด',
      'จึงไม่ขอรับรองเรื่อง zero training, zero retention หรือระยะเวลาเก็บข้อมูลของผู้ให้บริการภายนอกครับ',
      'ถ้าต้องการข้อสรุปเรื่องนี้ ต้องตรวจนโยบายและการตั้งค่าของผู้ให้บริการที่ใช้งานจริงเพิ่มเติม ไม่ใช่อนุมานจากตัว parser ของจดตัง',
    ],
    related: ['ai_processing', 'stored_data', 'data_location'],
  },
  line_account: {
    lines: [
      'จดตังใช้ LINE User ID เป็นตัวผูกข้อมูลของผู้ใช้แต่ละคน การเปลี่ยนเครื่องที่ยังใช้บัญชี LINE เดิมจึงเป็นคนละกรณีกับการเปลี่ยนบัญชี LINE',
      'source ปัจจุบันไม่มีขั้นตอนรวมข้อมูลจากบัญชี LINE ใหม่ให้อัตโนมัติ และไม่มีหลักฐานรับรอง backup/recovery อัตโนมัติ',
      'ถ้ามีผู้อื่นควบคุมบัญชี LINE เขาอาจส่งข้อความในฐานะบัญชีนั้นได้ จึงควรดูแลความปลอดภัยของบัญชี LINE แยกจากระบบจดตังครับ',
    ],
    related: ['data_location', 'data_access', 'stored_data'],
  },
  banking_credentials: {
    lines: [
      'จดตังทำหน้าที่บันทึกรายการ ไม่ใช่ธนาคาร และ source ปัจจุบันไม่มี flow เชื่อมบัญชีธนาคาร ดูยอด หักเงิน หรือทำรายการโอนเงินจริงแทนคุณ',
      'การบันทึกรายการประเภทโอนในสมุดเป็นเพียงการบันทึกข้อมูล ไม่ใช่การโอนเงินจริงผ่านธนาคารครับ',
      'อย่าส่งรหัสผ่านธนาคาร, PIN, OTP, เลขบัตร หรือข้อมูลลับให้จดตัง แม้มีข้อความใดขอข้อมูลเหล่านี้',
    ],
    related: ['stored_data', 'data_access', 'transaction_confirmation'],
  },
  user_control: {
    lines: [
      'ถ้าพิมพ์รายการผิด ระบบมี Draft ให้ตรวจสอบ แก้ไข หรือยกเลิกก่อนยืนยันได้ครับ',
      'รายการที่ยืนยันแล้วมีเส้นทางแก้ไขหรือยกเลิกสถานะ และระบบบันทึกประวัติการเปลี่ยนแปลงไว้',
      'การยกเลิกหรือ void เป็นการเปลี่ยนสถานะตาม flow ปัจจุบัน ไม่ใช่หลักฐานว่าข้อมูลถูกลบถาวรครับ',
    ],
    related: ['transaction_confirmation', 'deletion_export', 'stored_data'],
  },
  deletion_export: {
    lines: [
      'ตอนนี้ source ปัจจุบันยังไม่มีเมนู self-service สำหรับลบข้อมูลทั้งหมดหรือส่งออกข้อมูลของผู้ใช้',
      'การยกเลิก Draft หรือ void รายการที่ยืนยันแล้วเป็นการเปลี่ยนสถานะและมี audit history ไม่ใช่การลบถาวร',
      'จึงยังไม่สามารถรับรองขั้นตอนการลบถาวร การ export หรือระยะเวลาลบข้อมูลได้จากตัวแอปครับ',
    ],
    related: ['stored_data', 'data_location', 'user_control'],
  },
  transaction_confirmation: {
    lines: [
      'ข้อความรายการการเงินที่แยกจำนวนเงินได้จะถูกสร้างเป็น Draft ก่อน ไม่บันทึกเป็นรายการจริงทันที',
      'ผู้ใช้ต้องตรวจสอบและกดยืนยันก่อนจึงจะ commit เป็น Transaction พร้อม audit history; FAQ และ Query เป็นเส้นทางอ่านอย่างเดียว',
      'Draft ที่ยังไม่ยืนยันสามารถแก้ไขหรือยกเลิกตาม flow ได้ครับ',
    ],
    related: ['user_control', 'stored_data', 'ai_processing'],
  },
};

function renderSecurityFaqSection(topic: SecurityFaqTopic): string[] {
  const section = SECURITY_FAQ_SECTIONS[topic];
  return [
    SECURITY_FAQ_TOPIC_LABELS[topic],
    ...section.lines.map((line) => `• ${line}`),
  ];
}

/**
 * Builds either the complete overview or a focused topic answer. Both forms
 * remain deterministic and read-only; this function has no database access.
 */
export function buildSecurityFaqText(topic: SecurityFaqTopic = 'overview'): string {
  const header = '🔒 ความปลอดภัยและความเป็นส่วนตัวของ จดตัง (JodTang)';

  if (topic === 'overview') {
    return [
      header,
      '',
      ...SECURITY_FAQ_TOPIC_ORDER.flatMap((faqTopic, index) => [
        ...(index > 0 ? [''] : []),
        ...renderSecurityFaqSection(faqTopic),
      ]),
    ].join('\n');
  }

  const related = SECURITY_FAQ_SECTIONS[topic].related
    .map((relatedTopic) => SECURITY_FAQ_TOPIC_LABELS[relatedTopic])
    .join(' · ');

  return [
    header,
    '',
    ...renderSecurityFaqSection(topic),
    '',
    `หัวข้อที่เกี่ยวข้อง: ${related}`,
  ].join('\n');
}

/**
 * Builds the official 2-row JodTang Rich Menu specification with Security FAQ.
 *
 * Layout (2500 x 1686):
 * ┌──────────────────────────────┬──────────────────────────────┐
 * │  Area 1: ✏️ เริ่มจด           │  Area 2: 📷 อัพสลิป           │ (y: 0..562)
 * ├──────────────────────────────┼──────────────────────────────┤
 * │  Area 3: 📊 สรุปยอด          │  Area 4: 📥 Export CSV       │ (y: 562..1124)
 * ├──────────────────────────────┼──────────────────────────────┤
 * │  Area 5: ❤️ โดเนท            │  Area 6: 🔒 ความปลอดภัย      │ (y: 1124..1686)
 * └──────────────────────────────┴──────────────────────────────┘
 *
 * Default: selected = false (Keyboard text input is primary default).
 */
export function buildJodTangRichMenuRequest(): messagingApi.RichMenuRequest {
  return {
    size: {
      width: 2500,
      height: 1686,
    },
    selected: false,
    name: 'JodTang Large Menu (6 Buttons)',
    chatBarText: 'เมนูจดตัง',
    areas: [
      // Row 1, Col 1 (Area 1: 0, 0, 1250, 562): ✏️ เริ่มจด
      {
        bounds: {
          x: 0,
          y: 0,
          width: 1250,
          height: 562,
        },
        action: {
          type: 'message',
          label: 'เริ่มจด',
          text: 'เริ่มจด',
        },
      },
      // Row 1, Col 2 (Area 2: 1250, 0, 1250, 562): 📷 อัพสลิป
      {
        bounds: {
          x: 1250,
          y: 0,
          width: 1250,
          height: 562,
        },
        action: {
          type: 'message',
          label: 'อัพสลิป',
          text: 'อัพสลิป',
        },
      },
      // Row 2, Col 1 (Area 3: 0, 562, 1250, 562): 📊 สรุปยอด
      {
        bounds: {
          x: 0,
          y: 562,
          width: 1250,
          height: 562,
        },
        action: {
          type: 'message',
          label: 'สรุปยอด',
          text: '📊 สรุปยอด',
        },
      },
      // Row 2, Col 2 (Area 4: 1250, 562, 1250, 562): 📥 Export CSV
      {
        bounds: {
          x: 1250,
          y: 562,
          width: 1250,
          height: 562,
        },
        action: {
          type: 'message',
          label: 'Export CSV',
          text: '📥 Export CSV',
        },
      },
      // Row 3, Col 1 (Area 5: 0, 1124, 1250, 562): ❤️ โดเนท
      {
        bounds: {
          x: 0,
          y: 1124,
          width: 1250,
          height: 562,
        },
        action: {
          type: 'message',
          label: 'โดเนท',
          text: '❤️ โดเนท',
        },
      },
      // Row 3, Col 2 (Area 6: 1250, 1124, 1250, 562): 🔒 ความปลอดภัย
      {
        bounds: {
          x: 1250,
          y: 1124,
          width: 1250,
          height: 562,
        },
        action: {
          type: 'message',
          label: 'ความปลอดภัย',
          text: '🔒 ความปลอดภัยและความเป็นส่วนตัว',
        },
      },
    ],
  };
}

/**
 * Builds user-facing message for upcoming Export CSV function (M14).
 */
export function buildComingSoonExportCsvText(): string {
  return [
    '📥 ฟังก์ชัน Export CSV (กำลังพัฒนา)',
    '━━━━━━━━━━━━━━━━━━━━',
    'เร็วๆ นี้คุณจะสามารถดาวน์โหลดประวัติรายรับ-รายจ่ายทั้งหมดออกมาเป็นไฟล์ CSV / Excel เพื่อนำไปใช้งานหรือจัดทำบัญชีต่อได้อย่างสะดวกรวดเร็วครับ ✨',
    '',
    '📌 ฟังก์ชันนี้จะเปิดให้ใช้งานในเวอร์ชันถัดไป (M14) โปรดรอติดตามนะครับ! 🙏',
  ].join('\n');
}

/**
 * Builds user-facing message for upcoming Donate / Support function.
 */
export function buildComingSoonDonateText(): string {
  return [
    '❤️ ขอบคุณที่ร่วมเป็นกำลังใจให้ จดตัง (JodTang)!',
    '━━━━━━━━━━━━━━━━━━━━',
    'ระบบรับการสนับสนุน / โดเนทเพื่อช่วยค่าเซิร์ฟเวอร์และค่าพัฒนาระบบ กำลังอยู่ระหว่างการจัดเตรียมช่องทางที่สะดวกและปลอดภัยครับ 🙏',
    '',
    'ทุกความตั้งใจและการสนับสนุนมีความหมายอย่างยิ่งต่อทีมพัฒนา โปรดรอติดตามในเร็วๆ นี้นะครับ ✨',
  ].join('\n');
}
