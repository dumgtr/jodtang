import { env } from '../../config/env';
import { IReceiptOcrProvider } from './receipt-provider.interface';
import { TyphoonOcrAdapter } from './providers/typhoon-ocr.adapter';
import { MockReceiptAdapter } from './providers/mock-receipt.adapter';

/**
 * Factory to instantiate the configured IReceiptOcrProvider.
 * Respects fail-closed RECEIPT_OCR_ENABLED flag by default.
 */
export function createReceiptProvider(providerName?: string): IReceiptOcrProvider {
  if (!env.RECEIPT_OCR_ENABLED) {
    return new MockReceiptAdapter(false);
  }

  const selected = (providerName ?? env.RECEIPT_OCR_PROVIDER ?? 'typhoon').toLowerCase();

  switch (selected) {
    case 'typhoon':
    case 'typhoon-ocr':
      return new TyphoonOcrAdapter();
    case 'mock':
      return new MockReceiptAdapter(true);
    default:
      console.warn(`[ReceiptOCR] Unknown OCR provider "${selected}", defaulting to unconfigured mock.`);
      return new MockReceiptAdapter(false);
  }
}
