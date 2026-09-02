import { env } from '../../../config/env';
import {
  IReceiptOcrProvider,
  NormalizedReceiptResult,
} from '../receipt-provider.interface';
import { parseReceiptRawText } from '../receipt-parser.util';
import { logInternalError } from '../../../utils/errors';

export interface TyphoonOcrAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Extracts raw text from Typhoon OCR response defensively.
 * Supports:
 * 1. results[] with message.choices[0].message.content
 * 2. choices[] directly on top-level
 * 3. JSON string with natural_text
 * 4. Raw text / Markdown
 * 5. Multiple pages concatenated deterministically
 */
export function extractTextFromTyphoonResponse(responseJson: any): string {
  if (!responseJson || typeof responseJson !== 'object') {
    return '';
  }

  const pages: string[] = [];

  // Determine candidate item array: results[] or [responseJson]
  const items: any[] = Array.isArray(responseJson.results)
    ? responseJson.results
    : [responseJson];

  for (const item of items) {
    if (!item) continue;

    let content: any = null;

    // Check message.choices[0].message.content
    if (item.message?.choices?.[0]?.message?.content !== undefined) {
      content = item.message.choices[0].message.content;
    } else if (item.choices?.[0]?.message?.content !== undefined) {
      // Check choices[0].message.content
      content = item.choices[0].message.content;
    } else if (item.message?.content !== undefined) {
      // Check message.content
      content = item.message.content;
    } else if (typeof item.content === 'string') {
      // Check direct content
      content = item.content;
    }

    if (!content || typeof content !== 'string') {
      continue;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      continue;
    }

    // Attempt to parse JSON content for natural_text
    let extractedText = trimmed;
    try {
      const parsedJson = JSON.parse(trimmed);
      if (parsedJson && typeof parsedJson === 'object') {
        if (typeof parsedJson.natural_text === 'string' && parsedJson.natural_text.trim()) {
          extractedText = parsedJson.natural_text.trim();
        } else if (typeof parsedJson.naturalText === 'string' && parsedJson.naturalText.trim()) {
          extractedText = parsedJson.naturalText.trim();
        } else if (typeof parsedJson.text === 'string' && parsedJson.text.trim()) {
          extractedText = parsedJson.text.trim();
        }
      }
    } catch {
      // Not a JSON string, use content directly as text / Markdown
    }

    if (extractedText) {
      pages.push(extractedText);
    }
  }

  return pages.join('\n\n').trim();
}

/**
 * Typhoon OCR 1.5 Provider Adapter
 * Connects to https://api.opentyphoon.ai/v1/ocr via multipart/form-data
 */
export class TyphoonOcrAdapter implements IReceiptOcrProvider {
  public readonly name = 'typhoon-ocr';

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options?: TyphoonOcrAdapterOptions) {
    this.apiKey = options && 'apiKey' in options ? options.apiKey : env.TYPHOON_API_KEY;
    this.baseUrl = options?.baseUrl ?? env.TYPHOON_BASE_URL ?? 'https://api.opentyphoon.ai/v1';
    this.fetchFn = options?.fetchFn ?? fetch;
    this.timeoutMs = options?.timeoutMs ?? 8000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async extractReceipt(
    imageBuffer: Buffer,
    contentType: string = 'image/jpeg'
  ): Promise<NormalizedReceiptResult> {
    if (!this.isConfigured()) {
      return {
        status: 'PROVIDER_ERROR',
        errorMessage: 'TYPHOON_API_KEY_MISSING',
      };
    }

    const url = `${this.baseUrl.replace(/\/+$/, '')}/ocr`;
    console.log('[ReceiptOCR] receipt_ocr_started', { provider: this.name });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const blob = new Blob([new Uint8Array(imageBuffer)], { type: contentType });
      const form = new FormData();
      form.append('file', blob, 'receipt.jpg');
      form.append('model', 'typhoon-ocr');
      form.append('task_type', 'default');
      form.append('max_tokens', '16384');
      form.append('temperature', '0.1');
      form.append('top_p', '0.6');
      form.append('repetition_penalty', '1.2');

      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[ReceiptOCR] receipt_ocr_failure', {
          provider: this.name,
          httpStatus: response.status,
        });
        return {
          status: 'PROVIDER_ERROR',
          errorMessage: `TYPHOON_HTTP_${response.status}`,
        };
      }

      const responseText = await response.text();
      let responseJson: any;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        console.warn('[ReceiptOCR] receipt_ocr_failure', {
          provider: this.name,
          error: 'MALFORMED_JSON_RESPONSE',
        });
        return {
          status: 'PROVIDER_ERROR',
          errorMessage: 'MALFORMED_JSON_RESPONSE',
        };
      }

      const extractedText = extractTextFromTyphoonResponse(responseJson);
      if (!extractedText || extractedText.trim().length === 0) {
        console.warn('[ReceiptOCR] receipt_ocr_failure', {
          provider: this.name,
          error: 'EMPTY_OCR_RESULT',
        });
        return {
          status: 'UNREADABLE',
          errorMessage: 'EMPTY_OCR_RESULT',
        };
      }

      console.log('[ReceiptOCR] receipt_ocr_success', {
        provider: this.name,
        charCount: extractedText.length,
      });

      // Parse fields using deterministic receipt parser
      const parsed = parseReceiptRawText(extractedText);

      return {
        status: 'SUCCESS',
        data: {
          merchant: parsed.merchant,
          amount: parsed.amount,
          occurredAt: parsed.occurredAt,
          confidence: 0.9,
          receiptNumber: parsed.receiptNumber,
          rawText: parsed.sanitizedRawText,
        },
      };
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error?.name === 'AbortError' || controller.signal.aborted) {
        console.error('[ReceiptOCR] receipt_ocr_timeout', { provider: this.name });
        return {
          status: 'TIMEOUT',
          errorMessage: 'TYPHOON_TIMEOUT',
        };
      }

      logInternalError('[ReceiptOCR] Provider request failed', {
        provider: this.name,
        errorName: error?.name,
        errorMessage: error?.message,
      });

      return {
        status: 'PROVIDER_ERROR',
        errorMessage: 'NETWORK_ERROR',
      };
    }
  }
}
