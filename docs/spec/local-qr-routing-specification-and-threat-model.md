# Local QR Routing & Threat Model Specification
**Document Version:** 2.0.0 (Hardened Specification)
**Status:** 🔴 SPECIFICATION & THREAT MODEL ONLY — NO IMPLEMENTATION
**Date:** 2026-09-02
**Target Repository:** `C:\jodtang`

---

## 1. Executive Summary & Foundational Principles

This specification defines the architectural contracts, taxonomy, decision logic, and STRIDE threat model for the **Local QR Router** and the post-OCR **Bank-Slip Likelihood Guard** in Jodtang.

### 1.1 Strict Role Separation
1. **Local QR Router = In-Memory Image Classifier:**
   - Evaluates image buffers locally in memory.
   - Operates as a pure structural classifier to direct the image to the appropriate downstream processing pipeline.
   - **Performance / NFR Target:** Local in-memory execution target $\le 50\text{ ms}$ (benchmark goal $\le 30\text{ ms}$ on standard 1080p images), 0 external network requests, and 0 Slip2Go quota/token consumption for non-slip images.
   - **NOT a Financial Verifier:** The router does NOT verify financial authenticity, validity, or tampering.
2. **Slip2Go = Financial Verifier (Authoritative Gateway):**
   - The sole external authority for verifying bank transfer slips, detecting forged slips (`200500`), and checking duplicate transactions (`200501`).
3. **Typhoon OCR 1.5 = Text & Field Extractor:**
   - Extracts raw text, merchant name, total amount, and date from retail receipts.
   - **ZERO Authority to Approve Drafts:** OCR output alone never certifies an image as a legitimate expense.
4. **Bank-Slip Likelihood Guard = Post-OCR Contextual Security Boundary:**
   - Analyzes normalized OCR text using multi-signal contextual evidence.
   - Ensures that bank transfer slips missing QR codes (e.g. cropped slips) fail closed and cannot be converted into receipt drafts.
5. **User = Explicit Confirmer:**
   - All approved classifications produce drafts in `pending_confirmation` status. Permanent transactions are written to PostgreSQL only upon explicit interactive user confirmation via LINE Flex card.

---

## 2. Classification Taxonomy & Routing Behavior

The Local QR Router normalizes every input image into exactly one of **5 mutually exclusive categories**:

```text
                                [Input Image Buffer]
                                         │
                                         ▼
                            [Local QR Router Classifier]
                                         │
     ┌───────────────────┬───────────────┴───────────────┬───────────────────┐
     │                   │                               │                   │
[BANK_SLIP_QR]      [NON_BANK_QR]                     [NO_QR]          [UNREADABLE_QR] /
     │                   │                               │             [AMBIGUOUS]
     │                   └───────────────┬───────────────┘                   │
     ▼                                   ▼                                   ▼
 [Slip2Go]                       [Typhoon OCR 1.5]                      [HARD STOP]
 (Verifier)                              │                              (Fail-Closed)
                                         ▼
                            [Bank-Slip Likelihood Guard]
                                         │
                       ┌─────────────────┴─────────────────┐
                       │                                   │
               [ALLOW_RECEIPT]                   [REJECT_SUSPECTED_SLIP] /
                       │                         [REJECT_AMBIGUOUS]
                       ▼                                   │
                 [Receipt Draft]                           ▼
                       │                              [HARD STOP]
                       ▼                             (Fail-Closed)
             [User Confirm via Flex]
```

### 2.1 Category Definitions & Terminal Routing Rules

| Category | Precise Definition | Terminal Routing Behavior | Default User Response / Action |
| :--- | :--- | :--- | :--- |
| **`BANK_SLIP_QR`** | **"QR payload structurally eligible for Slip2Go verification."** Contains valid Thai Interbank Mini-QR (`Tag 00.00 = '000001'`, valid 3-digit `sendingBank`, alphanumeric `transRef`, `Tag 51 = 'TH'`, `Tag 91 = CRC16`) or TrueMoney Transfer Slip QR. **Does NOT imply the slip is genuine or verified.** | Dispatch to **Slip2Go (`ISlipProvider.verifySlip`)**. | If Slip2Go approves (`200000`/`200200`) $\rightarrow$ Create Slip Draft (`source = 'slip'`). If Slip2Go rejects (`200500`/`200501`) $\rightarrow$ **HARD STOP**. |
| **`NON_BANK_QR`** | A decodable QR matrix is detected, but its payload is **NOT** a bank slip. Examples: PromptPay Payment AnyID (Tag 29 AID `A000000677010111`), Domestic Bill Payment (Tag 30 AID `A000000677010112`), Web URLs (`http://`, `https://`), POS retail transaction matrices, or product barcodes. | Dispatch to **Typhoon OCR $\rightarrow$ Bank-Slip Likelihood Guard**. | Requires multi-signal receipt proof before creating Receipt Draft. If bank slip signals appear $\rightarrow$ **HARD STOP**. |
| **`NO_QR`** | Zero QR matrix patterns detected in image buffer (typical for retail paper receipts, but also the attack vector for cropped bank slips). | Dispatch to **Typhoon OCR $\rightarrow$ Bank-Slip Likelihood Guard**. | Evaluated strictly by Guard. Requires positive retail receipt signals; fails closed if transfer slip signals appear. |
| **`UNREADABLE_QR` / `QR_DECODE_ERROR`** | QR matrix or finder patterns are detected, but matrix is torn, blurred, corrupted, or Reed-Solomon error correction fails. | **FAIL-CLOSED (HARD STOP)**. Slip2Go and OCR are bypassed. | *"📷 ภาพ QR Code ไม่ชัดเจนหรือไม่สมบูรณ์ กรุณาถ่ายภาพใหม่ให้เห็น QR Code ชัดเจนครับ ✨"* |
| **`AMBIGUOUS`** | Multiple conflicting QR matrices detected in image (e.g. a bank slip pasted next to a merchant payment QR, or conflicting payload markers). | **FAIL-CLOSED (HARD STOP)**. Slip2Go and OCR are bypassed. | *"⚠️ ตรวจพบ QR Code หลายรายการในภาพเดียว กรุณาส่งรูปเฉพาะสลิปหรือใบเสร็จรายการเดียวครับ ✨"* |

---

## 3. High-Confidence Routing Signal: `BANK_SLIP_QR` Structure

### 3.1 Structural Signal (`000001` Mini-QR)
A payload qualifies as `BANK_SLIP_QR` if and only if it strictly matches the TLV structure standardized across Thai commercial banks and National ITMX:

```text
Tag 00: Transfer Payload Container (Length: 35–45 characters)
  ├── Subtag 00 (06 chars): "000001" (Thai Interbank Slip Service Standard)
  ├── Subtag 01 (03 chars): sendingBank 3-digit BOT code (e.g., "004", "006", "014")
  └── Subtag 02 (15-25 chars): transRef (Alphanumeric Bank Transaction Reference)
Tag 51 (02 chars): "TH" (Country Code)
Tag 91 (04 chars): Checksum / CRC16-CCITT (XMODEM)
```

### 3.2 Explicit Exclusion of Payment AIDs
- **`A000000677010111` (Tag 29):** PromptPay Credit Transfer (AnyID) Merchant-Presented Payment QR.
- **`A000000677010112` (Tag 30):** Domestic Bill Payment QR.
- **Policy Invariant:** These AIDs indicate an **unexecuted payment request**, NOT a completed transfer slip. They **MUST NEVER** be classified as `BANK_SLIP_QR`. Routing them to Slip2Go results in HTTP 400 (`400001: QR Code is missing / ไม่ถูกต้อง`).

---

## 4. Reconciled Provider & Channel Enumeration

Reconciling the official Slip2Go REST API documentation (`/guide/rest-api/qr-code`):
- **34 Distinct Slip2Go `accountType` Codes:**
  - `01002` through `01088`: 24 commercial bank codes.
  - `01030` through `01098`: 5 specialized financial institution codes.
  - `02001`, `02003`, `02004`: 3 PromptPay proxy codes.
  - `03000`: 1 Merchant POS partner code.
  - `04000`: 1 Non-bank e-wallet code.
- **38 Distinct Financial Institutions, Channels, and Partner Apps:**
  - 24 Thai commercial banks + 5 SFIs + 3 PromptPay proxies + 5 partner apps under `03000` (K+ Shop, แม่มณี, Be Merchant NextGen, TTB Smart Shop, ร้านน้องหอมจัง) + 1 e-wallet (`04000` TrueMoney) = **38 distinct entities**.

### Machine-Reviewable Provider Table

| No. | Slip2Go `accountType` | BOT Code | Entity / Channel Name (Thai) | Entity / Channel Name (English) | Category | Evidence | Confidence |
| :---: | :---: | :---: | :--- | :--- | :--- | :--- | :---: |
| 1 | `01002` | `002` | ธนาคารกรุงเทพ | Bangkok Bank (BBL) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 2 | `01004` | `004` | ธนาคารกสิกรไทย | Kasikorn Bank (KBANK) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 3 | `01006` | `006` | ธนาคารกรุงไทย | Krung Thai Bank (KTB) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 4 | `01008` | `008` | ธนาคารเจพีมอร์แกน เชส | JPMorgan Chase Bank (JPMC) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 5 | `01011` | `011` | ธนาคารทหารไทยธนชาต | TMBThanachart Bank (TTB) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 6 | `01014` | `014` | ธนาคารไทยพาณิชย์ | Siam Commercial Bank (SCB) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 7 | `01017` | `017` | ธนาคารซิตี้แบงก์ | Citibank Thailand (CITI) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 8 | `01018` | `018` | ธนาคารซูมิโตโม มิตซุย | Sumitomo Mitsui Banking Corp (SMBC) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 9 | `01020` | `020` | ธนาคารสแตนดาร์ดชาร์เตอร์ด (ไทย) | Standard Chartered Bank Thai (SCBT) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 10 | `01022` | `022` | ธนาคารซีไอเอ็มบี ไทย | CIMB Thai Bank (CIMBT) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 11 | `01024` | `024` | ธนาคารยูโอบี | United Overseas Bank Thai (UOBT) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 12 | `01025` | `025` | ธนาคารกรุงศรีอยุธยา | Bank of Ayudhya (BAY / Krungsri) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 13 | `01029` | `029` | ธนาคารอินเดียนโอเวอร์ซีส์ | Indian Overseas Bank (IOBA) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 14 | `01031` | `031` | ธนาคารฮ่องกงและเซี่ยงไฮ้แบงกิ้ง | HSBC Thailand | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 15 | `01032` | `032` | ธนาคารดอยซ์แบงก์ เอจี | Deutsche Bank AG (DB) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 16 | `01039` | `039` | ธนาคารมิซูโฮ | Mizuho Bank Bangkok Branch | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 17 | `01045` | `045` | ธนาคารบีเอ็นพี พารีบาส์ | BNP Paribas Bangkok Branch | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 18 | `01052` | `052` | ธนาคารแห่งประเทศจีน (ไทย) | Bank of China Thai (BOC) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 19 | `01067` | `067` | ธนาคารทิสโก้ | TISCO Bank | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 20 | `01069` | `069` | ธนาคารเกียรตินาคินภัทร | Kiatnakin Phatra Bank (KKP) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 21 | `01070` | `070` | ธนาคารไอซีบีซี (ไทย) | ICBC Thai | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 22 | `01071` | `071` | ธนาคารไทยเครดิต | Thai Credit Bank (TCRB) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 23 | `01073` | `073` | ธนาคารแลนด์ แอนด์ เฮ้าส์ | Land and Houses Bank (LH Bank) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 24 | `01088` | `088` | ธนาคารคลิกซ์ | CLICX Bank (Digital / Virtual) | Commercial Bank | Slip2Go Doc | **VERIFIED** |
| 25 | `01030` | `030` | ธนาคารออมสิน | Government Savings Bank (GSB) | State-Owned Bank | Slip2Go Doc | **VERIFIED** |
| 26 | `01033` | `033` | ธนาคารอาคารสงเคราะห์ | Government Housing Bank (GHB) | State-Owned Bank | Slip2Go Doc | **VERIFIED** |
| 27 | `01034` | `034` | ธ.ก.ส. | BAAC | State-Owned Bank | Slip2Go Doc | **VERIFIED** |
| 28 | `01066` | `066` | ธนาคารอิสลามแห่งประเทศไทย | Islamic Bank of Thailand (ISBT) | State-Owned Bank | Slip2Go Doc | **VERIFIED** |
| 29 | `01098` | `098` | ธพว. (SME Bank) | SME Development Bank | State-Owned Bank | Slip2Go Doc | **VERIFIED** |
| 30 | `02001` | - | PromptPay เบอร์โทรศัพท์ | PromptPay Mobile (MSISDN) | PromptPay Proxy | Slip2Go Doc | **VERIFIED** |
| 31 | `02003` | - | PromptPay บัตร ปชช./Tax ID | PromptPay National ID / Tax ID | PromptPay Proxy | Slip2Go Doc | **VERIFIED** |
| 32 | `02004` | - | PromptPay รหัส E-Wallet | PromptPay E-Wallet ID | PromptPay Proxy | Slip2Go Doc | **VERIFIED** |
| 33 | `03000` | - | K+ Shop | KBANK Merchant POS | Merchant POS | Slip2Go Doc | **VERIFIED** |
| 34 | `03000` | - | แม่มณี | SCB Merchant POS | Merchant POS | Slip2Go Doc | **VERIFIED** |
| 35 | `03000` | - | Be Merchant NextGen | BBL Merchant POS | Merchant POS | Slip2Go Doc | **VERIFIED** |
| 36 | `03000` | - | TTB Smart Shop | TTB Merchant POS | Merchant POS | Slip2Go Doc | **VERIFIED** |
| 37 | `03000` | - | ร้านน้องหอมจัง | BAAC Merchant POS | Merchant POS | Slip2Go Doc | **VERIFIED** |
| 38 | `04000` | - | True Money Wallet | TrueMoney Wallet | Non-Bank Wallet | Slip2Go Doc | **VERIFIED** |

---

## 5. Bank-Slip Likelihood Guard (Post-OCR Contextual Security)

### 5.1 Principle: Multi-Signal Contextual Evidence (No Single-Keyword Veto)
A single generic keyword (e.g. `"SCB"`, `"PromptPay"`, or `"Ref No."`) **MUST NOT** be treated as sufficient evidence of a bank slip. Many authentic retail receipts contain payment method notes (e.g. `"ชำระด้วย PromptPay"`, `"บัตรเครดิต KBank"`, `"EDC Ref: 12345"`). Treating isolated keywords as vetoes would cause severe false-positive rejections of valid retail receipts.

Instead, the Guard evaluates **multi-signal contextual co-occurrence**:

```text
Bank Slip Context =
    [Transfer Confirmation Action Verb]
    + [Directional Account Roles ("จากบัญชี... ไปยังบัญชี...")]
    + [Interbank Clearing Transaction Metadata]
```

### 5.2 Signal Matrix & Provisional Scoring

> [!NOTE]
> **Provisional / Non-Normative Calibration Notice:**
> The numeric weights below are **provisional and non-normative**. They represent architectural heuristics subject to empirical calibration against a representative corpus of Thai retail receipts and banking slips in Step 3/4. The qualitative fail-closed rule remains normative.

#### A. Positive Retail Receipt Signals (`receiptEvidence`)
1. **Registered Retailer Brands:** `7-Eleven`, `Lotus's`, `Big C`, `CJ MORE`, `Makro`, `Tops`, `Gourmet Market`, `Foodland`, `Cafe Amazon`, `Starbucks`, `Watsons`, `Boots`.
2. **Fiscal Receipt Headers:** `ใบเสร็จรับเงิน`, `ใบกำกับภาษีอย่างย่อ`, `TAX INVOICE (ABB)`, `ใบกำกับภาษีเต็มรูป`, `RECEIPT`.
3. **Point of Sale (POS) Hardware Identifiers:** `เลขประจำตัวผู้เสียภาษี`, `TAX ID`, `POS ID`, `เครื่องที่`, `แคชเชียร์`, `Cashier`, `RD/Tax ID`.
4. **Transaction Tender Breakdown:** `เงินสด`, `เงินทอน`, `Change`, `Cash`, `ยอดรวมรวมภาษีมูลค่าเพิ่ม`, `VAT 7%`.
5. **Itemized Line Patterns:** Quantity and unit price formatting (`x1`, `x2`, `@`, `Qty`).

#### B. Positive Bank Transfer Slip Signals (`bankSlipEvidence`)
1. **Transfer Execution Verbs:** `โอนเงินสำเร็จ`, `โอนสำเร็จ`, `Successful Transfer`, `ทำรายการสำเร็จ`, `บันทึกรายการสำเร็จ`.
2. **Directional Transfer Account Context:** Co-occurrence of `จาก:` / `จากบัญชี:` / `From Account:` with `ไปยัง:` / `เข้าบัญชี:` / `To Account:`.
3. **Financial Institution in Sender/Receiver Role:** Bank names explicitly linked to sender/receiver account titles (e.g. `ธนาคารกสิกรไทย บัญชีเลขที่...`).
4. **Interbank Clearing Metadata:** `รหัสอ้างอิงธนาคาร`, `Reference No:`, `Trace No:`, `Transaction Ref:`.
5. **Masked Interbank Account Syntax:** Regex matching masked banking accounts (`\bxxx-x-x\d{4}-x\b`, `\bx{3,}-\d{4}\b`).

### 5.3 Guard Decision Logic (Normative)
```text
FUNCTION evaluateGuard(extractedText, receiptSignals, bankSlipSignals):

    // Multi-signal bank transfer test:
    hasTransferAction   = containsTransferExecutionVerb(extractedText)
    hasDirectionalRole  = containsDirectionalTransferAccounts(extractedText)
    hasBankMetadata     = containsInterbankMetadata(extractedText)

    // 1. Cropped / Missing QR Bank Slip Detection
    IF (hasTransferAction AND (hasDirectionalRole OR hasBankMetadata)):
        RETURN REJECT_SUSPECTED_SLIP
        // Rationale: Co-occurrence of transfer confirmation with account direction
        // proves this document is a bank slip lacking verified QR code. Fail-closed.

    // 2. Clear Retail Receipt Detection
    IF (receiptSignals >= THRESHOLD AND NOT hasTransferAction):
        RETURN ALLOW_RECEIPT
        // Rationale: Positive retail signals with zero transfer action verbs.

    // 3. Ambiguous / Low Signal
    RETURN REJECT_AMBIGUOUS
        // Rationale: Cannot positively confirm as retail receipt. Fail-closed.
```

---

## 6. Duplicate-Control Controls & Clarification

### 6.1 Verified Current Implementation
- **Tier 1 (Provider Level):** `SlipService` passes `{ checkDuplicate: true }` to Slip2Go. Slip2Go returns `200501: Slip is Duplicated` on duplicates checked against the merchant package.
- **Tier 2 (Application Query Level):** In `src/modules/slip/slip.service.ts` (`findDuplicateByTransRef`), an application-level SQL query is executed:
  ```sql
  SELECT id FROM transaction_drafts
  WHERE user_id = $1 AND status != 'cancelled' AND (extracted_data->>'transRef') = $2
  LIMIT 1
  ```
- **Audited State:** **There is currently NO PostgreSQL database-level `UNIQUE` index constraint on `(extracted_data->>'transRef')` in migrations 001–005.**
- **Future Implementation Consideration (Not Existing Control):** Adding a database-level partial unique index `idx_drafts_user_trans_ref` on `(user_id, (extracted_data->>'transRef')) WHERE status != 'cancelled'` is documented as a valuable future hardening enhancement, but is **NOT** enforced in the current schema and **no migration is added in this step**.

---

## 7. C1–C11 Truth Table & Hybrid Policy Scenarios

Governed by the **Hybrid Policy Framework** ([`docs/spec/product-policy-hybrid-decision.md`](file:///C:/jodtang/docs/spec/product-policy-hybrid-decision.md)):
- **Policy A (Fail-Closed / Hard Stop):** Applied to physical ATM paper slips and cropped bank slips. No unverified draft is created; user is advised to log via text.
- **Policy B (Unverified Draft with Explicit Warning ⚠️):** Applied to electronic wallet confirmations (G-Wallet, ShopeePay) and completed Bill Payments (KTC, utilities). Routes to Typhoon OCR and produces a strictly non-verified draft requiring explicit user confirmation.

| Case ID | Scenario Description | Detected Signal | Category | Downstream Route | Guard Evaluation / Policy | Terminal Outcome | Safety Invariant Enforced |
| :---: | :--- | :---: | :--- :---: | :---: | :---: | :---: | :--- |
| **C1** | Genuine Bank Transfer Slip with intact Mini-QR | Tag 00.00 = `'000001'` | `BANK_SLIP_QR` | Slip2Go | N/A (Bypassed) | **Slip Draft (`source = 'slip'`)** on `200000`/`200200` | Slip2Go is financial verifier. |
| **C2** | Retail Paper Receipt (7-Eleven / Lotus) with no QR | No QR matrix found | `NO_QR` | Typhoon OCR | `ALLOW_RECEIPT` | **Receipt Draft (`source = 'receipt'`)** | Valid retail receipt supported. |
| **C3** | Retail Receipt with Store Website / Promo URL QR | URL string (`https://...`) | `NON_BANK_QR` | Typhoon OCR | `ALLOW_RECEIPT` | **Receipt Draft (`source = 'receipt'`)** | Non-bank QR does not trigger Slip2Go. |
| **C4** | Merchant Payment QR Signboard (Tag 29 PromptPay AnyID) | Tag 29 AID `A000000677010111` | `NON_BANK_QR` | Typhoon OCR | `REJECT_AMBIGUOUS` | **HARD STOP** ("เป็น QR รับเงิน ไม่ใช่สลิปหรือใบเสร็จ") | Payment request QR is not an expense. |
| **C5** | **Bill Payment Confirmation** (KTC / Utility Bill Paid) | Tag 30 or No QR + `จ่ายบิลสำเร็จ` | `NON_BANK_QR` / `NO_QR` | Typhoon OCR | **Policy B: `ALLOW_UNVERIFIED_BILL`** | **Unverified Draft (`source = 'bill_unverified'`)** `[Unverified Bill Payment ⚠️]` | Strictly unverified; requires explicit user confirmation. |
| **C6** | TrueMoney Wallet Transfer Slip | Tag 00.00/01 = `'01'`, TxID | `BANK_SLIP_QR` | Slip2Go | N/A (Bypassed) | **Slip Draft** on `200000` | TrueMoney slip verified via Slip2Go `04000`. |
| **C7** | **Adversarial: Cropped Bank Slip** (Interbank QR cut out) | No QR + Directional Bank Accounts | `NO_QR` | Typhoon OCR | **Policy A: `REJECT_SUSPECTED_SLIP`** | **HARD STOP** ("พบสลิปโอนเงินแต่ไม่มี QR กรุณาส่งรูปเต็มใบ") | Cropped interbank slips fail closed. |
| **C8** | **Adversarial: Torn / Blurred Bank Slip QR** | Degraded QR matrix | `UNREADABLE_QR` | None (Direct Stop) | N/A | **HARD STOP** ("ภาพ QR ไม่ชัดเจน กรุณาถ่ายใหม่") | Unreadable QR fails closed. |
| **C9** | Retail Receipt with Bank Note ("ชำระผ่าน PromptPay SCB") | No QR or Store URL QR | `NO_QR` / `NON_BANK_QR` | Typhoon OCR | `ALLOW_RECEIPT` | **Receipt Draft (`source = 'receipt'`)** | Multi-signal context prevents single-keyword false positive. |
| **C10** | **Adversarial: Multiple QR Codes** (Slip + promo QR in 1 photo) | $\ge 2$ conflicting matrices | `AMBIGUOUS` | None (Direct Stop) | N/A | **HARD STOP** ("พบ QR หลายตัว กรุณาส่งรูปเดียว") | Ambiguous inputs fail closed. |
| **C11** | **Physical ATM Paper Slip** (Dispensed ATM transfer/withdrawal slip) | No QR + ATM layout / keywords | `NO_QR` | Typhoon OCR | **Policy A: `REJECT_ATM_SLIP`** | **HARD STOP** ("ไม่สามารถยืนยันสลิปตู้ ATM ได้ กรุณาพิมพ์บอกรายการ") | ATM paper slips fail closed. |
| **C12** | **e-Wallet Payment Confirmation** (เป๋าตัง G-Wallet 32 THB, ShopeePay) | No QR + `G-Wallet` / `เป๋าตัง` | `NO_QR` | Typhoon OCR | **Policy B: `ALLOW_UNVERIFIED_EWALLET`** | **Unverified Draft (`source = 'ewallet_unverified'`)** `[Unverified e-Wallet ⚠️]` | Strictly unverified; requires explicit user confirmation. |

---

## 8. STRIDE Threat Analysis Summary

| Threat ID | Category | Threat Vector | Impact | Mitigation Strategy |
| :---: | :---: | :--- | :---: | :--- |
| **T-01** | **Tampering** | Cropped Bank Slip submitted as Receipt (QR removed) | Critical | **Bank-Slip Likelihood Guard:** Flags transfer action verbs + directional account roles; terminates with `REJECT_SUSPECTED_SLIP`. |
| **T-02** | **Spoofing** | Unexecuted PromptPay Payment QR submitted as Expense | High | **Local QR Classifier:** AID `010111` routed to OCR/Guard; rejected as lacking purchase receipt lines. |
| **T-03** | **Repudiation** | Unpaid Utility Bill Payment QR submitted as Expense | Medium | **Local QR Classifier:** AID `010112` routed to OCR/Guard; rejected as unpaid invoice. |
| **T-04** | **Denial of Service** | Flooding non-slip images to exhaust Slip2Go token quota | High | **In-Memory Filtering Target:** Local classification filters `NO_QR` and `NON_BANK_QR` locally without invoking Slip2Go. |
| **T-05** | **Info Disclosure** | Full 16-digit PAN credit card numbers or National IDs on receipts | High | **Deterministic PII Sanitization:** In-memory regex masking (`****-****-****-****`) prior to draft persistence. |
| **T-06** | **Tampering** | Replaying previously verified slip | High | **2-Tier Duplicate Check:** Slip2Go `checkDuplicate: true` + Application-level SQL check against `transaction_drafts`. |

---

## 9. Product Decision Gates (Preserved & Unresolved)

The following product policy decisions are intentionally preserved as **PENDING PRODUCT SIGN-OFF** and are NOT altered by this technical specification:

1. **Product Policy Gate: Physical ATM Receipts:**
   - Physical paper ATM transaction receipts do NOT have QR codes printed on them by legacy ATMs.
   - *Current System Behavior:* Under this specification, an ATM slip image will classify as `NO_QR`, and the Guard will detect transfer verbs $\rightarrow$ `REJECT_SUSPECTED_SLIP` (Fail-closed).
   - *Open Product Decision:* Should ATM paper receipts be supported via a dedicated manual/ATM workflow, or should users be instructed to record ATM transactions via text input (e.g. `"โอนเงิน 500"` / `"ถอนเงิน 1000"`)?
2. **Product Policy Gate: Third-Party E-Wallets (ShopeePay, Rabbit LINE Pay):**
   - Slip2Go explicitly documents TrueMoney Wallet (`04000`), but does not document ShopeePay or Rabbit LINE Pay.
   - *Policy:* These remain unverified until provider documentation confirms gateway support.

---

## 10. Acceptance Criteria & Sign-Off Checklist (Step 2 Gate)

- [x] **Semantic Definition Locked:** `BANK_SLIP_QR` defined strictly as "QR payload structurally eligible for Slip2Go verification", with explicit declaration that it does not mean the slip is verified or genuine.
- [x] **Guard Revised:** Single-keyword veto removed; multi-signal contextual evidence defined; fail-closed preserved; scoring marked provisional/non-normative.
- [x] **Taxonomy Normalized:** Exactly 5 mutually exclusive categories defined (`BANK_SLIP_QR`, `NON_BANK_QR`, `NO_QR`, `UNREADABLE_QR`, `AMBIGUOUS`).
- [x] **Provider Enumeration Reconciled:** 34 Slip2Go codes and 38 distinct entities/channels fully verified and enumerated without guessing.
- [x] **Duplicate Control Corrected:** Accurately describes existing application-level SQL check; no false claims of PostgreSQL unique constraint; no schema migrations added.
- [x] **Performance Rephrased:** In-memory performance phrased as an explicit Non-Functional Target ($\le 50\text{ ms}$, goal $\le 30\text{ ms}$), not an absolute claim.
- [x] **Immutable Invariants Preserved:** `200500` / `200501` HARD STOP, Slip2Go as verifier, Typhoon OCR as extraction only, fail-closed on ambiguity.
- [x] **C1–C11 Truth Table & Adversarial Scenarios Documented.**
- [x] **Product Decision Gates Preserved:** ATM paper receipts and unverified e-wallets held for product sign-off.
- [x] **Zero Code Changes:** 0 source code files modified, 0 config files modified, 0 dependencies added, 0 migrations created.

```text
STEP 2 REVISION COMPLETE
Status: SPECIFICATION & THREAT MODEL ONLY
Implementation: NOT AUTHORIZED
Commit: NOT AUTHORIZED
Push: NOT AUTHORIZED
Deploy: NOT AUTHORIZED
```
