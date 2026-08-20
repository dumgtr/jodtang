import { env } from '../config/env';
import { parseCleanAmount } from './ai.service';
import { isValidPositiveAmount } from '../utils/amount';
import { logInternalError } from '../utils/errors';

export interface ParsedSlipData {
  strategy: 'QR_VERIFICATION' | 'DETERMINISTIC_OCR_REGEX';
  amount: number;
  receiver: string;
  sender?: string;
  transDate: string;
  transRef?: string;
  rawText?: string;
}

/**
 * Reserved service for deterministic parsing of bank transfer slips.
 * Sprint 1 image handling does not invoke this service.
 * Ensures the monetary amount is calculated purely by code/API, NEVER by AI guessing.
 */
export class SlipParserService {
  /**
   * Strategy A: Pluggable Slip Verification API via decoded QR payload.
   */
  static async parseViaQR(qrData: string): Promise<ParsedSlipData | null> {
    if (env.SLIPOK_API_KEY && env.SLIPOK_BRANCH_ID) {
      try {
        console.log('[SlipParser] Calling SlipOK API for reserved slip-processing flow');
        const response = await fetch(`https://api.slipok.com/api/line/apikey/${env.SLIPOK_BRANCH_ID}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-authorization': env.SLIPOK_API_KEY,
          },
          body: JSON.stringify({ data: qrData }),
        });

        if (response.ok) {
          const json = await response.json();
          if (json.success && json.data) {
            const d = json.data;
            const amount = parseCleanAmount(d.amount);
            if (!isValidPositiveAmount(amount)) {
              return null;
            }

            return {
              strategy: 'QR_VERIFICATION',
              amount,
              receiver: d.receiver?.name || d.receiver?.displayName || 'ผู้รับเงิน',
              sender: d.sender?.name || d.sender?.displayName,
              transDate: d.transDate || new Date().toISOString().split('T')[0],
              transRef: d.transRef,
            };
          }
        }
      } catch (error) {
        logInternalError('[SlipParser] SlipOK QR verification failed; returning no verified slip', error);
      }
    }

    return null;
  }

  /**
   * Strategy B: Deterministic Code-Based Regex Parsing from caller-provided text.
   * Numbers and fields are parsed strictly by regular expressions in TypeScript.
   */
  static parseViaDeterministicRegex(rawTranscript: string, currentDate: string): ParsedSlipData {
    // 1. Deterministic Amount Parsing (Matching exact Thai Slip Amount Patterns)
    const amountRegexes = [
      /(?:จำนวนเงิน|ยอดเงิน|ยอดโอน|จำนวน|Amount|Transfer Amount|Total)\s*[:\s]?\s*([0-9,]+\.[0-9]{2})/i,
      /([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\s*(?:บาท|THB|baht)/i,
      /\b([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\b/,
    ];

    let extractedAmount = 0;
    for (const regex of amountRegexes) {
      const match = rawTranscript.match(regex);
      if (match && match[1]) {
        const cleaned = parseCleanAmount(match[1]);
        if (isValidPositiveAmount(cleaned)) {
          extractedAmount = cleaned;
          break;
        }
      }
    }

    // 2. Deterministic Receiver / Payee Parsing (supports Thai titles: พระ, วัด, มูลนิธิ, บจก., etc.)
    const receiverRegexes = [
      /(?:ไปยัง|ผู้รับเงิน|To|ไปยังบัญชี|ชื่อบัญชีผู้รับ|รับเงินโดย|โอนให้)\s*[:\s]?\s*([^\n\r]+)/i,
      /((?:บจก\.|บริษัท|หจก\.|บมจ\.|มูลนิธิ|สมาคม|กองทุน|วัด|พระ|พระครู|นาย|นาง|นางสาว|น\.ส\.|Mr\.|Mrs\.|Miss|Ms\.)\s*[^\n\r]+)/i,
    ];

    let extractedReceiver = 'สลิปโอนเงิน';
    for (const regex of receiverRegexes) {
      const match = rawTranscript.match(regex);
      if (match && match[1]) {
        const cleaned = match[1].replace(/(\d{3}-\d{1}-\d{5}-\d{1}|\d{10,}|\b(xxx-xxx|xxx-xxxx)\b)/gi, '').trim();
        if (cleaned.length > 1) {
          extractedReceiver = cleaned;
          break;
        }
      }
    }

    // 3. Deterministic Date Parsing
    const dateRegexes = [
      /([0-9]{1,2}\s+(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+[0-9]{2,4})/i,
      /([0-9]{4}-[0-9]{2}-[0-9]{2})/,
      /([0-9]{2}\/[0-9]{2}\/[0-9]{2,4})/,
    ];

    let extractedDate = currentDate;
    for (const regex of dateRegexes) {
      const match = rawTranscript.match(regex);
      if (match && match[1]) {
        extractedDate = match[1].trim();
        break;
      }
    }

    return {
      strategy: 'DETERMINISTIC_OCR_REGEX',
      amount: extractedAmount,
      receiver: extractedReceiver,
      transDate: extractedDate,
      rawText: rawTranscript,
    };
  }
}
