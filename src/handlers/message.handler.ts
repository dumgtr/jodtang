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
import { parseNaturalThaiDate } from '../utils/date';
import { GENERIC_USER_ERROR_MESSAGE, logInternalError } from '../utils/errors';
import { parseQueryIntent } from '../services/query-parser.service';
import { QueryEngineService } from '../services/query-engine.service';
import { formatQueryResult } from '../services/query-formatter.service';
import { classifySecurityFaqIntent } from '../services/security-faq.service';
import {
  buildQuickSummaryQuickReply,
  buildSlipUploadQuickReply,
  buildSecurityFaqText,
  buildStartRecordGuideText,
  buildHelpGuideText,
  buildRecentTransactionsText,
  buildComingSoonExportCsvText,
  buildComingSoonDonateText,
} from '../utils/menu.builder';

/**
 * Deterministically checks if input text is a Start Record command (e.g. "เริ่มจด", "จดรายการ").
 */
function isStartRecordCommand(text: string): boolean {
  if (/\d/.test(text)) return false;
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
  return /^(เริ่มจด|เริ่มบันทึก|จดรายการ|บันทึกรายการ|จดเงิน)$/u.test(normalized);
}

/**
 * Deterministically checks if input text is an edit command (stripping emojis, symbols, and variation selectors).
 */
function isEditCommand(text: string): boolean {
  if (/\d/.test(text)) return false; // Contains digits -> financial input, not a command
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
  return /^(ขอ)?(แก้ไข|แก้)(รายการ)?$/u.test(normalized) || normalized === 'edit';
}

/**
 * Deterministically checks if input text is a void/delete command (stripping emojis, symbols, and variation selectors).
 */
function isVoidCommand(text: string): boolean {
  if (/\d/.test(text)) return false; // Contains digits -> financial input, not a command
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
  return /^(ขอ)?(ลบ|ยกเลิก)(รายการ)?$/u.test(normalized) || normalized === 'delete' || normalized === 'void';
}

/**
 * Deterministically checks if input text is a Quick Summary menu request.
 */
function isSummaryMenuCommand(text: string): boolean {
  if (/\d/.test(text)) return false;
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
  return /^(สรุป|สรุปยอด|เมนูสรุป|รายงาน)$/u.test(normalized);
}

/**
 * Deterministically checks if input text is an Image/Slip upload menu request.
 */
function isSlipUploadMenuCommand(text: string): boolean {
  if (/\d/.test(text)) return false;
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
  return /^(อัพสลิป|อัปสลิป|เพิ่มรูป|เพิ่มรูปภาพ|เพิ่มสลิป|เพิ่มรูปภาพสลิป|อัปโหลดรูป|อัพโหลดรูป|แนบสลิป|ส่งรูป|สแกนสลิป)$/u.test(normalized);
}

/**
 * Deterministically checks if input text is a Help / Guide request.
 */
function isHelpGuideCommand(text: string): boolean {
  if (/\d/.test(text)) return false;
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
  return (
    /^(วิธีใช้|คู่มือ|ช่วยเหลือ|ช่วยด้วย|แนะนำวิธีใช้|คำสั่ง)$/u.test(normalized) ||
    normalized === 'help' ||
    normalized === 'guide' ||
    normalized === 'manual' ||
    normalized === 'menu' ||
    normalized === 'info'
  );
}

/**
 * Deterministically checks if input text is a Recent Transactions request.
 */
function isRecentTransactionsCommand(text: string): boolean {
  if (/\d/.test(text)) return false;
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
  return (
    /^(ประวัติรายการ|รายการล่าสุด|ประวัติการจด|ดูรายการล่าสุด|ประวัติ)$/u.test(normalized) ||
    normalized === 'recent' ||
    normalized === 'history'
  );
}

/**
 * Deterministically checks if input text is an Export CSV request.
 */
function isExportCsvCommand(text: string): boolean {
  if (/\d/.test(text)) return false;
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
  return (
    /^(exportcsv|csv|export|ส่งออกcsv|ดาวน์โหลดcsv)$/u.test(normalized) ||
    normalized.includes('exportcsv')
  );
}

/**
 * Deterministically checks if input text is a Donate / Support request.
 */
function isDonateCommand(text: string): boolean {
  if (/\d/.test(text)) return false;
  const normalized = text.toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
  return (
    /^(โดเนท|บริจาค|สนับสนุน|donate|support|tip)$/u.test(normalized) ||
    normalized.includes('โดเนท')
  );
}

/**
 * Handles incoming LINE text message events.
 * 1. Checks if user is in an active edit conversation state (draft or confirmed transaction).
 * 2. Checks if user sent a management command (e.g. "ขอแก้ไขรายการ", "ขอลบรายการ", with or without emojis).
 * 3. Otherwise, checks financial intent and extracts transactions via AI.
 * 4. Responds with friendly greeting if input is non-financial (no 0-baht draft).
 */
export async function handleTextMessage(
  lineUserId: string,
  text: string,
  replyToken: string | undefined,
  lineClient: messagingApi.MessagingApiClient,
  referenceDate?: string
): Promise<void> {
  try {
    const trimmedText = text.trim();

    // 0. Upcoming Navigation Commands (Export CSV M14, Donate)
    // Read-only, informative messages, executed before user lookup/state
    if (isExportCsvCommand(trimmedText)) {
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: buildComingSoonExportCsvText(),
            },
          ],
        });
      }
      return;
    }

    if (isDonateCommand(trimmedText)) {
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: buildComingSoonDonateText(),
            },
          ],
        });
      }
      return;
    }

    // 1. Security FAQ is intentionally handled before user lookup/state.
    // This keeps the FAQ route read-only even for a first-time LINE user.
    const securityFaqTopic = classifySecurityFaqIntent(trimmedText);
    if (securityFaqTopic) {
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
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

    // 2. Ensure user exists for stateful/query/write paths
    const user = await UserRepository.findOrCreateByLineUserId(lineUserId);

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
        const parsedDate = parseNaturalThaiDate(trimmedText);
        if (!parsedDate) {
          if (replyToken) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '⚠️ ผมยังไม่เข้าใจวันที่ครับ ลองพิมพ์แบบที่สะดวกได้เลย เช่น วันนี้, เมื่อวาน, 17/8, 17 สิงหาคม หรือ 17/8/2569',
                },
              ],
            });
          }
          return;
        }
        pendingEdits.occurred_at = parsedDate;
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
        const parsedDate = parseNaturalThaiDate(trimmedText);
        if (!parsedDate) {
          if (replyToken) {
            await lineClient.replyMessage({
              replyToken,
              messages: [
                {
                  type: 'text',
                  text: '⚠️ ผมยังไม่เข้าใจวันที่ครับ ลองพิมพ์แบบที่สะดวกได้เลย เช่น วันนี้, เมื่อวาน, 17/8, 17 สิงหาคม หรือ 17/8/2569',
                },
              ],
            });
          }
          return;
        }
        updatedExtractedData.occurred_at = parsedDate;
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

    // 3. Command Intent Checks (Supports emojis like ✏️, 🗑️, ❌, and natural variants)
    if (isEditCommand(trimmedText)) {
      // 3A. Check if user has an active pending draft first
      const pendingDraft = await DraftRepository.findLatestPendingByUser(user.id);
      if (pendingDraft) {
        ConversationService.setState(user.id, {
          targetType: 'draft',
          draftId: pendingDraft.id,
          step: 'select_field',
        });

        if (replyToken) {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: 'ต้องการแก้ไขข้อมูลส่วนไหนของรายการที่รอยืนยันครับ?',
                quickReply: {
                  items: [
                    {
                      type: 'action',
                      action: {
                        type: 'postback',
                        label: 'จำนวนเงิน',
                        data: `action=set_field&field=amount&draft_id=${pendingDraft.id}`,
                        displayText: 'แก้ไข: จำนวนเงิน',
                      },
                    },
                    {
                      type: 'action',
                      action: {
                        type: 'postback',
                        label: 'หมวดหมู่',
                        data: `action=set_field&field=category&draft_id=${pendingDraft.id}`,
                        displayText: 'แก้ไข: หมวดหมู่',
                      },
                    },
                    {
                      type: 'action',
                      action: {
                        type: 'postback',
                        label: 'วันที่',
                        data: `action=set_field&field=date&draft_id=${pendingDraft.id}`,
                        displayText: 'แก้ไข: วันที่',
                      },
                    },
                    {
                      type: 'action',
                      action: {
                        type: 'postback',
                        label: 'รายละเอียด',
                        data: `action=set_field&field=description&draft_id=${pendingDraft.id}`,
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

      // 3B. Otherwise, find recent active confirmed transactions
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

    if (isVoidCommand(trimmedText)) {
      // 3C. Check if user has an active pending draft first -> Cancel it
      const pendingDraft = await DraftRepository.findLatestPendingByUser(user.id);
      if (pendingDraft) {
        await DraftRepository.cancelDraft(pendingDraft.id, user.id);
        ConversationService.clearState(user.id);

        if (replyToken) {
          await lineClient.replyMessage({
            replyToken,
            messages: [
              {
                type: 'text',
                text: '🗑️ ยกเลิกรายการที่รอยืนยันแล้วครับ',
              },
            ],
          });
        }
        return;
      }

      // 3D. Otherwise, find recent active confirmed transactions to void
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

    // 3A. Start Record Command (Conversational Guide)
    if (isStartRecordCommand(trimmedText)) {
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: buildStartRecordGuideText(),
            },
          ],
        });
      }
      return;
    }

    // 3B. Help & Guide Command
    if (isHelpGuideCommand(trimmedText)) {
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: buildHelpGuideText(),
            },
          ],
        });
      }
      return;
    }

    // 3C. Recent Transactions Command (Read-only)
    if (isRecentTransactionsCommand(trimmedText)) {
      const recentTxs = await TransactionRepository.findRecentByUser(user.id, 5);
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: buildRecentTransactionsText(recentTxs),
            },
          ],
        });
      }
      return;
    }

    // 3D. Quick Summary Menu Command (Q6 UX)
    if (isSummaryMenuCommand(trimmedText)) {
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: '📊 เลือกช่วงเวลาหรือหมวดหมู่ที่ต้องการดูสรุปได้เลยครับ หรือพิมพ์คำถามที่ต้องการถามได้ทันที ✨',
              quickReply: buildQuickSummaryQuickReply(),
            },
          ],
        });
      }
      return;
    }

    // 3E. Slip / Image Upload Entrypoint Command (Q6 UX)
    if (isSlipUploadMenuCommand(trimmedText)) {
      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [
            {
              type: 'text',
              text: '📷 คุณสามารถถ่ายรูปหรือเลือกภาพสลิป/ใบเสร็จจากอัลบั้มเพื่อส่งให้จดตังได้เลยครับ ✨',
              quickReply: buildSlipUploadQuickReply(),
            },
          ],
        });
      }
      return;
    }

    // 4. Timezone-aware Reference Date (Asia/Bangkok)
    const currentDate = referenceDate ?? new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    // 5. Query Flow: READ-ONLY Intent Classification -> Engine -> Formatter
    const queryIntent = await parseQueryIntent(trimmedText, currentDate);

    if (queryIntent) {
      const queryResult = await QueryEngineService.executeQuery(user.id, queryIntent, currentDate);
      const formattedReply = formatQueryResult(queryResult);

      if (replyToken) {
        await lineClient.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: formattedReply }],
        });
      }
      return;
    }

    // 6. Write Path: AI Extraction for new transactions
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
