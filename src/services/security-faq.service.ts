/**
 * Deterministic recognition for the existing Security & Privacy FAQ route.
 *
 * This module only classifies the user's message. The FAQ response remains in
 * menu.builder.ts and the handler keeps this route before Query and Write.
 */

export type SecurityFaqTopic =
  | 'overview'
  | 'stored_data'
  | 'data_access'
  | 'ai_processing'
  | 'data_location'
  | 'user_control'
  | 'banking_boundary'
  | 'line_account';

const FINANCIAL_WRITE_CUE_PATTERN =
  /(กิน|จ่าย|ซื้อ|ได้เงิน|เงินเดือน|รายรับ|รายจ่าย|โอน|ค่าไฟ|ค่าน้ำ|ค่าบิล|ค่าโทรศัพท์|บันทึก|ใช้เงิน)/u;

const EXPLICIT_SECURITY_SUBJECT_PATTERN =
  /(ข้อมูล|ระบบ|จดตัง|แอป|บริการ|บัญชี|รายการ|ความปลอดภัย|ความเป็นส่วนตัว|security|privacy|รหัสผ่าน|otp|pin|ai)/u;

const AI_QUESTION_CUES = ['เห็น', 'ใช้', 'ทำอะไร', 'เทรน', 'ฝึก', 'จำ', 'ส่ง', 'อยู่', 'ไปอยู่'];

/**
 * Uses Unicode normalization, case-folding, and punctuation/emoji removal
 * while preserving Thai and ASCII words for deterministic matching.
 */
export function normalizeSecurityFaqIntentText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
}

function includesAnyNormalized(normalized: string, cues: readonly string[]): boolean {
  return cues.some((cue) => normalized.includes(normalizeSecurityFaqIntentText(cue)));
}

function isFinancialSecurityPhrase(normalized: string, original: string): boolean {
  if (/\d/u.test(original) && FINANCIAL_WRITE_CUE_PATTERN.test(normalized)) {
    return true;
  }

  // Avoid hijacking ordinary phrases such as "ซื้อของปลอดภัยไหม". A security
  // word alone is not enough when the sentence is framed as a purchase/action.
  return (
    FINANCIAL_WRITE_CUE_PATTERN.test(normalized) &&
    normalized.includes('ปลอดภัย') &&
    !EXPLICIT_SECURITY_SUBJECT_PATTERN.test(normalized)
  );
}

function isAiQuestion(normalized: string): boolean {
  if (normalized.includes('เอาข้อมูลไปเทรน') || normalized.includes('ส่งข้อมูลให้ai')) {
    return true;
  }

  return normalized.includes('ai') && includesAnyNormalized(normalized, AI_QUESTION_CUES);
}

function isBankingQuestion(normalized: string): boolean {
  return (
    normalized.includes('บัญชีธนาคาร') ||
    normalized.includes('แอปธนาคาร') ||
    normalized.includes('เป็นธนาคาร') ||
    normalized.includes('รหัสธนาคาร') ||
    normalized.includes('รหัสผ่านธนาคาร') ||
    normalized.includes('รหัสผ่าน') ||
    normalized.includes('ยอดบัญชี') ||
    normalized.includes('เลขบัญชี') ||
    normalized.includes('otp') ||
    normalized.includes('pin') ||
    normalized.includes('จดตังเข้าบัญชี') ||
    normalized.includes('จดตังโอนเงิน') ||
    normalized.includes('จดตังหักเงิน') ||
    normalized.includes('หักเงินจากบัญชี') ||
    (normalized.includes('โอนเงิน') && normalized.includes('จดตัง'))
  );
}

function isUserControlQuestion(normalized: string): boolean {
  return [
    'พิมพ์ผิด',
    'ยอดผิด',
    'อ่านผิด',
    'แก้รายการ',
    'แก้ข้อมูล',
    'แก้ได้ไหม',
    'ก่อนบันทึก',
    'ตรวจสอบก่อน',
    'ลบข้อมูล',
    'ลบรายการ',
    'ลบทั้งหมด',
    'ส่งออก',
    'export',
    'draft',
  ].some((cue) => normalized.includes(normalizeSecurityFaqIntentText(cue)));
}

function isDataLocationQuestion(normalized: string): boolean {
  if (normalized.includes('มือถือ') && normalized.includes('server')) return true;

  return [
    'เก็บไว้ที่ไหน',
    'ข้อมูลอยู่ที่ไหน',
    'ข้อมูลผมอยู่ที่ไหน',
    'ข้อมูลฉันอยู่ที่ไหน',
    'ข้อมูลของฉันอยู่ที่ไหน',
    'ฐานข้อมูลอยู่ที่ไหน',
    'มือถือหรือserver',
    'มือถือหรือเซิร์ฟเวอร์',
    'ลบแชต',
  ].some((cue) => normalized.includes(normalizeSecurityFaqIntentText(cue)));
}

function isLineAccountQuestion(normalized: string): boolean {
  return [
    'เปลี่ยนมือถือ',
    'เปลี่ยนline',
    'บัญชีline',
    'เข้าline',
    'คนเข้าline',
    'เปลี่ยนบัญชี',
  ].some((cue) => normalized.includes(normalizeSecurityFaqIntentText(cue)));
}

function isDataAccessQuestion(normalized: string): boolean {
  return [
    'ใครเห็นข้อมูล',
    'ใครเห็นรายการ',
    'ใครเป็นคนดูข้อมูล',
    'คนอื่นเห็นข้อมูล',
    'คนอื่นเห็นรายการ',
    'แอดมินเห็น',
    'เข้าถึงข้อมูล',
    'ปนกับคนอื่น',
    'ข้อมูลปน',
    'ข้อมูลจะไปโผล่',
    'ข้อมูลผมจะไปโผล่',
    'ไปโผล่ของคนอื่น',
    'โผล่ของคนอื่น',
    'คนอื่นค้นหา',
    'ค้นหารายการของฉัน',
    'ค้นหารายการของผม',
  ].some((cue) => normalized.includes(normalizeSecurityFaqIntentText(cue)));
}

function isStoredDataQuestion(normalized: string): boolean {
  return [
    'เก็บข้อมูล',
    'เก็บอะไร',
    'ข้อมูลอะไร',
    'ข้อมูลของฉัน',
    'ข้อมูลผม',
    'ข้อมูลฉัน',
    'ข้อมูลส่วนตัว',
    'ข้อมูลมีอะไร',
    'รู้ข้อมูล',
    'ข้อมูลถูกเก็บ',
    'พิมพ์ถูกเก็บ',
    'เก็บรายการ',
    'เอาข้อมูลไปใช้',
    'ข้อมูลไปใช้',
    'ข้อมูลเอาไปใช้',
  ].some((cue) => normalized.includes(normalizeSecurityFaqIntentText(cue)));
}

function isGenericSecurityQuestion(normalized: string): boolean {
  return (
    normalized === 'faq' ||
    normalized === 'dataprivacy' ||
    normalized.includes('security') ||
    normalized.includes('privacy') ||
    normalized.includes('ความปลอดภัย') ||
    normalized.includes('ความเป็นส่วนตัว') ||
    normalized === 'ปลอดภัยไหม' ||
    normalized.startsWith('ระบบปลอดภัย') ||
    normalized.startsWith('เรื่องความปลอดภัย') ||
    normalized.startsWith('ขอข้อมูลความปลอดภัย')
  );
}

/**
 * Classifies a natural-language Security & Privacy FAQ request.
 * No LLM call or database access is performed here.
 */
export function classifySecurityFaqIntent(text: string): SecurityFaqTopic | null {
  if (!text || typeof text !== 'string') return null;

  const normalized = normalizeSecurityFaqIntentText(text);
  if (!normalized || isFinancialSecurityPhrase(normalized, text)) return null;

  if (isAiQuestion(normalized)) return 'ai_processing';
  if (isBankingQuestion(normalized)) return 'banking_boundary';
  if (isUserControlQuestion(normalized)) return 'user_control';
  if (isLineAccountQuestion(normalized)) return 'line_account';
  if (isDataLocationQuestion(normalized)) return 'data_location';
  if (isDataAccessQuestion(normalized)) return 'data_access';
  if (isStoredDataQuestion(normalized)) return 'stored_data';
  if (normalized.includes('ปลอดภัย') && EXPLICIT_SECURITY_SUBJECT_PATTERN.test(normalized)) {
    return 'overview';
  }
  if (isGenericSecurityQuestion(normalized)) return 'overview';

  return null;
}

export function isSecurityFaqCommand(text: string): boolean {
  return classifySecurityFaqIntent(text) !== null;
}
