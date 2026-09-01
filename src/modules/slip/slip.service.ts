import { query } from '../../db/client';
import { DraftRepository } from '../draft/draft.repository';
import { TransactionDraft } from '../../types/database';
import { ISlipProvider, NormalizedSlipResult } from './slip-provider.interface';
import { Slip2GoAdapter } from './slip2go.adapter';

export interface ProcessSlipSuccess {
  success: true;
  draft: TransactionDraft;
  slipData: {
    amount: number;
    merchant: string;
    category: string;
    transRef: string;
    occurredAt: string;
    senderName?: string;
  };
}

export interface ProcessSlipFailure {
  success: false;
  reason:
    | 'DUPLICATE'
    | 'NOT_FOUND'
    | 'INVALID_IMAGE'
    | 'FRAUD'
    | 'RECIPIENT_MISMATCH'
    | 'AMOUNT_MISMATCH'
    | 'DATE_MISMATCH'
    | 'BANK_ERROR'
    | 'TEMPORARY_CONFLICT'
    | 'QUEUED'
    | 'QUOTA_EXCEEDED'
    | 'PROVIDER_ERROR';
  message: string;
}

export type ProcessSlipResult = ProcessSlipSuccess | ProcessSlipFailure;

export function resolveSlipCategory(merchantName: string): string {
  const m = merchantName.toLowerCase();

  if (
    m.includes('coffee') ||
    m.includes('cafe') ||
    m.includes('starbucks') ||
    m.includes('amazon') ||
    m.includes('อาหาร') ||
    m.includes('ร้าน') ||
    m.includes('ข้าว') ||
    m.includes('ก๋วยเตี๋ยว') ||
    m.includes('ชา') ||
    m.includes('เบเกอรี่') ||
    m.includes('kfc') ||
    m.includes('mcdonald') ||
    m.includes('swensen')
  ) {
    return 'อาหารและเครื่องดื่ม';
  }

  if (
    m.includes('bts') ||
    m.includes('mrt') ||
    m.includes('grab') ||
    m.includes('bolt') ||
    m.includes('ptt') ||
    m.includes('shell') ||
    m.includes('caltex') ||
    m.includes('bangchak') ||
    m.includes('ปั๊ม') ||
    m.includes('ทางด่วน') ||
    m.includes('ขนส่ง')
  ) {
    return 'การเดินทาง/ยานพาหนะ';
  }

  if (
    m.includes('ไฟฟ้า') ||
    m.includes('ประปา') ||
    m.includes('ais') ||
    m.includes('true') ||
    m.includes('dtac') ||
    m.includes('nt') ||
    m.includes('biller') ||
    m.includes('bill')
  ) {
    return 'บิล/ค่าใช้จ่าย/สาธารณูปโภค';
  }

  if (
    m.includes('shopee') ||
    m.includes('lazada') ||
    m.includes('lotus') ||
    m.includes('big c') ||
    m.includes('central') ||
    m.includes('tops') ||
    m.includes('7-eleven') ||
    m.includes('cj')
  ) {
    return 'ช้อปปิ้ง/ของใช้/อุปกรณ์';
  }

  return 'ทั่วไป';
}

export class SlipService {
  private readonly provider: ISlipProvider;

  constructor(provider?: ISlipProvider) {
    this.provider = provider ?? new Slip2GoAdapter();
  }

  /**
   * Check if this transRef has already been recorded for this user
   * in either pending drafts or confirmed transactions.
   */
  async findDuplicateByTransRef(userId: string, transRef: string): Promise<boolean> {
    if (!transRef || !transRef.trim()) return false;

    // Check drafts
    const draftRes = await query<{ id: string }>(
      `SELECT id FROM transaction_drafts
       WHERE user_id = $1
         AND (extracted_data->>'transRef') = $2
         AND status IN ('pending_confirmation', 'confirmed')
       LIMIT 1;`,
      [userId, transRef.trim()]
    );

    if (draftRes.rowCount && draftRes.rowCount > 0) {
      return true;
    }

    return false;
  }

  /**
   * Core orchestrator: Verify slip image, protect against duplicates, and create a draft.
   * STRICT INVARIANT: Does NOT create a permanent transaction!
   */
  async processSlip(
    userId: string,
    imageBuffer: Buffer,
    contentType: string = 'image/jpeg'
  ): Promise<ProcessSlipResult> {
    const verification: NormalizedSlipResult = await this.provider.verifySlipImage(
      imageBuffer,
      contentType,
      { checkDuplicate: true }
    );

    if (verification.status === 'DUPLICATE') {
      return {
        success: false,
        reason: 'DUPLICATE',
        message: '⚠️ สลิปนี้ถูกตรวจสอบหรือใช้งานไปแล้วครับ\nกรุณาส่งสลิปใบใหม่ครับ',
      };
    }

    if (verification.status === 'FRAUD') {
      return {
        success: false,
        reason: 'FRAUD',
        message: '⚠️ ไม่สามารถยืนยันสลิปนี้ได้ เนื่องจากระบบตรวจพบว่าสลิปไม่ถูกต้องหรืออาจเป็นสลิปปลอมครับ',
      };
    }

    if (verification.status === 'NOT_FOUND') {
      return {
        success: false,
        reason: 'NOT_FOUND',
        message: '⚠️ ไม่พบข้อมูลสลิปนี้ในระบบธนาคารครับ กรุณาตรวจสอบว่าเป็นสลิปที่โอนเงินสำเร็จหรือไม่ หรือพิมพ์บอกรายการแทนได้ครับ ✨',
      };
    }

    if (verification.status === 'RECIPIENT_MISMATCH') {
      return {
        success: false,
        reason: 'RECIPIENT_MISMATCH',
        message: '⚠️ บัญชีผู้รับเงินไม่ตรงตามเงื่อนไขที่กำหนดครับ กรุณาตรวจสอบสลิปอีกครั้งครับ',
      };
    }

    if (verification.status === 'AMOUNT_MISMATCH') {
      return {
        success: false,
        reason: 'AMOUNT_MISMATCH',
        message: '⚠️ ยอดเงินในสลิปไม่ตรงตามเงื่อนไขที่กำหนดครับ กรุณาตรวจสอบสลิปอีกครั้งครับ',
      };
    }

    if (verification.status === 'DATE_MISMATCH') {
      return {
        success: false,
        reason: 'DATE_MISMATCH',
        message: '⚠️ วันที่โอนในสลิปไม่ตรงตามเงื่อนไขที่กำหนดครับ กรุณาตรวจสอบสลิปอีกครั้งครับ',
      };
    }

    if (verification.status === 'BANK_ERROR') {
      return {
        success: false,
        reason: 'BANK_ERROR',
        message: '⚠️ ธนาคารปลายทางขัดข้องชั่วคราว กรุณารอสักครู่แล้วลองส่งใหม่อีกครั้งครับ ✨',
      };
    }

    if (verification.status === 'TEMPORARY_CONFLICT') {
      return {
        success: false,
        reason: 'TEMPORARY_CONFLICT',
        message: '⚠️ ระบบกำลังตรวจสอบรายการหรือมีคำขอซ้อนกัน กรุณารอสักครู่แล้วลองใหม่อีกครั้งครับ ✨',
      };
    }

    if (verification.status === 'QUEUED') {
      return {
        success: false,
        reason: 'QUEUED',
        message: '⏳ ระบบกำลังประมวลผลสลิปของคุณ กรุณารอสักครู่ครับ ✨',
      };
    }

    if (verification.status === 'INVALID_IMAGE') {
      return {
        success: false,
        reason: 'INVALID_IMAGE',
        message: '📷 ภาพไม่ชัดหรือไม่พบ QR Code บนสลิปครับ กรุณาส่งรูปสลิปที่เห็น QR Code ชัดเจน หรือพิมพ์จดรายการได้เลยครับ ✨',
      };
    }

    if (verification.status === 'QUOTA_EXCEEDED') {
      return {
        success: false,
        reason: 'QUOTA_EXCEEDED',
        message: '⚠️ ระบบตรวจสลิปชั่วคราวไม่พร้อมให้บริการ กรุณาพิมพ์จดรายการแทนได้เลยครับ เช่น "กินข้าว 80" ✨',
      };
    }

    if (verification.status !== 'SUCCESS' || !verification.data) {
      return {
        success: false,
        reason: 'PROVIDER_ERROR',
        message: '⚠️ ไม่สามารถเชื่อมต่อระบบตรวจสลิปได้ชั่วคราว กรุณาลองใหม่อีกครั้ง หรือพิมพ์จดรายการได้เลยครับ ✨',
      };
    }

    const { amount, merchant, transRef, occurredAt, senderName } = verification.data;

    // Database-level duplicate protection
    const isDuplicate = await this.findDuplicateByTransRef(userId, transRef);
    if (isDuplicate) {
      return {
        success: false,
        reason: 'DUPLICATE',
        message: `⚠️ สลิปนี้ถูกตรวจสอบหรือใช้งานไปแล้วครับ (รหัสอ้างอิง: ${transRef})`,
      };
    }

    // Resolve category heuristic
    const category = resolveSlipCategory(merchant);

    // Create Draft (pending_confirmation)
    const draft = await DraftRepository.createDraft({
      userId,
      source: 'slip',
      rawInput: `สลิป: ${merchant} ฿${Number(amount).toFixed(2)} (${transRef})`,
      extractedData: {
        type: 'expense',
        amount,
        merchant_id: merchant,
        category_id: category,
        description: `โอนให้ ${merchant}`,
        occurred_at: occurredAt,
        confidence: 1.0,
        ...({
          transRef,
          sender: senderName,
          slipProvider: this.provider.name,
        } as any),
      },
      expiresInMinutes: 24 * 60,
    });

    return {
      success: true,
      draft,
      slipData: {
        amount,
        merchant,
        category,
        transRef,
        occurredAt,
        senderName,
      },
    };
  }
}
