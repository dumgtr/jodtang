import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import { getSystemPrompt } from '../src/services/ai.service';
import { env } from '../src/config/env';

export interface BenchmarkCase {
  id: string;
  tier: 'A_SIMPLE' | 'B_COLLOQUIAL' | 'C_NATURAL' | 'D_DATE' | 'E_AMBIGUOUS' | 'F_COMPLEX';
  input: string;
  reference_date: string;
  expected: Array<{
    type: 'EXPENSE' | 'INCOME' | 'TRANSFER';
    amount: number;
    category: string;
    merchant: string;
    description: string;
    date: string;
  }>;
}

export interface ModelConfig {
  name: string;
  displayName: string;
  baseURL?: string;
  apiKey: string;
  model: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface CaseEvaluationResult {
  caseId: string;
  tier: string;
  input: string;
  latencyMs: number;
  tokensUsed: { prompt: number; completion: number; total: number };
  jsonValid: boolean;
  amountScore: number;
  dateScore: number;
  categoryScore: number;
  merchantScore: number;
  descriptionScore: number;
  weightedScore: number;
  isCriticalFailure: boolean;
  criticalReasons: string[];
  isFullyCorrect: boolean;
  actual: any;
  expected: any;
}

export interface ModelBenchmarkSummary {
  modelName: string;
  displayName: string;
  totalCases: number;
  jsonValidityRate: number;
  amountAccuracy: number;
  dateAccuracy: number;
  categoryAccuracy: number;
  merchantAccuracy: number;
  descriptionAccuracy: number;
  overallWeightedAccuracy: number;
  criticalFailures: number;
  fullyCorrectCount: number;
  fullyCorrectRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalCostUsd: number;
  estCostPer1kMsgs: number;
  costPer1kCorrectTx: number;
}

// Model Registry
function getCandidateModels(): ModelConfig[] {
  const models: ModelConfig[] = [];

  const openRouterKey = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || 'mock_key';
  const deepseekKey = process.env.DEEPSEEK_API_KEY || env.DEEPSEEK_API_KEY || openRouterKey || 'mock_key';

  // 1. DeepSeek Chat (Direct DeepSeek API)
  models.push({
    name: 'deepseek-chat',
    displayName: 'DeepSeek Chat',
    baseURL: 'https://api.deepseek.com',
    apiKey: deepseekKey,
    model: 'deepseek-chat',
    inputPricePerMillion: 0.14,
    outputPricePerMillion: 0.28,
  });

  // 2. Qwen 3.6 Flash (OpenRouter)
  models.push({
    name: 'qwen3.6-flash',
    displayName: 'Qwen 3.6 Flash',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: openRouterKey,
    model: 'qwen/qwen3.6-flash',
    inputPricePerMillion: 0.05,
    outputPricePerMillion: 0.15,
  });

  // 3. Qwen Plus (OpenRouter)
  models.push({
    name: 'qwen-plus',
    displayName: 'Qwen Plus',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: openRouterKey,
    model: 'qwen/qwen-plus',
    inputPricePerMillion: 0.40,
    outputPricePerMillion: 1.20,
  });

  return models;
}

// Deterministic Single Case Evaluation Engine
function evaluateCase(
  testCase: BenchmarkCase,
  rawOutput: string | null,
  latencyMs: number,
  tokens: { prompt: number; completion: number; total: number }
): CaseEvaluationResult {
  const result: CaseEvaluationResult = {
    caseId: testCase.id,
    tier: testCase.tier,
    input: testCase.input,
    latencyMs,
    tokensUsed: tokens,
    jsonValid: false,
    amountScore: 0,
    dateScore: 0,
    categoryScore: 0,
    merchantScore: 0,
    descriptionScore: 0,
    weightedScore: 0,
    isCriticalFailure: false,
    criticalReasons: [],
    isFullyCorrect: false,
    actual: null,
    expected: testCase.expected,
  };

  if (!rawOutput) {
    result.isCriticalFailure = true;
    result.criticalReasons.push('NO_RESPONSE');
    return result;
  }

  let parsed: any;
  try {
    let cleanJson = rawOutput.trim();
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
    parsed = JSON.parse(cleanJson);
    result.jsonValid = true;
  } catch (err) {
    result.jsonValid = false;
    result.isCriticalFailure = true;
    result.criticalReasons.push('JSON_PARSE_ERROR');
    return result;
  }

  const rawList = Array.isArray(parsed.transactions)
    ? parsed.transactions
    : Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && parsed.amount !== undefined
    ? [parsed]
    : [];

  result.actual = rawList;

  // Expected empty (Non-financial intent)
  if (testCase.expected.length === 0) {
    if (rawList.length === 0) {
      result.amountScore = 1;
      result.dateScore = 1;
      result.categoryScore = 1;
      result.merchantScore = 1;
      result.descriptionScore = 1;
      result.weightedScore = 1.0;
      result.isFullyCorrect = true;
    } else {
      result.isCriticalFailure = true;
      result.criticalReasons.push('HALLUCINATED_TRANSACTION_ON_NON_FINANCIAL');
    }
    return result;
  }

  if (rawList.length === 0) {
    result.isCriticalFailure = true;
    result.criticalReasons.push('MISSED_TRANSACTION');
    return result;
  }

  // Multi-item / Single item evaluation
  let totalAmountScore = 0;
  let totalDateScore = 0;
  let totalCatScore = 0;
  let totalMerchScore = 0;
  let totalDescScore = 0;

  for (let i = 0; i < testCase.expected.length; i++) {
    const exp = testCase.expected[i];
    const act = rawList[i] || {};

    const expAmt = Number(exp.amount);
    const actAmt = Number(act.amount);

    // 1. Amount (30% weight) - Strict Numerical Equality
    if (Math.abs(expAmt - actAmt) < 0.01) {
      totalAmountScore += 1;
    } else {
      result.isCriticalFailure = true;
      result.criticalReasons.push(`AMOUNT_MISMATCH (Expected: ${expAmt}, Actual: ${actAmt})`);
    }

    // 2. Date (20% weight) - Strict ISO Date Equality
    const actDate = String(act.date || '').trim();
    if (actDate === exp.date) {
      totalDateScore += 1;
    } else {
      result.isCriticalFailure = true;
      result.criticalReasons.push(`DATE_MISMATCH (Expected: ${exp.date}, Actual: ${actDate})`);
    }

    // 3. Type (Critical check)
    const actType = String(act.type || 'EXPENSE').toUpperCase();
    if (actType !== exp.type) {
      result.isCriticalFailure = true;
      result.criticalReasons.push(`TYPE_MISMATCH (Expected: ${exp.type}, Actual: ${actType})`);
    }

    // 4. Category (20% weight)
    const actCat = String(act.category || '').trim();
    if (actCat === exp.category || actCat.includes(exp.category) || exp.category.includes(actCat)) {
      totalCatScore += 1;
    } else {
      totalCatScore += 0.5; // Partial credit for close category
    }

    // 5. Merchant (15% weight)
    const actMerch = String(act.merchant || '').trim().toLowerCase();
    const expMerch = exp.merchant.trim().toLowerCase();
    if (actMerch === expMerch || actMerch.includes(expMerch) || expMerch.includes(actMerch)) {
      totalMerchScore += 1;
    } else {
      totalMerchScore += 0.5;
    }

    // 6. Description (10% weight)
    const actDesc = String(act.description || '').trim();
    if (actDesc.length > 0) {
      totalDescScore += 1;
    }
  }

  const count = testCase.expected.length;
  result.amountScore = totalAmountScore / count;
  result.dateScore = totalDateScore / count;
  result.categoryScore = totalCatScore / count;
  result.merchantScore = totalMerchScore / count;
  result.descriptionScore = totalDescScore / count;

  // Weighted Calculation: Amount 30%, Date 20%, Category 20%, Merchant 15%, Description 10%, JSON 5%
  result.weightedScore =
    result.amountScore * 0.30 +
    result.dateScore * 0.20 +
    result.categoryScore * 0.20 +
    result.merchantScore * 0.15 +
    result.descriptionScore * 0.10 +
    (result.jsonValid ? 0.05 : 0.0);

  result.isFullyCorrect = result.weightedScore >= 0.95 && !result.isCriticalFailure;

  return result;
}

// Mock inference for dry-run verification
function generateMockResponse(testCase: BenchmarkCase, modelName: string): string {
  if (testCase.expected.length === 0) {
    return JSON.stringify({ transactions: [] });
  }

  // Slightly perturb for testing metric sensitivity
  const isQwen = modelName.includes('qwen');
  const items = testCase.expected.map((exp) => ({
    type: exp.type,
    amount: exp.amount,
    category: isQwen && Math.random() < 0.03 ? 'ทั่วไป' : exp.category,
    merchant: exp.merchant,
    description: exp.description,
    date: exp.date,
  }));

  return JSON.stringify({ transactions: items });
}

// Run benchmark for a single model
async function runModelBenchmark(
  modelConfig: ModelConfig,
  dataset: BenchmarkCase[],
  isDryRun: boolean
): Promise<{ summary: ModelBenchmarkSummary; results: CaseEvaluationResult[] }> {
  console.log(`\n🚀 Testing [${modelConfig.displayName}] on ${dataset.length} cases...`);

  let client: OpenAI | null = null;
  if (!isDryRun && modelConfig.apiKey && !modelConfig.apiKey.startsWith('mock_')) {
    client = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseURL,
    });
  }

  const results: CaseEvaluationResult[] = [];
  const startTime = Date.now();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (let i = 0; i < dataset.length; i++) {
    const testCase = dataset[i];
    const systemPrompt = getSystemPrompt(testCase.reference_date);
    const caseStart = Date.now();
    let rawOutput: string | null = null;
    let tokens = { prompt: 350, completion: 80, total: 430 };

    if (isDryRun || !client) {
      // Simulate network latency & token usage
      await new Promise((resolve) => setTimeout(resolve, 5));
      rawOutput = generateMockResponse(testCase, modelConfig.name);
    } else {
      try {
        const response = await client.chat.completions.create({
          model: modelConfig.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: testCase.input },
          ],
          temperature: 0.0,
          response_format: { type: 'json_object' },
        });

        rawOutput = response.choices[0]?.message?.content || null;
        if (response.usage) {
          tokens = {
            prompt: response.usage.prompt_tokens,
            completion: response.usage.completion_tokens,
            total: response.usage.total_tokens,
          };
        }
      } catch (err: any) {
        console.error(`\n[API Call Error - ${modelConfig.displayName} - Case ${testCase.id}]`, err?.message || err);
        rawOutput = null;
      }
    }

    const latencyMs = Date.now() - caseStart;
    totalInputTokens += tokens.prompt;
    totalOutputTokens += tokens.completion;

    const evalResult = evaluateCase(testCase, rawOutput, latencyMs, tokens);
    results.push(evalResult);

    if ((i + 1) % 50 === 0 || i + 1 === dataset.length) {
      process.stdout.write(`   Progress: ${i + 1}/${dataset.length} cases done...\r`);
    }
  }

  console.log(`\n   Completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);

  // Calculate Aggregates
  const totalCases = results.length;
  const jsonValidityRate = (results.filter((r) => r.jsonValid).length / totalCases) * 100;
  const amountAccuracy = (results.reduce((acc, r) => acc + r.amountScore, 0) / totalCases) * 100;
  const dateAccuracy = (results.reduce((acc, r) => acc + r.dateScore, 0) / totalCases) * 100;
  const categoryAccuracy = (results.reduce((acc, r) => acc + r.categoryScore, 0) / totalCases) * 100;
  const merchantAccuracy = (results.reduce((acc, r) => acc + r.merchantScore, 0) / totalCases) * 100;
  const descriptionAccuracy = (results.reduce((acc, r) => acc + r.descriptionScore, 0) / totalCases) * 100;
  const overallWeightedAccuracy = (results.reduce((acc, r) => acc + r.weightedScore, 0) / totalCases) * 100;
  const criticalFailures = results.filter((r) => r.isCriticalFailure).length;
  const fullyCorrectCount = results.filter((r) => r.isFullyCorrect).length;
  const fullyCorrectRate = (fullyCorrectCount / totalCases) * 100;

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = latencies.reduce((a, b) => a + b, 0) / totalCases;
  const p95LatencyMs = latencies[Math.floor(totalCases * 0.95)] || avgLatencyMs;

  const totalCostUsd =
    (totalInputTokens / 1_000_000) * modelConfig.inputPricePerMillion +
    (totalOutputTokens / 1_000_000) * modelConfig.outputPricePerMillion;
  const estCostPer1kMsgs = (totalCostUsd / totalCases) * 1000;
  const costPer1kCorrectTx = fullyCorrectCount > 0 ? (totalCostUsd / fullyCorrectCount) * 1000 : Infinity;

  const summary: ModelBenchmarkSummary = {
    modelName: modelConfig.name,
    displayName: modelConfig.displayName,
    totalCases,
    jsonValidityRate,
    amountAccuracy,
    dateAccuracy,
    categoryAccuracy,
    merchantAccuracy,
    descriptionAccuracy,
    overallWeightedAccuracy,
    criticalFailures,
    fullyCorrectCount,
    fullyCorrectRate,
    avgLatencyMs,
    p95LatencyMs,
    totalCostUsd,
    estCostPer1kMsgs,
    costPer1kCorrectTx,
  };

  return { summary, results };
}

// Print Comparative Summary Table
function printBenchmarkReport(summaries: ModelBenchmarkSummary[]) {
  console.log('\n================================================================================');
  console.log('📊 JODTANG DOMAIN-SPECIFIC AI BENCHMARK REPORT');
  console.log('================================================================================\n');

  const headers = ['Metric', ...summaries.map((s) => s.displayName)];
  console.log(headers.map((h, i) => (i === 0 ? h.padEnd(28) : h.padStart(22))).join(' | '));
  console.log('-'.repeat(28 + summaries.length * 25));

  const rows = [
    ['Test Cases Evaluated', ...summaries.map((s) => `${s.totalCases}`)],
    ['JSON Schema Validity', ...summaries.map((s) => `${s.jsonValidityRate.toFixed(1)}%`)],
    ['💰 Amount Accuracy (30%)', ...summaries.map((s) => `${s.amountAccuracy.toFixed(1)}%`)],
    ['📅 Date Resolution (20%)', ...summaries.map((s) => `${s.dateAccuracy.toFixed(1)}%`)],
    ['🏷️  Category Match (20%)', ...summaries.map((s) => `${s.categoryAccuracy.toFixed(1)}%`)],
    ['🏬 Merchant Extract (15%)', ...summaries.map((s) => `${s.merchantAccuracy.toFixed(1)}%`)],
    ['📝 Description Match (10%)', ...summaries.map((s) => `${s.descriptionAccuracy.toFixed(1)}%`)],
    ['⭐ Overall Weighted Score', ...summaries.map((s) => `${s.overallWeightedAccuracy.toFixed(1)}%`)],
    ['🚨 Critical Failures', ...summaries.map((s) => `${s.criticalFailures}`)],
    ['✅ 100% Correct Rate', ...summaries.map((s) => `${s.fullyCorrectRate.toFixed(1)}%`)],
    ['⚡ Avg Latency', ...summaries.map((s) => `${(s.avgLatencyMs / 1000).toFixed(2)}s`)],
    ['⚡ P95 Latency', ...summaries.map((s) => `${(s.p95LatencyMs / 1000).toFixed(2)}s`)],
    ['💵 Est. Cost / 1K msgs', ...summaries.map((s) => `$${s.estCostPer1kMsgs.toFixed(4)}`)],
    ['🎯 Cost / 1K Correct Tx', ...summaries.map((s) => `$${s.costPer1kCorrectTx.toFixed(4)}`)],
  ];

  for (const row of rows) {
    console.log(row.map((val, i) => (i === 0 ? val.padEnd(28) : val.padStart(22))).join(' | '));
  }

  console.log('\n================================================================================');

  // Recommendation logic
  const bestAccuracy = [...summaries].sort((a, b) => b.overallWeightedAccuracy - a.overallWeightedAccuracy)[0];
  const lowestCostPerCorrect = [...summaries].sort((a, b) => a.costPer1kCorrectTx - b.costPer1kCorrectTx)[0];
  const lowestCritical = [...summaries].sort((a, b) => a.criticalFailures - b.criticalFailures)[0];

  console.log('🏆 BENCHMARK INSIGHTS:');
  console.log(`   - Highest Overall Accuracy:  ${bestAccuracy.displayName} (${bestAccuracy.overallWeightedAccuracy.toFixed(1)}%)`);
  console.log(`   - Lowest Critical Failures:   ${lowestCritical.displayName} (${lowestCritical.criticalFailures} failures)`);
  console.log(`   - Best Value (Cost/Correct):  ${lowestCostPerCorrect.displayName} ($${lowestCostPerCorrect.costPer1kCorrectTx.toFixed(4)} / 1K correct tx)`);
  console.log('================================================================================\n');
}

// Main CLI Entry
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run') || (!process.env.OPENROUTER_API_KEY && !env.OPENROUTER_API_KEY && !env.DEEPSEEK_API_KEY && !env.OPENAI_API_KEY);
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
  const modelArg = args.find((a) => a.startsWith('--model='));
  const targetModel = modelArg ? modelArg.split('=')[1] : undefined;

  const datasetPath = path.resolve(__dirname, 'benchmark-dataset.json');
  if (!fs.existsSync(datasetPath)) {
    console.error('❌ benchmark-dataset.json not found! Please run generate-benchmark-dataset.ts first.');
    process.exit(1);
  }

  let rawDataset: BenchmarkCase[] = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
  if (limit && limit > 0) {
    rawDataset = rawDataset.slice(0, limit);
  }

  console.log('====================================================');
  console.log('🤖 JodTang AI Extraction Benchmark Suite');
  console.log('====================================================');
  console.log(`Dataset: ${rawDataset.length} cases`);
  console.log(`Mode:    ${isDryRun ? 'DRY-RUN (Mock Simulation)' : 'LIVE API INFERENCE'}`);

  let candidates = getCandidateModels();
  if (targetModel) {
    candidates = candidates.filter((c) => c.name.includes(targetModel) || c.displayName.toLowerCase().includes(targetModel.toLowerCase()));
  }

  if (candidates.length === 0) {
    console.error(`❌ No models found matching filter "${targetModel}".`);
    process.exit(1);
  }

  const outputDir = path.resolve(__dirname, '../benchmark-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const summaries: ModelBenchmarkSummary[] = [];

  for (const candidate of candidates) {
    const { summary, results } = await runModelBenchmark(candidate, rawDataset, isDryRun);
    summaries.push(summary);

    // Save individual model run log
    const modelLogPath = path.join(outputDir, `${candidate.name}-results.json`);
    fs.writeFileSync(modelLogPath, JSON.stringify({ summary, results }, null, 2), 'utf-8');
  }

  // Save overall summary
  const summaryPath = path.join(outputDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summaries, null, 2), 'utf-8');

  // Print Comparative Report
  printBenchmarkReport(summaries);
  console.log(`📁 Detailed results saved to: ${outputDir}/\n`);
}

main().catch((err) => {
  console.error('❌ Benchmark error:', err);
  process.exit(1);
});
