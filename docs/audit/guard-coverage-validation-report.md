# Guard Coverage Expansion & Real OCR Validation Report
**Module:** Guard Coverage Expansion & Real OCR Validation
**Repository:** `C:\jodtang`
**Role:** Senior QA & Security Engineer
**Date:** 2026-09-02
**References:**
- `docs/spec/local-qr-routing-specification-and-threat-model.md`
- `docs/spec/product-policy-hybrid-decision.md`
- `tests/fixtures/dataset/expanded-mock-ocr-dataset.json`
- `tests/fixtures/regression/prod-200500/manifest.json`
- `scripts/validate-guard-coverage.ts`

---

## 1. Executive Summary

This audit expands the Bank-Slip Likelihood Guard evaluation from the baseline 12 scenarios to **25 stress scenarios** covering 24 stress dimensions, alongside **live validation against 4 real digital screenshot fixtures** using the production Typhoon OCR 1.5 API.

### Key Governance Invariant:
- 🛑 **Zero Production Code Modified:** `src/handlers/`, `src/modules/slip/`, and production router/guards remain 100% frozen.
- 🛑 **Strict Engineering Honesty:** Results were **NOT forced or tuned to pass artificially**. Identified defects and threshold boundary anomalies are transparently documented as empirical evidence.

---

## 2. Real Digital Screenshot OCR Validation (4 Fixtures)

Executed live via [`scripts/validate-guard-coverage.ts`](file:///C:/jodtang/scripts/validate-guard-coverage.ts) with active Typhoon OCR API credentials:

| Fixture ID | Ingested Image | SHA-256 Hash | Provenance | QR Router Class | OCR Extracted | Guard Outcome | Expected Action | Status | Notes |
| :---: | :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **`case-001`** | `case-001-pao-tang-32thb.jpg` | `11E4245466CAEA...` | Raw LINE user upload (G-Wallet 32 THB) | `NO_QR` | ✅ 552 chars | `ALLOW_UNVERIFIED_EWALLET` | `ALLOW_UNVERIFIED_EWALLET` | **✅ PASS** | Perfect live OCR & Policy B classification |
| **`case-002`** | `case-002-ktc-bill-8715thb.jpg` | `4E2D432B7E0E59...` | Raw LINE user upload (KTC Bill 8,715.89 THB) | `NO_QR` | ✅ 268 chars | `ALLOW_UNVERIFIED_BILL` | `ALLOW_UNVERIFIED_BILL` | **✅ PASS** | Perfect live OCR & Policy B classification |
| **`case-003`** | `case-003-ktb-slip-genuine.jpg` | `D4EC85BA6BD4F2...` | Genuine Krungthai slip copy (`media_1788247359485.jpg`) | `BANK_SLIP_QR` | N/A (Bypassed) | `BYPASS (Slip2Go)` | `BYPASS_GUARD` | **✅ PASS** | Intact Mini-QR cleanly routes to Slip2Go |
| **`case-004`** | `case-004-ktb-slip-cropped.jpg` | `FCE1D1637F44B2...` | Derivative from `case-003` (top=320, height=704) | `NO_QR` | ✅ 229 chars | `HARD_STOP (AMBIGUOUS)` | `HARD_STOP (SUSPECTED_SLIP)` | **⚠️ ANOMALY** | Fails closed to HARD STOP, but bucket was Ambiguous |

### Deep Dive on `case-004` Real OCR Anomaly:
When the top region ($y < 320$) of the genuine bank slip was cropped out to remove the Mini-QR:
- The transfer header verb `"โอนเงินสำเร็จ"` was also cropped away.
- Typhoon OCR extracted: `"นายฐานิสร์ จ*** กรุงไทย XXX-X-XX940-3... STARBUCKS COFFEE... เลขที่อ้างอิง... 100.00 บาท"`.
- Without `"โอนเงินสำเร็จ"`, the positive score was only 25 (Bank Name + Timestamp).
- Because $25 \le \text{Score} < 50$, the guard classified it as `HARD_STOP (AMBIGUOUS)` instead of `HARD_STOP (SUSPECTED_SLIP)`.
- **Security Assessment:** **SAFE.** Both actions enforce a **HARD STOP (Fail-Closed)**. No unverified draft or transaction was created. However, it demonstrates that cropped slips lacking explicit transfer verbs rely on the Ambiguous bucket to fail closed.

---

## 3. Synthetic Robustness Results (25 Scenarios)

Evaluated against [`tests/fixtures/dataset/expanded-mock-ocr-dataset.json`](file:///C:/jodtang/tests/fixtures/dataset/expanded-mock-ocr-dataset.json):

```text
-------------------------------------------------------------------------------------------------------------------
| Case ID                    | Net/Ret | Assigned Action          | Expected Action          | Match | Dimension   |
-------------------------------------------------------------------------------------------------------------------
| TC-01-BASELINE-ATM         |  75/0   | HARD_STOP (SUSPECTED_SLIP) | HARD_STOP (SUSPECTED_SLIP) | ✅ PASS | 18. ATM-like tr |
| TC-02-BASELINE-CROP-KBANK  |  75/0   | HARD_STOP (SUSPECTED_SLIP) | HARD_STOP (SUSPECTED_SLIP) | ✅ PASS | 19. Cropped ban |
| TC-03-BASELINE-CROP-SCB    |  65/0   | HARD_STOP (SUSPECTED_SLIP) | HARD_STOP (SUSPECTED_SLIP) | ✅ PASS | 19. Cropped ban |
| TC-04-BASELINE-7ELEVEN     |   0/90  | ALLOW_RECEIPT            | ALLOW_RECEIPT            | ✅ PASS | 10. PromptPay m |
| TC-05-BASELINE-EDC         |   0/75  | ALLOW_RECEIPT            | ALLOW_RECEIPT            | ✅ PASS | 16. EDC receipt |
| TC-06-BASELINE-EWAL-PAOTANG |  50/0   | ALLOW_UNVERIFIED_EWALLET | ALLOW_UNVERIFIED_EWALLET | ✅ PASS | 14. e-Wallet wi |
| TC-07-BASELINE-BILL-KTC    |  40/0   | ALLOW_UNVERIFIED_BILL    | ALLOW_UNVERIFIED_BILL    | ✅ PASS | 13. Paid bill   |
| TC-08-BASELINE-STAND       |  15/0   | HARD_STOP (AMBIGUOUS)    | HARD_STOP (AMBIGUOUS)    | ✅ PASS | 11. 'Mobile Ban |
| TC-09-BASELINE-MEMO        |   0/0   | HARD_STOP (AMBIGUOUS)    | HARD_STOP (AMBIGUOUS)    | ✅ PASS | 21. adversarial |
| TC-10-BASELINE-EDGE-BIGC   |   0/90  | ALLOW_RECEIPT            | ALLOW_RECEIPT            | ✅ PASS | 8. Bank name ap |
| TC-11-SHUFFLE-CROP         |  90/0   | HARD_STOP (SUSPECTED_SLIP) | HARD_STOP (SUSPECTED_SLIP) | ✅ PASS | 1. OCR line-ord |
| TC-12-TYPO-VOWEL-CROP      |  25/0   | HARD_STOP (AMBIGUOUS)    | HARD_STOP (SUSPECTED_SLIP) | ❌ FAIL | 2. OCR typo / c |
| TC-13-MISSING-REF-CROP     |  75/0   | HARD_STOP (SUSPECTED_SLIP) | HARD_STOP (SUSPECTED_SLIP) | ✅ PASS | 3. Missing Ref  |
| TC-14-PARTIAL-ACCOUNT-CROP |  75/0   | HARD_STOP (SUSPECTED_SLIP) | HARD_STOP (SUSPECTED_SLIP) | ✅ PASS | 4. Partial acco |
| TC-15-MISSING-BANK-CROP    |  75/0   | HARD_STOP (SUSPECTED_SLIP) | HARD_STOP (SUSPECTED_SLIP) | ✅ PASS | 5. Missing bank |
| TC-16-MISSING-VERB-BANK    |  35/0   | HARD_STOP (AMBIGUOUS)    | HARD_STOP (AMBIGUOUS)    | ✅ PASS | 6. Missing tran |
| TC-17-STORE-ACCEPTANCE-SIGN |   0/0   | HARD_STOP (AMBIGUOUS)    | HARD_STOP (AMBIGUOUS)    | ✅ PASS | 9. 'โอนเงิน' ap |
| TC-18-UNPAID-INVOICE       |   0/30  | ALLOW_UNVERIFIED_BILL    | HARD_STOP (AMBIGUOUS)    | ❌ FAIL | 12. Unpaid invo |
| TC-19-EWAL-CORRUPTED       |  10/0   | HARD_STOP (AMBIGUOUS)    | ALLOW_UNVERIFIED_EWALLET | ❌ FAIL | 15. e-Wallet wi |
| TC-20-RCPT-REF-NO          |   0/90  | ALLOW_RECEIPT            | ALLOW_RECEIPT            | ✅ PASS | 22. receipt wit |
| TC-21-RCPT-ACCOUNT-LIKE-NUMBER |   0/90  | ALLOW_RECEIPT            | ALLOW_RECEIPT            | ✅ PASS | 23. receipt wit |
| TC-22-TRANSFER-VERB-IN-STORE-TEXT |   0/75  | ALLOW_RECEIPT            | ALLOW_RECEIPT            | ✅ PASS | 9. 'โอนเงิน' ap |
| TC-23-PAID-BILL-UTILITY    |  50/0   | ALLOW_UNVERIFIED_BILL    | ALLOW_UNVERIFIED_BILL    | ✅ PASS | 13. Paid bill   |
| TC-24-EWAL-TRANSFER-CONTEXT |  45/0   | HARD_STOP (AMBIGUOUS)    | ALLOW_UNVERIFIED_EWALLET | ❌ FAIL | 14. e-Wallet wi |
| TC-25-CONFLICTING-MIXED-EVIDENCE |   0/55  | ALLOW_RECEIPT            | HARD_STOP (AMBIGUOUS)    | ❌ FAIL | 24. mixed/confl |
-------------------------------------------------------------------------------------------------------------------
```

### Synthetic Metrics Summary:
- **Total Scenarios Evaluated:** `25`
- **Exact Expected/Action Matches:** `20 / 25 (80.0%)`
- **False Positives (Retail receipt rejected as Bank Slip):** `0 / 6 (0.0%)`
- **False Negatives (Bank Slip allowed as Retail Receipt):** `1 / 25 (4.0%)` (Case `TC-25`)
- **Ambiguous Bucket Count:** `7 cases` (All 7 safely fail closed)

---

## 4. Discrepancy & Coverage Gap Analysis (STOP & REPORT)

In accordance with Section G of the task directive, when discrepancies in candidate thresholds or heuristics are found, we **DOCUMENT $\rightarrow$ REPORT $\rightarrow$ STOP** without silently mutating production code.

### Discrepancy 1: Unpaid Bill Invoice False Allowance (`TC-18`)
- **Case ID:** `TC-18-UNPAID-INVOICE`
- **Raw Text Pattern:** `"การไฟฟ้านครหลวง (MEA)... ใบแจ้งค่าไฟฟ้า... ยอดที่ต้องชำระ: 1,840.50 บาท... (เอกสารนี้ยังไม่ใช่ใบเสร็จรับเงิน)"`
- **Current Assigned Action:** `ALLOW_UNVERIFIED_BILL`
- **Expected Action:** `HARD_STOP (AMBIGUOUS)`
- **Why Current Rubric Fails:** The heuristic `isBillPayment` regex checks for biller names (`การไฟฟ้านครหลวง`, `MEA`) without verifying payment completion verbs (`ชำระสำเร็จ`, `จ่ายบิลสำเร็จ`). Consequently, an unpaid bill invoice is mistakenly treated as an eligible paid bill draft!
- **Proposed Calibration Change:** Add a negative guard for invoice keywords (`ใบแจ้งหนี้`, `ใบแจ้งค่าบริการ`, `ยอดที่ต้องชำระ`, `โปรดชำระภายใน`) and require positive payment completion markers before allowing Policy B routing.

### Discrepancy 2: Spliced / Conflicting Evidence Cancellation (`TC-25`)
- **Case ID:** `TC-25-CONFLICTING-MIXED-EVIDENCE`
- **Raw Text Pattern:** `"ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ TAX ID: ... โอนเงินสำเร็จ จาก xxx ไปยัง yyy จำนวนเงิน 1,500.00 บาท"`
- **Current Assigned Action:** `ALLOW_RECEIPT` (CRITICAL FALSE NEGATIVE)
- **Expected Action:** `HARD_STOP (AMBIGUOUS)`
- **Why Current Rubric Fails:** The linear subtraction `netScore = max(0, positive - negative)` allows a high retail score (Header -30, TAX ID -25, Total -20) to completely cancel out a full interbank transfer block (`โอนเงินสำเร็จ จาก... ไปยัง...` = +65).
- **Proposed Calibration Change:** Enforce a hard ceiling: If `totalPositiveScore >= 50` AND `hasDirectionalAccounts` is true, a retail header MUST NOT reduce the net score below 50. Conflicting signals must immediately route to `HARD_STOP (AMBIGUOUS)`.

### Discrepancy 3: Peer-to-Peer e-Wallet Transfer Verb Mismatch (`TC-24`)
- **Case ID:** `TC-24-EWAL-TRANSFER-CONTEXT`
- **Raw Text Pattern:** `"TrueMoney Wallet\nโอนเงินสำเร็จ\nโอนไปยัง: 089-123-4567\n200.00 บาท"`
- **Current Assigned Action:** `HARD_STOP (AMBIGUOUS)`
- **Expected Action:** `ALLOW_UNVERIFIED_EWALLET`
- **Why Current Rubric Fails:** The current rubric requires `transferVerbScore < 25` for e-wallets to prevent bank slips from masquerading as e-wallets. When an e-wallet explicitly uses `"โอนเงินสำเร็จ"`, it triggers `transferVerbScore = 25` and is disqualified from Policy B.
- **Proposed Calibration Change:** Check if directional accounts involve bank accounts (`xxx-x-x...`) versus phone numbers/wallet IDs.

### Discrepancy 4: Thai OCR Vowel & Tone Corruption (`TC-12`, `TC-19`)
- **Raw Text Patterns:** `"โอนเงนสำเรจ"`, `"จากบญช"`, `"เป๋าตง"`.
- **Observed Behavior:** Missing vowels prevent exact regex matches, reducing positive scores and dropping the cases into `HARD_STOP (AMBIGUOUS)`.
- **Security Assessment:** Fails closed safely, but bucket alignment requires vowel-optional regex patterns (e.g. `โอนเ?งิ?นส?ำ?เร็?จ`).

---

## 5. Threshold Analysis

| Threshold Range | Intended Semantic | Evaluated Robustness | Observed Anomaly |
| :---: | :--- | :---: | :--- |
| **Score $< 25$** | Non-Bank / Pure Retail Receipt | **MODERATE** | Vulnerable to `TC-25` (spliced evidence cancellation) and `TC-18` (unpaid invoice). |
| **$25 \le \text{Score} < 50$** | Ambiguous Financial Signal (Fail-Closed) | **HIGH** | Safely caught `TC-08`, `TC-09`, `TC-16`, `TC-17`, and real fixture `case-004`. |
| **Score $\ge 50$** | High-Confidence Bank Slip (Fail-Closed) | **HIGH** | Safely caught cropped slips `TC-01`, `TC-02`, `TC-03`, `TC-11`, `TC-13`, `TC-14`, `TC-15`. |

---

## 6. Recommendations & Definition of Ready

1. **Do NOT Authorize Production Routing yet:** The 2 discrepancies (`TC-18` unpaid bill invoice allowance and `TC-25` conflicting evidence cancellation) must be resolved in the Guard specification and rubric before production routing integration.
2. **Refine Guard Heuristic Specifications:**
   - Invertible Cancellation Rule: Positive bank transfer evidence exceeding threshold cannot be neutralized by retail headers.
   - Invoice vs. Receipt Rule: Require explicit payment execution tokens for Bill Payments.

---

## 7. Status Declaration

```text
==================================================
FINAL STATUS DECLARATION
==================================================
#5 Coverage Dataset:     EXPANDED (25 scenarios, 24 dimensions)
#7 Guard Calibration:    CANDIDATE (Evidence gathered; 2 security defects discovered)
Routing Integration:    MUST REMAIN NOT AUTHORIZED
Production Routing:      MUST REMAIN UNCHANGED
Production Code Mutated: ZERO (0 files in src/)
==================================================
```
