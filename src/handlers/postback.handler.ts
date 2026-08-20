import { messagingApi } from '@line/bot-sdk';
import { ConversationService } from '../services/conversation.service';
import { DraftRepository } from '../modules/draft/draft.repository';
import { TransactionRepository } from '../modules/transaction/transaction.repository';
import { User } from '../types/database';
import { GENERIC_USER_ERROR_MESSAGE, logInternalError } from '../utils/errors';

/**
 * Handles incoming LINE postback events with strict user ownership and atomic DB operations.
 */
export async function handlePostbackEvent(
  user: User,
  postbackData: string,
  replyToken: string | undefined,
  lineClient: messagingApi.MessagingApiClient
): Promise<void> {
  const params = new URLSearchParams(postbackData);
  const action = params.get('action');
  const draftId = params.get('draft_id');

  const replyWithGenericError = async (): Promise<void> => {
    if (!replyToken) return;

    try {
      await lineClient.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: GENERIC_USER_ERROR_MESSAGE }],
      });
    } catch (replyError) {
      logInternalError('[Postback Handler Error Reply Failed]', replyError);
    }
  };

  if (!draftId) {
    console.warn('[Postback Handler] Ignored postback without draft_id', { action });
    return;
  }

  // 1. Confirm action: Commit draft to transaction atomically
  if (action === 'confirm') {
    try {
      const result = await TransactionRepository.commitDraft(draftId, user.id);
      ConversationService.clearState(user.id);

      if (replyToken) {
        const formattedAmount = Number(result.transaction.amount).toLocaleString('th-TH', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: `✅ บันทึกรายการเรียบร้อย!\n💰 จำนวน: ฿${formattedAmount}\n🏷️ หมวดหมู่: ${result.transaction.category_id || '-'}\n🏬 ร้านค้า/โน้ต: ${result.transaction.merchant_id || '-'}\n📅 วันที่: ${new Date(result.transaction.occurred_at).toLocaleDateString('th-TH')}`,
            },
          ],
        });
      }
    } catch (error) {
      logInternalError('[Commit Draft Error]', error);
      await replyWithGenericError();
    }
    return;
  }

  // 2. Cancel action: Mark draft as cancelled with audit logging
  if (action === 'cancel') {
    try {
      await DraftRepository.cancelDraft(draftId, user.id);
      ConversationService.clearState(user.id);

      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: '🗑️ ยกเลิกรายการแล้วครับ',
            },
          ],
        });
      }
    } catch (error) {
      logInternalError('[Cancel Draft Error]', error);
      await replyWithGenericError();
    }
    return;
  }

  // 3. Edit action: Prompt user to choose field to edit via Quick Replies
  if (action === 'edit') {
    try {
      const draft = await DraftRepository.findById(draftId, user.id);
      if (!draft || draft.status !== 'pending_confirmation') {
        if (replyToken) {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: '⚠️ ไม่พบรายการที่รอยืนยัน หรือรายการหมดอายุ/ถูกยกเลิกแล้วครับ',
              },
            ],
          });
        }
        return;
      }

      ConversationService.setState(user.id, {
        draftId,
        step: 'select_field',
      });

      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: 'ต้องการแก้ไขข้อมูลส่วนไหนครับ?',
              quickReply: {
                items: [
                  {
                    type: 'action',
                    action: {
                      type: 'postback',
                      label: 'จำนวนเงิน',
                      data: `action=set_field&field=amount&draft_id=${draftId}`,
                      displayText: 'แก้ไข: จำนวนเงิน',
                    },
                  },
                  {
                    type: 'action',
                    action: {
                      type: 'postback',
                      label: 'หมวดหมู่',
                      data: `action=set_field&field=category&draft_id=${draftId}`,
                      displayText: 'แก้ไข: หมวดหมู่',
                    },
                  },
                  {
                    type: 'action',
                    action: {
                      type: 'postback',
                      label: 'วันที่',
                      data: `action=set_field&field=date&draft_id=${draftId}`,
                      displayText: 'แก้ไข: วันที่',
                    },
                  },
                  {
                    type: 'action',
                    action: {
                      type: 'postback',
                      label: 'รายละเอียด',
                      data: `action=set_field&field=description&draft_id=${draftId}`,
                      displayText: 'แก้ไข: รายละเอียด',
                    },
                  },
                ],
              },
            },
          ],
        });
      }
    } catch (error) {
      logInternalError('[Edit Draft Error]', error);
      await replyWithGenericError();
    }
    return;
  }

  // 4. Set Field action: Set waiting_for_input state and prompt for new value
  if (action === 'set_field') {
    const selectedField = params.get('field') || 'amount';

    ConversationService.setState(user.id, {
      draftId,
      step: 'waiting_for_input',
      fieldToEdit: selectedField,
    });

    if (replyToken) {
      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: 'text',
            text: 'พิมพ์ข้อมูลที่ถูกต้องมาได้เลยครับ 💬',
          },
        ],
      });
    }
    return;
  }
}
