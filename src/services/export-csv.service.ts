import crypto from 'node:crypto';
import { env } from '../config/env';
import type { Transaction } from '../types/database';

export const EXPORT_TOKEN_TTL_MS = 15 * 60 * 1000;

export type ExportCsvIntent = 'EXPORT_CSV';

const EXACT_EXPORT_ALIASES = new Set([
  // Existing deterministic commands and Rich Menu text.
  'csv',
  'exportcsv',
  'ส่งออกcsv',
  'ดาวน์โหลดcsv',
  'ขอexportcsv',
  'ขอcsv',
  'ขอไฟล์csv',
  'ขอส่งออกcsv',
  'exportไฟล์',
  'ดาวน์โหลดไฟล์csv',

  // High-confidence natural-language requests whose action and scope are
  // explicit even without the CSV suffix.
  'ขอไฟล์รายการ',
  'ดาวน์โหลดไฟล์',
  'โหลดไฟล์',
  'ส่งออกรายการ',
  'ส่งออกรายการทั้งหมด',
  'ดาวน์โหลดรายการ',
  'โหลดรายการ',
  'ขอรายการทั้งหมด',
  'ขอข้อมูลทั้งหมด',
  'เอาข้อมูลทั้งหมด',
  'ขอประวัติรายการ',
  'ดาวน์โหลดประวัติรายการ',
  'โหลดประวัติรายการ',
  'downloadfile',
  'exportdata',
  'exporttransactions',
  'downloadtransactions',
  'downloadtransactionhistory',
  'exporttransactionhistory',
  'gettransactionhistory',
]);

function normalizeExportIntentText(text: string): {
  compact: string;
  englishTokens: Set<string>;
} {
  const normalized = text.normalize('NFKC').toLowerCase();
  const englishWords = normalized
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);

  return {
    compact: normalized.replace(/[^a-z0-9\u0E00-\u0E7F]/gu, ''),
    englishTokens: new Set(englishWords),
  };
}

function containsAny(value: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => value.includes(candidate));
}

/**
 * Classifies high-confidence natural-language requests for a CSV export.
 *
 * This intentionally runs without an LLM: command routing must be fast and
 * deterministic before the generic Query/Write pipeline. Contextual matches
 * require both an export/download action and an export object or CSV format;
 * broad words such as "ข้อมูล", "รายการ", "ไฟล์", and "ดาวน์โหลด" do not
 * trigger on their own.
 */
export function classifyExportCsvIntent(text: string): ExportCsvIntent | null {
  if (!text || typeof text !== 'string' || /\p{N}/u.test(text)) return null;

  const { compact: normalized, englishTokens } = normalizeExportIntentText(text);
  if (!normalized) return null;
  if (EXACT_EXPORT_ALIASES.has(normalized)) return 'EXPORT_CSV';

  const hasUploadAction =
    containsAny(normalized, ['อัปโหลด', 'อัพโหลด']) || englishTokens.has('upload');
  const hasThaiDownloadAction =
    normalized.includes('ดาวน์โหลด') ||
    (normalized.includes('โหลด') && !hasUploadAction);
  const hasEnglishDownloadAction = englishTokens.has('download');
  const hasExplicitExportAction = normalized.includes('ส่งออก') || englishTokens.has('export');
  const hasThaiRequestAction =
    normalized.startsWith('ขอ') ||
    normalized.startsWith('เอา') ||
    normalized.startsWith('ช่วยขอ') ||
    normalized.startsWith('ช่วยส่ง') ||
    normalized.includes('อยากได้');
  const hasRequestAction = hasThaiRequestAction || englishTokens.has('get');

  const hasCsvFormat = englishTokens.has('csv');
  const hasFileObject = normalized.includes('ไฟล์') || englishTokens.has('file');
  const hasThaiTransactionObject = containsAny(normalized, ['ประวัติรายการ', 'รายการ']);
  const hasEnglishTransactionObject =
    englishTokens.has('transactions') ||
    englishTokens.has('data') ||
    normalized.includes('transactionhistory');

  // Explicit CSV format plus a request/export action is the strongest signal
  // and supports polite or filler wording around the intent.
  if (
    hasCsvFormat &&
    (hasThaiDownloadAction ||
      hasEnglishDownloadAction ||
      hasExplicitExportAction ||
      hasRequestAction)
  ) {
    return 'EXPORT_CSV';
  }

  // File requests still require a download action, or a request action plus
  // a transaction/data object. "ไฟล์" and "download" alone stay negative.
  if (
    hasFileObject &&
    (hasThaiDownloadAction ||
      hasEnglishDownloadAction ||
      (hasRequestAction &&
        (hasThaiTransactionObject || hasEnglishTransactionObject)))
  ) {
    return 'EXPORT_CSV';
  }

  // Natural requests for transaction/history data without saying CSV.
  if (
    (hasThaiTransactionObject || hasEnglishTransactionObject) &&
    (hasThaiDownloadAction || hasEnglishDownloadAction || hasExplicitExportAction)
  ) {
    return 'EXPORT_CSV';
  }

  return null;
}

/**
 * Backward-compatible boolean command guard used by existing routing code.
 */
export function isExportCsvCommand(text: string): boolean {
  return classifyExportCsvIntent(text) === 'EXPORT_CSV';
}

const CSV_HEADERS = [
  'type',
  'amount',
  'category',
  'merchant',
  'account',
  'description',
  'occurred_at',
] as const;

function base64UrlEncode(value: Buffer): string {
  return value.toString('base64url');
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function exportTokenKey(): Buffer {
  const secret = process.env.EXPORT_TOKEN_SECRET || env.LINE_CHANNEL_SECRET;
  if (!secret) {
    throw new Error('EXPORT_TOKEN_SECRET is not configured.');
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Creates a short-lived opaque export token. The user UUID is encrypted, not
 * exposed in the download URL, and the token is stateless so no export table
 * or Redis dependency is required.
 */
export function createExportToken(userId: string, nowMs: number = Date.now()): string {
  const expiresAt = nowMs + EXPORT_TOKEN_TTL_MS;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', exportTokenKey(), iv);
  const plaintext = JSON.stringify({ userId, expiresAt });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [base64UrlEncode(iv), base64UrlEncode(authTag), base64UrlEncode(ciphertext)].join('.');
}

/**
 * Decrypts and validates an export token. Returns the internal user UUID only
 * when authentication and expiry checks both succeed.
 */
export function verifyExportToken(token: string, nowMs: number = Date.now()): string | null {
  try {
    const [ivPart, tagPart, ciphertextPart] = token.split('.');
    if (!ivPart || !tagPart || !ciphertextPart) return null;

    const decipher = crypto.createDecipheriv('aes-256-gcm', exportTokenKey(), base64UrlDecode(ivPart));
    decipher.setAuthTag(base64UrlDecode(tagPart));
    const plaintext = Buffer.concat([
      decipher.update(base64UrlDecode(ciphertextPart)),
      decipher.final(),
    ]).toString('utf8');
    const payload = JSON.parse(plaintext) as { userId?: unknown; expiresAt?: unknown };

    if (typeof payload.userId !== 'string' || !payload.userId) return null;
    if (typeof payload.expiresAt !== 'number' || !Number.isSafeInteger(payload.expiresAt)) return null;
    if (payload.expiresAt <= nowMs) return null;

    return payload.userId;
  } catch {
    return null;
  }
}

function sanitizeSpreadsheetCell(value: string): string {
  // Defense against CSV/Formula Injection for human spreadsheet consumers.
  // Keep the stored value unchanged in PostgreSQL; only the export gets the
  // protective prefix when a formula-triggering character is first.
  if (/^[=+\-@\t\r\n＝＋－＠]/u.test(value)) {
    return `\t${value}`;
  }
  return value;
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  const normalized = sanitizeSpreadsheetCell(String(value ?? ''));
  return `"${normalized.replaceAll('"', '""')}"`;
}

function formatAmount(amount: string | number): string {
  return Number(amount).toFixed(2);
}

function formatDate(value: Date | string | undefined): string {
  if (!value) return '';
  return new Date(value).toISOString();
}

/**
 * Produces UTF-8 BOM + RFC4180-style quoted CSV so Thai text opens cleanly in
 * spreadsheet applications such as Excel.
 *
 * The export intentionally includes all transaction statuses (including
 * voided) so the user's exported data preserves the database history.
 */
export function buildTransactionsCsv(transactions: Transaction[]): string {
  const rows = [CSV_HEADERS.map((header) => escapeCsvCell(header)).join(',')];

  for (const tx of transactions) {
    rows.push(
      [
        tx.type,
        formatAmount(tx.amount),
        tx.category_id,
        tx.merchant_id,
        tx.account_id,
        tx.description,
        formatDate(tx.occurred_at),
      ].map((value) => escapeCsvCell(value)).join(','),
    );
  }

  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

export function buildExportDownloadUrl(userId: string): string {
  const configuredBase = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
  const baseUrl = configuredBase
    ? configuredBase.replace(/\/+$/u, '')
    : env.NODE_ENV === 'production'
      ? ''
      : `http://localhost:${env.PORT}`;

  if (!baseUrl) {
    throw new Error('PUBLIC_BASE_URL is required for production CSV exports.');
  }

  if (env.NODE_ENV === 'production' && new URL(baseUrl).protocol !== 'https:') {
    throw new Error('PUBLIC_BASE_URL must use HTTPS for production CSV exports.');
  }

  const token = createExportToken(userId);
  return `${baseUrl}/exports/transactions.csv?openExternalBrowser=1&token=${encodeURIComponent(token)}`;
}

export function buildExportCsvFlexMessage(downloadUrl: string, transactionCount: number): Record<string, unknown> {
  return {
    type: 'flex',
    altText: '📥 ดาวน์โหลดรายการเป็น CSV',
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: '📥 Export CSV',
            weight: 'bold',
            size: 'xl',
          },
          {
            type: 'text',
            text: `พบรายการทั้งหมด ${transactionCount.toLocaleString('th-TH')} รายการ`,
            size: 'sm',
            color: '#666666',
            wrap: true,
          },
          {
            type: 'text',
            text: 'ลิงก์ดาวน์โหลดมีอายุ 15 นาที และเข้าถึงได้เฉพาะลิงก์ที่ระบบออกให้สำหรับรายการนี้ครับ',
            size: 'sm',
            color: '#666666',
            wrap: true,
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            action: {
              type: 'uri',
              label: 'ดาวน์โหลด CSV',
              uri: downloadUrl,
            },
          },
        ],
      },
    },
  };
}
