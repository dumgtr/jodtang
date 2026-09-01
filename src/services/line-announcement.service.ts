import type { messagingApi } from '@line/bot-sdk';

export const EXPORT_CSV_ANNOUNCEMENT_TEXT = [
  '📊 ฟังก์ชันรายงาน CSV พร้อมใช้งานแล้ว!',
  '',
  'ตอนนี้คุณสามารถดาวน์โหลดรายการรับ-จ่ายทั้งหมดเป็นไฟล์ CSV ได้แล้วครับ',
  '',
  '📋 คำสั่งดาวน์โหลดไฟล์ตาราง:',
  '“ดาวน์โหลด CSV”',
  'หรือ',
  '“ขอไฟล์รายการ”',
  'หรือ',
  '“download transactions”',
  '',
  'จดตังจะสร้างไฟล์ CSV ให้ดาวน์โหลดทันทีครับ 🎉',
].join('\n');

export type LineAnnouncementClient = Pick<
  messagingApi.MessagingApiClient,
  'broadcast' | 'pushMessage'
>;

export type ExportCsvAnnouncementTarget =
  | { mode: 'broadcast' }
  | { mode: 'push'; recipientUserId: string };

export function buildExportCsvAnnouncementMessages(): messagingApi.Message[] {
  return [
    {
      type: 'text',
      text: EXPORT_CSV_ANNOUNCEMENT_TEXT,
    },
  ];
}

/**
 * Sends the informational CSV availability announcement through the supplied
 * LINE client. This function does not access the database, AI, or CSV flow.
 */
export async function sendExportCsvAnnouncement(
  lineClient: LineAnnouncementClient,
  target: ExportCsvAnnouncementTarget,
): Promise<unknown> {
  const messages = buildExportCsvAnnouncementMessages();

  if (target.mode === 'broadcast') {
    return lineClient.broadcast({
      messages,
      notificationDisabled: false,
    });
  }

  const recipientUserId = target.recipientUserId.trim();
  if (!recipientUserId) {
    throw new Error('A LINE recipient user ID is required for push mode.');
  }

  return lineClient.pushMessage({
    to: recipientUserId,
    messages,
    notificationDisabled: false,
  });
}
