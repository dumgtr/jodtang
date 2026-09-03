/**
 * Local QR Router Interfaces & Taxonomy
 *
 * Locked Taxonomy per STEP 2 Specification & Threat Model v2.0.0:
 * 1. BANK_SLIP_QR: "QR payload structurally eligible for Slip2Go verification"
 *    (Does NOT mean the slip is genuine or financially verified)
 * 2. NON_BANK_QR: Non-bank payment / bill / URL / generic QR
 * 3. NO_QR: Zero QR matrix detected
 * 4. UNREADABLE_QR (or QR_DECODE_ERROR): QR matrix detected but cannot be decoded
 * 5. AMBIGUOUS: Multiple conflicting QRs or contradictory signals
 */

export type QrRoutingCategory =
  | 'BANK_SLIP_QR'
  | 'NON_BANK_QR'
  | 'NO_QR'
  | 'UNREADABLE_QR'
  | 'AMBIGUOUS';

export type NonBankQrType =
  | 'PROMPTPAY_PAYMENT' // Tag 29 AID A000000677010111
  | 'BILL_PAYMENT'      // Tag 30 AID A000000677010112
  | 'URL'               // http:// or https://
  | 'GENERIC';          // Other decodable text / barcode / non-bank payload

export interface BankSlipQrPayload {
  /** 3-digit BOT bank code (e.g. '004' KBANK, '006' KTB, '014' SCB) */
  sendingBank: string;

  /** Bank transaction reference (alphanumeric, 10-35 chars) */
  transRef: string;

  /** Complete decoded raw payload */
  rawPayload: string;
}

export interface NonBankQrPayload {
  qrType: NonBankQrType;
  rawPayload: string;
  aid?: string;
  url?: string;
}

export interface QrClassificationResult {
  /** Normalized routing category */
  category: QrRoutingCategory;

  /** Extracted structured slip data if category is BANK_SLIP_QR */
  bankSlipData?: BankSlipQrPayload;

  /** Extracted non-bank payload details if category is NON_BANK_QR */
  nonBankData?: NonBankQrPayload;

  /** Decoded raw string payload if decodable */
  rawPayload?: string;

  /** Routing confidence level */
  confidence: 'HIGH' | 'LOW';

  /** Local processing latency in milliseconds */
  processingTimeMs: number;

  /** Human-readable explanation or rejection rationale */
  reason?: string;
}

export interface ILocalQrRouter {
  /**
   * Classify an in-memory image buffer.
   * Pure in-memory execution, 0 external network requests, 0 Slip2Go quota.
   */
  classifyImage(imageBuffer: Buffer, contentType?: string): Promise<QrClassificationResult>;

  /**
   * Classify an already decoded raw QR string payload.
   * Useful for fast paths, mocks, and unit testing.
   */
  classifyPayload(rawPayload: string): QrClassificationResult;
}
