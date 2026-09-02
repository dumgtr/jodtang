export interface ReceiptItem {
  name: string;
  price?: number;
  quantity?: number;
}

export interface NormalizedReceiptData {
  merchant: string;
  amount: number;
  occurredAt: string; // ISO 8601 string
  confidence: number; // 0.0 - 1.0
  receiptNumber?: string;
  items?: ReceiptItem[];
  rawText?: string;
}

export type ReceiptExtractionStatus =
  | 'SUCCESS'
  | 'NOT_RECEIPT'
  | 'UNREADABLE'
  | 'TIMEOUT'
  | 'PROVIDER_ERROR';

export interface NormalizedReceiptResult {
  status: ReceiptExtractionStatus;
  data?: NormalizedReceiptData;
  errorMessage?: string;
  rawResponse?: any;
}

export interface IReceiptOcrProvider {
  readonly name: string;
  isConfigured(): boolean;
  extractReceipt(
    imageBuffer: Buffer,
    contentType?: string
  ): Promise<NormalizedReceiptResult>;
}
