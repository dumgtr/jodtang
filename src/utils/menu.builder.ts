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
 * Builds the official 2-area JodTang Rich Menu specification.
 *
 * Layout (2500 x 843):
 * ┌──────────────────────────────┐
 * │  [ 📊 สรุปยอด ] [ 📷 เพิ่มรูป ] │
 * └──────────────────────────────┘
 *
 * Default: Chat bar displays "พิมพ์บอกจดตัง เช่น กินข้าว 80..." with keyboard open.
 */
export function buildJodTangRichMenuRequest(): messagingApi.RichMenuRequest {
  return {
    size: {
      width: 2500,
      height: 843,
    },
    selected: true,
    name: 'JodTang Main Menu',
    chatBarText: '💬 พิมพ์ข้อความ หรือเลือกเมนู...',
    areas: [
      // Left Area (0..1250): 📊 สรุปยอด
      {
        bounds: {
          x: 0,
          y: 0,
          width: 1250,
          height: 843,
        },
        action: {
          type: 'message',
          label: '📊 สรุปยอด',
          text: '📊 สรุปยอด',
        },
      },
      // Right Area (1250..2500): 📷 เพิ่มรูปภาพ/สลิป
      {
        bounds: {
          x: 1250,
          y: 0,
          width: 1250,
          height: 843,
        },
        action: {
          type: 'message',
          label: '📷 เพิ่มรูปภาพ/สลิป',
          text: '📷 เพิ่มรูปภาพ/สลิป',
        },
      },
    ],
  };
}
