import OpenAI from 'openai';
import { env } from '../config/env';
import { QueryIntent, QueryIntentSchema } from '../types/query';

let _openai: OpenAI | null = null;
function getOpenAIClient(): OpenAI | null {
  if (!_openai) {
    const apiKey =
      env.OPENAI_API_KEY && !env.OPENAI_API_KEY.startsWith('mock_') && env.OPENAI_API_KEY !== 'dummy_key'
        ? env.OPENAI_API_KEY
        : env.OPENROUTER_API_KEY || env.DEEPSEEK_API_KEY;

    if (!apiKey || apiKey.startsWith('mock_') || apiKey === 'dummy_key') {
      return null;
    }
    _openai = new OpenAI({
      apiKey,
      baseURL: env.OPENAI_BASE_URL || undefined,
    });
  }
  return _openai;
}

/**
 * Returns the specialized system prompt for Query Intent Parsing.
 * LLM only classifies the question intent; NEVER performs math or aggregates data.
 */
export function getQueryParserSystemPrompt(currentDate: string): string {
  return `You are an expert Thai financial query intent parser for the "จดตัง" app.
Current Reference Date: ${currentDate}

Allowed Categories:
- อาหารและเครื่องดื่ม
- การเดินทาง/ยานพาหนะ
- ช้อปปิ้ง/ของใช้/อุปกรณ์
- บิล/ค่าใช้จ่าย/สาธารณูปโภค
- สุขภาพ/ความงาม
- ความบันเทิง/สังสรรค์
- โอนเงิน/ทั่วไป
- รายรับ/เงินเดือน/ธุรกิจ

CRITICAL INSTRUCTIONS:
1. Determine the user's inquiry intent:
   - "SUMMARY": Inquiring about totals, spending in a period, or category totals (e.g. "เดือนนี้ใช้เงินไปเท่าไร", "เดือนนี้กินข้าวไปเท่าไร", "สรุปค่าใช้จ่ายเดือนนี้", "เมื่อวานใช้เงินเท่าไร").
   - "RANKING": Inquiring about top spending merchants or top categories (e.g. "เดือนนี้ร้านไหนใช้เงินเยอะที่สุด", "หมวดไหนใช้เงินเยอะสุด", "Top 5 ร้านค้า").
   - "LISTING": Inquiring about itemized transactions (e.g. "อาทิตย์นี้มีค่าใช้จ่ายอะไรบ้าง", "เมื่อวานใช้อะไรไปบ้าง", "ดูรายการล่าสุด").
   - "COUNT": Inquiring about frequency or count of transactions or store visits (e.g. "เดือนนี้มีรายจ่ายกี่รายการ", "วันนี้มีกี่รายการ", "เดือนนี้กิน MK กี่ครั้ง", "เดือนนี้ซื้อของที่ MK กี่ครั้ง", "สัปดาห์นี้มีค่าใช้จ่ายกี่ครั้ง").
   - "UNKNOWN": If the message is NOT a query asking for financial reports (e.g. it is a new transaction input like "กินข้าว 50", a greeting "สวัสดี", or irrelevant text).

2. DO NOT CALCULATE ANY NUMBERS OR BALANCES. Only extract the structured search parameters.

3. Extract Date Range:
   - "TODAY", "YESTERDAY", "THIS_WEEK", "LAST_WEEK", "CURRENT_MONTH", "LAST_MONTH", "THIS_YEAR", "LAST_YEAR", "SPECIFIC_DATE", "ALL_TIME".
   - If user specifies a particular day like "17 สิงหา" or "วันที่ 19", use type "SPECIFIC_DATE" and provide specific_date: "YYYY-MM-DD" or natural text.

4. Extract Transaction Type:
   - "EXPENSE": Default for spending, buying, expenses (e.g. "ใช้เงิน", "จ่าย", "ซื้อ", "กินข้าว").
   - "INCOME": For income, earnings, salary (e.g. "รายรับ", "เงินเดือน", "รายได้").
   - "TRANSFER": For money transfers (e.g. "โอนเงิน", "โอนไป", "โอน").
   - "ALL": For all types combined (e.g. "ทุกประเภท", "ทั้งหมด").

5. Output strict JSON matching the schema below.

JSON Schema:
{
  "intent": "SUMMARY" | "RANKING" | "LISTING" | "COUNT" | "UNKNOWN",
  "date_range": {
    "type": "TODAY" | "YESTERDAY" | "THIS_WEEK" | "LAST_WEEK" | "CURRENT_MONTH" | "LAST_MONTH" | "THIS_YEAR" | "LAST_YEAR" | "SPECIFIC_DATE" | "CUSTOM_RANGE" | "ALL_TIME",
    "specific_date": string | null
  },
  "transaction_type": "EXPENSE" | "INCOME" | "TRANSFER" | "ALL",
  "category": string | null,
  "merchant": string | null,
  "group_by": "CATEGORY" | "MERCHANT" | "DATE" | "TYPE" | "NONE",
  "aggregation": "SUM" | "COUNT" | "AVG" | "NONE",
  "sort_by": "AMOUNT" | "DATE" | "COUNT",
  "sort_order": "ASC" | "DESC",
  "limit": number
}`;
}

/**
 * Parses user natural language text into a validated QueryIntent.
 * Returns null if the text is not a financial query.
 */
export async function parseQueryIntent(
  text: string,
  referenceDate: string = new Date().toISOString().split('T')[0]
): Promise<QueryIntent | null> {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return null;
  }

  const trimmed = text.trim();

  // Fast pre-filter: obvious non-queries (e.g. single numbers or obvious standard expenses without question keywords)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return null; // Bare number is not a query
  }

  const client = getOpenAIClient();
  if (!client) {
    // Fallback deterministic query parsing for test environments
    return parseDeterministicQueryIntentFallback(trimmed, referenceDate);
  }

  try {
    const systemPrompt = getQueryParserSystemPrompt(referenceDate);
    const response = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: trimmed },
      ],
      temperature: 0.0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return null;

    let cleanJson = content.trim();
    const jsonMatch = cleanJson.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (jsonMatch) {
      cleanJson = jsonMatch[1].trim();
    } else {
      const firstBracket = cleanJson.indexOf('{');
      const lastBracket = cleanJson.lastIndexOf('}');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        cleanJson = cleanJson.substring(firstBracket, lastBracket + 1);
      }
    }

    const parsed = JSON.parse(cleanJson);
    if (!parsed || typeof parsed !== 'object') {
      return parseDeterministicQueryIntentFallback(trimmed, referenceDate);
    }

    const intentStr = String(parsed.intent || 'SUMMARY').toUpperCase().trim();
    const intent = ['SUMMARY', 'RANKING', 'LISTING', 'COUNT', 'UNKNOWN'].includes(intentStr)
      ? intentStr
      : 'SUMMARY';

    if (intent === 'UNKNOWN') {
      return null;
    }

    // Normalize date range
    const rawDateRange = parsed.date_range || {};
    let dateType = String(rawDateRange.type || 'CURRENT_MONTH').toUpperCase().trim();
    if (dateType === 'THIS_MONTH' || dateType === 'MONTH' || dateType === 'MONTHLY') dateType = 'CURRENT_MONTH';
    if (dateType === 'PREVIOUS_MONTH' || dateType === 'LASTMONTH') dateType = 'LAST_MONTH';
    if (dateType === 'WEEK' || dateType === 'THISWEEK') dateType = 'THIS_WEEK';

    const validDateTypes = [
      'TODAY', 'YESTERDAY', 'THIS_WEEK', 'LAST_WEEK',
      'CURRENT_MONTH', 'LAST_MONTH', 'THIS_YEAR', 'LAST_YEAR',
      'SPECIFIC_DATE', 'CUSTOM_RANGE', 'ALL_TIME',
    ];
    if (!validDateTypes.includes(dateType)) dateType = 'CURRENT_MONTH';

    // Normalize transaction type
    let txType = String(parsed.transaction_type || 'EXPENSE').toUpperCase().trim();
    if (!['EXPENSE', 'INCOME', 'TRANSFER', 'ALL'].includes(txType)) txType = 'EXPENSE';

    // Normalize group_by
    let groupBy = parsed.group_by ? String(parsed.group_by).toUpperCase().trim() : 'NONE';
    if (!['CATEGORY', 'MERCHANT', 'DATE', 'TYPE', 'NONE'].includes(groupBy)) groupBy = 'NONE';

    // Normalize aggregation
    let agg = String(parsed.aggregation || 'SUM').toUpperCase().trim();
    if (!['SUM', 'COUNT', 'AVG', 'NONE'].includes(agg)) agg = 'SUM';

    // Normalize sort_by
    let sortBy = parsed.sort_by ? String(parsed.sort_by).toUpperCase().trim() : 'AMOUNT';
    if (!['AMOUNT', 'DATE', 'COUNT', 'NONE'].includes(sortBy)) sortBy = 'AMOUNT';

    // Normalize sort_order
    let sortOrder = parsed.sort_order ? String(parsed.sort_order).toUpperCase().trim() : 'DESC';
    if (!['ASC', 'DESC', 'NONE'].includes(sortOrder)) sortOrder = 'DESC';

    // Normalize limit
    let limit: number | null = null;
    if (parsed.limit !== undefined && parsed.limit !== null) {
      const num = Number(parsed.limit);
      if (!isNaN(num) && num >= 0) limit = Math.floor(num);
    }

    const normalized = {
      intent,
      date_range: {
        type: dateType,
        specific_date: rawDateRange.specific_date ? String(rawDateRange.specific_date).trim() : null,
        start_date: rawDateRange.start_date ? String(rawDateRange.start_date).trim() : null,
        end_date: rawDateRange.end_date ? String(rawDateRange.end_date).trim() : null,
      },
      transaction_type: txType,
      category: parsed.category ? String(parsed.category).trim() : null,
      merchant: parsed.merchant ? String(parsed.merchant).trim() : null,
      group_by: groupBy,
      aggregation: agg,
      sort_by: sortBy,
      sort_order: sortOrder,
      limit,
    };

    const validated = QueryIntentSchema.safeParse(normalized);
    if (!validated.success) {
      console.warn('[QueryParser] Schema validation warning; falling back to deterministic parser:', validated.error);
      return parseDeterministicQueryIntentFallback(trimmed, referenceDate);
    }

    return validated.data as QueryIntent;
  } catch (err: any) {
    console.error('[QueryParser] API or Parse Error:', err?.message || err);
    // Graceful fallback to deterministic parsing
    return parseDeterministicQueryIntentFallback(trimmed, referenceDate);
  }
}

/**
 * Matches explicit day expressions: "วันที่ 19", "วันที่ 17 สิงหาคม",
 * "17 สิงหา", "17 ส.ค." — optionally followed by a 2-4 digit year.
 * The matched raw span is stored in date_range.specific_date and converted
 * to an ISO date later by parseNaturalThaiDate() inside the date resolver.
 */
const THAI_MONTH_ALTERNATION = [
  'มกราคม', 'ม\\.ค\\.?', 'กุมภาพันธ์', 'ก\\.พ\\.?', 'มีนาคม', 'มี\\.ค\\.?', 'เมษายน', 'เม\\.ย\\.?',
  'พฤษภาคม', 'พ\\.ค\\.?', 'มิถุนายน', 'มิ\\.ย\\.?', 'กรกฎาคม', 'ก\\.ค\\.?',
  'สิงหาคม', 'สิงหา', 'ส\\.ค\\.?', 'กันยายน', 'ก\\.ย\\.?', 'ตุลาคม', 'ต\\.ค\\.?',
  'พฤศจิกายน', 'พ\\.ย\\.?', 'ธันวาคม', 'ธ\\.ค\\.?',
].join('|');

const SPECIFIC_DAY_PATTERN = new RegExp(
  `(?:วันที่\\s*\\d{1,2}(?:\\s*(?:${THAI_MONTH_ALTERNATION}))?)` +
  `|(?:\\d{1,2}\\s*(?:${THAI_MONTH_ALTERNATION})(?:\\s*\\d{2,4})?)`
);

/**
 * Deterministic intent rule engine fallback for offline testing or fast keywords.
 */
export function parseDeterministicQueryIntentFallback(
  text: string,
  referenceDate: string
): QueryIntent | null {
  const lower = text.toLowerCase();

  // Must have query indicator keywords
  const isQuery =
    lower.includes('เท่าไร') ||
    lower.includes('เท่าไหร่') ||
    lower.includes('อะไรบ้าง') ||
    lower.includes('กี่บาท') ||
    lower.includes('กี่รายการ') ||
    lower.includes('กี่ครั้ง') ||
    lower.includes('สรุป') ||
    lower.includes('เยอะที่สุด') ||
    lower.includes('มากที่สุด') ||
    lower.includes('รายงาน') ||
    lower.includes('สถิติ');

  if (!isQuery) {
    return null;
  }

  // 1. Determine Date Range
  let dateRangeType: any = 'CURRENT_MONTH';
  let specificDate: string | null = null;

  // Explicit day expressions take priority over relative keywords
  // (e.g. "วันที่ 19", "17 สิงหา", "17 ส.ค." -> SPECIFIC_DATE)
  const specificDayMatch = text.match(SPECIFIC_DAY_PATTERN);
  if (specificDayMatch) {
    dateRangeType = 'SPECIFIC_DATE';
    specificDate = specificDayMatch[0].trim();
  } else if (lower.includes('เมื่อวาน')) {
    dateRangeType = 'YESTERDAY';
  } else if (lower.includes('วันนี้')) {
    dateRangeType = 'TODAY';
  } else if (lower.includes('สัปดาห์นี้') || lower.includes('อาทิตย์นี้')) {
    dateRangeType = 'THIS_WEEK';
  } else if (lower.includes('สัปดาห์ที่แล้ว') || lower.includes('อาทิตย์ที่แล้ว')) {
    dateRangeType = 'LAST_WEEK';
  } else if (lower.includes('เดือนที่แล้ว') || lower.includes('เดือนก่อน')) {
    dateRangeType = 'LAST_MONTH';
  } else if (lower.includes('เดือนนี้')) {
    dateRangeType = 'CURRENT_MONTH';
  } else if (lower.includes('ปีนี้')) {
    dateRangeType = 'THIS_YEAR';
  } else if (lower.includes('ปีที่แล้ว')) {
    dateRangeType = 'LAST_YEAR';
  }

  // 2. Determine Intent Type
  let intent: any = 'SUMMARY';
  let groupBy: any = 'NONE';
  let aggregation: any = 'SUM';
  let sortBy: any = 'AMOUNT';
  let sortOrder: any = 'DESC';
  let limit = 5;

  if (lower.includes('เยอะที่สุด') || lower.includes('มากที่สุด') || lower.includes('อันดับ') || lower.includes('top')) {
    intent = 'RANKING';
    if (lower.includes('ร้าน') || lower.includes('ที่ไหน')) {
      groupBy = 'MERCHANT';
    } else if (lower.includes('หมวด')) {
      groupBy = 'CATEGORY';
    } else {
      groupBy = 'MERCHANT';
    }
  } else if (lower.includes('อะไรบ้าง') || lower.includes('รายการบ้าง') || lower.includes('มีอะไร') || lower.includes('ดูรายการ')) {
    intent = 'LISTING';
    aggregation = 'NONE';
    sortBy = 'DATE';
    limit = 10;
  } else if (lower.includes('กี่รายการ') || lower.includes('กี่ครั้ง')) {
    intent = 'COUNT';
    aggregation = 'COUNT';
  }

  // 3. Category matching
  let category: string | null = null;
  if (lower.includes('กินข้าว') || lower.includes('อาหาร') || lower.includes('กาแฟ') || lower.includes('ชาบู') || lower.includes('ของกิน')) {
    category = 'อาหารและเครื่องดื่ม';
  } else if (lower.includes('น้ำมัน') || lower.includes('รถ') || lower.includes('เดินทาง') || lower.includes('bts') || lower.includes('mrt')) {
    category = 'การเดินทาง/ยานพาหนะ';
  } else if (lower.includes('ช้อป') || lower.includes('ซื้อของ') || lower.includes('เสื้อ')) {
    category = 'ช้อปปิ้ง/ของใช้/อุปกรณ์';
  } else if (lower.includes('ค่าไฟ') || lower.includes('ค่าน้ำ') || lower.includes('บิล') || lower.includes('เน็ต')) {
    category = 'บิล/ค่าใช้จ่าย/สาธารณูปโภค';
  }

  // 4. Merchant matching
  let merchant: string | null = null;
  if (lower.includes('mk')) merchant = 'MK';
  else if (lower.includes('lotus')) merchant = 'Lotus';
  else if (lower.includes('ปตท')) merchant = 'ปตท';

  // 5. Transaction type detection (default EXPENSE)
  // INCOME: รายรับ / เงินเดือน / รายได้ / ขายของ / โบนัส
  // TRANSFER: โอน / โอนเงิน / โอนให้
  // ALL: ทุกประเภท / ทั้งหมด / รวมทุกอย่าง (never when a specific type keyword matched)
  let transactionType: any = 'EXPENSE';
  if (lower.includes('โอน')) {
    transactionType = 'TRANSFER';
  } else if (
    lower.includes('รายรับ') ||
    lower.includes('เงินเดือน') ||
    lower.includes('รายได้') ||
    lower.includes('ขายของ') ||
    lower.includes('โบนัส')
  ) {
    transactionType = 'INCOME';
  } else if (
    lower.includes('ทุกประเภท') ||
    lower.includes('ทั้งหมด') ||
    lower.includes('รวมทุกอย่าง')
  ) {
    transactionType = 'ALL';
  }

  return {
    intent,
    date_range: {
      type: dateRangeType,
      specific_date: specificDate,
    },
    transaction_type: transactionType,
    category,
    merchant,
    group_by: groupBy,
    aggregation,
    sort_by: sortBy,
    sort_order: sortOrder,
    limit,
  };
}
