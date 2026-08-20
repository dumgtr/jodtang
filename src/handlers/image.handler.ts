import { messagingApi } from '@line/bot-sdk';
import { logInternalError } from '../utils/errors';

/**
 * Handles incoming LINE image message events.
 * Sprint 1 behavior is maintenance-only: no OCR, AI, QR parsing, or database write.
 */
export async function handleImageMessage(
  lineUserId: string,
  messageId: string,
  replyToken: string | undefined,
  lineClient: messagingApi.MessagingApiClient
): Promise<void> {
  console.log('[Image Handler] Image received', { lineUserId, messageId });

  if (replyToken) {
    try {
      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: 'text',
            text: '📷 ระบบสแกนสลิปจะเปิดให้บริการในเวอร์ชันถัดไปครับ ตอนนี้สามารถพิมพ์จดรายการได้เลย เช่น "กินข้าว 80" หรือ "โอนเงิน 100 บาท" ครับ ✨',
          },
        ],
      });
    } catch (error) {
      logInternalError('[Image Handler] Failed to send reply message', error);
    }
  }
}
