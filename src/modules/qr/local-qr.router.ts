import {
  BankSlipQrPayload,
  ILocalQrRouter,
  NonBankQrPayload,
  QrClassificationResult,
  QrRoutingCategory,
} from './qr-router.interface';
import { isAuthorizedBankCode } from './providers.catalog';
import {
  parseTlv,
  parseSubTags,
  findTag,
  validateCrc,
} from './tlv-parser.util';
import { detectAndDecodeQr } from './qr-detector.util';

export class LocalQrRouter implements ILocalQrRouter {
  /**
   * Classify an image buffer in-memory.
   * Pure in-memory execution, 0 external network requests, 0 Slip2Go quota.
   */
  async classifyImage(
    imageBuffer: Buffer,
    _contentType?: string
  ): Promise<QrClassificationResult> {
    const startTime = Date.now();

    if (!imageBuffer || imageBuffer.length === 0) {
      return {
        category: 'NO_QR',
        confidence: 'HIGH',
        processingTimeMs: 0,
        reason: 'EMPTY_IMAGE_BUFFER',
      };
    }

    const detection = await detectAndDecodeQr(imageBuffer);

    if (detection.status === 'NO_QR') {
      return {
        category: 'NO_QR',
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: detection.reason || 'NO_QR_MATRIX_FOUND',
      };
    }

    if (detection.status === 'UNREADABLE_QR') {
      return {
        category: 'UNREADABLE_QR',
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: detection.reason || 'QR_DECODE_ERROR',
      };
    }

    if (detection.status === 'MULTIPLE_QR') {
      return {
        category: 'AMBIGUOUS',
        confidence: 'HIGH',
        rawPayload: detection.payloads?.join(' | '),
        processingTimeMs: Date.now() - startTime,
        reason: 'MULTIPLE_DISTINCT_QR_CODES_DETECTED',
      };
    }

    // Single QR decoded successfully: Classify payload structure
    const payloadResult = this.classifyPayload(detection.payload!);
    return {
      ...payloadResult,
      processingTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Classify an already decoded raw QR payload string.
   * Deterministic, pure evaluation.
   */
  classifyPayload(rawPayload: string): QrClassificationResult {
    const startTime = Date.now();

    if (!rawPayload || typeof rawPayload !== 'string' || rawPayload.trim().length === 0) {
      return {
        category: 'NO_QR',
        confidence: 'HIGH',
        processingTimeMs: 0,
        reason: 'EMPTY_PAYLOAD',
      };
    }

    const trimmed = rawPayload.trim();

    // 1. URL Check (Web / Store / Promo QR)
    if (/^https?:\/\//i.test(trimmed)) {
      const nonBankData: NonBankQrPayload = {
        qrType: 'URL',
        rawPayload: trimmed,
        url: trimmed,
      };
      return {
        category: 'NON_BANK_QR',
        nonBankData,
        rawPayload: trimmed,
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: 'URL_PAYLOAD_DETECTED',
      };
    }

    // 2. Parse TLV structure
    const tlv = parseTlv(trimmed);

    // If payload is not valid TLV:
    if (!tlv.success) {
      // Check if it looks like an attempted bank slip or TLV container (e.g. starts with '00' or has '000001')
      if (/^00/i.test(trimmed) || trimmed.includes('000001')) {
        return {
          category: 'UNREADABLE_QR',
          rawPayload: trimmed,
          confidence: 'HIGH',
          processingTimeMs: Date.now() - startTime,
          reason: `MALFORMED_BANK_SLIP_TLV: ${tlv.error}`,
        };
      }

      // Otherwise, generic non-bank payload (e.g. plain text, non-TLV barcode)
      return {
        category: 'NON_BANK_QR',
        nonBankData: {
          qrType: 'GENERIC',
          rawPayload: trimmed,
        },
        rawPayload: trimmed,
        confidence: 'LOW',
        processingTimeMs: Date.now() - startTime,
        reason: 'NON_TLV_GENERIC_PAYLOAD',
      };
    }

    const tags = tlv.tags;

    // 3. Contradictory Evidence Check: Has both Mini-QR Tag 00.00='000001' AND Tag 29/30 Payment AID
    const tag00 = findTag(tags, '00');
    const tag29 = findTag(tags, '29');
    const tag30 = findTag(tags, '30');

    let isMiniQrCandidate = false;
    let isPaymentAidCandidate = false;

    if (tag00) {
      const sub00 = parseSubTags(tag00.value);
      if (sub00 && findTag(sub00, '00')?.value === '000001') {
        isMiniQrCandidate = true;
      }
    }

    if (tag29) {
      const sub29 = parseSubTags(tag29.value);
      const aid29 = sub29 ? findTag(sub29, '00')?.value : undefined;
      if (aid29 === 'A000000677010111') isPaymentAidCandidate = true;
    }

    if (tag30) {
      const sub30 = parseSubTags(tag30.value);
      const aid30 = sub30 ? findTag(sub30, '00')?.value : undefined;
      if (aid30 === 'A000000677010112') isPaymentAidCandidate = true;
    }

    if (isMiniQrCandidate && isPaymentAidCandidate) {
      return {
        category: 'AMBIGUOUS',
        rawPayload: trimmed,
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: 'CONTRADICTORY_SLIP_AND_PAYMENT_SIGNALS_FOUND',
      };
    }

    // 4. Evaluate Thai Interbank Mini-QR Standard (Tag 00, 51, 91)
    if (tag00 && isMiniQrCandidate) {
      return this.evaluateMiniQrCandidate(trimmed, tag00.value, tags, startTime);
    }

    // 5. Evaluate TrueMoney Slip QR
    if (tag00) {
      const subTags = parseSubTags(tag00.value);
      if (
        subTags &&
        findTag(subTags, '00')?.value === '01' &&
        findTag(subTags, '01')?.value === '01'
      ) {
        const txId = findTag(subTags, '03')?.value;
        if (txId && txId.length >= 6) {
          const bankSlipData: BankSlipQrPayload = {
            sendingBank: '04000', // TrueMoney accountType
            transRef: txId,
            rawPayload: trimmed,
          };
          return {
            category: 'BANK_SLIP_QR',
            bankSlipData,
            rawPayload: trimmed,
            confidence: 'HIGH',
            processingTimeMs: Date.now() - startTime,
            reason: 'TRUEMONEY_SLIP_STRUCTURE_ELIGIBLE_FOR_SLIP2GO',
          };
        }
      }
    }

    // 6. Evaluate PromptPay Payment QR (Tag 29 AID A000000677010111)
    if (tag29) {
      const subTags = parseSubTags(tag29.value);
      const aid = subTags ? findTag(subTags, '00')?.value : undefined;
      if (aid === 'A000000677010111') {
        return {
          category: 'NON_BANK_QR',
          nonBankData: {
            qrType: 'PROMPTPAY_PAYMENT',
            aid,
            rawPayload: trimmed,
          },
          rawPayload: trimmed,
          confidence: 'HIGH',
          processingTimeMs: Date.now() - startTime,
          reason: 'PROMPTPAY_PAYMENT_INITIATION_QR_EXCLUDED_FROM_SLIP2GO',
        };
      }
    }

    // 7. Evaluate Domestic Bill Payment QR (Tag 30 AID A000000677010112)
    if (tag30) {
      const subTags = parseSubTags(tag30.value);
      const aid = subTags ? findTag(subTags, '00')?.value : undefined;
      if (aid === 'A000000677010112') {
        return {
          category: 'NON_BANK_QR',
          nonBankData: {
            qrType: 'BILL_PAYMENT',
            aid,
            rawPayload: trimmed,
          },
          rawPayload: trimmed,
          confidence: 'HIGH',
          processingTimeMs: Date.now() - startTime,
          reason: 'BILL_PAYMENT_INITIATION_QR_EXCLUDED_FROM_SLIP2GO',
        };
      }
    }

    // 8. General EMVCo or Merchant Non-Bank QR
    return {
      category: 'NON_BANK_QR',
      nonBankData: {
        qrType: 'GENERIC',
        rawPayload: trimmed,
      },
      rawPayload: trimmed,
      confidence: 'HIGH',
      processingTimeMs: Date.now() - startTime,
      reason: 'GENERIC_NON_SLIP_TLV_PAYLOAD',
    };
  }

  /**
   * Deep validation of a Thai Interbank Slip Verify candidate payload.
   * Strictly enforces Tag 00.00='000001', 3-digit authorized BOT bank, transRef, Tag 51='TH', Tag 91 CRC.
   */
  private evaluateMiniQrCandidate(
    rawPayload: string,
    tag00Value: string,
    topLevelTags: any[],
    startTime: number
  ): QrClassificationResult {
    const subTags = parseSubTags(tag00Value);
    if (!subTags) {
      return {
        category: 'UNREADABLE_QR',
        rawPayload,
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: 'MALFORMED_SUBTAGS_IN_TAG_00',
      };
    }

    const sub00 = findTag(subTags, '00')?.value;
    const sendingBank = findTag(subTags, '01')?.value;
    const transRef = findTag(subTags, '02')?.value;

    // Subtag 00 must be '000001'
    if (sub00 !== '000001') {
      return {
        category: 'NON_BANK_QR',
        rawPayload,
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: `UNSUPPORTED_API_TYPE_${sub00}`,
      };
    }

    // Sending Bank validation
    if (!sendingBank || !isAuthorizedBankCode(sendingBank)) {
      return {
        category: 'NON_BANK_QR',
        rawPayload,
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: `UNSUPPORTED_OR_INVALID_BANK_CODE_${sendingBank}`,
      };
    }

    // Transaction Reference validation
    if (!transRef || transRef.length < 8 || transRef.length > 35) {
      return {
        category: 'UNREADABLE_QR',
        rawPayload,
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: `INVALID_TRANS_REF_LENGTH_${transRef?.length || 0}`,
      };
    }

    // Tag 51 Country Code validation
    const tag51 = findTag(topLevelTags, '51')?.value;
    if (tag51 !== 'TH') {
      return {
        category: 'NON_BANK_QR',
        rawPayload,
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: `INVALID_OR_MISSING_COUNTRY_CODE_${tag51}`,
      };
    }

    // Tag 91 CRC validation
    const tag91 = findTag(topLevelTags, '91');
    if (!tag91 || tag91.value.length !== 4) {
      return {
        category: 'UNREADABLE_QR',
        rawPayload,
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: 'MISSING_OR_MALFORMED_CRC_TAG_91',
      };
    }

    const crcCheck = validateCrc(rawPayload);
    if (!crcCheck.valid) {
      return {
        category: 'UNREADABLE_QR',
        rawPayload,
        confidence: 'HIGH',
        processingTimeMs: Date.now() - startTime,
        reason: `CRC_CHECKSUM_MISMATCH_EXPECTED_${crcCheck.expectedCrc}_ACTUAL_${crcCheck.actualCrc}`,
      };
    }

    // All structural criteria satisfied: Classify as BANK_SLIP_QR
    const bankSlipData: BankSlipQrPayload = {
      sendingBank,
      transRef,
      rawPayload,
    };

    return {
      category: 'BANK_SLIP_QR',
      bankSlipData,
      rawPayload,
      confidence: 'HIGH',
      processingTimeMs: Date.now() - startTime,
      reason: 'STRUCTURALLY_ELIGIBLE_FOR_SLIP2GO_VERIFICATION',
    };
  }
}
