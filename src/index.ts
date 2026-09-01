import express, { Request, Response, NextFunction } from 'express';
import { middleware, MiddlewareConfig, WebhookEvent, messagingApi } from '@line/bot-sdk';
import { env } from './config/env';
import { UserRepository } from './modules/user/user.repository';
import { handleTextMessage } from './handlers/message.handler';
import { handleImageMessage } from './handlers/image.handler';
import { handlePostbackEvent } from './handlers/postback.handler';
import { handleWebhookEvent } from './handlers/webhook-event.handler';
import { handleTransactionCsvExport } from './handlers/export.handler';
import { GENERIC_USER_ERROR_MESSAGE, getSafeHttpStatus, logInternalError } from './utils/errors';

const lineConfig: MiddlewareConfig = {
  channelSecret: env.LINE_CHANNEL_SECRET,
};

const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});

const lineBlobClient = new messagingApi.MessagingApiBlobClient({
  channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
});

const webhookEventDependencies = {
  lineClient,
  lineBlobClient,
  findOrCreateByLineUserId: (lineUserId: string) =>
    UserRepository.findOrCreateByLineUserId(lineUserId),
  handleTextMessage,
  handleImageMessage,
  handlePostbackEvent,
};

const app = express();

// 1. Health Check Endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 2. Secure, short-lived per-user CSV export endpoint.
// The token is opaque and encrypted; the endpoint never accepts a user ID
// supplied directly by the browser.
app.get('/exports/transactions.csv', (req: Request, res: Response) => {
  void handleTransactionCsvExport(req, res);
});

/**
 * 3. LINE Webhook Handler
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
            await handleWebhookEvent(event, webhookEventDependencies);
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
