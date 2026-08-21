/**
 * Thai and English month mappings to 1-based month numbers.
 * Supports full names, abbreviations, and common colloquial forms.
 */
const MONTH_MAP: Record<string, number> = {
  // มกราคม (1)
  'มกราคม': 1, 'ม.ค.': 1, 'ม.ค': 1, 'มกรา': 1, 'มกราฯ': 1, 'january': 1, 'jan': 1,
  // กุมภาพันธ์ (2)
  'กุมภาพันธ์': 2, 'ก.พ.': 2, 'ก.พ': 2, 'กุมภา': 2, 'กุมภาฯ': 2, 'february': 2, 'feb': 2,
  // มีนาคม (3)
  'มีนาคม': 3, 'มี.ค.': 3, 'มี.ค': 3, 'มีนา': 3, 'มีนาฯ': 3, 'march': 3, 'mar': 3,
  // เมษายน (4)
  'เมษายน': 4, 'เม.ย.': 4, 'เม.ย': 4, 'เมษา': 4, 'เมษาฯ': 4, 'april': 4, 'apr': 4,
  // พฤษภาคม (5)
  'พฤษภาคม': 5, 'พ.ค.': 5, 'พ.ค': 5, 'พฤษภา': 5, 'พฤษภาฯ': 5, 'may': 5,
  // มิถุนายน (6)
  'มิถุนายน': 6, 'มิ.ย.': 6, 'มิ.ย': 6, 'มิถุนา': 6, 'มิถุนาฯ': 6, 'june': 6, 'jun': 6,
  // กรกฎาคม (7)
  'กรกฎาคม': 7, 'ก.ค.': 7, 'ก.ค': 7, 'กรกฎา': 7, 'กรกฎาฯ': 7, 'july': 7, 'jul': 7,
  // สิงหาคม (8)
  'สิงหาคม': 8, 'ส.ค.': 8, 'ส.ค': 8, 'สิงหา': 8, 'สิงหาฯ': 8, 'august': 8, 'aug': 8,
  // กันยายน (9)
  'กันยายน': 9, 'ก.ย.': 9, 'ก.ย': 9, 'กันยา': 9, 'กันยาฯ': 9, 'september': 9, 'sep': 9, 'sept': 9,
  // ตุลาคม (10)
  'ตุลาคม': 10, 'ต.ค.': 10, 'ต.ค': 10, 'ตุลา': 10, 'ตุลาฯ': 10, 'october': 10, 'oct': 10,
  // พฤศจิกายน (11)
  'พฤศจิกายน': 11, 'พ.ย.': 11, 'พ.ย': 11, 'พฤศจิกา': 11, 'พฤศจิกาฯ': 11, 'november': 11, 'nov': 11,
  // ธันวาคม (12)
  'ธันวาคม': 12, 'ธ.ค.': 12, 'ธ.ค': 12, 'ธันวา': 12, 'ธันวาฯ': 12, 'december': 12, 'dec': 12,
};

// Sort month names by length descending for regex matching
const SORTED_MONTH_NAMES = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length);

/**
 * Deterministically parses natural and conversational Thai/English date inputs.
 * Supports:
 * - Relative: "วันนี้", "เมื่อวาน", "เมื่อวานนี้", "พรุ่งนี้", "today", "yesterday", "tomorrow"
 * - Date prefix + day: "วันที่ 19", "วันที่ 1", "วันที่ 31" (uses current month and year)
 * - Numeric without year: "17/8", "17-8", "17/08", "17-08" (uses current year)
 * - Thai month without year: "17 สิงหาคม", "17 สิงหา", "17 ส.ค.", "วันที่ 17 สิงหาคม" (uses current year)
 * - With explicit year: "17/8/2026", "17/8/2569", "17/8/26", "17/8/69", "17 สิงหาคม 2569", "17 สิงหาคม 69", "YYYY-MM-DD"
 * - Reject ambiguous or invalid inputs: "19" (bare number), "32/8", "31/2", "วันที่ 32", "วันที่ 0"
 *
 * Returns ISO date string "YYYY-MM-DD" or null if unparseable/invalid.
 */
export function parseNaturalThaiDate(input: string, referenceDate: Date = new Date()): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim().toLowerCase();
  const defaultYear = getCurrentBangkokYear(referenceDate);
  const defaultMonth = getCurrentBangkokMonth(referenceDate);

  // 1. Relative Thai & English keywords
  if (trimmed === 'วันนี้' || trimmed === 'today') {
    const d = new Date(referenceDate);
    return formatDateIso(d);
  }
  if (trimmed === 'เมื่อวาน' || trimmed === 'เมื่อวานนี้' || trimmed === 'yesterday') {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - 1);
    return formatDateIso(d);
  }
  if (trimmed === 'พรุ่งนี้' || trimmed === 'tomorrow') {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() + 1);
    return formatDateIso(d);
  }

  // 2. Format: "วันที่ + วัน" with explicit prefix (e.g. "วันที่ 19", "วันที่ 1", "วันที่ 31") -> current month & current year
  const bareDayWithPrefixMatch = trimmed.match(/^(?:วันที่|วัน|date)\s*(\d{1,2})$/iu);
  if (bareDayWithPrefixMatch) {
    const day = parseInt(bareDayWithPrefixMatch[1], 10);
    if (day >= 1 && isValidDateComponents(defaultYear, defaultMonth, day)) {
      return formatYmd(defaultYear, defaultMonth, day);
    }
    return null;
  }

  // Guard: bare number without "วันที่" prefix (e.g. "19", "17") must be rejected to prevent ambiguity with amounts
  if (/^\d{1,2}$/.test(trimmed)) {
    return null;
  }

  // Strip leading prefixes like "วันที่", "วัน", "date" for subsequent multi-token patterns
  const cleaned = trimmed.replace(/^(วันที่|วัน|date)\s*/iu, '').trim();

  // 3. Format: YYYY-MM-DD or YYYY/MM/DD (4-digit year first)
  const ymdMatch = cleaned.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (ymdMatch) {
    const year = normalizeYear(ymdMatch[1], defaultYear);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    if (isValidDateComponents(year, month, day)) {
      return formatYmd(year, month, day);
    }
    return null;
  }

  // 4. Format: Text Month matching (e.g. "17 สิงหาคม 2569", "17 สิงหา", "17 ส.ค. 69", "17 ส.ค.", "17-ส.ค.-2569")
  for (const monthName of SORTED_MONTH_NAMES) {
    const monthIndex = cleaned.indexOf(monthName);
    if (monthIndex !== -1) {
      const beforeMonth = cleaned.substring(0, monthIndex).trim().replace(/[-\/\.\s]+$/, '');
      const afterMonth = cleaned.substring(monthIndex + monthName.length).trim().replace(/^([-\/\.\s]+)/, '');

      // Day must be before the month name (e.g. "17")
      const dayMatch = beforeMonth.match(/^(\d{1,2})$/);
      if (dayMatch) {
        const day = parseInt(dayMatch[1], 10);
        const month = MONTH_MAP[monthName];
        let year = defaultYear;

        if (afterMonth.length > 0) {
          const yearMatch = afterMonth.match(/^(\d{2,4})$/);
          if (yearMatch) {
            year = normalizeYear(yearMatch[1], defaultYear);
          } else {
            return null; // Has unrecognized trailing tokens
          }
        }

        if (isValidDateComponents(year, month, day)) {
          return formatYmd(year, month, day);
        }
        return null;
      }
    }
  }

  // 5. Format: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (4-digit year last)
  const dmy4Match = cleaned.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})$/);
  if (dmy4Match) {
    const day = parseInt(dmy4Match[1], 10);
    const month = parseInt(dmy4Match[2], 10);
    const year = normalizeYear(dmy4Match[3], defaultYear);
    if (isValidDateComponents(year, month, day)) {
      return formatYmd(year, month, day);
    }
    return null;
  }

  // 6. Format: DD/MM/YY or DD-MM-YY or DD.MM.YY (2-digit year last, e.g. 17/8/26, 17/8/69)
  const dmy2Match = cleaned.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2})$/);
  if (dmy2Match) {
    const day = parseInt(dmy2Match[1], 10);
    const month = parseInt(dmy2Match[2], 10);
    const year = normalizeYear(dmy2Match[3], defaultYear);
    if (isValidDateComponents(year, month, day)) {
      return formatYmd(year, month, day);
    }
    return null;
  }

  // 7. Format: DD/MM or D/M or DD-MM or D-M or DD.MM (Numeric without year -> current year)
  const dmMatch = cleaned.match(/^(\d{1,2})[-\/\.](\d{1,2})$/);
  if (dmMatch) {
    const day = parseInt(dmMatch[1], 10);
    const month = parseInt(dmMatch[2], 10);
    const year = defaultYear;
    if (isValidDateComponents(year, month, day)) {
      return formatYmd(year, month, day);
    }
    return null;
  }

  return null;
}

/**
 * Normalizes 2-digit and 4-digit years (both BE and CE) to 4-digit CE year.
 * - 4-digit BE (2400..2700) -> BE - 543
 * - 4-digit CE (1900..2200) -> CE
 * - 2-digit BE (40..99) -> 2500 + yy - 543 (e.g. 69 -> 2569 -> 2026)
 * - 2-digit CE (00..39) -> 2000 + yy (e.g. 26 -> 2026)
 */
export function normalizeYear(rawYear: string | number | undefined, defaultYear: number): number {
  if (rawYear === undefined || rawYear === null || rawYear === '') {
    return defaultYear;
  }

  const y = typeof rawYear === 'number' ? rawYear : parseInt(String(rawYear), 10);
  if (isNaN(y)) return defaultYear;

  // 4-digit Buddhist Era (e.g. 2569 -> 2026)
  if (y >= 2400 && y <= 2700) {
    return y - 543;
  }

  // 4-digit Common Era (e.g. 2026)
  if (y >= 1900 && y <= 2200) {
    return y;
  }

  // 2-digit Thai Buddhist Era (e.g. 69 -> BE 2569 -> CE 2026)
  if (y >= 40 && y <= 99) {
    return (2500 + y) - 543;
  }

  // 2-digit Common Era (e.g. 26 -> CE 2026)
  if (y >= 0 && y < 40) {
    return 2000 + y;
  }

  return y;
}

/**
 * Checks if year/month/day form a valid calendar date (handles leap years & month lengths).
 */
export function isValidDateComponents(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const d = new Date(year, month - 1, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === month - 1 &&
    d.getDate() === day
  );
}

function formatYmd(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function formatDateIso(d: Date): string {
  const bangkokFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return bangkokFormatter.format(d);
}

function getCurrentBangkokYear(referenceDate: Date): number {
  const bangkokYearFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  });
  return parseInt(bangkokYearFormatter.format(referenceDate), 10);
}

function getCurrentBangkokMonth(referenceDate: Date): number {
  const bangkokMonthFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    month: 'numeric',
  });
  return parseInt(bangkokMonthFormatter.format(referenceDate), 10);
}
