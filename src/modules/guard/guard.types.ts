/**
 * Guard Category taxonomy
 */
export type GuardCategory =
  | 'SUSPECTED_BANK_SLIP'
  | 'ALLOW_RECEIPT'
  | 'ALLOW_UNVERIFIED_EWALLET'
  | 'ALLOW_UNVERIFIED_BILL'
  | 'AMBIGUOUS';

/**
 * Downstream Guard Action
 */
export type GuardAction =
  | 'ALLOW_RECEIPT'
  | 'ALLOW_UNVERIFIED_EWALLET'
  | 'ALLOW_UNVERIFIED_BILL'
  | 'HARD_STOP';

/**
 * Internal multi-signal breakdown
 */
export interface GuardSignals {
  transferVerbScore: number;       // S1 (+25 / +10)
  refTxnIdScore: number;           // S2 (+15)
  directionalAccountScore: number; // S3 (+25 / +10)
  bankNameScore: number;           // S4 (+15)
  timestampScore: number;          // S5 (+10)
  totalPositiveScore: number;

  fiscalHeaderScore: number;       // N1 (-30)
  posHardwareScore: number;        // N2 (-25)
  commercialTenderScore: number;   // N3 (-20)
  itemizedLineScore: number;       // N4 (-15)
  totalNegativeScore: number;

  netBankSlipScore: number;
  totalRetailScore: number;
}

/**
 * Output of the Bank-Slip Likelihood Guard evaluation
 */
export interface GuardEvaluationResult {
  action: GuardAction;
  category: GuardCategory;
  score: number;
  positiveScore: number;
  negativeScore: number;
  signals: GuardSignals;
  detectedSpecialRoute?: 'ATM_SLIP' | 'E_WALLET' | 'BILL_PAYMENT';
  reasons: string[];
  isConflict: boolean;
  rationale: string;
}
