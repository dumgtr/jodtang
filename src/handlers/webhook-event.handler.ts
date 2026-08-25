import type { WebhookEvent, messagingApi } from '@line/bot-sdk';
import type { User } from '../types/database';
import { classifySecurityFaqIntent } from '../services/security-faq.service';
import { buildSecurityFaqText } from '../utils/menu.builder';

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
 * Dispatches a validated LINE event. Security FAQ text is classified and
 * answered before any user lookup so that this path remains read-only.
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
