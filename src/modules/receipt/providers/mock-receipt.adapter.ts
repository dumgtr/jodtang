import {
  IReceiptOcrProvider,
  NormalizedReceiptResult,
} from '../receipt-provider.interface';
import { parseReceiptRawText } from '../receipt-parser.util';

export class MockReceiptAdapter implements IReceiptOcrProvider {
  public readonly name = 'mock-receipt-adapter';
  private configured: boolean = true;
  private nextResult?: NormalizedReceiptResult;
  private nextRawText?: string;
  private delayMs: number = 0;

  constructor(configured: boolean = true) {
    this.configured = configured;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  setConfigured(value: boolean): void {
    this.configured = value;
  }

  setNextResult(result: NormalizedReceiptResult): void {
    this.nextResult = result;
  }

  setNextRawText(rawText: string): void {
    this.nextRawText = rawText;
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  async extractReceipt(
    _imageBuffer: Buffer,
    _contentType: string = 'image/jpeg'
  ): Promise<NormalizedReceiptResult> {
    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.nextResult) {
      const res = this.nextResult;
      this.nextResult = undefined;
      return res;
    }

    if (this.nextRawText !== undefined) {
      const text = this.nextRawText;
      this.nextRawText = undefined;

      const parsed = parseReceiptRawText(text);

      return {
        status: 'SUCCESS',
        data: {
          merchant: parsed.merchant,
          amount: parsed.amount,
          occurredAt: parsed.occurredAt,
          confidence: 0.95,
          receiptNumber: parsed.receiptNumber,
          rawText: parsed.sanitizedRawText,
        },
      };
    }

    // Default mock response: standard 7-Eleven receipt
    return {
      status: 'SUCCESS',
      data: {
        merchant: '7-Eleven',
        amount: 89.0,
        occurredAt: new Date().toISOString(),
        confidence: 0.95,
        receiptNumber: 'POS-00123',
        items: [{ name: 'ขนมปังและนม', price: 89.0, quantity: 1 }],
        rawText: '7-Eleven\nยอดรวม 89.00 บาท',
      },
    };
  }
}
