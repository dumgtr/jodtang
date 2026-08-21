import {
  QueryResult,
  SummaryQueryResult,
  RankingQueryResult,
  ListingQueryResult,
  CountQueryResult,
  TransactionFilterType,
} from '../types/query';

/**
 * Q3: Deterministic Query Result Formatter.
 *
 * Converts structured QueryResult objects (produced by the Deterministic
 * Query Engine) into human-readable Thai text for LINE messages.
 *
 * Guarantees:
 * - DETERMINISTIC: same input always yields byte-identical output.
 * - NO RECALCULATION: amounts are rendered verbatim from the engine result.
 *   This service never sums, averages, or derives any monetary value.
 * - PURE / READ-ONLY: never mutates the input result.
 */

/** Thai month abbreviations indexed 1-12 (Jan..Dec). */
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

const TYPE_LABELS: Record<TransactionFilterType, string> = {
  EXPENSE: 'รายจ่าย',
  INCOME: 'รายรับ',
  TRANSFER: 'โอนเงิน',
  ALL: 'รายการทั้งหมด',
};

const MEDAL_BADGES = ['🥇', '🥈', '🥉'] as const;

/**
 * Formats an amount as Thai currency text, e.g. 5579 -> "5,579 บาท",
 * 1250.5 -> "1,250.50 บาท". Rounds to 2 decimal places only for display;
 * the underlying value is never recomputed or accumulated.
 */
function formatThaiCurrency(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  const hasDecimals = !Number.isInteger(rounded);
  const formatted = rounded.toLocaleString('en-US', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} บาท`;
}

/**
 * Renders an ISO date (YYYY-MM-DD) as Thai Buddhist-era dd/mm/yyyy,
 * e.g. "2026-08-21" -> "21/08/2569". Pure string slicing: no Date
 * parsing, therefore immune to timezone shifts.
 */
function formatThaiBuddhistDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${Number(year) + 543}`;
}

/** Medal badge for top-3 ranks, numeric prefix otherwise. */
function rankBadge(rank: number): string {
  return MEDAL_BADGES[rank - 1] ?? `${rank}.`;
}

function typeLabel(transactionType: TransactionFilterType): string {
  return TYPE_LABELS[transactionType] ?? TYPE_LABELS.ALL;
}

/** " · <label>" suffix built from the resolved date range label. */
function rangeSuffix(dateRange: { label: string }): string {
  return dateRange.label ? ` · ${dateRange.label}` : '';
}

/** Filter context line, e.g. "🔍 หมวด: X · ร้าน: Y" (omits absent filters). */
function filterLine(category?: string | null, merchant?: string | null): string | null {
  const parts: string[] = [];
  if (category) parts.push(`หมวด: ${category}`);
  if (merchant) parts.push(`ร้าน: ${merchant}`);
  return parts.length > 0 ? `🔍 ${parts.join(' · ')}` : null;
}

/** Friendly no-data message shared by every result type. */
function emptyMessage(transactionType: TransactionFilterType, label: string): string {
  return `📭 ไม่พบรายการ${typeLabel(transactionType)}ในช่วง ${label || 'ที่ระบุ'} ครับ`;
}

function formatSummary(result: SummaryQueryResult): string {
  // Empty = no transactions at all. A zero total WITH transactions is a
  // legitimate answer (e.g. free items) and must still render the amount.
  if (result.transactionCount === 0) {
    return emptyMessage(result.transactionType, result.dateRange.label);
  }

  const lines: string[] = [
    `📊 สรุป${typeLabel(result.transactionType)}${rangeSuffix(result.dateRange)}`,
    `💰 รวม ${formatThaiCurrency(result.totalAmount)}`,
    `🧾 ${result.transactionCount} รายการ`,
  ];

  const filters = filterLine(result.filteredCategory, result.filteredMerchant);
  if (filters) lines.push(filters);

  if (result.categoryBreakdown && result.categoryBreakdown.length > 0) {
    lines.push('📂 แยกตามหมวดหมู่:');
    for (const item of result.categoryBreakdown) {
      let line = `- ${item.name}: ${formatThaiCurrency(item.amount)} (${item.count} รายการ)`;
      if (item.percentage !== undefined) {
        line += ` · ${item.percentage.toFixed(1)}%`;
      }
      lines.push(line);
    }
  }

  return lines.join('\n');
}

function formatRanking(result: RankingQueryResult): string {
  if (result.rankings.length === 0) {
    return emptyMessage(result.transactionType, result.dateRange.label);
  }

  const groupNoun = result.groupBy === 'CATEGORY' ? 'หมวดหมู่' : 'ร้านค้า';
  const lines: string[] = [
    `🏆 อันดับ${groupNoun}${rangeSuffix(result.dateRange)}`,
  ];

  for (const entry of result.rankings) {
    lines.push(
      `${rankBadge(entry.rank)} ${entry.name} · ${formatThaiCurrency(entry.amount)} (${entry.count} รายการ)`
    );
  }

  lines.push(`💰 รวม ${formatThaiCurrency(result.totalAmount)}`);
  return lines.join('\n');
}

function formatListing(result: ListingQueryResult): string {
  if (result.items.length === 0) {
    return emptyMessage(result.transactionType, result.dateRange.label);
  }

  const lines: string[] = [
    `📋 รายการ${typeLabel(result.transactionType)}${rangeSuffix(result.dateRange)}`,
  ];

  for (const item of result.items) {
    lines.push(
      `[${formatThaiBuddhistDate(item.occurredAt)}] ${item.merchant} · ${item.description} · ${formatThaiCurrency(item.amount)} (${item.category})`
    );
  }

  lines.push(`💰 รวม ${formatThaiCurrency(result.totalAmount)} (${result.count} รายการ)`);
  return lines.join('\n');
}

function formatCount(result: CountQueryResult): string {
  if (result.count === 0) {
    return emptyMessage(result.transactionType, result.dateRange.label);
  }

  const lines: string[] = [
    `🔢 นับรายการ${rangeSuffix(result.dateRange)}`,
    `พบ ${result.count} ครั้ง`,
  ];

  const filters = filterLine(result.filteredCategory, result.filteredMerchant);
  if (filters) lines.push(filters);

  return lines.join('\n');
}

/**
 * Formats any QueryResult into deterministic Thai text.
 * Never throws on unknown result types — returns a graceful fallback.
 */
export function formatQueryResult(result: QueryResult): string {
  switch (result.type) {
    case 'SUMMARY':
      return formatSummary(result);
    case 'RANKING':
      return formatRanking(result);
    case 'LISTING':
      return formatListing(result);
    case 'COUNT':
      return formatCount(result);
    default:
      return '⚠️ ไม่สามารถแสดงผลลัพธ์ประเภทนี้ได้';
  }
}
