import { messagingApi } from '@line/bot-sdk';

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
 * Builds the official Security & Privacy FAQ message response.
 * Follows conservative guidelines:
 * - No bank connection, no passwords/PINs requested.
 * - Uses LINE User ID for data separation.
 * - Standard HTTPS/TLS encrypted communication.
 * - AI assists in text extraction; user confirms via Draft before commit.
 */
export function buildSecurityFaqText(): string {
  return [
    '🔒 ความปลอดภัยและความเป็นส่วนตัวของ จดตัง (JodTang)',
    '',
    '1. 🏦 ไม่เชื่อมต่อบัญชีธนาคาร',
    '• จดตังไม่ใช่แอปธนาคาร และไม่มีการเชื่อมต่อกับบัญชีเงินฝากใดๆ',
    '• ระบบจะไม่ขอรหัสผ่าน, PIN, OTP หรือข้อมูลบัตรเครดิต/เดบิตเด็ดขาด',
    '',
    '2. 👤 การเก็บรักษาข้อมูลเฉพาะบุคคล',
    '• บันทึกรายรับ-รายจ่ายจะผูกกับ LINE User ID ของคุณโดยเฉพาะ',
    '• ข้อมูลถูกแยกรายผู้ใช้งานอย่างปลอดภัย ไม่ปะปนกับผู้อื่น',
    '',
    '3. 🛡️ การรับส่งข้อมูลที่ปลอดภัย',
    '• การสื่อสารทั้งหมดระหว่าง LINE, เซิร์ฟเวอร์ และฐานข้อมูล ดำเนินการผ่านการเข้ารหัส HTTPS/TLS ตามมาตรฐาน',
    '',
    '4. 🤖 การประมวลผลด้วย AI และการยืนยันรายการ',
    '• AI ถูกใช้เพื่อช่วยอ่านข้อความและสกัดตัวเลขยอดเงิน/หมวดหมู่เท่านั้น',
    '• ทุกรายการจะมีหน้าต่างการ์ด (Draft) ให้คุณตรวจสอบและกดยืนยันก่อนบันทึกจริงเสมอ ✨',
  ].join('\n');
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
