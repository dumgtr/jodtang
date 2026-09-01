import { messagingApi } from '@line/bot-sdk';
import {
  buildExportCsvAnnouncementMessages,
  sendExportCsvAnnouncement,
} from '../src/services/line-announcement.service';

type AnnouncementMode = 'broadcast' | 'push';

function parseMode(args: string[]): AnnouncementMode {
  const modeArg = args.find((arg) => arg.startsWith('--mode='));
  const mode = modeArg?.slice('--mode='.length) || 'broadcast';

  if (mode !== 'broadcast' && mode !== 'push') {
    throw new Error('Invalid mode. Use --mode=broadcast or --mode=push.');
  }

  return mode;
}

function printUsage(): void {
  console.log('Dry-run broadcast:');
  console.log('  npm run announce:export-csv -- --mode=broadcast');
  console.log('');
  console.log('Live broadcast (requires separate authorization):');
  console.log('  npm run announce:export-csv -- --mode=broadcast --send');
  console.log('');
  console.log('Live single-user push (requires separate authorization):');
  console.log("  $env:LINE_ANNOUNCEMENT_USER_ID='<LINE user ID>'");
  console.log('  npm run announce:export-csv -- --mode=push --send');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    printUsage();
    return;
  }

  const mode = parseMode(args);
  const shouldSend = args.includes('--send');
  const messages = buildExportCsvAnnouncementMessages();

  if (!shouldSend) {
    const payload = mode === 'broadcast'
      ? { messages, notificationDisabled: false }
      : {
          to: '<LINE_ANNOUNCEMENT_USER_ID from environment>',
          messages,
          notificationDisabled: false,
        };

    console.log('DRY RUN — no LINE API call was made.');
    console.log(JSON.stringify({ mode, payload }, null, 2));
    return;
  }

  const { env } = await import('../src/config/env');
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN is missing in environment.');
  }

  const lineClient = new messagingApi.MessagingApiClient({
    channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
  });

  if (mode === 'broadcast') {
    await sendExportCsvAnnouncement(lineClient, { mode: 'broadcast' });
    console.log('LINE broadcast completed.');
    return;
  }

  const recipientUserId = process.env.LINE_ANNOUNCEMENT_USER_ID?.trim();
  if (!recipientUserId) {
    throw new Error('LINE_ANNOUNCEMENT_USER_ID is required for push mode.');
  }

  await sendExportCsvAnnouncement(lineClient, { mode: 'push', recipientUserId });
  console.log('LINE push completed for the configured recipient.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Announcement command failed.');
  process.exitCode = 1;
});
