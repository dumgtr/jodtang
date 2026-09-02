import { messagingApi } from '@line/bot-sdk';
import { env } from '../config/env';
import { UserRepository } from '../modules/user/user.repository';
import { SlipService } from '../modules/slip/slip.service';
import { ReceiptService } from '../modules/receipt/receipt.service';
import { buildDraftConfirmBubble } from '../utils/flex.builder';
import { GENERIC_USER_ERROR_MESSAGE, logInternalError } from '../utils/errors';

/**
 * Handles incoming LINE image message events.
 * Streams the image directly in-memory, verifies via SlipService,
 * falls back to ReceiptService if no bank QR code is found,
 * protects against duplicates, and replies with a Draft Confirmation Card.
 * 
 * STRICT INVARIANT: Does NOT create a permanent transaction!
 */
export async function handleImageMessage(
  lineUserId: string,
  messageId: string,
  replyToken: string | undefined,
  lineClient: messagingApi.MessagingApiClient,
  lineBlobClient?: messagingApi.MessagingApiBlobClient,
  slipService: SlipService = new SlipService(),
  receiptService: ReceiptService = new ReceiptService()
): Promise<void> {
  console.log('[Image Handler] Processing image message', { lineUserId, messageId });

  if (!replyToken) return;

  try {
    const user = await UserRepository.findOrCreateByLineUserId(lineUserId);

    // Initialize blob client if not injected
    const blobClient =
      lineBlobClient ??
      new messagingApi.MessagingApiBlobClient({
        channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
      });

    // 1. Download image stream from LINE CDN into in-memory buffer (zero disk write)
    let imageBuffer: Buffer;
    try {
      const stream = await blobClient.getMessageContent(messageId);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      imageBuffer = Buffer.concat(chunks);
    } catch (downloadError) {
      logInternalError('[Image Handler] Failed to download image from LINE CDN', downloadError);
      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: 'text',
            text: '⚠️ ดาวน์โหลดรูปภาพไม่สำเร็จ กรุณาลองส่งใหม่อีกครั้งครับ',
          },
        ],
      });
      return;
    }

    if (!imageBuffer || imageBuffer.length === 0) {
      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: 'text',
            text: '⚠️ รูปภาพว่างเปล่าหรือไม่ถูกต้อง กรุณาลองส่งใหม่อีกครั้งครับ',
          },
        ],
      });
      return;
    }

    // 2. Process slip via SlipService (verification, duplicate check, draft creation)
    const result = await slipService.processSlip(user.id, imageBuffer);

    if (result.success) {
      // 3. Success: send confirmation flex bubble
      const flexBubble = buildDraftConfirmBubble(
        result.draft.id,
        result.slipData.amount,
        result.slipData.category,
        result.slipData.merchant
      );

      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: 'flex',
            altText: `📝 รายการรอยืนยัน: ฿${result.slipData.amount.toFixed(2)} - ${result.slipData.merchant}`,
            contents: flexBubble,
          },
        ],
      });
      return;
    }

    // 4. Receipt OCR Fallback: Triggered ONLY when no bank QR was found on image (INVALID_IMAGE)
    // STRICT INVARIANTS:
    // - DUPLICATE slips NEVER fallback to OCR
    // - FRAUD slips NEVER fallback to OCR
    // - NOT_FOUND / BANK_ERROR slips NEVER fallback to OCR
    if (result.reason === 'INVALID_IMAGE' && receiptService.isConfigured()) {
      console.log('[Image Handler] No bank QR found; falling back to Receipt OCR...');
      const receiptResult = await receiptService.processReceipt(user.id, imageBuffer);

      if (receiptResult.success) {
        const flexBubble = buildDraftConfirmBubble(
          receiptResult.draft.id,
          receiptResult.receiptData.amount,
          receiptResult.receiptData.category,
          receiptResult.receiptData.merchant
        );

        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'flex',
              altText: `🧾 ใบเสร็จรอยืนยัน: ฿${receiptResult.receiptData.amount.toFixed(2)} - ${receiptResult.receiptData.merchant}`,
              contents: flexBubble,
            },
          ],
        });
        return;
      }

      // Receipt OCR was attempted but failed/unreadable/no amount
      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: 'text',
            text: receiptResult.message,
          },
        ],
      });
      return;
    }

    // 5. Verification failed, duplicate detected, or OCR unconfigured
    await lineClient.replyMessage({
      replyToken,
      messages: [
        {
          type: 'text',
          text: result.message,
        },
      ],
    });
  } catch (error) {
    logInternalError('[Image Handler Error]', error);
    try {
      await lineClient.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: GENERIC_USER_ERROR_MESSAGE }],
      });
    } catch (replyError) {
      logInternalError('[Image Handler Error Reply Failed]', replyError);
    }
  }
}
