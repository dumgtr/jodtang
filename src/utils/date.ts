/**
 * Deterministically parses natural and formatted Thai/English dates.
 * Supports:
 * - "วันนี้", "today" -> current date
 * - "เมื่อวาน", "เมื่อวานนี้", "yesterday" -> current date - 1 day
 * - "พรุ่งนี้", "tomorrow" -> current date + 1 day
 * - "YYYY-MM-DD" or "YYYY/MM/DD" (converts Buddhist Era >= 2400 to CE by subtracting 543)
 * - "DD/MM/YYYY" or "D/M/YYYY" or "DD-MM-YYYY" (converts Buddhist Era >= 2400 to CE by subtracting 543)
 * - ISO date strings
 *
 * Returns formatted ISO date string "YYYY-MM-DD" or null if unparseable.
 */
export function parseNaturalThaiDate(input: string, referenceDate: Date = new Date()): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim().toLowerCase();

  // 1. Relative Thai/English keywords
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

  // 2. Format: YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = trimmed.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (ymdMatch) {
    let year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    if (year >= 2400) {
      year -= 543; // BE to CE
    }
    if (isValidDateComponents(year, month, day)) {
      return formatYmd(year, month, day);
    }
    return null;
  }

  // 3. Format: DD/MM/YYYY or D/M/YYYY or DD-MM-YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);
    if (year >= 2400) {
      year -= 543; // BE to CE
    }
    if (isValidDateComponents(year, month, day)) {
      return formatYmd(year, month, day);
    }
    return null;
  }

  // 4. Standard ISO string parsing fallback
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return formatDateIso(parsed);
  }

  return null;
}

function isValidDateComponents(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
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
