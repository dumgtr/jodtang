/**
 * Deterministic recognition for the existing Security & Privacy FAQ route.
 *
 * This module only classifies the user's message. The FAQ response remains in
 * menu.builder.ts and the handler keeps this route before Query and Write.
 */

const FINANCIAL_WRITE_CUE_PATTERN =
  /(กิน|จ่าย|ซื้อ|ได้เงิน|เงินเดือน|รายรับ|รายจ่าย|โอน|ค่าไฟ|ค่าน้ำ|ค่าบิล|บันทึก|ใช้เงิน)/u;

const DATA_PRIVACY_QUESTION_PATTERNS: readonly RegExp[] = [
  /เก็บข้อมูล(?:อะไร|ที่ไหน|ไว้ที่ไหน|ยังไง|อย่างไร|บ้าง|ไหม)?/u,
  /ข้อมูล(?:ของฉัน|ฉัน|ส่วนตัว)?(?:ถูก)?เก็บ(?:ไว้)?/u,
  /ข้อมูล.*(?:เอาไป|นำไป)?ใช้/u,
  /ข้อมูล.*(?:เทรน|ฝึก)/u,
  /(?:เห็น|เข้าถึง|เชื่อม).*(?:บัญชีธนาคาร|บัญชี|รายการ|ข้อมูล)/u,
  /(?:บัญชีธนาคาร|บัญชี).*(?:เห็น|เข้าถึง|เชื่อม)/u,
  /(?:รหัสผ่าน|พาสเวิร์ด|password|pin|otp)/u,
  /(?:ใคร|คนอื่น|ผู้อื่น).*เห็น.*(?:รายการ|ข้อมูล)/u,
];

/**
 * Uses the same deterministic normalization style as the command matchers in
 * message.handler.ts: case-folding, Unicode normalization, and removal of
 * punctuation/emoji/spacing while preserving Thai and ASCII words.
 */
export function normalizeSecurityFaqIntentText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
}

/**
 * Recognizes natural-language Security & Privacy FAQ requests without an LLM.
 * Numeric financial write messages containing security-like wording remain
 * eligible for the normal Write Path when they also contain a write cue.
 */
export function isSecurityFaqCommand(text: string): boolean {
  if (!text || typeof text !== 'string') return false;

  const normalized = normalizeSecurityFaqIntentText(text);
  if (!normalized) return false;

  // Preserve the write-path safety boundary for messages such as
  // "จ่ายเงินอย่างปลอดภัย 500" while allowing legitimate security questions
  // that mention a year or retention period.
  if (/\d/u.test(text) && FINANCIAL_WRITE_CUE_PATTERN.test(normalized)) {
    return false;
  }

  if (normalized === 'faq') return true;
  if (normalized.includes('security') || normalized.includes('privacy')) return true;
  if (normalized.includes('ความปลอดภัย') || normalized.includes('ปลอดภัย')) return true;
  if (normalized.includes('ความเป็นส่วนตัว')) return true;
  if (normalized === 'dataprivacy') return true;

  return DATA_PRIVACY_QUESTION_PATTERNS.some((pattern) => pattern.test(normalized));
}
