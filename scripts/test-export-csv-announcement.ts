import assert from 'node:assert/strict';
import type { messagingApi } from '@line/bot-sdk';
import {
  EXPORT_CSV_ANNOUNCEMENT_TEXT,
  LineAnnouncementClient,
  buildExportCsvAnnouncementMessages,
  sendExportCsvAnnouncement,
} from '../src/services/line-announcement.service';

const EXPECTED_TEXT = [
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

async function main(): Promise<void> {
  const broadcastCalls: messagingApi.BroadcastRequest[] = [];
  const pushCalls: messagingApi.PushMessageRequest[] = [];

  const mockClient: LineAnnouncementClient = {
    broadcast: async (request) => {
      broadcastCalls.push(request);
      return {};
    },
    pushMessage: async (request) => {
      pushCalls.push(request);
      return { sentMessages: [] };
    },
  };

  const messages = buildExportCsvAnnouncementMessages();
  assert.equal(EXPORT_CSV_ANNOUNCEMENT_TEXT, EXPECTED_TEXT);
  assert.deepEqual(messages, [{ type: 'text', text: EXPECTED_TEXT }]);

  await sendExportCsvAnnouncement(mockClient, { mode: 'broadcast' });
  assert.equal(broadcastCalls.length, 1);
  assert.equal(pushCalls.length, 0);
  assert.deepEqual(broadcastCalls[0], {
    messages,
    notificationDisabled: false,
  });

  await sendExportCsvAnnouncement(mockClient, {
    mode: 'push',
    recipientUserId: 'U_TEST_ANNOUNCEMENT_RECIPIENT',
  });
  assert.equal(pushCalls.length, 1);
  assert.deepEqual(pushCalls[0], {
    to: 'U_TEST_ANNOUNCEMENT_RECIPIENT',
    messages,
    notificationDisabled: false,
  });

  await assert.rejects(
    () => sendExportCsvAnnouncement(mockClient, { mode: 'push', recipientUserId: '   ' }),
    /recipient user ID is required/,
  );

  console.log('PASS: CSV announcement payload is exact and informational.');
  console.log('PASS: Broadcast and single-user Push routing use mocked LINE methods only.');
  console.log('PASS: No live LINE API call was made.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
