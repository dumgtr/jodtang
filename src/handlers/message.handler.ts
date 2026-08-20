import { messagingApi } from '@line/bot-sdk';
import { UserRepository } from '../modules/user/user.repository';
import { DraftRepository } from '../modules/draft/draft.repository';
import { ConversationService } from '../services/conversation.service';
import * as aiService from '../services/ai.service';
import { buildDraftConfirmFlex, buildDraftsConfirmCarousel, DraftConfirmItem } from '../utils/flex.builder';
import { isValidPositiveAmount } from '../utils/amount';
import { GENERIC_USER_ERROR_MESSAGE, logInternalError } from '../utils/errors';

/**
 * Handles incoming LINE text message events.
 * 1. Checks if user is in an active edit conversation state (with user ownership).
 * 2. If editing, updates the existing draft and sends the updated Flex confirmation.
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

    // 2. Check Conversation State (Edit Flow with user ownership)
    const state = ConversationService.getState(user.id);
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
        const parsedAmount = aiService.parseCleanAmount(text);
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
        updatedExtractedData.category_id = text.trim();
      } else if (field === 'date') {
        updatedExtractedData.occurred_at = text.trim();
      } else if (field === 'description') {
        updatedExtractedData.description = text.trim();
        updatedExtractedData.merchant_id = text.trim();
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

    // 3. Normal Flow: AI Extraction
    const currentDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    const transactions = await aiService.extractTransactions(text, currentDate);

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

    // 4. Save a draft record in PostgreSQL for each extracted transaction
    const draftItems: DraftConfirmItem[] = [];

    for (const item of transactions) {
      if (!isValidPositiveAmount(item.amount)) continue; // Invariant guard

      const draft = await DraftRepository.createDraft({
        userId: user.id,
        source: 'line_text',
        rawInput: text,
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

    // 5. Send Flex Carousel (or Single Bubble)
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
