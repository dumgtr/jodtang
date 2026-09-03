/**
 * Deterministic In-Memory TLV (Tag-Length-Value) Parser & CRC Validator
 *
 * Implements EMVCo and Thai Interbank Mini-QR payload parsing.
 * Zero external network calls, zero external dependencies.
 */

export interface TlvTag {
  id: string;          // 2 characters (e.g. '00', '51', '91', '29', '30')
  length: number;      // Declared length
  value: string;       // String payload
  subTags?: TlvTag[];  // Parsed nested subtags if applicable
}

export interface TlvParseResult {
  success: boolean;
  tags: TlvTag[];
  error?: string;
}

export interface CrcValidationResult {
  valid: boolean;
  expectedCrc?: string;
  actualCrc?: string;
  crcTagId?: string;
  error?: string;
}

/**
 * Calculates CRC16-CCITT (Poly: 0x1021, Init: 0xFFFF).
 * Used by Thai Interbank Slip Verify (Tag 91) and PromptPay/EMVCo (Tag 63).
 */
export function calculateCrc16Ccitt(data: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data.charCodeAt(i) << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Validates the CRC checksum embedded in a QR payload.
 * Checks Tag 91 (Thai Slip Mini-QR) or Tag 63 (PromptPay / EMVCo).
 */
export function validateCrc(payload: string): CrcValidationResult {
  if (!payload || typeof payload !== 'string' || payload.length < 8) {
    return { valid: false, error: 'PAYLOAD_TOO_SHORT_FOR_CRC' };
  }

  // Look for Tag 91 (Mini-QR) or Tag 63 (EMVCo) near the end
  let crcTagId: string | null = null;
  let idx = -1;

  const idx91 = payload.lastIndexOf('9104');
  const idx63 = payload.lastIndexOf('6304');

  if (idx91 !== -1 && idx91 === payload.length - 8) {
    crcTagId = '91';
    idx = idx91;
  } else if (idx63 !== -1 && idx63 === payload.length - 8) {
    crcTagId = '63';
    idx = idx63;
  }

  if (idx === -1 || !crcTagId) {
    return { valid: false, error: 'CRC_TAG_NOT_FOUND_AT_END' };
  }

  // Data to hash includes everything up to and including tag ID and length (e.g. "...9104")
  const dataToHash = payload.substring(0, idx + 4);
  const actualCrc = payload.substring(idx + 4, idx + 8).toUpperCase();
  const expectedCrc = calculateCrc16Ccitt(dataToHash);

  const valid = actualCrc === expectedCrc;
  return {
    valid,
    expectedCrc,
    actualCrc,
    crcTagId,
    error: valid ? undefined : 'CRC_CHECKSUM_MISMATCH',
  };
}

/**
 * Parses a flat TLV string into an array of TlvTag objects.
 * Strict length bounds checking: fails closed on truncation or overflow.
 */
export function parseTlv(payload: string): TlvParseResult {
  if (!payload || typeof payload !== 'string') {
    return { success: false, tags: [], error: 'EMPTY_OR_INVALID_INPUT' };
  }

  const tags: TlvTag[] = [];
  let cursor = 0;

  while (cursor < payload.length) {
    if (cursor + 4 > payload.length) {
      return { success: false, tags: [], error: `TRUNCATED_HEADER_AT_INDEX_${cursor}` };
    }

    const id = payload.substring(cursor, cursor + 2);
    const lengthStr = payload.substring(cursor + 2, cursor + 4);

    if (!/^\d{2}$/.test(lengthStr)) {
      return { success: false, tags: [], error: `INVALID_LENGTH_FIELD_${lengthStr}_AT_INDEX_${cursor}` };
    }

    const length = parseInt(lengthStr, 10);
    const valueStart = cursor + 4;
    const valueEnd = valueStart + length;

    if (valueEnd > payload.length) {
      return { success: false, tags: [], error: `VALUE_OVERFLOW_FOR_TAG_${id}_EXPECTED_${length}_FOUND_${payload.length - valueStart}` };
    }

    const value = payload.substring(valueStart, valueEnd);
    tags.push({ id, length, value });

    cursor = valueEnd;
  }

  return { success: true, tags };
}

/**
 * Parses sub-tags inside a parent TLV value (e.g. inside Tag 00 or Tag 29).
 */
export function parseSubTags(value: string): TlvTag[] | null {
  const result = parseTlv(value);
  if (!result.success) return null;
  return result.tags;
}

/**
 * Helper to locate a specific tag by ID.
 */
export function findTag(tags: TlvTag[], id: string): TlvTag | undefined {
  return tags.find((t) => t.id === id);
}

/**
 * Helper to locate a nested sub-tag value (e.g. tag '00', subtag '01').
 */
export function getSubTagValue(tags: TlvTag[], parentId: string, subId: string): string | undefined {
  const parent = findTag(tags, parentId);
  if (!parent) return undefined;

  if (!parent.subTags) {
    const parsed = parseSubTags(parent.value);
    if (!parsed) return undefined;
    parent.subTags = parsed;
  }

  const sub = findTag(parent.subTags, subId);
  return sub?.value;
}
