import path from 'node:path';
import fs from 'node:fs';
import { evaluateOcrText } from '../src/modules/guard/bank-slip.guard';
import { LocalQrRouter } from '../src/modules/qr/local-qr.router';
import { TyphoonOcrAdapter } from '../src/modules/receipt/providers/typhoon-ocr.adapter';

interface SyntheticResult {
  id: string;
  name: string;
  dimension: string;
  expectedAction: string;
  assignedAction: string;
  isMatch: boolean;
  score: number;
  retailScore: number;
  rationale: string;
}

interface RealOcrResult {
  fixtureId: string;
  fileName: string;
  sha256: string;
  description: string;
  qrClassification: string;
  bypassesOcr: boolean;
  ocrExtracted: boolean;
  maskedOcrSnippet?: string;
  guardScore?: number;
  assignedGuardAction?: string;
  expectedGuardAction: string;
  isMatch?: boolean;
  notes: string;
}

/**
 * Mask potential PII (phone numbers, account digits, Thai citizen IDs)
 */
function maskPii(text: string): string {
  return text
    .replace(/(\d{3})[-.\s]?(\d{3})[-.\s]?(\d{4})/g, '$1-***-****')
    .replace(/(?:บัญชี|เลขที่|Account)\s*[:\s]*(\d{1,4}[-.\s\d]*\d{3})/gi, 'บัญชี: ***-****')
    .replace(/(\d{1})[-.\s]?(\d{4})[-.\s]?(\d{5})[-.\s]?(\d{2})[-.\s]?(\d{1})/g, '$1-****-*****-**-$5');
}

async function runCoverageAndRealOcrValidation() {
  console.log('================================================================');
  console.log('🛡️ Guard Coverage Expansion & Real OCR Validation');
  console.log('================================================================\n');

  // ===========================================================================
  // SECTION 1: SYNTHETIC OCR PERTURBATION EVALUATION (25 Scenarios)
  // ===========================================================================
  console.log('--- PART 1: Synthetic OCR Perturbation & Stress Evaluation (25 Scenarios) ---');
  const datasetPath = path.resolve(__dirname, '../tests/fixtures/dataset/expanded-mock-ocr-dataset.json');
  if (!fs.existsSync(datasetPath)) {
    throw new Error(`Expanded dataset not found at ${datasetPath}`);
  }

  const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const testCases = dataset.testCases;

  const syntheticResults: SyntheticResult[] = [];
  let fpCount = 0; // Receipt marked as slip
  let fnCount = 0; // Slip marked as receipt
  let exactMatchCount = 0;

  // Threshold bucket distribution
  const bucketCounts = {
    under25: 0,
    range25to49: 0,
    above50: 0,
  };

  for (const tc of testCases) {
    const evalRes = evaluateOcrText(tc.rawText);
    const isMatch = evalRes.assignedAction === tc.expectedAction;

    if (isMatch) exactMatchCount++;

    if (tc.expectedAction === 'ALLOW_RECEIPT' && evalRes.assignedAction.startsWith('HARD_STOP')) {
      fpCount++;
    }
    if (tc.expectedAction.startsWith('HARD_STOP') && evalRes.assignedAction === 'ALLOW_RECEIPT') {
      fnCount++;
    }

    const netScore = evalRes.signals.netBankSlipScore;
    if (netScore < 25) bucketCounts.under25++;
    else if (netScore < 50) bucketCounts.range25to49++;
    else bucketCounts.above50++;

    syntheticResults.push({
      id: tc.id,
      name: tc.name,
      dimension: tc.dimension || 'Baseline',
      expectedAction: tc.expectedAction,
      assignedAction: evalRes.assignedAction,
      isMatch,
      score: netScore,
      retailScore: evalRes.signals.totalRetailScore,
      rationale: evalRes.rationale,
    });
  }

  console.log('-------------------------------------------------------------------------------------------------------------------');
  console.log('| Case ID                    | Net/Ret | Assigned Action          | Expected Action          | Match | Dimension   |');
  console.log('-------------------------------------------------------------------------------------------------------------------');
  for (const r of syntheticResults) {
    const id = r.id.padEnd(26, ' ');
    const scoreStr = `${r.score.toString().padStart(3, ' ')}/${r.retailScore.toString().padEnd(3, ' ')}`;
    const assigned = r.assignedAction.padEnd(24, ' ');
    const expected = r.expectedAction.padEnd(24, ' ');
    const status = r.isMatch ? '✅ PASS' : '❌ FAIL';
    const dim = r.dimension.substring(0, 15);
    console.log(`| ${id} | ${scoreStr} | ${assigned} | ${expected} | ${status} | ${dim} |`);
  }
  console.log('-------------------------------------------------------------------------------------------------------------------\n');

  console.log('📊 Synthetic Robustness Metrics:');
  console.log(`- Total Scenarios: ${testCases.length}`);
  console.log(`- Exact Classification Matches: ${exactMatchCount} / ${testCases.length} (${((exactMatchCount / testCases.length) * 100).toFixed(1)}%)`);
  console.log(`- False Positives (Receipt rejected as Slip): ${fpCount}`);
  console.log(`- False Negatives (Slip allowed as Receipt): ${fnCount}`);
  console.log('- Score Distribution across candidate threshold buckets:');
  console.log(`  * Score < 25:       ${bucketCounts.under25} cases`);
  console.log(`  * Score 25 - 49:    ${bucketCounts.range25to49} cases`);
  console.log(`  * Score >= 50:      ${bucketCounts.above50} cases\n`);

  // ===========================================================================
  // SECTION 2: REAL DIGITAL SCREENSHOT OCR VALIDATION
  // ===========================================================================
  console.log('--- PART 2: Real Digital Screenshot OCR Validation (4 Fixtures) ---');

  const manifestPath = path.resolve(__dirname, '../tests/fixtures/regression/prod-200500/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const router = new LocalQrRouter();
  const ocrAdapter = new TyphoonOcrAdapter();
  const realResults: RealOcrResult[] = [];

  const ocrAvailable = ocrAdapter.isConfigured();
  console.log(`Typhoon OCR Configured: ${ocrAvailable ? 'YES (Live API Available)' : 'NO (Missing API Key)'}\n`);

  for (const f of manifest.fixtures) {
    const filePath = path.resolve(__dirname, '../tests/fixtures/regression/prod-200500', f.fileName);
    if (!fs.existsSync(filePath)) {
      console.error(`Fixture file not found: ${filePath}`);
      continue;
    }

    const imageBuffer = fs.readFileSync(filePath);

    // Step 1: Local QR Router Classification
    const qrResult = await router.classifyImage(imageBuffer);
    const bypassesOcr = qrResult.category === 'BANK_SLIP_QR';

    let ocrExtracted = false;
    let maskedOcrSnippet: string | undefined;
    let guardScore: number | undefined;
    let assignedGuardAction: string | undefined;
    let isMatch: boolean | undefined;
    let notes = '';

    if (bypassesOcr) {
      notes = 'Intact Mini-QR detected -> Direct to Slip2Go, Bypasses OCR & Guard completely.';
      isMatch = f.expectedGuardAction === 'BYPASS_GUARD (Slip2Go Direct)';
    } else if (ocrAvailable) {
      try {
        const ocrResult = await ocrAdapter.extractReceipt(imageBuffer, 'image/jpeg');
        if (ocrResult.status === 'SUCCESS' && ocrResult.data) {
          ocrExtracted = true;
          const rawText = ocrResult.data.rawText || '';
          const evalRes = evaluateOcrText(rawText);

          guardScore = evalRes.signals.netBankSlipScore;
          assignedGuardAction = evalRes.assignedAction;
          isMatch = assignedGuardAction === f.expectedGuardAction;

          maskedOcrSnippet = maskPii(rawText.split('\n').slice(0, 4).join(' ')).substring(0, 100);
          notes = `OCR Success (${rawText.length} chars). Classified: ${assignedGuardAction}`;
        } else {
          notes = `OCR Failed: ${ocrResult.errorMessage || ocrResult.status}`;
        }
      } catch (err: any) {
        notes = `OCR Exception: ${err?.message || 'Unknown'}`;
      }
    } else {
      notes = 'REAL OCR VALIDATION = NOT RUN (No Typhoon API Key)';
    }

    realResults.push({
      fixtureId: f.id,
      fileName: f.fileName,
      sha256: f.sha256,
      description: f.description,
      qrClassification: qrResult.category,
      bypassesOcr,
      ocrExtracted,
      maskedOcrSnippet,
      guardScore,
      assignedGuardAction,
      expectedGuardAction: f.expectedGuardAction,
      isMatch,
      notes,
    });
  }

  console.log('-------------------------------------------------------------------------------------------------------------------');
  console.log('| Fixture | QR Router     | Downstream Action         | Expected Action           | Match | Notes                     |');
  console.log('-------------------------------------------------------------------------------------------------------------------');
  for (const res of realResults) {
    const id = `${res.fixtureId} (${res.fileName.substring(0, 14)})`.padEnd(20, ' ');
    const qr = res.qrClassification.padEnd(13, ' ');
    const action = (res.assignedGuardAction || (res.bypassesOcr ? 'BYPASS (Slip2Go)' : 'N/A')).padEnd(25, ' ');
    const expected = res.expectedGuardAction.substring(0, 25).padEnd(25, ' ');
    const match = res.isMatch === true ? '✅ PASS' : res.isMatch === false ? '❌ FAIL' : '⚠️ N/A';
    const note = res.notes.substring(0, 27);
    console.log(`| ${id} | ${qr} | ${action} | ${expected} | ${match} | ${note} |`);
  }
  console.log('-------------------------------------------------------------------------------------------------------------------\n');

  console.log('================================================================');
  console.log('🎉 GUARD COVERAGE VALIDATION RUN COMPLETE!');
  console.log('================================================================\n');

  return { syntheticResults, realResults };
}

runCoverageAndRealOcrValidation().catch((err) => {
  console.error('Fatal Validation Error:', err);
  process.exit(1);
});
