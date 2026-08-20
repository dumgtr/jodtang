import express, { Request, Response, NextFunction } from 'express';
import { middleware, MiddlewareConfig, WebhookEvent, messagingApi } from '@line/bot-sdk';
import { env } from './config/env';
import { UserRepository } from './modules/user/user.repository';
import { handleTextMessage } from './handlers/message.handler';
import { handleImageMessage } from './handlers/image.handler';
import { handlePostbackEvent } from './handlers/postback.handler';
import { GENERIC_USER_ERROR_MESSAGE, getSafeHttpStatus, logInternalError } from './utils/errors';

const lineConfig: MiddlewareConfig = {
  channelSecret: env.LINE_CHANNEL_SECRET,
};

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});

const app = express();

// 1. Health Check Endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * 2. LINE Webhook Handler
 * - Handles verification pings immediately.
 * - Responds 200 OK immediately.
 * - Processes events asynchronously in the background.
 */
app.post(
  '/webhook',
  middleware(lineConfig),
  (req: Request, res: Response): void => {
    try {
      const events: WebhookEvent[] = req.body?.events || [];

      // Handle LINE Developers Console Verification Ping
      if (!events || events.length === 0) {
        console.log('[LINE Webhook] Received verification ping from LINE Developers Console.');
        res.status(200).send('OK');
        return;
      }

      // Immediately respond 200 OK for valid webhook delivery
      res.status(200).json({ status: 'success' });

      // Process events asynchronously in the background
      setImmediate(async () => {
        for (const event of events) {
          try {
            await handleWebhookEvent(event);
          } catch (err) {
            logInternalError('[Event Processing Error]', err);
          }
        }
      });
    } catch (err) {
      logInternalError('[Webhook Request Handler Error]', err);
      if (!res.headersSent) {
        res.status(200).send('OK');
      }
    }
  }
);

/**
 * 3. Main Webhook Event Dispatcher
 */
async function handleWebhookEvent(event: WebhookEvent): Promise<void> {
  const lineUserId = event.source.userId;
  if (!lineUserId) {
    console.warn('[LINE Event] Skipped event without userId', {
      eventType: event.type,
      sourceType: event.source.type,
    });
    return;
  }

  // 1. Ensure user exists in Postgres
  const user = await UserRepository.findOrCreateByLineUserId(lineUserId);

  // 2. Handle text messages -> deterministic validation plus optional AI extraction -> draft confirmation
  if (event.type === 'message' && event.message.type === 'text') {
    const text = event.message.text.trim();
    console.log('[Text Message Received]', { userId: user.id, inputLength: text.length });
    await handleTextMessage(lineUserId, text, event.replyToken, lineClient);
    return;
  }

  // 3. Handle image messages -> maintenance response only (no OCR, AI, or database writes)
  if (event.type === 'message' && event.message.type === 'image') {
    console.log('[Image Message Received]', { userId: user.id, messageId: event.message.id });
    await handleImageMessage(lineUserId, event.message.id, event.replyToken, lineClient);
    return;
  }

  // 4. Handle Postback Events (Confirm, Cancel, Edit, Set Field)
  if (event.type === 'postback') {
    const postback = new URLSearchParams(event.postback.data);
    console.log('[Postback Received]', {
      userId: user.id,
      action: postback.get('action'),
      draftId: postback.get('draft_id'),
    });
    await handlePostbackEvent(user, event.postback.data, event.replyToken, lineClient);
    return;
  }
}

// 4. Fallback JSON Parser for non-webhook routes
app.use(express.json());

// 5. Global Error Handling Middleware
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logInternalError('[Unhandled Server Error]', err);
  const statusCode = getSafeHttpStatus(err);

  if (statusCode === 401) {
    console.warn('[LINE Signature Error] Webhook signature verification failed');
    res.status(401).json({ error: 'Unauthorized', message: GENERIC_USER_ERROR_MESSAGE });
    return;
  }

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal Server Error' : 'Request Error',
    message: GENERIC_USER_ERROR_MESSAGE,
  });
});

const PORT = env.PORT;
app.listen(PORT, () => {
  console.log(`🚀 [จดตัง JodTang Server] running on port ${PORT} (env: ${env.NODE_ENV})`);
});
