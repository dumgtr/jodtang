/**
 * Deterministic Security & Privacy FAQ intent classification.
 *
 * This module contains only normalized topic profiles. It never calls an LLM,
 * reads the database, or writes application state. The handler keeps this
 * classifier before user lookup, conversation state, Query, and Write.
 */

export type SecurityFaqTopic =
  | 'overview'
  | 'stored_data'
  | 'data_location'
  | 'data_access'
  | 'encryption'
  | 'ai_processing'
  | 'ai_training_retention'
  | 'line_account'
  | 'banking_credentials'
  | 'user_control'
  | 'deletion_export'
  | 'transaction_confirmation';

const FINANCIAL_WRITE_CUE_PATTERN =
  /(กิน|จ่าย|ซื้อ|ได้เงิน|เงินเดือน|รายรับ|รายจ่าย|โอน|ค่าไฟ|ค่าน้ำ|ค่าบิล|ค่าโทรศัพท์|บันทึก|ใช้เงิน|เติมน้ำมัน|มี)/u;

const SECURITY_ANCHOR_PATTERN =
  /(จดตัง|ระบบ|บริการ|ข้อมูล(?:ของฉัน|ของผม|ของเรา|ฉัน|ผม|เรา|ส่วนตัว)|ความปลอดภัย|ความเป็นส่วนตัว|privacy|security|เข้ารหัส|encryption|https|tls|ssl|ai|เอไอ|รหัสผ่าน|otp|pin|ธนาคาร|บัญชี|line|draft|ใคร|ผู้ดูแล|แอดมิน|ข้อมูลรั่ว|ข้อมูลหลุด)/u;

/**
 * Uses Unicode normalization, case-folding, and punctuation/emoji removal
 * while preserving Thai and ASCII words for deterministic matching.
 */
export function normalizeSecurityFaqIntentText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    // Common Thai chat variants/typos are normalized before topic matching.
    .replace(/มั้ย/gu, 'ไหม')
    .replace(/ป่าว/gu, 'ไหม')
    .replace(/ปลอดภ้ย/gu, 'ปลอดภัย')
    .replace(/ปลอดภย/gu, 'ปลอดภัย')
    .replace(/[^a-z0-9\u0E00-\u0E7F]/gu, '');
}

function containsAny(normalized: string, cues: readonly string[]): boolean {
  return cues.some((cue) => normalized.includes(normalizeSecurityFaqIntentText(cue)));
}

function containsAll(normalized: string, cues: readonly string[]): boolean {
  return cues.every((cue) => normalized.includes(normalizeSecurityFaqIntentText(cue)));
}

function isStatefulManagementCommand(normalized: string): boolean {
  return (
    /^(ขอ)?(แก้ไข|แก้)(รายการ)?$/u.test(normalized) ||
    /^(ขอ)?(ลบ|ยกเลิก)(รายการ)?$/u.test(normalized) ||
    normalized === 'edit' ||
    normalized === 'delete' ||
    normalized === 'void'
  );
}

/**
 * Keeps ordinary financial text out of the FAQ route. A number plus a write
 * cue is always a write-path candidate. Without a number, an action phrase
 * such as "ซื้อของปลอดภัยไหม" is also left to the normal handler unless it
 * has a clear JodTang/privacy subject.
 */
function isFinancialWriteBoundary(normalized: string, original: string): boolean {
  if (/\d/u.test(original) && FINANCIAL_WRITE_CUE_PATTERN.test(normalized)) {
    return true;
  }

  const hasFinancialAction = FINANCIAL_WRITE_CUE_PATTERN.test(normalized);
  const hasSecurityQuestionCue = containsAny(normalized, [
    'ปลอดภัย',
    'ความปลอดภัย',
    'ความเป็นส่วนตัว',
    'เข้ารหัส',
    'encryption',
    'https',
    'tls',
    'ssl',
    'รหัสผ่าน',
    'otp',
    'pin',
    'ข้อมูลรั่ว',
    'ข้อมูลหลุด',
  ]);

  return hasFinancialAction && hasSecurityQuestionCue && !SECURITY_ANCHOR_PATTERN.test(normalized);
}

function matchesEncryption(normalized: string): boolean {
  return (
    containsAny(normalized, ['เข้ารหัส', 'encryption', 'https', 'tls', 'ssl']) ||
    (containsAny(normalized, ['ส่งข้อมูล', 'รับส่งข้อมูล']) && containsAny(normalized, ['ปลอดภัย', 'ความปลอดภัย']))
  );
}

function matchesAiTrainingRetention(normalized: string): boolean {
  return (
    containsAny(normalized, ['เทรน', 'ฝึก', 'training', 'retention', 'เก็บไว้นาน']) ||
    (containsAny(normalized, ['ai', 'เอไอ']) && containsAny(normalized, ['จำข้อมูล', 'จำข้อความ', 'เก็บข้อมูล', 'เก็บข้อความ']))
  );
}

function matchesAiProcessing(normalized: string): boolean {
  const hasAiSubject = containsAny(normalized, ['ai', 'เอไอ', 'ผู้ให้บริการ ai', 'ผู้ให้บริการเอไอ']);
  const hasProcessingCue = containsAny(normalized, [
    'เห็นข้อมูล',
    'ส่งข้อมูล',
    'ส่งข้อความ',
    'ส่งให้',
    'อยู่กับ',
    'ไปอยู่กับ',
    'ใช้ข้อมูล',
    'ทำอะไร',
    'ประมวลผล',
    'provider',
    'ผู้ให้บริการ',
  ]);

  return (
    (hasAiSubject && hasProcessingCue) ||
    containsAll(normalized, ['ผู้ให้บริการ', 'ข้อมูล']) ||
    containsAll(normalized, ['provider', 'ข้อมูล'])
  );
}

function matchesBankingCredentials(normalized: string): boolean {
  return containsAny(normalized, [
    'บัญชีธนาคาร',
    'แอปธนาคาร',
    'เชื่อมธนาคาร',
    'ต่อธนาคาร',
    'ผูกธนาคาร',
    'เป็นธนาคาร',
    'รหัสธนาคาร',
    'รหัสผ่านธนาคาร',
    'รหัสผ่าน',
    'password',
    'ยอดบัญชี',
    'เลขบัญชี',
    'otp',
    'pin',
    'บัตรเครดิต',
    'บัตรเดบิต',
    'จดตังเข้าบัญชี',
    'จดตังโอนเงินแทน',
    'จดตังโอนเงินให้',
    'จดตังหักเงิน',
    'หักเงินจากบัญชี',
  ]) || (containsAny(normalized, ['โอนเงิน', 'โอน']) && containsAny(normalized, ['จดตัง', 'ระบบ']) && !/\d/u.test(normalized));
}

function matchesLineAccount(normalized: string): boolean {
  if (containsAny(normalized, ['ลบแชต', 'ลบข้อความ']) && containsAny(normalized, ['ข้อมูล', 'หาย'])) {
    return false;
  }

  return (
    containsAny(normalized, [
      'เปลี่ยนมือถือ',
      'เปลี่ยนเครื่อง',
      'เปลี่ยนโทรศัพท์',
      'โทรศัพท์ใหม่',
      'เปลี่ยนline',
      'บัญชีline',
      'เข้าlineไม่ได้',
      'เข้าlineไม่ได',
      'lineมีปัญหา',
      'lineถูกแฮก',
      'บัญชีlineถูกแฮก',
      'เปลี่ยนบัญชี',
      'ผูกกับบัญชี',
      'ผูกข้อมูลกับline',
      'ผูกกับไลน์',
      'line user id',
      'lineuserid',
      'ไลน์ไอดี',
    ]) ||
    (containsAny(normalized, ['line']) && containsAny(normalized, ['ข้อมูล', 'บัญชี', 'หาย', 'เปลี่ยน', 'เข้าไม่ได้']))
  );
}

function matchesDataLocation(normalized: string): boolean {
  if (containsAny(normalized, ['ลบแชต', 'ลบข้อความ']) && containsAny(normalized, ['ข้อมูล', 'หาย'])) {
    return true;
  }

  return containsAny(normalized, [
    'เก็บไว้ที่ไหน',
    'ข้อมูลอยู่ที่ไหน',
    'ข้อมูลผมอยู่ที่ไหน',
    'ข้อมูลฉันอยู่ที่ไหน',
    'ข้อมูลของฉันอยู่ที่ไหน',
    'ฐานข้อมูลอยู่ที่ไหน',
    'เก็บที่ไหน',
    'เซิร์ฟเวอร์',
    'server',
    'cloud',
    'ฐานข้อมูล',
    'มือถือหรือในเครื่อง',
    'มือถือหรือserver',
    'มือถือหรือเซิร์ฟเวอร์',
    'บนเครื่อง',
  ]);
}

function matchesDataAccess(normalized: string): boolean {
  return containsAny(normalized, [
    'ใครเห็นข้อมูล',
    'ใครเห็นรายการ',
    'ใครดูข้อมูล',
    'ใครดูรายการ',
    'ใครเข้าถึงข้อมูล',
    'ใครเข้าถึงรายการ',
    'ใครเป็นคนดูข้อมูล',
    'คนอื่นเห็นข้อมูล',
    'คนอื่นเห็นรายการ',
    'คนอื่นดูข้อมูล',
    'แอดมินเห็น',
    'ผู้ดูแลเห็น',
    'ผู้ดูแลระบบเห็น',
    'operatorเห็น',
    'providerเห็น',
    'เข้าถึงข้อมูล',
    'เข้าถึงรายการ',
    'ปนกับคนอื่น',
    'ข้อมูลปน',
    'ข้อมูลจะไปโผล่',
    'ไปโผล่ของคนอื่น',
    'โผล่ของคนอื่น',
    'คนอื่นค้นหา',
    'ข้อมูลเราโดนดู',
    'ข้อมูลฉันโดนดู',
    'ข้อมูลผมโดนดู',
    'ข้อมูลของฉันโดนดู',
    'ข้อมูลของผมโดนดู',
    'ข้อมูลส่วนตัวโดนดู',
    'ข้อมูลจะรั่ว',
    'ข้อมูลรั่ว',
    'ข้อมูลจะหลุด',
    'ข้อมูลหลุด',
    'ข้อมูลของฉันจะหลุด',
    'ข้อมูลของผมจะหลุด',
    'ข้อมูลส่วนตัวหลุด',
    'ข้อมูลส่วนตัวรั่ว',
    'ค้นหารายการของฉัน',
    'ค้นหารายการของผม',
  ]);
}

function matchesDeletionExport(normalized: string): boolean {
  return containsAny(normalized, [
    'ลบข้อมูล',
    'ลบรายการ',
    'ลบทั้งหมด',
    'ลบถาวร',
    'ลบทิ้ง',
    'ขอไฟล์ข้อมูล',
    'ไฟล์ข้อมูล',
    'ส่งออกข้อมูล',
    'ส่งออก',
    'export',
    'delete data',
  ]);
}

function matchesTransactionConfirmation(normalized: string): boolean {
  return containsAny(normalized, [
    'draft',
    'ก่อนบันทึก',
    'ตรวจสอบก่อน',
    'ต้องยืนยัน',
    'ยืนยันก่อน',
    'บันทึกจริง',
    'confirm',
    'กดยืนยัน',
  ]);
}

function matchesUserControl(normalized: string): boolean {
  return containsAny(normalized, [
    'พิมพ์ผิด',
    'ยอดผิด',
    'อ่านผิด',
    'แก้รายการ',
    'แก้ข้อมูล',
    'แก้ไขรายการ',
    'แก้ไขข้อมูล',
    'แก้จำนวน',
    'แก้ยอด',
    'แก้draft',
    'แก้ได้ไหม',
    'ยกเลิกรายการ',
    'ยกเลิกข้อมูล',
    'cancel',
    'edit',
  ]);
}

function matchesStoredData(normalized: string): boolean {
  return containsAny(normalized, [
    'เก็บข้อมูล',
    'เก็บอะไร',
    'ข้อมูลอะไร',
    'ข้อมูลของฉัน',
    'ข้อมูลของผม',
    'ข้อมูลของเรา',
    'ข้อมูลผม',
    'ข้อมูลฉัน',
    'ข้อมูลเรา',
    'ข้อมูลส่วนตัว',
    'ข้อมูลมีอะไร',
    'รู้ข้อมูล',
    'ข้อมูลถูกเก็บ',
    'พิมพ์ถูกเก็บ',
    'ข้อความถูกเก็บ',
    'ข้อความที่ส่ง',
    'ข้อมูลที่ฉันส่ง',
    'ข้อมูลที่ผมส่ง',
    'ข้อมูลที่ฉันพิมพ์',
    'ข้อมูลที่ผมพิมพ์',
    'ข้อมูลที่ส่ง',
    'เก็บรายการ',
    'บันทึกอะไร',
    'ใช้ข้อมูลฉัน',
    'ใช้ข้อมูลผม',
    'เอาข้อมูลไปใช้',
    'ข้อมูลไปใช้',
    'ข้อมูลเอาไปใช้',
  ]);
}

function matchesOverview(normalized: string): boolean {
  return (
    normalized === 'faq' ||
    normalized === 'dataprivacy' ||
    containsAny(normalized, [
      'security',
      'privacy',
      'ความปลอดภัย',
      'ความเป็นส่วนตัว',
      'ปลอดภัยไหม',
      'ปลอดภัยป่าว',
      'ปลอดภัยมั้ย',
      'ปลอดภัยหรือเปล่า',
      'ระบบปลอดภัย',
      'เรื่องความปลอดภัย',
      'ขอข้อมูลความปลอดภัย',
      'นโยบายความปลอดภัย',
    ])
  );
}

/**
 * Classifies a natural-language Security & Privacy FAQ request.
 * No LLM call or database access is performed here.
 */
export function classifySecurityFaqIntent(text: string): SecurityFaqTopic | null {
  if (!text || typeof text !== 'string') return null;

  const normalized = normalizeSecurityFaqIntentText(text);
  if (!normalized || isStatefulManagementCommand(normalized) || isFinancialWriteBoundary(normalized, text)) return null;

  // More specific profiles run first so a phrase such as "AI เอาไปเทรนไหม"
  // is not reduced to the broader AI-processing topic.
  if (matchesEncryption(normalized)) return 'encryption';
  if (matchesBankingCredentials(normalized)) return 'banking_credentials';
  if (matchesAiTrainingRetention(normalized)) return 'ai_training_retention';
  if (matchesAiProcessing(normalized)) return 'ai_processing';
  if (matchesLineAccount(normalized)) return 'line_account';
  if (matchesDataLocation(normalized)) return 'data_location';
  if (matchesDataAccess(normalized)) return 'data_access';
  if (matchesDeletionExport(normalized)) return 'deletion_export';
  if (matchesUserControl(normalized)) return 'user_control';
  if (matchesTransactionConfirmation(normalized)) return 'transaction_confirmation';
  if (matchesStoredData(normalized)) return 'stored_data';
  if (matchesOverview(normalized)) return 'overview';

  return null;
}

export function isSecurityFaqCommand(text: string): boolean {
  return classifySecurityFaqIntent(text) !== null;
}
