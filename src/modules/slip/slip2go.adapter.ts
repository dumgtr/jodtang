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

      // 1. Success / Valid (200000 / 200200 / 200001)
      if ((code === '200000' || code === '200200' || code === '200001') && responseJson?.data) {
        const d = responseJson.data;
        const amount = typeof d.amount === 'number' ? d.amount : parseFloat(d.amount);
        const transRef = String(d.transRef ?? '');
        const occurredAt = d.dateTime ? new Date(d.dateTime).toISOString() : new Date().toISOString();
        const extractAccountName = (target: any): string => {
          if (!target) return '';
          const val = target.name ?? target;
          if (typeof val === 'string') return val.trim();
          if (typeof val === 'object' && val !== null) {
            const candidate = val.th || val.en || val.displayName || '';
            if (typeof candidate === 'string') return candidate.trim();
          }
          return '';
        };

        const merchant =
          extractAccountName(d.receiver?.account) ||
          extractAccountName(d.receiver) ||
          'ร้านค้า/ผู้รับเงิน';
        const senderName =
          extractAccountName(d.sender?.account) ||
          extractAccountName(d.sender) ||
          undefined;

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

      const lowerMsg = message.toLowerCase();

      // 2. Queued / Processing (200202)
      if (code === '200202' || lowerMsg.includes('queue')) {
        return {
          status: 'QUEUED',
          rawCode: code,
          errorMessage: message || 'Slip is queued for processing.',
        };
      }

      // 3. Duplicate Slip (200501 / 400004 or specific duplicate message)
      if (
        code === '200501' ||
        code === '400004' ||
        lowerMsg.includes('slip is duplicated') ||
        lowerMsg.includes('already been used') ||
        lowerMsg.includes('สลิปซ้ำ') ||
        (lowerMsg.includes('duplicate') && (code.startsWith('200') || code.startsWith('400')))
      ) {
        return {
          status: 'DUPLICATE',
          rawCode: code,
          errorMessage: message || 'This slip has already been used.',
        };
      }

      // 4. Temporary Conflict / Concurrency Rate Lock (400409)
      // Must NOT be mapped to DUPLICATE, FRAUD, or general PROVIDER_ERROR
      if (code === '400409' || lowerMsg.includes('conflicted') || lowerMsg.includes('conflict')) {
        return {
          status: 'TEMPORARY_CONFLICT',
          rawCode: code,
          errorMessage: message || 'Request is conflicted, please retry in a moment.',
        };
      }

      // 5. Slip Not Found in Bank System (200404 / 400001)
      if (
        code === '200404' ||
        code === '400001' ||
        lowerMsg.includes('not found') ||
        lowerMsg.includes('ไม่พบสลิป')
      ) {
        return {
          status: 'NOT_FOUND',
          rawCode: code,
          errorMessage: message || 'Slip not found in banking system.',
        };
      }

      // 6. Recipient Account Not Match (200401)
      if (code === '200401' || lowerMsg.includes('recipient account not match')) {
        return {
          status: 'RECIPIENT_MISMATCH',
          rawCode: code,
          errorMessage: message || 'Recipient account does not match condition.',
        };
      }

      // 7. Transfer Amount Not Match (200402)
      if (code === '200402' || lowerMsg.includes('transfer amount not match')) {
        return {
          status: 'AMOUNT_MISMATCH',
          rawCode: code,
          errorMessage: message || 'Transfer amount does not match condition.',
        };
      }

      // 8. Transfer Date Not Match (200403)
      if (code === '200403' || lowerMsg.includes('transfer date not match')) {
        return {
          status: 'DATE_MISMATCH',
          rawCode: code,
          errorMessage: message || 'Transfer date does not match condition.',
        };
      }

      // 9. Fraudulent Slip (200500)
      if (code === '200500' || lowerMsg.includes('fraud')) {
        return {
          status: 'FRAUD',
          rawCode: code,
          errorMessage: message || 'Slip is fraud or invalid.',
        };
      }

      // 10. Bank Error / Retryable (200502)
      if (code === '200502' || lowerMsg.includes('bank error')) {
        return {
          status: 'BANK_ERROR',
          rawCode: code,
          errorMessage: message || 'Bank system error, please retry.',
        };
      }

      // 11. Invalid Image / Unreadable QR (400002 / 400003)
      if (
        code === '400002' ||
        code === '400003' ||
        lowerMsg.includes('unreadable') ||
        lowerMsg.includes('qr') ||
        lowerMsg.includes('ภาพไม่ชัด')
      ) {
        return {
          status: 'INVALID_IMAGE',
          rawCode: code,
          errorMessage: message || 'Cannot decode QR code from slip image.',
        };
      }

      // 12. Quota / Token Exhausted (400005, 429)
      if (
        code === '400005' ||
        code === '429' ||
        lowerMsg.includes('quota') ||
        lowerMsg.includes('token') ||
        lowerMsg.includes('โควต้า')
      ) {
        console.warn('[Slip2GoAdapter] Slip2Go quota exhausted or rate limit hit', { code });
        return {
          status: 'QUOTA_EXCEEDED',
          rawCode: code,
          errorMessage: message || 'Slip2Go quota exhausted.',
        };
      }

      // 13. Authentication Error (401)
      if (response.status === 401 || code === '401') {
        console.error('[Slip2GoAdapter] Authentication failed with Slip2Go (401 Unauthorized)');
        return {
          status: 'PROVIDER_ERROR',
          rawCode: code,
          errorMessage: 'AUTHENTICATION_FAILED',
        };
      }

      // 14. General / Unknown Provider Error
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

  /**
   * Check account info & verify secret (GET /api/account/info -> code 200001)
   */
  async getAccountInfo(): Promise<{
    status: 'SUCCESS' | 'PROVIDER_ERROR';
    rawCode?: string;
    data?: any;
    errorMessage?: string;
  }> {
    if (!this.secret) {
      return {
        status: 'PROVIDER_ERROR',
        errorMessage: 'SLIP2GO_API_SECRET_MISSING',
      };
    }

    try {
      const response = await this.fetchFn(`${this.baseUrl}/api/account/info`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.secret}`,
        },
      });

      const responseText = await response.text();
      let responseJson: any;

      try {
        responseJson = JSON.parse(responseText);
      } catch {
        return {
          status: 'PROVIDER_ERROR',
          errorMessage: 'INVALID_JSON_RESPONSE',
        };
      }

      const code = String(responseJson?.code ?? response.status);
      const message = String(responseJson?.message ?? '');

      if (code === '200001' && responseJson?.data) {
        return {
          status: 'SUCCESS',
          rawCode: code,
          data: responseJson.data,
        };
      }

      return {
        status: 'PROVIDER_ERROR',
        rawCode: code,
        errorMessage: message || `Provider returned status ${code}`,
      };
    } catch (error: any) {
      return {
        status: 'PROVIDER_ERROR',
        errorMessage: error.message || 'NETWORK_ERROR',
      };
    }
  }
}
