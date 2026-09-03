/**
 * Bank-Slip Likelihood Guard Constants & Heuristics
 * Verified in Guard Calibration & Coverage Validation
 */

export const GUARD_THRESHOLDS = {
  SUSPECTED_BANK_SLIP_MIN: 50,
  AMBIGUOUS_MIN: 25,
  CONFIRMED_RETAIL_MIN: 25,
} as const;

export const GUARD_SCORE_WEIGHTS = {
  POSITIVE: {
    TRANSFER_VERB_EXPLICIT: 25,
    TRANSFER_VERB_GENERIC: 10,
    REF_TXN_ID: 15,
    DIRECTIONAL_ACCOUNT_PAIR: 25,
    DIRECTIONAL_ACCOUNT_SINGLE: 10,
    BANK_NAME: 15,
    TIMESTAMP: 10,
  },
  NEGATIVE: {
    FISCAL_HEADER: 30,
    POS_HARDWARE: 25,
    COMMERCIAL_TENDER: 20,
    ITEMIZED_LINE: 15,
  },
} as const;

// 1. Context Flags
export const ATM_REGEX = /(?:ATM|ตู้\s*ATM|ตู้\s*เอทีเอ็ม|WITHDRAWAL|ATM\s*TRANSFER)/i;

export const EWALLET_PROVIDER_REGEX =
  /(?:เป๋า\s*ตั?ง|G-Wallet|ShopeePay|TrueMoney(?:\s*Wallet)?|ถุ?ง\s*เงิ?น|Rabbit\s*LINE\s*Pay|กระเป๋า\s*เงิน\s*อิเล็กทรอนิกส์)/i;

export const BILLER_ENTITY_REGEX =
  /(?:บัตรกรุงไทย|KTC|การไฟฟ้านครหลวง|MEA|การไฟฟ้าส่วนภูมิภาค|PEA|การประปา|TrueMove|AIS|DTAC|TOT|บมจ\.\s*ทรู|บัตรเครดิต)/i;

export const BILL_PAYMENT_KEYWORD_REGEX =
  /(?:จ่ายบิลสำเร็จ|ชำระบิลสำเร็จ|ชำระค่าบริการ|ชำระบิล)/i;

export const SETTLEMENT_CONFIRMATION_REGEX =
  /(?:ชำระ\s*ส?ำ?เ?ร็?จ|จ่าย\s*บิล\s*ส?ำ?เ?ร็?จ|ชำระ\s*บิล\s*ส?ำ?เ?ร็?จ|ชำระแล้ว|\bPAID\b)/i;

export const UNPAID_INVOICE_KEYWORD_REGEX =
  /(?:ใบแจ้งหนี้|ใบแจ้งค่าบริการ|ใบแจ้งค่าไฟฟ้า|ใบแจ้งค่าน้ำ|ยอดที่ต้องชำระ|ครบกำหนดชำระ|โปรดชำระภายใน|ยังไม่ใช่ใบเสร็จ)/i;

// 2. Positive Bank Slip Regexes with Diacritic & OCR Noise Tolerance
export const TRANSFER_VERB_EXPLICIT_REGEX =
  /(?:โอน\s*เ?งิ?น\s*ส?ำ?เ?ร็?จ|โอน\s*ส?ำ?เ?ร็?จ|\bTRANSFER\b)/i;

export const TRANSFER_VERB_GENERIC_REGEX =
  /(?:ทำ\s*ราย\s*การ\s*ส?ำ?เ?ร็?จ|บัน\s*ทึก\s*ราย\s*การ\s*ส?ำ?เ?ร็?จ)/i;

export const REF_TXN_ID_REGEX =
  /(?:(?:รหัส|เลข\s*ท(?:ี่|ี)?)\s*อ้าง\s*อิง|Reference\s*No|Trace\s*No|Transaction\s*Ref|เลข\s*ท(?:ี่|ี)?\s*ราย\s*การ|Txn\s*ID|Ref\s*1)/i;

export const FROM_ACCOUNT_REGEX =
  /(?:จาก|ชำระจาก)\s*(?:บ(?:ัญ|ญ)?ช(?:ี|ิ)?)?[:\s]|From[:\s]/i;

export const TO_ACCOUNT_REGEX =
  /(?:ไปยัง|โอนไปยัง|เข้าบ(?:ัญ|ญ)?ช(?:ี|ิ)?)[:\s]|To[:\s]/i;

export const MASKED_ACCOUNT_REGEX =
  /\bxxx-x-x\d{3,4}(?:-\d)?\b|\bxxx-\d-\d{5}-\d\b|\b\d{3}-\d-\d{5}-\d\b|[A-Z]{3}-[A-Z0-9]-[A-Z0-9]{5}-[0-9]/i;

export const BANK_NAME_REGEX =
  /(?:ธนาคารกสิกรไทย|กสิกรไทย|KBANK|ธนาคารไทยพาณิ?ชย์?|ไทยพาณิ?ชย์?|SCB|ธนาคารกรุงไทย|กรุงไทย|KTB|ธนาคารกรุงเทพ|BBL|ธนาคารทหารไทยธนชาต|TTB|ธนาคารออมสิน|GSB|ธนาคารกรุงศรี|BAY|ธ\.\s*ไทยพาณิ?ชย์?|ธ\.\s*กสิกรไทย|ธ\.\s*กรุงไทย|ธ\.\s*กรุงเทพ)/i;

export const TIMESTAMP_REGEX =
  /(?:วัน\s*ท(?:ี่|ี)?\s*ทำ\s*ราย\s*การ|เวลา|\d{1,2}\s*(?:ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*\d{4}|\d{2}\/\d{2}\/\d{4})/i;

// 3. Negative Retail / Commerce Regexes
export const FISCAL_HEADER_REGEX =
  /ใบเสร็จรับเงิน|ใบกำกับภาษีอย่างย่อ|TAX\s*INVOICE\s*\(ABB\)|ใบกำกับภาษีเต็มรูป|RECEIPT|SALE\s*SLIP/i;

export const POS_HARDWARE_REGEX =
  /TAX\s*ID|เลขประจำตัวผู้เสียภาษี|POS\s*ID|เครื่องที่|แคชเชียร์|Cashier|TID:|MID:/i;

export const COMMERCIAL_TENDER_REGEX =
  /เงินสด|เงินทอน|Change|Cash|VAT\s*7%|ภาษีมูลค่าเพิ่ม|ยอดรวมทั้งสิ้น|รวมทั้งสิ้น|\bTOTAL\b/i;

export const ITEMIZED_LINE_REGEX =
  /\d+\s*ชิ้น|\d+\s*ขวด|\d+\s*ถุง|\bQty\b|\bรายการสินค้า\b/i;
