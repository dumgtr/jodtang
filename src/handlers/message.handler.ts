import { messagingApi } from '@line/bot-sdk';
import { UserRepository } from '../modules/user/user.repository';
import { DraftRepository } from '../modules/draft/draft.repository';
import { TransactionRepository } from '../modules/transaction/transaction.repository';
import { ConversationService } from '../services/conversation.service';
import * as aiService from '../services/ai.service';
import {
  buildDraftConfirmFlex,
  buildDraftsConfirmCarousel,
  buildTxSelectionFlex,
  buildTxEditConfirmFlex,
  DraftConfirmItem,
} from '../utils/flex.builder';
import { isValidPositiveAmount } from '../utils/amount';
import { GENERIC_USER_ERROR_MESSAGE, logInternalError } from '../utils/errors';

/**
 * Handles incoming LINE text message events.
 * 1. Checks if user is in an active edit conversation state (draft or confirmed transaction).
 * 2. Checks if user sent a management command (e.g. "ขอแก้ไขรายการ", "ขอลบรายการ").
 * 3. Otherwise, checks financial intent and extracts transactions via AI.
 * 4. Responds with friendly greeting if input is non-financial (no 0-baht draft).
 */
export async function handleTextMessage(
  lineUserId: string,
  text: string,
  replyToken: string | undefined,
  lineClient: messagingApi.MessagingApiClient
): Promise<void> {
  try {
    // 1. Ensure user exists
    const user = await UserRepository.findOrCreateByLineUserId(lineUserId);
    const trimmedText = text.trim();

    // 2. Check Conversation State
    const state = ConversationService.getState(user.id);

    // 2A. Confirmed Transaction Edit Input
    if (
      state &&
      state.targetType === 'transaction' &&
      state.step === 'waiting_for_tx_input' &&
      state.transactionId
    ) {
      const tx = await TransactionRepository.findByIdAndUser(state.transactionId, user.id);
      if (!tx || tx.status !== 'confirmed') {
        ConversationService.clearState(user.id);
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

      const pendingEdits = { ...(state.pendingEdits || {}) };
      const field = state.fieldToEdit || 'amount';

      if (field === 'amount') {
        const parsedAmount = aiService.parseCleanAmount(trimmedText);
        if (!isValidPositiveAmount(parsedAmount)) {
          if (replyToken) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '⚠️ จำนวนเงินต้องมากกว่า 0 บาท กรุณาพิมพ์ระบุจำนวนเงินใหม่อีกครั้งครับ',
                },
              ],
            });
          }
          return;
        }
        pendingEdits.amount = parsedAmount;
      } else if (field === 'category') {
        pendingEdits.category_id = trimmedText;
      } else if (field === 'date') {
        const parsedDate = new Date(trimmedText);
        if (isNaN(parsedDate.getTime())) {
          if (replyToken) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '⚠️ รูปแบบวันที่ไม่ถูกต้อง กรุณาระบุในรูปแบบ YYYY-MM-DD เช่น 2026-08-20',
                },
              ],
            });
          }
          return;
        }
        pendingEdits.occurred_at = trimmedText;
      } else if (field === 'description') {
        pendingEdits.description = trimmedText;
      }

      // Update in-memory state with pending changes
      ConversationService.setState(user.id, {
        targetType: 'transaction',
        transactionId: state.transactionId,
        step: 'select_tx_field',
        pendingEdits,
      });

      // Send preview confirmation card
      if (replyToken) {
        const previewFlex = buildTxEditConfirmFlex(state.transactionId, tx, pendingEdits);
        await lineClient.replyMessage({
          replyToken,
          messages: [previewFlex],
        });
      }
      return;
    }

    // 2B. Draft Edit Input (Existing Draft Flow)
    if (state && state.step === 'waiting_for_input' && state.draftId) {
      const draft = await DraftRepository.findById(state.draftId, user.id);

      if (!draft || draft.status !== 'pending_confirmation') {
        ConversationService.clearState(user.id);
        if (replyToken) {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: '⚠️ ไม่พบรายการที่รอยืนยัน หรือรายการหมดอายุแล้ว กรุณาส่งรายการใหม่อีกครั้งครับ',
              },
            ],
          });
        }
        return;
      }

      const updatedExtractedData = { ...draft.extracted_data };
      const field = state.fieldToEdit || 'amount';

      if (field === 'amount') {
        const parsedAmount = aiService.parseCleanAmount(trimmedText);
        if (!isValidPositiveAmount(parsedAmount)) {
          if (replyToken) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '⚠️ จำนวนเงินต้องมากกว่า 0 บาท กรุณาพิมพ์ระบุจำนวนเงินใหม่อีกครั้งครับ',
                },
              ],
            });
          }
          return;
        }
        updatedExtractedData.amount = parsedAmount;
      } else if (field === 'category') {
        updatedExtractedData.category_id = trimmedText;
      } else if (field === 'date') {
        updatedExtractedData.occurred_at = trimmedText;
      } else if (field === 'description') {
        updatedExtractedData.description = trimmedText;
        updatedExtractedData.merchant_id = trimmedText;
      }

      // Update draft in PostgreSQL with ownership verification
      await DraftRepository.updateExtractedData(draft.id, user.id, updatedExtractedData);

      // Clear conversation state
      ConversationService.clearState(user.id);

      // Send updated Flex confirmation card
      if (replyToken) {
        const flexMsg = buildDraftConfirmFlex(
          draft.id,
          updatedExtractedData.amount,
          updatedExtractedData.category_id || 'ทั่วไป',
          updatedExtractedData.merchant_id || updatedExtractedData.description || '-'
        );

        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: '✏️ อัปเดตข้อมูลเรียบร้อยแล้ว กรุณาตรวจสอบและกดยืนยันครับ:',
            },
            flexMsg,
          ],
        });
      }
      return;
    }

    // 3. Command Intent Checks for Confirmed Transactions
    const editCommandPattern = /^(ขอ)?แก้ไขรายการ|แก้รายการ|แก้ไข$/i;
    const voidCommandPattern = /^(ขอ)?(ลบ|ยกเลิก)รายการ|ลบรายการ|ขอลบ$/i;

    if (editCommandPattern.test(trimmedText)) {
      const recentTxs = await TransactionRepository.findRecentByUser(user.id, 5);
      if (recentTxs.length === 0) {
        if (replyToken) {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: '⚠️ ยังไม่มีรายการที่บันทึกไว้ในระบบครับ',
              },
            ],
          });
        }
        return;
      }

      if (replyToken) {
        const selectionFlex = buildTxSelectionFlex(recentTxs, 'edit');
        await lineClient.replyMessage({
          replyToken,
          messages: [selectionFlex],
        });
      }
      return;
    }

    if (voidCommandPattern.test(trimmedText)) {
      const recentTxs = await TransactionRepository.findRecentByUser(user.id, 5);
      if (recentTxs.length === 0) {
        if (replyToken) {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: '⚠️ ยังไม่มีรายการที่บันทึกไว้ในระบบครับ',
              },
            ],
          });
        }
        return;
      }

      if (replyToken) {
        const selectionFlex = buildTxSelectionFlex(recentTxs, 'void');
        await lineClient.replyMessage({
          replyToken,
          messages: [selectionFlex],
        });
      }
      return;
    }

    // 4. Normal Flow: AI Extraction
    const currentDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const transactions = await aiService.extractTransactions(trimmedText, currentDate);

    // If input is non-financial (no valid positive transactions), reply with a helpful guide
    if (!transactions || transactions.length === 0) {
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: '👋 สวัสดีครับ จดตังพร้อมช่วยบันทึกรายรับรายจ่าย พิมพ์บอกได้เลย เช่น "กินข้าว 80" หรือ "ได้เงินเดือน 30,000" ครับ ✨',
            },
          ],
        });
      }
      return;
    }

    // 5. Save a draft record in PostgreSQL for each extracted transaction
    const draftItems: DraftConfirmItem[] = [];

    for (const item of transactions) {
      if (!isValidPositiveAmount(item.amount)) continue; // Invariant guard

      const draft = await DraftRepository.createDraft({
        userId: user.id,
        source: 'line_text',
        rawInput: trimmedText,
        extractedData: {
          type: item.type.toLowerCase() === 'income'
            ? 'income'
            : item.type.toLowerCase() === 'transfer'
            ? 'transfer'
            : 'expense',
          amount: item.amount,
          merchant_id: item.merchant,
          category_id: item.category,
          description: item.description,
          occurred_at: item.date,
        },
        expiresInMinutes: 24 * 60,
      });

      draftItems.push({
        draftId: draft.id,
        amount: item.amount,
        category: item.category,
        merchant: item.merchant,
      });
    }

    // If all items were filtered out (e.g. invalid amount)
    if (draftItems.length === 0) {
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: '👋 สวัสดีครับ จดตังพร้อมช่วยบันทึกรายรับรายจ่าย พิมพ์บอกได้เลย เช่น "กินข้าว 80" หรือ "ได้เงินเดือน 30,000" ครับ ✨',
            },
          ],
        });
      }
      return;
    }

    // 6. Send Flex Carousel (or Single Bubble)
    if (replyToken) {
      const carouselMessage = buildDraftsConfirmCarousel(draftItems);

      await lineClient.replyMessage({
        replyToken,
        messages: [carouselMessage],
      });
    }
  } catch (error) {
    logInternalError('[Text Message Handler Error]', error);
    if (!replyToken) return;

    try {
      await lineClient.replyMessage({
        replyToken,
        messages: [{ type: 'text', text: GENERIC_USER_ERROR_MESSAGE }],
      });
    } catch (replyError) {
      logInternalError('[Text Message Handler Error Reply Failed]', replyError);
    }
  }
}
