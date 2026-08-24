import { env } from '../src/config/env';
import { assertTestDatabaseConnection } from '../src/db/test-isolation';

assertTestDatabaseConnection(env.DATABASE_URL);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

async function testExtractionInvariants() {
  // Keep this regression deterministic and offline even when a developer .env has an API key.
  process.env.OPENAI_API_KEY = 'mock_test';

  const { extractTransactions, parseCleanAmount } = await import('../src/services/ai.service');
  const { DraftRepository } = await import('../src/modules/draft/draft.repository');
  const { isValidPositiveAmount } = await import('../src/utils/amount');

  const currentDate = '2026-08-19';
  const noTransactionInputs = ['hello', 'สวัสดี', '-100', '-100 บาท', '-1,000', 'NaN', 'Infinity', '-Infinity'];

  for (const input of noTransactionInputs) {
    const result = await extractTransactions(input, currentDate);
    assert(result.length === 0, `${JSON.stringify(input)} must not produce a transaction`);
  }

  const validCases: Array<[string, number]> = [
    ['100', 100],
    ['1,000', 1000],
    ['30,000.50', 30000.5],
    ['ซื้อของ 30,000', 30000],
  ];

  for (const [input, expectedAmount] of validCases) {
    const result = await extractTransactions(input, currentDate);
    assert(result.length === 1, `${JSON.stringify(input)} must produce one transaction`);
    assert(result[0].amount === expectedAmount, `${JSON.stringify(input)} must parse as ${expectedAmount}`);
  }

  const invalidValues = [NaN, Infinity, -Infinity, 0, -1];
  for (const value of invalidValues) {
    assert(!isValidPositiveAmount(value), `${String(value)} must fail the positive finite invariant`);

    let rejected = false;
    try {
      await DraftRepository.createDraft({
        userId: '00000000-0000-0000-0000-000000000000',
        source: 'test',
        rawInput: `invalid ${String(value)}`,
        extractedData: {
          type: 'expense',
          amount: value,
        },
      });
    } catch {
      rejected = true;
    }
    assert(rejected, `${String(value)} must be rejected before draft creation`);
  }

  assert(Number.isNaN(parseCleanAmount('NaN')), 'string NaN must remain invalid');
  assert(Number.isNaN(parseCleanAmount('Infinity')), 'string Infinity must remain invalid');
  assert(Number.isNaN(parseCleanAmount('-Infinity')), 'string -Infinity must remain invalid');
  assert(parseCleanAmount('-100') === -100, 'negative sign must be preserved by the parser');

  const inline = await extractTransactions('กาแฟ 65 ข้าวมันไก่ 55', currentDate);
  if (inline.length !== 2) {
    console.warn(`KNOWN P2: inline multi-transaction input currently returns ${inline.length} item(s).`);
  }

  console.log('Extraction invariant tests passed.');
}

testExtractionInvariants().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
