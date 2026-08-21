import OpenAI from 'openai';
import { env } from '../config/env';
import { isValidPositiveAmount } from '../utils/amount';
import { logInternalError } from '../utils/errors';

export interface ExtractedTransaction {
  type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
  amount: number;
  merchant: string;
  category: string;
  description: string;
  date: string;
}

// Lazy OpenAI Client
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
 * Returns the exact production system prompt for financial transaction extraction.
 */
export function getSystemPrompt(currentDate: string): string {
  return `You are an expert Thai financial transaction parser for the "จดตัง" app.
Current Date: ${currentDate}

Allowed Categories:
- อาหารและเครื่องดื่ม
- การเดินทาง/ยานพาหนะ
- ช้อปปิ้ง/ของใช้/อุปกรณ์
- บิล/ค่าใช้จ่าย/สาธารณูปโภค
- สุขภาพ/ความงาม
- ความบันเทิง/สังสรรค์
- โอนเงิน/ทั่วไป
- รายรับ/เงินเดือน/ธุรกิจ

CRITICAL RULES:
1. Parse numbers with commas (e.g. "30,000" or "1,500.50") as full numbers (30000 or 1500.50). NEVER drop digits after a comma.
2. If multiple transactions are mentioned (e.g. "กินข้าว 200 \\n ล้างรถ 300" or "กาแฟ 60 ข้าวมันไก่ 50"), extract EACH one as a separate item in the "transactions" array.
3. Determine if each item is an EXPENSE, INCOME, or TRANSFER.
4. Output strict JSON only matching the schema below. No explanations or markdown.

JSON Schema:
{
  "transactions": [
    {
      "type": "EXPENSE",
      "amount": number,
      "merchant": string,
      "category": string,
      "description": string,
      "date": "YYYY-MM-DD"
    }
  ]
}`;
}

/**
 * Deterministic number parser that preserves a leading sign.
 * Invalid and non-finite values become NaN and are rejected by the positive
 * amount invariant before any draft can be created.
 */
export function parseCleanAmount(val: unknown): number {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : Number.NaN;
  }

  if (typeof val !== 'string') {
    return Number.NaN;
  }

  const match = val.trim().match(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/);
  if (!match) {
    return Number.NaN;
  }

  const parsed = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Allowed standard categories for "จดตัง"
 */
export const ALLOWED_CATEGORIES = [
  'อาหารและเครื่องดื่ม',
  'การเดินทาง/ยานพาหนะ',
  'ช้อปปิ้ง/ของใช้/อุปกรณ์',
  'บิล/ค่าใช้จ่าย/สาธารณูปโภค',
  'สุขภาพ/ความงาม',
  'ความบันเทิง/สังสรรค์',
  'โอนเงิน/ทั่วไป',
  'รายรับ/เงินเดือน/ธุรกิจ',
] as const;

/**
 * Checks if the text has financial intent (contains at least one number).
 */
export function hasFinancialIntent(text: string): boolean {
  const numberRegex = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/;
  return numberRegex.test(text.trim());
}

/**
 * Fallback regex extractor when running offline or without OpenAI API key.
 */
function fallbackExtractionMulti(text: string, currentDate: string): ExtractedTransaction[] {
  if (!hasFinancialIntent(text)) {
    return [];
  }

  const lines = text.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);
  const results: ExtractedTransaction[] = [];
  const numberRegex = /[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/;

  for (const line of lines) {
    const amountMatch = line.match(numberRegex);
    if (!amountMatch) continue;

    const rawAmountStr = amountMatch[0];
    const amount = parseCleanAmount(rawAmountStr);
    if (!isValidPositiveAmount(amount)) continue;

    let type: 'EXPENSE' | 'INCOME' | 'TRANSFER' = 'EXPENSE';
    let category = 'อาหารและเครื่องดื่ม';

    const lower = line.toLowerCase();

    if (lower.includes('เงินเดือน') || lower.includes('รายรับ') || lower.includes('ได้เงิน') || lower.includes('โบนัส')) {
      type = 'INCOME';
      category = 'รายรับ/เงินเดือน/ธุรกิจ';
    } else if (
      lower.includes('เอฟเฟกต์') ||
      lower.includes('กีตาร์') ||
      lower.includes('ดนตรี') ||
      lower.includes('ช้อป') ||
      lower.includes('ซื้อของ') ||
      lower.includes('เสื้อ') ||
      lower.includes('รองเท้า') ||
      lower.includes('กล้อง') ||
      lower.includes('คอม') ||
      lower.includes('มือถือ') ||
      lower.includes('gadget')
    ) {
      category = 'ช้อปปิ้ง/ของใช้/อุปกรณ์';
    } else if (
      lower.includes('รถ') ||
      lower.includes('bts') ||
      lower.includes('mrt') ||
      lower.includes('น้ำมัน') ||
      lower.includes('วิน') ||
      lower.includes('แท็กซี่') ||
      lower.includes('grab') ||
      lower.includes('ทางด่วน')
    ) {
      category = 'การเดินทาง/ยานพาหนะ';
    } else if (
      lower.includes('ค่าไฟ') ||
      lower.includes('ค่าน้ำ') ||
      lower.includes('ค่าเน็ต') ||
      lower.includes('ค่าห้อง') ||
      lower.includes('บิล') ||
      lower.includes('ประกัน')
    ) {
      category = 'บิล/ค่าใช้จ่าย/สาธารณูปโภค';
    } else if (lower.includes('ยา') || lower.includes('หมอ') || lower.includes('ฟิตเนส') || lower.includes('สปา')) {
      category = 'สุขภาพ/ความงาม';
    } else if (lower.includes('เหล้า') || lower.includes('เบียร์') || lower.includes('คอนเสิร์ต') || lower.includes('หนัง')) {
      category = 'ความบันเทิง/สังสรรค์';
    } else if (lower.includes('โอน') || lower.includes('ย้าย')) {
      type = 'TRANSFER';
      category = 'โอนเงิน/ทั่วไป';
    }

    const merchant = line.replace(numberRegex, '').trim() || line;

    results.push({
      type,
      amount,
      merchant,
      category,
      description: line,
      date: currentDate,
    });
  }

  return results;
}

/**
 * Extracts structured financial transactions from natural language text using OpenAI.
 * Strictly parses single or multiple items into a verified transactions array.
 */
export async function extractTransactions(
  text: string,
  currentDate: string
): Promise<ExtractedTransaction[]> {
  // 1. Check financial intent first (if no numbers, avoid calling LLM)
  if (!hasFinancialIntent(text)) {
    return [];
  }

  const client = getOpenAIClient();
  if (!client) {
    return fallbackExtractionMulti(text, currentDate);
  }

  try {
    const systemPrompt = getSystemPrompt(currentDate);

    const response = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.0,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content?.trim() || '{}';
    const cleanJson = content.replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleanJson);

    const rawList = Array.isArray(parsed.transactions)
      ? parsed.transactions
      : Array.isArray(parsed)
      ? parsed
      : [parsed];

    // Code-level post-processing and sanitization
    const mapped: ExtractedTransaction[] = rawList.map((item: any) => {
      const typeStr = String(item.type || 'EXPENSE').toUpperCase();
      const type: 'EXPENSE' | 'INCOME' | 'TRANSFER' =
        typeStr === 'INCOME' ? 'INCOME' : typeStr === 'TRANSFER' ? 'TRANSFER' : 'EXPENSE';

      const amount = parseCleanAmount(item.amount);
      const merchant = String(item.merchant || item.description || 'ทั่วไป').trim();
      const category = String(item.category || 'ทั่วไป').trim();
      const description = String(item.description || item.merchant || text).trim();
      const date = String(item.date || currentDate).trim();

      return {
        type,
        amount,
        merchant,
        category,
        description,
        date,
      };
    });

    // Enforce amount > 0 invariant
    return mapped.filter((t: ExtractedTransaction) => isValidPositiveAmount(t.amount));
  } catch (error) {
    logInternalError('[AI Service] Multi-transaction extraction failed; using deterministic fallback', error);
    return fallbackExtractionMulti(text, currentDate);
  }
}
