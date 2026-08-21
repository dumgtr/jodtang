import { DateRangeSpec, ResolvedDateRange } from '../types/query';
import { parseNaturalThaiDate, normalizeYear, isValidDateComponents } from './date';

const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const THAI_MONTH_ABBR = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/**
 * Deterministically resolves a DateRangeSpec into exact ISO start/end date bounds
 * and a human-friendly Thai label.
 *
 * @param spec The date range specification from the QueryIntent.
 * @param referenceDate Current reference date (defaults to now, in Asia/Bangkok).
 */
export function resolveQueryDateRange(
  spec: DateRangeSpec,
  referenceDate: string | Date = new Date()
): ResolvedDateRange {
  const ref = typeof referenceDate === 'string'
    ? parseIsoToBangkokDate(referenceDate)
    : referenceDate;

  const year = getBangkokYear(ref);
  const month = getBangkokMonth(ref); // 1-12
  const day = getBangkokDay(ref);     // 1-31

  switch (spec.type) {
    case 'TODAY': {
      const iso = formatYmd(year, month, day);
      return {
        startDate: iso,
        endDate: iso,
        label: `วันนี้ (${formatThaiReadableDate(year, month, day)})`,
      };
    }

    case 'YESTERDAY': {
      const yDate = new Date(year, month - 1, day - 1);
      const yYear = yDate.getFullYear();
      const yMonth = yDate.getMonth() + 1;
      const yDay = yDate.getDate();
      const iso = formatYmd(yYear, yMonth, yDay);
      return {
        startDate: iso,
        endDate: iso,
        label: `เมื่อวาน (${formatThaiReadableDate(yYear, yMonth, yDay)})`,
      };
    }

    case 'THIS_WEEK': {
      // Monday to Sunday of the current week (ISO week)
      const currentDayOfWeek = new Date(year, month - 1, day).getDay(); // 0 = Sunday, 1 = Monday
      const diffToMonday = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
      const mondayDate = new Date(year, month - 1, day + diffToMonday);
      const sundayDate = new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate() + 6);

      const startIso = formatYmd(mondayDate.getFullYear(), mondayDate.getMonth() + 1, mondayDate.getDate());
      const endIso = formatYmd(sundayDate.getFullYear(), sundayDate.getMonth() + 1, sundayDate.getDate());

      return {
        startDate: startIso,
        endDate: endIso,
        label: `สัปดาห์นี้ (${formatThaiShortDate(mondayDate.getFullYear(), mondayDate.getMonth() + 1, mondayDate.getDate())} - ${formatThaiShortDate(sundayDate.getFullYear(), sundayDate.getMonth() + 1, sundayDate.getDate())})`,
      };
    }

    case 'LAST_WEEK': {
      const currentDayOfWeek = new Date(year, month - 1, day).getDay();
      const diffToMonday = (currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek) - 7;
      const mondayDate = new Date(year, month - 1, day + diffToMonday);
      const sundayDate = new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate() + 6);

      const startIso = formatYmd(mondayDate.getFullYear(), mondayDate.getMonth() + 1, mondayDate.getDate());
      const endIso = formatYmd(sundayDate.getFullYear(), sundayDate.getMonth() + 1, sundayDate.getDate());

      return {
        startDate: startIso,
        endDate: endIso,
        label: `สัปดาห์ที่แล้ว (${formatThaiShortDate(mondayDate.getFullYear(), mondayDate.getMonth() + 1, mondayDate.getDate())} - ${formatThaiShortDate(sundayDate.getFullYear(), sundayDate.getMonth() + 1, sundayDate.getDate())})`,
      };
    }

    case 'CURRENT_MONTH': {
      const lastDay = getDaysInMonth(year, month);
      const startIso = formatYmd(year, month, 1);
      const endIso = formatYmd(year, month, lastDay);
      return {
        startDate: startIso,
        endDate: endIso,
        label: `เดือนนี้ (${THAI_MONTH_NAMES[month - 1]} ${year + 543})`,
      };
    }

    case 'LAST_MONTH': {
      const prevMonthDate = new Date(year, month - 2, 1);
      const pYear = prevMonthDate.getFullYear();
      const pMonth = prevMonthDate.getMonth() + 1;
      const lastDay = getDaysInMonth(pYear, pMonth);

      const startIso = formatYmd(pYear, pMonth, 1);
      const endIso = formatYmd(pYear, pMonth, lastDay);
      return {
        startDate: startIso,
        endDate: endIso,
        label: `เดือนที่แล้ว (${THAI_MONTH_NAMES[pMonth - 1]} ${pYear + 543})`,
      };
    }

    case 'THIS_YEAR': {
      const startIso = formatYmd(year, 1, 1);
      const endIso = formatYmd(year, 12, 31);
      return {
        startDate: startIso,
        endDate: endIso,
        label: `ปีนี้ (พ.ศ. ${year + 543})`,
      };
    }

    case 'LAST_YEAR': {
      const prevYear = year - 1;
      const startIso = formatYmd(prevYear, 1, 1);
      const endIso = formatYmd(prevYear, 12, 31);
      return {
        startDate: startIso,
        endDate: endIso,
        label: `ปีที่แล้ว (พ.ศ. ${prevYear + 543})`,
      };
    }

    case 'SPECIFIC_DATE': {
      let iso = spec.specific_date || null;
      if (iso && !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        iso = parseNaturalThaiDate(iso, ref);
      }
      if (!iso) {
        iso = formatYmd(year, month, day);
      }

      const [sYear, sMonth, sDay] = iso.split('-').map((v) => parseInt(v, 10));
      return {
        startDate: iso,
        endDate: iso,
        label: `วันที่ ${formatThaiReadableDate(sYear, sMonth, sDay)}`,
      };
    }

    case 'CUSTOM_RANGE': {
      const start = spec.start_date && /^\d{4}-\d{2}-\d{2}$/.test(spec.start_date)
        ? spec.start_date
        : formatYmd(year, month, 1);
      const end = spec.end_date && /^\d{4}-\d{2}-\d{2}$/.test(spec.end_date)
        ? spec.end_date
        : formatYmd(year, month, day);

      return {
        startDate: start,
        endDate: end,
        label: `${start} ถึง ${end}`,
      };
    }

    case 'ALL_TIME':
    default: {
      return {
        startDate: '1970-01-01',
        endDate: '2099-12-31',
        label: 'ทั้งหมด (ทุกช่วงเวลา)',
      };
    }
  }
}

// Helper utilities
function parseIsoToBangkokDate(iso: string): Date {
  const parts = iso.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m - 1, d);
    }
  }
  return new Date();
}

function getBangkokYear(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric' });
  return parseInt(fmt.format(d), 10);
}

function getBangkokMonth(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', month: 'numeric' });
  return parseInt(fmt.format(d), 10);
}

function getBangkokDay(d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', day: 'numeric' });
  return parseInt(fmt.format(d), 10);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function formatYmd(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function formatThaiReadableDate(year: number, month: number, day: number): string {
  return `${day} ${THAI_MONTH_NAMES[month - 1]} ${year + 543}`;
}

function formatThaiShortDate(year: number, month: number, day: number): string {
  return `${day} ${THAI_MONTH_ABBR[month - 1]} ${year + 543}`;
}
