import { parseCleanAmount } from '../../services/ai.service';
import { isValidPositiveAmount } from '../../utils/amount';

export interface ParsedReceiptFields {
  merchant: string;
  amount: number;
  occurredAt: string;
  receiptNumber?: string;
  sanitizedRawText: string;
}

/**
 * Strips sensitive payment card PANs and Thai national IDs from text.
 */
export function sanitizeReceiptText(rawText: string): string {
  return rawText
    // Mask 13-digit Thai National ID numbers (1-XXXX-XXXXX-XX-X)
    .replace(/\b\d{1}-\d{4}-\d{5}-\d{2}-\d{1}\b/g, '*-****-*****-**-*')
    // Mask 16-digit credit card patterns
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
      const digitsOnly = match.replace(/[\s-]/g, '');
      if (digitsOnly.length >= 13 && digitsOnly.length <= 19) {
        return '****-****-****-****';
      }
      return match;
    })
    // Mask card patterns with X or *
    .replace(/\b[xX\*]{4,}[-\s]?[xX\*0-9]{4,}[-\s]?[xX\*0-9]{4,}\b/g, '****-****-****-****');
}

/**
 * Extracts monetary amount deterministically from receipt text using standard Thai/English receipt keywords.
 */
export function extractReceiptAmount(text: string): number {
  // Normalize markdown bold/italic formatting, HTML table tags, and markdown table delimiters
  const normalizedText = text
    .replace(/<\/?(?:td|tr|table|tbody|th)[^>]*>/gi, ' ')
    .replace(/\*{1,3}/g, '')
    .replace(/\|/g, ' ');

  const lines = normalizedText.split('\n').map((l) => l.trim()).filter(Boolean);

  const priorityTotalPatterns = [
    // Dedicated strict pattern for completed payment settlement (e.g. e-Wallet / G-Wallet / Bill payment)
    /(?:จำนวนเงินที่ชำระ)\s*[:\s=]?\s*฿?\s*([0-9,]+(?:\.[0-9]{2})?)(?:\s*(?:บาท|THB))?/i,
    /(?:ยอดรวมทั้งสิ้น|รวมเงินทั้งสิ้น|จำนวนเงินทั้งสิ้น|ยอดสุทธิ|รวมสุทธิ|จำนวนเงินที่ชำระ|ยอดชำระ|Grand\s*Total|Net\s*Total|Total\s*Amount|Amount\s*Due)\s*[:\s=]?\s*฿?\s*([0-9,]+\.[0-9]{2})/i,
    /(?:ยอดรวมทั้งสิ้น|รวมเงินทั้งสิ้น|จำนวนเงินทั้งสิ้น|ยอดสุทธิ|รวมสุทธิ|จำนวนเงินที่ชำระ|ยอดชำระ|Grand\s*Total|Net\s*Total|Total\s*Amount|Amount\s*Due)\s*[:\s=]?\s*฿?\s*([0-9,]+)(?:\s*(?:บาท|THB))?/i,
    /(?:รวมเงิน|ยอดรวม|Total|จำนวนเงิน|ยอดเงิน)\s*[:\s=]?\s*฿?\s*([0-9,]+\.[0-9]{2})/i,
    /(?:รวมเงิน|ยอดรวม|Total|จำนวนเงิน|ยอดเงิน)\s*[:\s=]?\s*฿?\s*([0-9,]+)(?:\s*(?:บาท|THB))/i,
    /([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2})\s*(?:บาท|THB)/i,
  ];

  // Try matching bottom-up since Total is usually at the bottom of receipts
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    for (const pattern of priorityTotalPatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const val = parseCleanAmount(match[1]);
        if (isValidPositiveAmount(val)) {
          return val;
        }
      }
    }
  }

  // Fallback: search across entire text
  for (const pattern of priorityTotalPatterns) {
    const match = normalizedText.match(pattern);
    if (match && match[1]) {
      const val = parseCleanAmount(match[1]);
      if (isValidPositiveAmount(val)) {
        return val;
      }
    }
  }

  return 0;
}

/**
 * Extracts and sanitizes merchant name from receipt text.
 * Strips common receipt headers (e.g. "ใบเสร็จรับเงิน", "TAX INVOICE").
 */
export function extractReceiptMerchant(text: string): string {
  // Check for biller entity / destination recipient first (e-Wallet / Bill Payment)
  const billerMatch = text.match(/(บริษัท\s*บัตรกรุงไทย\s*จำกัด\s*\(มหาชน\)|KTC|การไฟฟ้านครหลวง|การไฟฟ้าส่วนภูมิภาค|การประปานครหลวง|การประปาส่วนภูมิภาค)/i);
  if (billerMatch && billerMatch[1]) {
    return billerMatch[1].trim();
  }

  const destinationMatch = text.match(/(?:↓|ไปยัง:?|ชำระให้:?)\s*(?:\*\*(?:ถุงเงิน|G-Wallet)\*\*\s*)?(?:\*\*)?([^\n*#]{2,40})/i);
  if (destinationMatch && destinationMatch[1]) {
    const candidate = destinationMatch[1].trim();
    if (candidate && !/^(?:อาหาร|ของหวาน|เครื่องดื่ม|ยอด|ค่า)/i.test(candidate)) {
      return candidate;
    }
  }

  const genericHeaders = [
    'ใบเสร็จรับเงิน',
    'ใบกำกับภาษี',
    'ใบกำกับภาษีอย่างย่อ',
    'tax invoice',
    'receipt',
    'tax invoice (abb)',
    'abb',
    'สำเนา',
    'ต้นฉบับ',
    'ยินดีต้อนรับ',
    'welcome',
    'thank you',
    'ขอบคุณที่ใช้บริการ',
    'เป๋าตัง',
    'g-wallet',
    'ไทยช่วยไทย',
    'แพ็คช่วยไทย',
    'krungthai',
    'กรุงไทย',
    'krungthai next',
  ];

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  for (const line of lines.slice(0, 5)) {
    const lower = line.toLowerCase();
    const isGenericHeader = genericHeaders.some(
      (h) => lower === h || lower.startsWith(h) || lower.endsWith(h)
    );

    const isAmountOrDateLine =
      /^(?:ยอดรวม|ยอดสุทธิ|รวมเงิน|รวมทั้งสิ้น|รวมสุทธิ|จำนวนเงินทั้งสิ้น|ยอดชำระ|จำนวนเงิน|total|grand total|net total|amount due|cash|change|เงินทอน|เงินสด)/i.test(
        lower
      ) ||
      /\d+[\/\.\-]\d+[\/\.\-]\d+/.test(lower) ||
      /^[0-9,.\s฿]+(?:บาท|thb)?$/i.test(lower);

    if (!isGenericHeader && !isAmountOrDateLine && line.length >= 2 && !/^\d+$/.test(line)) {
      // Clean leading/trailing punctuation
      const cleaned = line.replace(/^[\s\-_#*]+|[\s\-_#*]+$/g, '').trim();
      if (cleaned.length > 1) {
        return cleaned;
      }
    }
  }

  return 'ร้านค้า/ผู้รับเงิน';
}

/**
 * Extracts receipt reference/tax number if present.
 */
export function extractReceiptNumber(text: string): string | undefined {
  const patterns = [
    /(?:เลขที่ใบเสร็จ|เลขที่|ใบเสร็จเลขที่|Receipt\s*No\.?|Bill\s*No\.?|Tax\s*Inv\.?|INV\s*No\.?)\s*[:\s#]?\s*([a-zA-Z0-9\-_/]{4,25})/i,
    /(?:POS\s*#|INV#)\s*([a-zA-Z0-9\-_/]{4,25})/i,
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) {
      return m[1].trim();
    }
  }

  return undefined;
}

/**
 * Extracts transaction date from receipt, supporting Buddhist Era years.
 */
export function extractReceiptDate(text: string, defaultDate: Date = new Date()): string {
  // 1. DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = text.match(/\b(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})\b/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10) - 1;
    let year = parseInt(dmyMatch[3], 10);

    // Convert Buddhist Era (e.g. 2567 -> 2024, 67 -> 2024)
    if (year >= 2500 && year <= 2600) {
      year -= 543;
    } else if (year >= 60 && year <= 99) {
      year = year + 2500 - 543;
    } else if (year < 100) {
      year = year + 2000;
    }

    // Time: HH:mm[:ss]
    const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
    const hour = timeMatch ? parseInt(timeMatch[1], 10) : defaultDate.getHours();
    const minute = timeMatch ? parseInt(timeMatch[2], 10) : defaultDate.getMinutes();

    const d = new Date(Date.UTC(year, month, day, hour - 7, minute)); // Offset Bangkok UTC+7
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  }

  return defaultDate.toISOString();
}

/**
 * Full deterministic pipeline to extract structured fields from receipt OCR raw text.
 */
export function parseReceiptRawText(rawText: string): ParsedReceiptFields {
  const sanitizedRawText = sanitizeReceiptText(rawText || '');
  const amount = extractReceiptAmount(sanitizedRawText);
  const merchant = extractReceiptMerchant(sanitizedRawText);
  const occurredAt = extractReceiptDate(sanitizedRawText);
  const receiptNumber = extractReceiptNumber(sanitizedRawText);

  return {
    merchant,
    amount,
    occurredAt,
    receiptNumber,
    sanitizedRawText,
  };
}
