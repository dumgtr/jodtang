import { messagingApi } from '@line/bot-sdk';
import { ConversationService } from '../services/conversation.service';
import { DraftRepository } from '../modules/draft/draft.repository';
import { TransactionRepository } from '../modules/transaction/transaction.repository';
import { User } from '../types/database';
import { GENERIC_USER_ERROR_MESSAGE, logInternalError } from '../utils/errors';
import { buildTxVoidConfirmFlex } from '../utils/flex.builder';

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
  const txId = params.get('tx_id');

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

  // ==========================================
  // A. CONFIRMED TRANSACTION POSTBACK ACTIONS
  // ==========================================

  // A1. Select Confirmed Transaction to Edit -> Show Field Options
  if (action === 'select_tx_for_edit' && txId) {
    try {
      const tx = await TransactionRepository.findByIdAndUser(txId, user.id);
      if (!tx || tx.status !== 'confirmed') {
        if (replyToken) {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: '⚠️ ไม่พบรายการที่ต้องการแก้ไข หรือรายการถูกยกเลิกไปแล้วครับ',
              },
            ],
          });
        }
        return;
      }

      ConversationService.setState(user.id, {
        targetType: 'transaction',
        transactionId: txId,
        step: 'select_tx_field',
      });

      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: 'ต้องการแก้ไขข้อมูลส่วนไหนของรายการนี้ครับ?',
              quickReply: {
                items: [
                  {
                    type: 'action',
                    action: {
                      type: 'postback',
                      label: 'จำนวนเงิน',
                      data: `action=set_tx_field&field=amount&tx_id=${txId}`,
                      displayText: 'แก้ไข: จำนวนเงิน',
                    },
                  },
                  {
                    type: 'action',
                    action: {
                      type: 'postback',
                      label: 'หมวดหมู่',
                      data: `action=set_tx_field&field=category&tx_id=${txId}`,
                      displayText: 'แก้ไข: หมวดหมู่',
                    },
                  },
                  {
                    type: 'action',
                    action: {
                      type: 'postback',
                      label: 'วันที่',
                      data: `action=set_tx_field&field=date&tx_id=${txId}`,
                      displayText: 'แก้ไข: วันที่',
                    },
                  },
                  {
                    type: 'action',
                    action: {
                      type: 'postback',
                      label: 'รายละเอียด',
                      data: `action=set_tx_field&field=description&tx_id=${txId}`,
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
      logInternalError('[Select Tx For Edit Error]', error);
      await replyWithGenericError();
    }
    return;
  }

  // A2. Set Confirmed Transaction Field -> Wait for Input
  if (action === 'set_tx_field' && txId) {
    const selectedField = params.get('field') || 'amount';
    const currentState = ConversationService.getState(user.id);
    const pendingEdits =
      currentState?.targetType === 'transaction' && currentState?.transactionId === txId
        ? currentState.pendingEdits || {}
        : {};

    ConversationService.setState(user.id, {
      targetType: 'transaction',
      transactionId: txId,
      step: 'waiting_for_tx_input',
      fieldToEdit: selectedField,
      pendingEdits,
    });

    if (replyToken) {
      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: 'text',
            text: 'พิมพ์ข้อมูลใหม่ที่ถูกต้องมาได้เลยครับ 💬',
          },
        ],
      });
    }
    return;
  }

  // A3. Confirm Transaction Edit -> Atomic Update with Stale State Assertion
  if (action === 'confirm_tx_edit' && txId) {
    try {
      const state = ConversationService.getState(user.id);

      // Verify stored pending edit target matches confirmation target
      if (
        !state ||
        state.targetType !== 'transaction' ||
        !state.transactionId ||
        state.transactionId !== txId
      ) {
        ConversationService.clearState(user.id);
        if (replyToken) {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: '⚠️ ข้อมูลการแก้ไขไม่ถูกต้องหรือหมดอายุแล้ว กรุณาเลือกรายการที่ต้องการแก้ไขใหม่อีกครั้งครับ',
              },
            ],
          });
        }
        return;
      }

      const pendingEdits = state.pendingEdits || {};
      const updatedTx = await TransactionRepository.updateTransaction(txId, user.id, pendingEdits);
      ConversationService.clearState(user.id);

      if (replyToken) {
        const formattedAmount = Number(updatedTx.amount).toLocaleString('th-TH', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });

        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: `✅ อัปเดตรายการเรียบร้อยแล้ว!\n💰 จำนวน: ฿${formattedAmount}\n🏷️ หมวดหมู่: ${updatedTx.category_id || '-'}\n📝 รายละเอียด: ${updatedTx.description || updatedTx.merchant_id || '-'}\n📅 วันที่: ${new Date(updatedTx.occurred_at).toLocaleDateString('th-TH')}`,
            },
          ],
        });
      }
    } catch (error: any) {
      logInternalError('[Confirm Tx Edit Error]', error);
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: `⚠️ ไม่สามารถบันทึกการแก้ไขได้: ${error.message || GENERIC_USER_ERROR_MESSAGE}`,
            },
          ],
        });
      }
    }
    return;
  }

  // A4. Cancel Transaction Edit
  if (action === 'cancel_tx_edit' && txId) {
    ConversationService.clearState(user.id);
    if (replyToken) {
      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: 'text',
            text: '↩️ ยกเลิกการแก้ไขรายการแล้วครับ',
          },
        ],
      });
    }
    return;
  }

  // A5. Select Confirmed Transaction to Void -> Show Confirmation
  if (action === 'select_tx_for_void' && txId) {
    try {
      const tx = await TransactionRepository.findByIdAndUser(txId, user.id);
      if (!tx || tx.status !== 'confirmed') {
        if (replyToken) {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: '⚠️ ไม่พบรายการที่ต้องการลบ หรือรายการถูกยกเลิกไปแล้วครับ',
              },
            ],
          });
        }
        return;
      }

      const confirmFlex = buildTxVoidConfirmFlex(tx);
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [confirmFlex],
        });
      }
    } catch (error) {
      logInternalError('[Select Tx For Void Error]', error);
      await replyWithGenericError();
    }
    return;
  }

  // A6. Confirm Transaction Void -> Atomic Soft-Delete
  if (action === 'confirm_tx_void' && txId) {
    try {
      await TransactionRepository.voidTransaction(txId, user.id);
      ConversationService.clearState(user.id);

      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: '🗑️ ลบ/ยกเลิกรายการเรียบร้อยแล้วครับ',
            },
          ],
        });
      }
    } catch (error: any) {
      logInternalError('[Confirm Tx Void Error]', error);
      if (replyToken) {
        const errorMsg = error.message?.includes('ALREADY_VOIDED')
          ? 'รายการนี้ถูกยกเลิกไปแล้วครับ'
          : `⚠️ ไม่สามารถลบรายการได้: ${error.message || GENERIC_USER_ERROR_MESSAGE}`;
        await lineClient.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: errorMsg }],
        });
      }
    }
    return;
  }

  // A7. Cancel Transaction Void
  if (action === 'cancel_tx_void' && txId) {
    ConversationService.clearState(user.id);
    if (replyToken) {
      await lineClient.replyMessage({
        replyToken,
        messages: [
          {
            type: 'text',
            text: '↩️ เก็บรายการไว้ตามเดิมครับ',
          },
        ],
      });
    }
    return;
  }

  // ==========================================
  // B. DRAFT CONFIRMATION POSTBACK ACTIONS
  // ==========================================

  if (!draftId) {
    console.warn('[Postback Handler] Ignored postback without draft_id or tx_id', { action });
    return;
  }

  // B1. Confirm action: Commit draft to transaction atomically
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

  // B2. Cancel action: Mark draft as cancelled with audit logging (or void confirmed tx if already committed)
  if (action === 'cancel') {
    try {
      const draft = await DraftRepository.findById(draftId, user.id);

      // If draft was already confirmed and has transaction_id, show void confirmation flex for that transaction
      if (draft && draft.status === 'confirmed' && draft.transaction_id) {
        const tx = await TransactionRepository.findByIdAndUser(draft.transaction_id, user.id);
        if (tx && tx.status === 'confirmed') {
          const confirmFlex = buildTxVoidConfirmFlex(tx);
          if (replyToken) {
            await lineClient.replyMessage({
              replyToken,
              messages: [confirmFlex],
            });
          }
          return;
        }
      }

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

  // B3. Edit action: Prompt user to choose field to edit via Quick Replies
  if (action === 'edit') {
    try {
      const draft = await DraftRepository.findById(draftId, user.id);

      // If draft was already confirmed and has transaction_id, seamlessly open confirmed transaction edit flow
      if (draft && draft.status === 'confirmed' && draft.transaction_id) {
        const tx = await TransactionRepository.findByIdAndUser(draft.transaction_id, user.id);
        if (tx && tx.status === 'confirmed') {
          ConversationService.setState(user.id, {
            targetType: 'transaction',
            transactionId: tx.id,
            step: 'select_tx_field',
          });

          if (replyToken) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: 'ต้องการแก้ไขข้อมูลส่วนไหนของรายการนี้ครับ?',
                  quickReply: {
                    items: [
                      {
                        type: 'action',
                        action: {
                          type: 'postback',
                          label: 'จำนวนเงิน',
                          data: `action=set_tx_field&field=amount&tx_id=${tx.id}`,
                          displayText: 'แก้ไข: จำนวนเงิน',
                        },
                      },
                      {
                        type: 'action',
                        action: {
                          type: 'postback',
                          label: 'หมวดหมู่',
                          data: `action=set_tx_field&field=category&tx_id=${tx.id}`,
                          displayText: 'แก้ไข: หมวดหมู่',
                        },
                      },
                      {
                        type: 'action',
                        action: {
                          type: 'postback',
                          label: 'วันที่',
                          data: `action=set_tx_field&field=date&tx_id=${tx.id}`,
                          displayText: 'แก้ไข: วันที่',
                        },
                      },
                      {
                        type: 'action',
                        action: {
                          type: 'postback',
                          label: 'รายละเอียด',
                          data: `action=set_tx_field&field=description&tx_id=${tx.id}`,
                          displayText: 'แก้ไข: รายละเอียด',
                        },
                      },
                    ],
                  },
                },
              ],
            });
          }
          return;
        }
      }

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
        targetType: 'draft',
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

  // B4. Set Field action: Set waiting_for_input state and prompt for new value
  if (action === 'set_field') {
    const selectedField = params.get('field') || 'amount';

    ConversationService.setState(user.id, {
      targetType: 'draft',
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
