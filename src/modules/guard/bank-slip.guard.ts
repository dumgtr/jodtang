import {
  GuardEvaluationResult,
  GuardCategory,
  GuardAction,
  GuardSignals,
} from './guard.types';
import {
  GUARD_THRESHOLDS,
  GUARD_SCORE_WEIGHTS,
  ATM_REGEX,
  EWALLET_PROVIDER_REGEX,
  BILLER_ENTITY_REGEX,
  BILL_PAYMENT_KEYWORD_REGEX,
  SETTLEMENT_CONFIRMATION_REGEX,
  UNPAID_INVOICE_KEYWORD_REGEX,
  TRANSFER_VERB_EXPLICIT_REGEX,
  TRANSFER_VERB_GENERIC_REGEX,
  REF_TXN_ID_REGEX,
  FROM_ACCOUNT_REGEX,
  TO_ACCOUNT_REGEX,
  MASKED_ACCOUNT_REGEX,
  BANK_NAME_REGEX,
  TIMESTAMP_REGEX,
  FISCAL_HEADER_REGEX,
  POS_HARDWARE_REGEX,
  COMMERCIAL_TENDER_REGEX,
  ITEMIZED_LINE_REGEX,
} from './guard.constants';

/**
 * Pure, stateless evaluation of raw OCR text against the Bank-Slip Likelihood Guard rubric.
 *
 * Implements:
 * - TC-18: Settlement Verification Gate (require Biller + Settlement verb, otherwise fail-closed)
 * - TC-25: Pre-emptive Evidence Conflict Short-Circuit (high bank signals + high retail signals -> immediate HARD_STOP without net subtraction)
 * - TC-24 & TC-19: e-Wallet Disambiguation (e-wallet provider + settlement -> ALLOW_UNVERIFIED_EWALLET)
 * - Policy A: ATM Paper Slip fail-closed (HARD_STOP)
 * - General Thresholds: >= 50 Suspected Bank Slip, 25-49 Ambiguous, < 25 Retail Receipt (if confirmed)
 */
export function evaluateOcrText(rawText: string): GuardEvaluationResult & { assignedAction: string } {
  const text = rawText || '';
  const reasons: string[] = [];

  // 1. Detect Special Context Flags
  const isAtm = ATM_REGEX.test(text);
  const hasEWalletProvider = EWALLET_PROVIDER_REGEX.test(text);
  const hasBillerEntity = BILLER_ENTITY_REGEX.test(text);
  const hasBillPaymentKeyword = BILL_PAYMENT_KEYWORD_REGEX.test(text);
  const hasSettlementConfirmation = SETTLEMENT_CONFIRMATION_REGEX.test(text);
  const hasUnpaidInvoiceKeyword = UNPAID_INVOICE_KEYWORD_REGEX.test(text);

  // 2. Positive Bank Slip Signals
  let transferVerbScore = 0;
  if (TRANSFER_VERB_EXPLICIT_REGEX.test(text)) {
    transferVerbScore = GUARD_SCORE_WEIGHTS.POSITIVE.TRANSFER_VERB_EXPLICIT;
    reasons.push('EXPLICIT_TRANSFER_VERB');
  } else if (TRANSFER_VERB_GENERIC_REGEX.test(text)) {
    transferVerbScore = GUARD_SCORE_WEIGHTS.POSITIVE.TRANSFER_VERB_GENERIC;
    reasons.push('GENERIC_COMPLETION_VERB');
  }

  let refTxnIdScore = 0;
  if (REF_TXN_ID_REGEX.test(text)) {
    refTxnIdScore = GUARD_SCORE_WEIGHTS.POSITIVE.REF_TXN_ID;
    reasons.push('REFERENCE_TXN_ID_PRESENT');
  }

  let directionalAccountScore = 0;
  const hasFrom = FROM_ACCOUNT_REGEX.test(text);
  const hasTo = TO_ACCOUNT_REGEX.test(text);
  const hasMaskedAccount = MASKED_ACCOUNT_REGEX.test(text);

  if ((hasFrom && hasTo) || (hasMaskedAccount && (hasFrom || hasTo))) {
    directionalAccountScore = GUARD_SCORE_WEIGHTS.POSITIVE.DIRECTIONAL_ACCOUNT_PAIR;
    reasons.push('DIRECTIONAL_ACCOUNT_PAIR');
  } else if (hasFrom || hasTo || hasMaskedAccount) {
    directionalAccountScore = GUARD_SCORE_WEIGHTS.POSITIVE.DIRECTIONAL_ACCOUNT_SINGLE;
    reasons.push('DIRECTIONAL_OR_MASKED_ACCOUNT');
  }

  let bankNameScore = 0;
  if (BANK_NAME_REGEX.test(text)) {
    bankNameScore = GUARD_SCORE_WEIGHTS.POSITIVE.BANK_NAME;
    reasons.push('BANK_INSTITUTION_NAME');
  }

  let timestampScore = 0;
  if (TIMESTAMP_REGEX.test(text)) {
    timestampScore = GUARD_SCORE_WEIGHTS.POSITIVE.TIMESTAMP;
    reasons.push('TRANSACTION_TIMESTAMP');
  }

  const totalPositiveScore =
    transferVerbScore + refTxnIdScore + directionalAccountScore + bankNameScore + timestampScore;

  // 3. Negative Retail / Commerce Signals
  let fiscalHeaderScore = 0;
  if (FISCAL_HEADER_REGEX.test(text)) {
    fiscalHeaderScore = GUARD_SCORE_WEIGHTS.NEGATIVE.FISCAL_HEADER;
    reasons.push('RETAIL_FISCAL_HEADER');
  }

  let posHardwareScore = 0;
  if (POS_HARDWARE_REGEX.test(text)) {
    posHardwareScore = GUARD_SCORE_WEIGHTS.NEGATIVE.POS_HARDWARE;
    reasons.push('POS_HARDWARE_OR_TAX_ID');
  }

  let commercialTenderScore = 0;
  if (COMMERCIAL_TENDER_REGEX.test(text)) {
    commercialTenderScore = GUARD_SCORE_WEIGHTS.NEGATIVE.COMMERCIAL_TENDER;
    reasons.push('COMMERCIAL_TENDER_BREAKDOWN');
  }

  let itemizedLineScore = 0;
  if (ITEMIZED_LINE_REGEX.test(text)) {
    itemizedLineScore = GUARD_SCORE_WEIGHTS.NEGATIVE.ITEMIZED_LINE;
    reasons.push('ITEMIZED_PRODUCT_LINES');
  }

  const totalNegativeScore =
    fiscalHeaderScore + posHardwareScore + commercialTenderScore + itemizedLineScore;
  const netBankSlipScore = Math.max(0, totalPositiveScore - totalNegativeScore);
  const totalRetailScore = totalNegativeScore;

  const signals: GuardSignals = {
    transferVerbScore,
    refTxnIdScore,
    directionalAccountScore,
    bankNameScore,
    timestampScore,
    totalPositiveScore,
    fiscalHeaderScore,
    posHardwareScore,
    commercialTenderScore,
    itemizedLineScore,
    totalNegativeScore,
    netBankSlipScore,
    totalRetailScore,
  };

  // Helper builder
  const buildResult = (
    action: GuardAction,
    category: GuardCategory,
    assignedAction: string,
    rationale: string,
    isConflict = false,
    detectedSpecialRoute?: 'ATM_SLIP' | 'E_WALLET' | 'BILL_PAYMENT'
  ): GuardEvaluationResult & { assignedAction: string } => ({
    action,
    category,
    score: netBankSlipScore,
    positiveScore: totalPositiveScore,
    negativeScore: totalNegativeScore,
    signals,
    detectedSpecialRoute,
    reasons,
    isConflict,
    rationale,
    assignedAction,
  });

  // =========================================================================
  // 4. Decision Logic & Hardened Security Gates
  // =========================================================================

  // GATE 1: Pre-emptive Evidence Conflict Short-Circuit (TC-25)
  // If high-confidence bank transfer context co-exists with high-confidence fiscal retail signals:
  // Mathematical subtraction is cancelled; fails closed to HARD STOP immediately.
  const isHighConfidenceBankContext = transferVerbScore >= 25 && directionalAccountScore >= 25;
  const isHighConfidenceRetail = fiscalHeaderScore >= 30 && posHardwareScore >= 25;
  if (isHighConfidenceBankContext && isHighConfidenceRetail) {
    return buildResult(
      'HARD_STOP',
      'AMBIGUOUS',
      'HARD_STOP (AMBIGUOUS)',
      'PREEMPTIVE_EVIDENCE_CONFLICT_SHORT_CIRCUIT_SPLICED_IMAGE',
      true
    );
  }

  // GATE 2: ATM Paper Slip -> Policy A (Hard Stop) (TC-01)
  if (isAtm && directionalAccountScore > 0) {
    return buildResult(
      'HARD_STOP',
      'SUSPECTED_BANK_SLIP',
      'HARD_STOP (SUSPECTED_SLIP)',
      'POLICY_A_ATM_PAPER_SLIP_FAIL_CLOSED',
      false,
      'ATM_SLIP'
    );
  }

  // GATE 3: Settlement Verification Gate for Invoices / Bills (TC-18)
  // If debt/invoice keywords appear without settlement confirmation -> HARD STOP
  if (hasUnpaidInvoiceKeyword && !hasSettlementConfirmation) {
    return buildResult(
      'HARD_STOP',
      'AMBIGUOUS',
      'HARD_STOP (AMBIGUOUS)',
      'SETTLEMENT_GATE_UNPAID_INVOICE_REJECTED'
    );
  }

  // GATE 4: e-Wallet Transfer Context (TC-24 & TC-19)
  // Non-commercial bank e-wallet transfers (TrueMoney, G-Wallet, ShopeePay) route to Policy B
  const hasCommercialBankDirectionalPair =
    hasFrom && hasTo && hasMaskedAccount && bankNameScore >= 15;
  if (hasEWalletProvider && !hasCommercialBankDirectionalPair) {
    if (
      transferVerbScore > 0 ||
      hasSettlementConfirmation ||
      /(?:ชำระ\s*เ?งิ?น\s*ส?ำ?เ?ร็?จ)/i.test(text)
    ) {
      return buildResult(
        'ALLOW_UNVERIFIED_EWALLET',
        'ALLOW_UNVERIFIED_EWALLET',
        'ALLOW_UNVERIFIED_EWALLET',
        'POLICY_B_EWALLET_PAYMENT_UNVERIFIED_DRAFT',
        false,
        'E_WALLET'
      );
    }
  }

  // GATE 5: Completed Bill Payment -> Policy B (TC-07 & TC-23)
  // Requires biller entity / card combined with confirmed settlement verb
  if (
    (hasBillerEntity || hasBillPaymentKeyword) &&
    (hasSettlementConfirmation || hasBillPaymentKeyword) &&
    !hasCommercialBankDirectionalPair
  ) {
    return buildResult(
      'ALLOW_UNVERIFIED_BILL',
      'ALLOW_UNVERIFIED_BILL',
      'ALLOW_UNVERIFIED_BILL',
      'POLICY_B_BILL_PAYMENT_UNVERIFIED_DRAFT',
      false,
      'BILL_PAYMENT'
    );
  }

  // GATE 6: General Threshold Evaluation
  // Score >= 50: Suspected Bank Slip (e.g. cropped slip) -> HARD STOP
  if (
    totalPositiveScore >= GUARD_THRESHOLDS.SUSPECTED_BANK_SLIP_MIN &&
    netBankSlipScore >= 45
  ) {
    return buildResult(
      'HARD_STOP',
      'SUSPECTED_BANK_SLIP',
      'HARD_STOP (SUSPECTED_SLIP)',
      `HIGH_BANK_SLIP_CONFIDENCE_SCORE_${totalPositiveScore}`
    );
  }

  // Score 25 <= Score < 50: Ambiguous -> HARD STOP (Fail-Closed)
  if (
    netBankSlipScore >= GUARD_THRESHOLDS.AMBIGUOUS_MIN &&
    totalRetailScore < GUARD_THRESHOLDS.CONFIRMED_RETAIL_MIN
  ) {
    return buildResult(
      'HARD_STOP',
      'AMBIGUOUS',
      'HARD_STOP (AMBIGUOUS)',
      `AMBIGUOUS_EVIDENCE_SCORE_${netBankSlipScore}`
    );
  }

  // Score < 25:
  // If retail proof is confirmed (totalRetailScore >= 25) -> ALLOW_RECEIPT
  if (totalRetailScore >= GUARD_THRESHOLDS.CONFIRMED_RETAIL_MIN) {
    return buildResult(
      'ALLOW_RECEIPT',
      'ALLOW_RECEIPT',
      'ALLOW_RECEIPT',
      `CONFIRMED_RETAIL_RECEIPT_SCORE_${totalRetailScore}`
    );
  }

  // Lacks retail proof -> Fail-Closed
  return buildResult(
    'HARD_STOP',
    'AMBIGUOUS',
    'HARD_STOP (AMBIGUOUS)',
    'UNSUBSTANTIATED_LOW_SIGNAL_FAIL_CLOSED'
  );
}
