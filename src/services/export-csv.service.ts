import crypto from 'node:crypto';
import { env } from '../config/env';
import type { Transaction } from '../types/database';

export const EXPORT_TOKEN_TTL_MS = 15 * 60 * 1000;

const CSV_HEADERS = [
  'transaction_id',
  'type',
  'amount',
  'category',
  'merchant',
  'account',
  'description',
  'status',
  'occurred_at',
  'created_at',
  'updated_at',
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
        tx.id,
        tx.type,
        formatAmount(tx.amount),
        tx.category_id,
        tx.merchant_id,
        tx.account_id,
        tx.description,
        tx.status,
        formatDate(tx.occurred_at),
        formatDate(tx.created_at),
        formatDate(tx.updated_at),
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
  return `${baseUrl}/exports/transactions.csv?token=${encodeURIComponent(token)}`;
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
