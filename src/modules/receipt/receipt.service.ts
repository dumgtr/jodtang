import {
  IReceiptOcrProvider,
  NormalizedReceiptResult,
} from './receipt-provider.interface';
import { createReceiptProvider } from './receipt-provider.factory';
import { MockReceiptAdapter } from './providers/mock-receipt.adapter';
import { DraftRepository } from '../draft/draft.repository';
import { TransactionDraft } from '../../types/database';
import { resolveSlipCategory } from '../slip/slip.service';
import { isValidPositiveAmount } from '../../utils/amount';
import { logInternalError } from '../../utils/errors';

export interface ProcessReceiptSuccess {
  success: true;
  draft: TransactionDraft;
  receiptData: {
    amount: number;
    merchant: string;
    category: string;
    occurredAt: string;
    receiptNumber?: string;
  };
}

export interface ProcessReceiptFailure {
  success: false;
  reason:
    | 'NOT_CONFIGURED'
    | 'UNREADABLE'
    | 'MISSING_AMOUNT'
    | 'LOW_CONFIDENCE'
    | 'TIMEOUT'
    | 'PROVIDER_ERROR';
  message: string;
}

export type ProcessReceiptResult = ProcessReceiptSuccess | ProcessReceiptFailure;

export interface ReceiptServiceOptions {
  timeoutMs?: number;
  minConfidence?: number;
}

export class ReceiptService {
  private readonly provider: IReceiptOcrProvider;
  private readonly timeoutMs: number;
  private readonly minConfidence: number;

  constructor(
    provider?: IReceiptOcrProvider,
    options?: ReceiptServiceOptions
  ) {
    this.provider = provider ?? createReceiptProvider();
    this.timeoutMs = options?.timeoutMs ?? 8000;
    this.minConfidence = options?.minConfidence ?? 0.6;
  }

  isConfigured(): boolean {
    return this.provider.isConfigured();
  }

  /**
   * Orchestrator for Receipt OCR Fallback.
   * Extracts data from a receipt image, validates amount, categorizes,
   * and creates a TransactionDraft (status = 'pending_confirmation').
   * 
   * STRICT INVARIANT: Does NOT create a permanent transaction!
   */
  async processReceipt(
    userId: string,
    imageBuffer: Buffer,
    contentType: string = 'image/jpeg'
  ): Promise<ProcessReceiptResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        reason: 'NOT_CONFIGURED',
        message: '📷 ภาพไม่ชัดหรือไม่พบ QR Code บนสลิปครับ กรุณาส่งรูปสลิปที่เห็น QR Code ชัดเจน หรือพิมพ์จดรายการได้เลยครับ ✨',
      };
    }

    try {
      // Execute OCR with hard timeout guard
      const extractionPromise = this.provider.extractReceipt(imageBuffer, contentType);
      const timeoutPromise = new Promise<NormalizedReceiptResult>((_, reject) =>
        setTimeout(() => reject(new Error('RECEIPT_OCR_TIMEOUT')), this.timeoutMs)
      );

      let result: NormalizedReceiptResult;
      try {
        result = await Promise.race([extractionPromise, timeoutPromise]);
      } catch (err: any) {
        if (err?.message === 'RECEIPT_OCR_TIMEOUT') {
          return {
            success: false,
            reason: 'TIMEOUT',
            message: '⏳ ระบบอ่านใบเสร็จใช้เวลานานกว่าปกติ กรุณาลองส่งใหม่อีกครั้ง หรือพิมพ์จดรายการได้เลยครับ ✨',
          };
        }
        throw err;
      }

      if (result.status === 'TIMEOUT') {
        return {
          success: false,
          reason: 'TIMEOUT',
          message: '⏳ ระบบอ่านใบเสร็จใช้เวลานานกว่าปกติ กรุณาลองส่งใหม่อีกครั้ง หรือพิมพ์จดรายการได้เลยครับ ✨',
        };
      }

      if (result.status === 'PROVIDER_ERROR') {
        return {
          success: false,
          reason: 'PROVIDER_ERROR',
          message: '⚠️ ระบบอ่านใบเสร็จขัดข้องชั่วคราว คุณสามารถพิมพ์จดรายการแทนได้เลยครับ ✨',
        };
      }

      if (result.status === 'UNREADABLE' || result.status === 'NOT_RECEIPT' || !result.data) {
        return {
          success: false,
          reason: 'UNREADABLE',
          message: '📷 ภาพใบเสร็จไม่ชัดเจนหรือไม่สามารถอ่านข้อมูลได้ครับ กรุณาถ่ายภาพใหม่อีกครั้ง หรือพิมพ์จดรายการได้เลยครับ ✨',
        };
      }

      const { amount, merchant, occurredAt, confidence, receiptNumber, items } = result.data;

      // 1. Validate monetary amount (strict positive amount invariant)
      if (!isValidPositiveAmount(amount)) {
        return {
          success: false,
          reason: 'MISSING_AMOUNT',
          message: '⚠️ ตรวจพบใบเสร็จแต่ไม่พบยอดรวมที่ชัดเจนครับ กรุณาพิมพ์บอกยอดเงิน หรือถ่ายภาพให้เห็นยอดรวมชัดเจนครับ ✨',
        };
      }

      // 2. Validate confidence threshold
      if (confidence !== undefined && confidence < this.minConfidence) {
        return {
          success: false,
          reason: 'LOW_CONFIDENCE',
          message: '📷 ภาพใบเสร็จไม่ชัดเจนพอที่จะยืนยันข้อมูลได้อย่างถูกต้อง กรุณาถ่ายภาพใหม่อีกครั้ง หรือพิมพ์จดรายการได้เลยครับ ✨',
        };
      }

      const cleanMerchant = (merchant || '').trim() || 'ร้านค้า/ผู้รับเงิน';

      // 3. Resolve canonical category (reuses 10-step decision tree & Person Guard)
      const category = resolveSlipCategory({
        merchantName: cleanMerchant,
        userId,
      });

      // 4. Create TransactionDraft (pending_confirmation)
      const draft = await DraftRepository.createDraft({
        userId,
        source: 'receipt',
        rawInput: `ใบเสร็จ: ${cleanMerchant} ฿${Number(amount).toFixed(2)}`,
        extractedData: {
          type: 'expense',
          amount,
          merchant_id: cleanMerchant,
          category_id: category,
          description: `ใบเสร็จ ${cleanMerchant}`,
          occurred_at: occurredAt || new Date().toISOString(),
          confidence: confidence ?? 0.85,
          ...({
            receiptNumber,
            items,
            ocrProvider: this.provider.name,
          } as any),
        },
        expiresInMinutes: 24 * 60,
      });

      return {
        success: true,
        draft,
        receiptData: {
          amount,
          merchant: cleanMerchant,
          category,
          occurredAt: occurredAt || new Date().toISOString(),
          receiptNumber,
        },
      };
    } catch (error) {
      logInternalError('[ReceiptService] Error processing receipt image', error);
      return {
        success: false,
        reason: 'PROVIDER_ERROR',
        message: '⚠️ ระบบอ่านใบเสร็จขัดข้องชั่วคราว คุณสามารถพิมพ์จดรายการแทนได้เลยครับ ✨',
      };
    }
  }
}
