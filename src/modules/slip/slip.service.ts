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

export interface SlipCategorizationInput {
  merchantName: string;
  senderName?: string;
  rawPayload?: Record<string, any>;
  userId?: string;
}

/**
 * Deterministic, structured-first categorization for verified slips.
 * Strictly adheres to canonical ALLOWED_CATEGORIES (8 categories).
 * Guarantees individual persons are NEVER misclassified as Food & Beverage.
 */
export function resolveSlipCategory(input: string | SlipCategorizationInput): string {
  let merchantName: string;
  let rawPayload: Record<string, any> | undefined;

  if (typeof input === 'string') {
    merchantName = input;
  } else {
    merchantName = input.merchantName;
    rawPayload = input.rawPayload;
  }

  const rawMerchant = (merchantName || '').trim();
  const m = rawMerchant.toLowerCase();

  // Extract structured fields from Slip2Go payload if present
  const receiver = rawPayload?.receiver;
  const proxy = receiver?.proxy;
  const proxyType = typeof proxy?.type === 'string' ? proxy.type.toUpperCase() : '';

  // ----------------------------------------------------
  // 1. BANK / CREDIT CARD / FINANCIAL INSTITUTION GUARD
  // ----------------------------------------------------
  // Must NEVER fall through to "อาหารและเครื่องดื่ม"
  const isFinancial =
    m.includes('ธนาคาร') ||
    m.includes('bank') ||
    m.includes('บัตรเครดิต') ||
    m.includes('credit card') ||
    m.includes('อิออน') ||
    m.includes('aeon') ||
    m.includes('เฟิร์สช้อยส์') ||
    m.includes('first choice') ||
    m.includes('firstchoice') ||
    m.includes('easy buy') ||
    m.includes('อีซี่บาย') ||
    m.includes('ยูเมะพลัส') ||
    m.includes('umay+') ||
    m.includes('umay plus') ||
    m.includes('เมืองไทย แคปปิตอล') ||
    m.includes('เมืองไทยแคปปิตอล') ||
    m.includes('เงินติดล้อ') ||
    m.includes('ศรีสวัสดิ์') ||
    m.includes('หลักทรัพย์') ||
    m.includes('securities') ||
    m.includes('บลจ.') ||
    m.includes('บล.');

  if (isFinancial) {
    if (
      m.includes('บัตรเครดิต') ||
      m.includes('credit card') ||
      m.includes('อิออน') ||
      m.includes('aeon') ||
      m.includes('เฟิร์สช้อยส์') ||
      m.includes('first choice') ||
      m.includes('firstchoice') ||
      m.includes('easy buy') ||
      m.includes('อีซี่บาย') ||
      m.includes('ยูเมะพลัส') ||
      m.includes('umay+') ||
      m.includes('umay plus') ||
      m.includes('เมืองไทย แคปปิตอล') ||
      m.includes('เมืองไทยแคปปิตอล') ||
      m.includes('เงินติดล้อ') ||
      m.includes('ศรีสวัสดิ์') ||
      proxyType === 'BILLERID'
    ) {
      return 'บิล/ค่าใช้จ่าย/สาธารณูปโภค';
    }
    return 'โอนเงิน/ทั่วไป';
  }

  // ----------------------------------------------------
  // 2. INDIVIDUAL PERSON GUARD
  // ----------------------------------------------------
  // Detect personal names and honorifics.
  // Must NOT classify as Food & Beverage just because name contains 'ชา', 'ข้าว', etc.
  const hasPersonTitle =
    /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|พระครู|พระมหา|พระ|สามเณร|ดร\.|dr\.|mr\.|mrs\.|miss|ms\.)(\s+|$)/i.test(rawMerchant) ||
    /(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.|mrs\.|miss|ms\.)\s+/i.test(rawMerchant);

  const isPromptPayCitizenId = proxyType === 'NATID';

  // Check if there are explicit corporate/commercial entity words
  const hasCommercialEntity =
    m.includes('บจก') ||
    m.includes('บริษัท') ||
    m.includes('หจก') ||
    m.includes('บมจ') ||
    m.includes('หสน') ||
    m.includes('ห้างหุ้นส่วน') ||
    m.includes('co.,') ||
    m.includes('ltd') ||
    m.includes('corp') ||
    m.includes('inc') ||
    m.includes('ร้านอาหาร') ||
    m.includes('ภัตตาคาร') ||
    m.includes('cafe') ||
    m.includes('coffee') ||
    m.includes('starbucks') ||
    m.includes('amazon') ||
    m.includes('d.i.y') ||
    m.includes('diy') ||
    m.includes('shop') ||
    m.includes('store') ||
    m.includes('market') ||
    m.includes('thailand') ||
    m.includes('สาขา');

  if ((hasPersonTitle || isPromptPayCitizenId) && !hasCommercialEntity) {
    return 'โอนเงิน/ทั่วไป';
  }

  // ----------------------------------------------------
  // 3. STRUCTURED BILLER / UTILITIES / TELECOM / TAX
  // ----------------------------------------------------
  const isUtilityOrTelecom =
    m.includes('การไฟฟ้า') ||
    m.includes('การประปา') ||
    m.includes('mea') ||
    m.includes('pea') ||
    m.includes('mwa') ||
    m.includes('pwa') ||
    m.includes('กฟน') ||
    m.includes('กฟภ') ||
    m.includes('กปน') ||
    m.includes('กปภ') ||
    m.includes('ais') ||
    m.includes('เอไอเอส') ||
    m.includes('awn') ||
    m.includes('true') ||
    m.includes('ทรู') ||
    m.includes('dtac') ||
    m.includes('ดีแทค') ||
    m.includes('nt telecom') ||
    m.includes('cat telecom') ||
    m.includes('tot') ||
    m.includes('ทีโอที') ||
    m.includes('3bb') ||
    m.includes('triple t') ||
    m.includes('อินเทอร์เน็ต') ||
    m.includes('internet') ||
    m.includes('ภาษี') ||
    m.includes('กรมสรรพากร') ||
    m.includes('สรรพากร') ||
    m.includes('ประกันสังคม') ||
    m.includes('ประกันชีวิต') ||
    m.includes('ประกันภัย') ||
    m.includes('insurance') ||
    m.includes('allianz') ||
    m.includes('aia') ||
    m.includes('fwd') ||
    m.includes('เมืองไทยประกันชีวิต') ||
    m.includes('กรุงเทพประกันชีวิต') ||
    m.includes('ทิพยประกันภัย') ||
    m.includes('วิริยะประกันภัย') ||
    m.includes('สินทรัพย์ประกันภัย');

  if (isUtilityOrTelecom) {
    return 'บิล/ค่าใช้จ่าย/สาธารณูปโภค';
  }

  if (proxyType === 'BILLERID') {
    // If it's a registered Biller, check food/transport first; otherwise bill
    if (
      m.includes('coffee') ||
      m.includes('cafe') ||
      m.includes('starbucks') ||
      m.includes('amazon') ||
      m.includes('kfc') ||
      m.includes('mcdonald')
    ) {
      return 'อาหารและเครื่องดื่ม';
    }
    if (
      m.includes('bts') ||
      m.includes('mrt') ||
      m.includes('ptt') ||
      m.includes('shell') ||
      m.includes('bangchak')
    ) {
      return 'การเดินทาง/ยานพาหนะ';
    }
    return 'บิล/ค่าใช้จ่าย/สาธารณูปโภค';
  }

  // ----------------------------------------------------
  // 4. TRANSPORTATION / VEHICLE / FUEL
  // ----------------------------------------------------
  if (
    m.includes('bts') ||
    m.includes('mrt') ||
    m.includes('grab') ||
    m.includes('bolt') ||
    m.includes('line man taxi') ||
    m.includes('ptt') ||
    m.includes('shell') ||
    m.includes('caltex') ||
    m.includes('bangchak') ||
    m.includes('บางจาก') ||
    m.includes('ปตท') ||
    m.includes('susco') ||
    m.includes('esso') ||
    m.includes('ปั๊ม') ||
    m.includes('การทางพิเศษ') ||
    m.includes('ทางด่วน') ||
    m.includes('easy pass') ||
    m.includes('m-pass') ||
    m.includes('ขนส่ง') ||
    m.includes('สมบัติทัวร์') ||
    m.includes('นครชัยแอร์') ||
    m.includes('airasia') ||
    m.includes('nok air') ||
    m.includes('thai airways') ||
    m.includes('การบินไทย') ||
    m.includes('bangkok airways') ||
    m.includes('vietjet') ||
    m.includes('สายการบิน')
  ) {
    return 'การเดินทาง/ยานพาหนะ';
  }

  // ----------------------------------------------------
  // 5. FOOD & BEVERAGE (VERIFIED BRANDS & SAFE COMPOUNDS)
  // ----------------------------------------------------
  // Only match multi-char compound tokens or known brand entities.
  // Explicitly do NOT match bare single-token words like 'ชา' or 'ร้าน' or 'ข้าว' alone!
  const isFoodAndBeverage =
    m.includes('coffee') ||
    m.includes('cafe') ||
    m.includes('คาเฟ่') ||
    m.includes('กาแฟ') ||
    m.includes('starbucks') ||
    m.includes('amazon') ||
    m.includes('kfc') ||
    m.includes('mcdonald') ||
    m.includes('burger king') ||
    m.includes('pizza') ||
    m.includes('swensen') ||
    m.includes('s&p') ||
    m.includes('mk restaurant') ||
    m.includes(' yayoi ') ||
    m.startsWith('yayoi') ||
    m.includes('bar b q plaza') ||
    m.includes('barbqplaza') ||
    m.includes('shabushi') ||
    m.includes('hachiban') ||
    m.includes('ชาตรามือ') ||
    m.includes('cha tra mue') ||
    m.includes('chatramue') ||
    m.includes('kamu') ||
    m.includes('koi the') ||
    m.includes('bearhouse') ||
    m.includes('mixue') ||
    m.includes('after you') ||
    m.includes('fuku matcha') ||
    m.includes('subway') ||
    m.includes('chester') ||
    m.includes('oishi') ||
    m.includes('ส้มตำ') ||
    m.includes('ข้าวเหนียว') ||
    m.includes('ไก่ย่าง') ||
    m.includes('ลาบ') ||
    m.includes('ผัดไทย') ||
    m.includes('ราดหน้า') ||
    m.includes('กะเพรา') ||
    m.includes('บะหมี่') ||
    m.includes('สเต๊ก') ||
    m.includes('ซูชิ') ||
    m.includes('ราเมน') ||
    m.includes('ปิ้งย่าง') ||
    m.includes('อาหาร') ||
    m.includes('ร้านอาหาร') ||
    m.includes('ภัตตาคาร') ||
    m.includes('ก๋วยเตี๋ยว') ||
    m.includes('ข้าวมันไก่') ||
    m.includes('ข้าวหมูแดง') ||
    m.includes('ข้าวราดแกง') ||
    m.includes('ชาบู') ||
    m.includes('หมูกระทะ') ||
    m.includes('ชานม') ||
    m.includes('ชาเขียว') ||
    m.includes('เบเกอรี่') ||
    m.includes('bakery') ||
    m.includes('restaurant') ||
    m.includes('kitchen') ||
    m.includes('dining');

  if (isFoodAndBeverage) {
    return 'อาหารและเครื่องดื่ม';
  }

  // ----------------------------------------------------
  // 6. SHOPPING / RETAIL / EQUIPMENT
  // ----------------------------------------------------
  if (
    m.includes('shopee') ||
    m.includes('lazada') ||
    m.includes('tiktok shop') ||
    m.includes('lotus') ||
    m.includes('โลตัส') ||
    m.includes('big c') ||
    m.includes('บิ๊กซี') ||
    m.includes('central') ||
    m.includes('เซ็นทรัล') ||
    m.includes('robinson') ||
    m.includes('the mall') ||
    m.includes('เดอะมอลล์') ||
    m.includes('tops') ||
    m.includes('7-eleven') ||
    m.includes('7 eleven') ||
    m.includes('เซเว่น') ||
    m.includes('cj express') ||
    m.includes('cj more') ||
    m.includes('go wholesale') ||
    m.includes('makro') ||
    m.includes('แม็คโคร') ||
    m.includes('watsons') ||
    m.includes('วัตสัน') ||
    m.includes('boots') ||
    m.includes('บู๊ทส์') ||
    m.includes('uniqlo') ||
    m.includes('ยูนิโคล่') ||
    m.includes('decathlon') ||
    m.includes('mr. d.i.y.') ||
    m.includes('mr.diy') ||
    m.includes('homepro') ||
    m.includes('โฮมโปร') ||
    m.includes('ไทวัสดุ') ||
    m.includes('ikea') ||
    m.includes('อิเกีย')
  ) {
    return 'ช้อปปิ้ง/ของใช้/อุปกรณ์';
  }

  // ----------------------------------------------------
  // 7. HEALTH & BEAUTY
  // ----------------------------------------------------
  if (
    m.includes('โรงพยาบาล') ||
    m.includes('คลินิก') ||
    m.includes('clinic') ||
    m.includes('hospital') ||
    m.includes('ร้านขายยา') ||
    m.includes('เภสัช') ||
    m.includes('pharmacy') ||
    m.includes('ทันตกรรม') ||
    m.includes('ทันตแพทย์') ||
    m.includes('dental')
  ) {
    return 'สุขภาพ/ความงาม';
  }

  // ----------------------------------------------------
  // 8. ENTERTAINMENT & SOCIAL
  // ----------------------------------------------------
  if (
    m.includes('major cineplex') ||
    m.includes('sf cinema') ||
    m.includes('cinema') ||
    m.includes('theatre') ||
    m.includes('โรงหนัง') ||
    m.includes('netflix') ||
    m.includes('spotify') ||
    m.includes('youtube') ||
    m.includes('disney') ||
    m.includes('karaoke') ||
    m.includes('คาราโอเกะ') ||
    m.includes('pub') ||
    m.includes(' bar')
  ) {
    return 'ความบันเทิง/สังสรรค์';
  }

  // ----------------------------------------------------
  // 9. CORPORATE / UNCLASSIFIED COMPANY FALLBACK
  // ----------------------------------------------------
  if (
    m.includes('บจก') ||
    m.includes('บริษัท') ||
    m.includes('หจก') ||
    m.includes('บมจ') ||
    m.includes('co., ltd') ||
    m.includes('company')
  ) {
    return 'โอนเงิน/ทั่วไป';
  }

  // ----------------------------------------------------
  // 10. FINAL CANONICAL FALLBACK
  // ----------------------------------------------------
  return 'โอนเงิน/ทั่วไป';
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
    const category = resolveSlipCategory({
      merchantName: merchant,
      senderName,
      rawPayload: verification.data.rawPayload,
      userId,
    });

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
