import type { WebhookEvent, messagingApi } from '@line/bot-sdk';
import type { User } from '../types/database';
import { classifySecurityFaqIntent } from '../services/security-faq.service';
import { buildSecurityFaqText } from '../utils/menu.builder';
import { TransactionRepository } from '../modules/transaction/transaction.repository';
import {
  isExportCsvCommand,
  buildExportCsvFlexMessage,
  buildExportDownloadUrl,
} from '../services/export-csv.service';

export type WebhookEventHandlerDependencies = {
  lineClient: messagingApi.MessagingApiClient;
  findOrCreateByLineUserId: (lineUserId: string) => Promise<User>;
  handleTextMessage: (
    lineUserId: string,
    text: string,
    replyToken: string | undefined,
    lineClient: messagingApi.MessagingApiClient
  ) => Promise<void>;
  handleImageMessage: (
    lineUserId: string,
    messageId: string,
    replyToken: string | undefined,
    lineClient: messagingApi.MessagingApiClient
  ) => Promise<void>;
  handlePostbackEvent: (
    user: User,
    postbackData: string,
    replyToken: string | undefined,
    lineClient: messagingApi.MessagingApiClient
  ) => Promise<void>;
};

/**
 * Dispatches a validated LINE event. Export CSV is resolved before Security
 * FAQ so explicit download requests cannot be captured by deletion/export
 * FAQ wording. Security FAQ still runs before generic user lookup and remains
 * strictly read-only.
 */
export async function handleWebhookEvent(
  event: WebhookEvent,
  dependencies: WebhookEventHandlerDependencies
): Promise<void> {
  const lineUserId = event.source.userId;
  if (!lineUserId) {
    console.warn('[LINE Event] Skipped event without userId', {
      eventType: event.type,
      sourceType: event.source.type,
    });
    return;
  }

  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();

    // Export CSV is a user-scoped read path. Resolve it before Security FAQ
    // and before the generic text/AI pipeline so it cannot create a draft or
    // transaction. Group chats are rejected before any user lookup.
    if (isExportCsvCommand(text)) {
      if (event.source.type !== 'user') {
        if (event.replyToken) {
          await dependencies.lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text: '🔒 เพื่อความเป็นส่วนตัว Export CSV ใช้ได้เฉพาะในแชตส่วนตัวกับจดตังครับ',
              },
            ],
          });
        }
        return;
      }

      try {
        const user = await dependencies.findOrCreateByLineUserId(lineUserId);
        const transactions = await TransactionRepository.findAllByUser(user.id);
        const downloadUrl = buildExportDownloadUrl(user.id);

        if (event.replyToken) {
          await dependencies.lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [buildExportCsvFlexMessage(downloadUrl, transactions.length) as any],
          });
        }
      } catch (error) {
        console.error('[CSV Export Preparation Error]', error);
        if (event.replyToken) {
          await dependencies.lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text: '⚠️ ตอนนี้ยังไม่สามารถเตรียมไฟล์ CSV ให้ได้ครับ กรุณาลองใหม่อีกครั้งภายหลัง',
              },
            ],
          });
        }
      }
      return;
    }

    const securityFaqTopic = classifySecurityFaqIntent(text);

    if (securityFaqTopic) {
      if (event.replyToken) {
        await dependencies.lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [
            {
              type: 'text',
              text: buildSecurityFaqText(securityFaqTopic),
            },
          ],
        });
      }
      return;
    }
  }

  const user = await dependencies.findOrCreateByLineUserId(lineUserId);

  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();

    console.log('[Text Message Received]', { userId: user.id, inputLength: text.length });
    await dependencies.handleTextMessage(lineUserId, text, event.replyToken, dependencies.lineClient);
    return;
  }

  if (event.type === 'message' && event.message.type === 'image') {
    console.log('[Image Message Received]', { userId: user.id, messageId: event.message.id });
    await dependencies.handleImageMessage(
      lineUserId,
      event.message.id,
      event.replyToken,
      dependencies.lineClient
    );
    return;
  }

  if (event.type === 'postback') {
    const postback = new URLSearchParams(event.postback.data);
    console.log('[Postback Received]', {
      userId: user.id,
      action: postback.get('action'),
      draftId: postback.get('draft_id'),
    });
    await dependencies.handlePostbackEvent(
      user,
      event.postback.data,
      event.replyToken,
      dependencies.lineClient
    );
  }
}
