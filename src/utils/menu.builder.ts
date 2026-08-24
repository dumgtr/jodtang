import { messagingApi } from '@line/bot-sdk';
import type { SecurityFaqTopic } from '../services/security-faq.service';

/**
 * Q6: Query/Summary UX + LINE Menu UI Builder
 *
 * Provides:
 * 1. Quick Reply action sets for Quick Summary & Slip Upload entrypoint.
 * 2. Rich Menu JSON specifications with default keyboard text input.
 */

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
 * Builds the existing Security & Privacy FAQ response.
 * Claims are limited to behavior evidenced by the application source/config.
 */
export function buildSecurityFaqText(topic: SecurityFaqTopic = 'overview'): string {
  const header = '🔒 ความปลอดภัยและความเป็นส่วนตัวของ จดตัง (JodTang)';

  const answers: Record<SecurityFaqTopic, string[]> = {
    overview: [
      'จดตังเป็นสมุดบันทึกรายรับรายจ่าย ไม่ใช่ธนาคารครับ',
      '• ข้อมูลในแอปผูกกับ LINE User ID เพื่อแยกผู้ใช้แต่ละคน',
      '• การบันทึกรายการใหม่จะมี Draft ให้ตรวจสอบก่อนยืนยัน',
      '• จดตังไม่มีขั้นตอนเชื่อมบัญชีธนาคารหรือขอรหัสผ่านธนาคาร, PIN และ OTP',
      '• เรื่องการเก็บข้อมูลหรือการฝึก AI ของผู้ให้บริการภายนอก จดตังยังไม่มีข้อมูลยืนยันพอ จึงไม่ขอรับรองเกินจริง',
    ],
    stored_data: [
      'จดตังเก็บข้อมูลที่จำเป็นต่อการแยกผู้ใช้และบันทึกรายการ เช่น LINE User ID, ข้อความที่ส่งเพื่อบันทึกรายการ, จำนวนเงิน, ประเภท, หมวดหมู่, ร้านค้า, รายละเอียด และวันที่',
      '• Draft และรายการที่ยืนยันแล้วถูกเก็บคนละสถานะ เพื่อให้ตรวจสอบก่อนบันทึกจริงได้',
      '• ระบบยังมีประวัติการเปลี่ยนแปลงบางอย่าง เช่น การยืนยัน แก้ไข หรือยกเลิก เพื่อใช้ตรวจสอบรายการ',
      '• การถาม FAQ นี้ไม่สร้าง Draft, Transaction หรือ Audit Log ของรายการครับ',
    ],
    data_access: [
      'รายการของคุณถูกผูกกับ LINE User ID และเส้นทางอ่าน/แก้ไขรายการในแอปตรวจสอบเจ้าของข้อมูลตามผู้ใช้',
      '• ในฟังก์ชันผู้ใช้ทั่วไปไม่มีเมนูให้ผู้ใช้อื่นค้นหารายการของคุณ',
      '• จดตังไม่สามารถยืนยันเรื่องสิทธิ์ของผู้ดูแลฐานข้อมูลหรือผู้ให้บริการโฮสติ้งได้ เพราะอยู่นอกส่วนการทำงานของแอป',
    ],
    ai_processing: [
      'เมื่อคุณส่งข้อความที่เป็นรายการการเงิน ระบบอาจใช้ AI ที่ตั้งค่าไว้บนเซิร์ฟเวอร์ช่วยแยกประเภท จำนวนเงิน ร้านค้า หมวดหมู่ รายละเอียด และวันที่',
      '• ถ้าเซิร์ฟเวอร์ไม่ได้เปิดใช้ผู้ให้บริการ AI ระบบจะใช้ตัวแยกข้อมูลตามกฎในแอปแทน',
      '• รายการที่ได้จะถูกทำเป็น Draft ให้คุณตรวจสอบก่อนยืนยัน',
      '• ตอนนี้จดตังยังไม่มีข้อมูลยืนยันเรื่องการนำข้อความไปฝึก AI หรือระยะเวลาที่ผู้ให้บริการเก็บข้อมูล จึงไม่ควรสัญญาว่า “AI ไม่เห็นข้อมูล” หรือ “ไม่ถูกเทรน” ครับ',
    ],
    data_location: [
      'ข้อมูลรายการของจดตังถูกเก็บในฐานข้อมูล PostgreSQL บนเซิร์ฟเวอร์ ไม่ได้อยู่เฉพาะในมือถือครับ',
      '• ตำแหน่งประเทศหรือผู้ให้บริการฐานข้อมูลจริงขึ้นกับการตั้งค่าของระบบ จึงไม่ขอระบุประเทศจากตัวแอปอย่างเดียว',
      '• การลบแชต LINE ไม่ได้ถูกระบุในโค้ดว่าเป็นคำสั่งลบข้อมูลในฐานข้อมูล',
    ],
    user_control: [
      'ถ้าพิมพ์รายการผิด ระบบมี Draft ให้ตรวจสอบ แก้ไข หรือยกเลิกก่อนยืนยันได้ครับ',
      '• รายการที่ยืนยันแล้วแก้ไขหรือยกเลิกสถานะได้ และระบบบันทึกประวัติการเปลี่ยนแปลงไว้',
      '• ตอนนี้ยังไม่มีเมนูให้ผู้ใช้ลบข้อมูลทั้งหมดหรือส่งออกข้อมูล จึงไม่ควรตอบว่าลบถาวรหรือส่งออกได้ครับ',
    ],
    banking_boundary: [
      'จดตังทำหน้าที่บันทึกรายการ ไม่ใช่ธนาคารครับ',
      '• ระบบไม่มี flow เชื่อมบัญชีธนาคาร ดูยอดเงิน หักเงิน หรือโอนเงินแทนคุณ',
      '• ไม่ต้องส่งรหัสผ่านธนาคาร, PIN, OTP หรือข้อมูลบัตรให้จดตัง ถ้ามีข้อความใดขอข้อมูลเหล่านี้อย่าส่งให้ครับ',
    ],
    line_account: [
      'จดตังใช้ LINE User ID เป็นตัวผูกข้อมูลของแต่ละผู้ใช้ครับ',
      '• ถ้าเปลี่ยนบัญชี LINE ระบบไม่มีขั้นตอนรวมข้อมูลเดิมให้อัตโนมัติ',
      '• หากมีผู้อื่นควบคุม LINE account ของคุณ เขาอาจส่งข้อความเข้ามาในฐานะ account นั้นได้ จึงควรดูแลความปลอดภัยของ LINE account ด้วย',
    ],
  };

  return [header, '', ...answers[topic]].join('\n');
}

/**
 * Builds the official 2-row JodTang Rich Menu specification with Security FAQ.
 *
 * Layout (2500 x 843):
 * ┌──────────────────────────────────────┐
 * │          📊 สรุปยอด                  │ (y: 0..562)
 * ├──────────────────────────────────────┤
 * │    🔒 ความปลอดภัยและความเป็นส่วนตัว    │ (y: 562..843)
 * └──────────────────────────────────────┘
 *
 * Default: selected = false (Keyboard text input is primary default).
 */
export function buildJodTangRichMenuRequest(): messagingApi.RichMenuRequest {
  return {
    size: {
      width: 2500,
      height: 843,
    },
    selected: false,
    name: 'JodTang - สรุปยอดและความปลอดภัย',
    chatBarText: 'เมนูจดตัง',
    areas: [
      // Top Area (0..562): 📊 สรุปยอด
      {
        bounds: {
          x: 0,
          y: 0,
          width: 2500,
          height: 562,
        },
        action: {
          type: 'message',
          label: 'สรุปยอด',
          text: '📊 สรุปยอด',
        },
      },
      // Bottom Area (562..843): 🔒 ความปลอดภัยและความเป็นส่วนตัว
      {
        bounds: {
          x: 0,
          y: 562,
          width: 2500,
          height: 281,
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
