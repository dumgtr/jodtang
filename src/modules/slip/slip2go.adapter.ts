import { env } from '../../config/env';
import {
  ISlipProvider,
  NormalizedSlipResult,
  SlipVerificationOptions,
} from './slip-provider.interface';

export interface Slip2GoAdapterConfig {
  secret?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class Slip2GoAdapter implements ISlipProvider {
  readonly name = 'Slip2Go';
  private readonly secret?: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config?: Slip2GoAdapterConfig) {
    this.secret = config && 'secret' in config ? config.secret : env.SLIP2GO_API_SECRET;
    this.baseUrl = (config?.baseUrl ?? env.SLIP2GO_BASE_URL ?? 'https://connect.slip2go.com').replace(/\/+$/, '');
    this.fetchFn = config?.fetchFn ?? fetch;
  }

  async verifySlipImage(
    imageBuffer: Buffer,
    contentType: string = 'image/jpeg',
    options?: SlipVerificationOptions
  ): Promise<NormalizedSlipResult> {
    if (!this.secret) {
      console.warn('[Slip2GoAdapter] SLIP2GO_API_SECRET is not configured.');
      return {
        status: 'PROVIDER_ERROR',
        errorMessage: 'SLIP2GO_API_SECRET_MISSING',
      };
    }

    const checkDuplicate = options?.checkDuplicate ?? true;
    const url = `${this.baseUrl}/api/verify-slip/qr-image/info`;

    try {
      const blob = new Blob([new Uint8Array(imageBuffer)], { type: contentType });
      const form = new FormData();
      form.append('file', blob, 'slip.jpg');
      form.append('payload', JSON.stringify({ checkDuplicate }));

      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secret}`,
        },
        body: form,
      });

      const responseText = await response.text();
      let responseJson: any;

      try {
        responseJson = JSON.parse(responseText);
      } catch {
        console.error('[Slip2GoAdapter] Received non-JSON response from Slip2Go API');
        return {
          status: 'PROVIDER_ERROR',
          errorMessage: 'INVALID_JSON_RESPONSE',
        };
      }

      const code = String(responseJson?.code ?? response.status);
      const message = String(responseJson?.message ?? '');

      // 1. Success (200000)
      if (code === '200000' && responseJson?.data) {
        const d = responseJson.data;
        const amount = typeof d.amount === 'number' ? d.amount : parseFloat(d.amount);
        const transRef = String(d.transRef ?? '');
        const occurredAt = d.dateTime ? new Date(d.dateTime).toISOString() : new Date().toISOString();
        const merchant = d.receiver?.account?.name || d.receiver?.name || 'ร้านค้า/ผู้รับเงิน';
        const senderName = d.sender?.account?.name || d.sender?.name;

        if (!amount || isNaN(amount) || amount <= 0) {
          return {
            status: 'INVALID_IMAGE',
            rawCode: code,
            errorMessage: 'INVALID_AMOUNT_IN_SLIP',
          };
        }

        return {
          status: 'SUCCESS',
          rawCode: code,
          data: {
            amount,
            occurredAt,
            merchant,
            senderName,
            transRef,
            rawPayload: d,
          },
        };
      }

      // 2. Duplicate Slip (400004 or duplicate message)
      if (code === '400004' || message.includes('already been used') || message.includes('สลิปซ้ำ')) {
        return {
          status: 'DUPLICATE',
          rawCode: code,
          errorMessage: message || 'This slip has already been used.',
        };
      }

      // 3. Slip Not Found in Bank System (400001 or not found)
      if (code === '400001' || message.toLowerCase().includes('not found') || message.includes('ไม่พบสลิป')) {
        return {
          status: 'NOT_FOUND',
          rawCode: code,
          errorMessage: message || 'Slip not found in banking system.',
        };
      }

      // 4. Invalid Image / Unreadable QR / Fraudulent slip (400002 / 400003 / 200500)
      if (
        code === '400002' ||
        code === '400003' ||
        code === '200500' ||
        message.toLowerCase().includes('fraud') ||
        message.toLowerCase().includes('unreadable') ||
        message.toLowerCase().includes('qr') ||
        message.includes('ภาพไม่ชัด')
      ) {
        return {
          status: 'INVALID_IMAGE',
          rawCode: code,
          errorMessage: message || 'Cannot decode QR code from slip image or slip is invalid.',
        };
      }

      // 5. Quota / Token Exhausted (400005, 429)
      if (
        code === '400005' ||
        code === '429' ||
        message.toLowerCase().includes('quota') ||
        message.toLowerCase().includes('token') ||
        message.includes('โควต้า')
      ) {
        console.warn('[Slip2GoAdapter] Slip2Go quota exhausted or rate limit hit', { code });
        return {
          status: 'QUOTA_EXCEEDED',
          rawCode: code,
          errorMessage: message || 'Slip2Go quota exhausted.',
        };
      }

      // 6. Authentication Error (401)
      if (response.status === 401 || code === '401') {
        console.error('[Slip2GoAdapter] Authentication failed with Slip2Go (401 Unauthorized)');
        return {
          status: 'PROVIDER_ERROR',
          rawCode: code,
          errorMessage: 'AUTHENTICATION_FAILED',
        };
      }

      // 7. General / Unknown Provider Error
      console.warn('[Slip2GoAdapter] Unhandled response code from Slip2Go', { code, message });
      return {
        status: 'PROVIDER_ERROR',
        rawCode: code,
        errorMessage: message || `Provider returned status ${code}`,
      };
    } catch (error: any) {
      console.error('[Slip2GoAdapter] Network or unexpected error during verification:', error.message);
      return {
        status: 'PROVIDER_ERROR',
        errorMessage: error.message || 'NETWORK_ERROR',
      };
    }
  }
}
