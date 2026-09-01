export type SlipVerificationStatus =
  | 'SUCCESS'
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

export interface NormalizedSlipData {
  amount: number;
  occurredAt: string; // ISO 8601 string
  merchant: string;
  senderName?: string;
  transRef: string;
  rawPayload?: Record<string, unknown>;
}

export interface NormalizedSlipResult {
  status: SlipVerificationStatus;
  data?: NormalizedSlipData;
  rawCode?: string | number;
  errorMessage?: string;
}

export interface SlipVerificationOptions {
  checkDuplicate?: boolean;
}

export interface ISlipProvider {
  readonly name: string;
  verifySlipImage(
    imageBuffer: Buffer,
    contentType?: string,
    options?: SlipVerificationOptions
  ): Promise<NormalizedSlipResult>;
}
