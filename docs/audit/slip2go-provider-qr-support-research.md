# Slip2Go Provider / QR Support Research & Evidence Hardening
**Document Version:** 1.1.0 (Hardened)
**Date:** 2026-09-02
**Status:** 🔴 RESEARCH ONLY — NO IMPLEMENTATION
**Repository:** `C:\jodtang`

---

## 1. Executive Summary

This hardened research document establishes the authoritative evidence base for financial providers, bank slip QR structures, and response semantics supported by **Slip2Go** and Thai banking standards (Bank of Thailand, National ITMX, EMVCo).

### Core Architectural Clarifications & Principles:
1. **Local QR Router = Classifier; Slip2Go = Verifier:**
   - The Local QR Router acts strictly as an **in-memory image classifier** (routing signal), NOT a verification or security authority.
   - We **never** claim local QR parsing is "100% fraud-safe". Final authenticity, duplicate checks, and fraud detection remain the exclusive responsibility of **Slip2Go** and the interbank gateway.
2. **Mini-QR vs. Payment QR (Critical Paradigm Shift):**
   - **Bank Transfer Verification QR ("Mini-QR" on slips):** Follows the Thai Interbank Slip Verification standard (`Tag 00` $\rightarrow$ `Subtag 00 = '000001'`, `Subtag 01 = sendingBank`, `Subtag 02 = transRef`, `Tag 51 = 'TH'`, `Tag 91 = CRC16`). **It contains NO Application Identifier (AID).**
   - **Merchant Payment QR (PromptPay Tag 29 / Bill Payment Tag 30):** Holds AID **`A000000677010111`** (Credit Transfer) or **`A000000677010112`** (Bill Payment). These are payment initiation codes, NOT completed transfer slips.
   - **Routing Rule:** Any QR containing AID `010111` or `010112` is explicitly **excluded** from `BANK_SLIP_QR`.
3. **Threat Model for `NO_QR` and `NON_BANK_QR` (Cropped Slip Guard):**
   - Routing `NO_QR` or `NON_BANK_QR` directly to Typhoon OCR is **NOT** inherently safe on its own, because an attacker or user may crop the QR code out of a bank slip (`Bank Slip -> Cropped QR -> NO_QR -> OCR`).
   - Therefore, images routed to OCR **MUST pass through a post-OCR Bank-Slip Likelihood Guard**. OCR has zero authority to create a draft if banking slip indicators are detected.
4. **Formal Finding on Existing Code Mapping:**
   - Logged as `FINDING: Existing Slip2Go response mapping diverges from current official API semantics.`
   - Discrepancies identified: `400001` (QR missing/invalid), `400004` (Image URL invalid), `400005` (Base64 invalid), `200501` (Duplicate), `401005` (Quota).
   - This is audited and isolated for remediation; **no code changes are made in this step**.

---

## 2. Authoritative Sources

| Source | Type | URL / Reference | Authority Level | Date Checked |
| :--- | :--- | :--- | :--- | :---: |
| **Slip2Go REST API Guide (QR-Code)** | Official Provider Doc | `https://slip2go.com/guide/rest-api/qr-code` | Authoritative (Primary) | 2026-09-02 |
| **Slip2Go Response Codes Guide** | Official Provider Doc | `https://slip2go.com/guide/response` | Authoritative (Primary) | 2026-09-02 |
| **Slip2Go REST API Guide (Image)** | Official Provider Doc | `https://slip2go.com/guide/rest-api/image` | Authoritative (Primary) | 2026-09-02 |
| **Slip2Go API Service Overview** | Official Provider Doc | `https://slip2go.com/services/slip2go-api` | Authoritative (Primary) | 2026-09-02 |
| **Slip2Go FAQ & Quota Rules** | Official Provider Doc | `https://slip2go.com/faq` | Authoritative (Primary) | 2026-09-02 |
| **Bank of Thailand (BOT)** | Central Bank Standard | Standardized Thai QR Code for Payment Transactions | Authoritative (National) | 2026-09-02 |
| **National ITMX (NITMX)** | Payment Switch Infrastructure | PromptPay & Interbank Transaction Specifications (RID `A000000677`) | Authoritative (National) | 2026-09-02 |
| **EMVCo** | International Card Standard | EMVCo QR Code Specification for Payment Systems (MPM) | Authoritative (International) | 2026-09-02 |
| **Community Implementations (`promptparse`)** | Open-source Reference SDK | `https://github.com/maythiwat/promptparse` (v1.6.0) | Secondary / Technical Reference | 2026-09-02 |

---

## 3. Full Provider Enumeration Table

Every financial institution, bank, proxy, and provider explicitly enumerated in the official Slip2Go REST API specification (`payload.checkCondition.checkReceiver.accountType`):

### 3.1 Thai Commercial Banks (24 Institutions)

| No. | Official Slip2Go Code (`accountType`) | BOT / Interbank Code | Bank Name (Thai) | Bank Name (English) | Common Abbreviation | Verification Capability | Evidence | Confidence |
| :---: | :---: | :---: | :--- | :--- | :---: | :---: | :--- | :---: |
| 1 | `01002` | `002` | ธนาคารกรุงเทพ | Bangkok Bank | BBL | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 2 | `01004` | `004` | ธนาคารกสิกรไทย | Kasikorn Bank | KBANK | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 3 | `01006` | `006` | ธนาคารกรุงไทย | Krung Thai Bank | KTB | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 4 | `01008` | `008` | ธนาคารเจพีมอร์แกน เชส | JPMorgan Chase Bank, Bangkok Branch | JPMC | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 5 | `01011` | `011` | ธนาคารทหารไทยธนชาต | TMBThanachart Bank | TTB | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 6 | `01014` | `014` | ธนาคารไทยพาณิชย์ | Siam Commercial Bank | SCB | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 7 | `01017` | `017` | ธนาคารซิตี้แบงก์ | Citibank, N.A., Bangkok Branch | CITI | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 8 | `01018` | `018` | ธนาคารซูมิโตโม มิตซุย | Sumitomo Mitsui Banking Corporation | SMBC | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 9 | `01020` | `020` | ธนาคารสแตนดาร์ดชาร์เตอร์ด (ไทย) | Standard Chartered Bank (Thai) | SCBT | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 10 | `01022` | `022` | ธนาคารซีไอเอ็มบี ไทย | CIMB Thai Bank | CIMBT | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 11 | `01024` | `024` | ธนาคารยูโอบี | United Overseas Bank (Thai) | UOBT | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 12 | `01025` | `025` | ธนาคารกรุงศรีอยุธยา | Bank of Ayudhya | BAY / Krungsri | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 13 | `01029` | `029` | ธนาคารอินเดียนโอเวอร์ซีส์ | Indian Overseas Bank, Bangkok Branch | IOBA | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 14 | `01031` | `031` | ธนาคารฮ่องกงและเซี่ยงไฮ้แบงกิ้งคอร์ปอเรชั่น | The Hongkong and Shanghai Banking Corporation | HSBC | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 15 | `01032` | `032` | ธนาคารดอยซ์แบงก์ เอจี | Deutsche Bank AG, Bangkok Branch | DB | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 16 | `01039` | `039` | ธนาคารมิซูโฮ | Mizuho Bank, Bangkok Branch | MIZUHO | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 17 | `01045` | `045` | ธนาคารบีเอ็นพี พารีบาส์ | BNP Paribas, Bangkok Branch | BNPP | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 18 | `01052` | `052` | ธนาคารแห่งประเทศจีน (ไทย) | Bank of China (Thai) | BOC | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 19 | `01067` | `067` | ธนาคารทิสโก้ | TISCO Bank | TISCO | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 20 | `01069` | `069` | ธนาคารเกียรตินาคินภัทร | Kiatnakin Phatra Bank | KKP | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 21 | `01070` | `070` | ธนาคารไอซีบีซี (ไทย) | Industrial and Commercial Bank of China (Thai) | ICBC | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 22 | `01071` | `071` | ธนาคารไทยเครดิต | Thai Credit Bank | TCRB | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 23 | `01073` | `073` | ธนาคารแลนด์ แอนด์ เฮ้าส์ | Land and Houses Bank | LH Bank | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 24 | `01088` | `088` | ธนาคารคลิกซ์ | CLICX Bank (Digital / Virtual) | CLICX | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |

### 3.2 State-Owned / Specialized Financial Institutions (SFIs) (5 Institutions)

| No. | Official Slip2Go Code (`accountType`) | BOT / Interbank Code | Institution Name (Thai) | Institution Name (English) | Abbreviation | Verification Capability | Evidence | Confidence |
| :---: | :---: | :---: | :--- | :--- | :---: | :---: | :--- | :---: |
| 25 | `01030` | `030` | ธนาคารออมสิน | Government Savings Bank | GSB | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 26 | `01033` | `033` | ธนาคารอาคารสงเคราะห์ | Government Housing Bank | GHB | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 27 | `01034` | `034` | ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร | Bank for Agriculture and Agricultural Cooperatives | BAAC | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 28 | `01066` | `066` | ธนาคารอิสลามแห่งประเทศไทย | Islamic Bank of Thailand | ISBT | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 29 | `01098` | `098` | ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อมฯ | Small and Medium Enterprise Development Bank | SME Bank | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |

### 3.3 PromptPay Proxies (3 Types)

| No. | Official Slip2Go Code (`accountType`) | Proxy Type | Format / Payload Spec | Target Description | Verification Capability | Evidence | Confidence |
| :---: | :---: | :---: | :---: | :--- | :---: | :--- | :---: |
| 30 | `02001` | `MSISDN` | 13-digit normalized (`0066...` or `0...`) | เบอร์โทรศัพท์มือถือ | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 31 | `02003` | `NATID` | 13-digit citizen ID / Tax ID | บัตรประชาชน / เลขประจำตัวผู้เสียภาษี | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| 32 | `02004` | `EWALLETID` | 15-digit e-Wallet ID | รหัสพร้อมเพย์ E-Wallet | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |

### 3.4 Merchant POS / Shop Accounts (5 Applications)

| No. | Official Slip2Go Code (`accountType`) | Associated Banks / Apps | Merchant Mechanism | Verification Capability | Evidence | Confidence |
| :---: | :---: | :--- | :---: | :---: | :--- | :---: |
| 33 | `03000` | K+ Shop (KBANK), แม่มณี (SCB), Be Merchant NextGen (BBL), TTB Smart Shop (TTB), ร้านน้องหอมจัง (BAAC) | Biller ID / Merchant ID (`BILLERID`) | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |

### 3.5 Non-Bank E-Wallets

| No. | Official Slip2Go Code (`accountType`) | Provider Name | Wallet Identifier | Verification Capability | Evidence | Confidence |
| :---: | :---: | :--- | :---: | :---: | :--- | :---: |
| 34 | `04000` | TrueMoney Wallet | TrueMoney Wallet Code / Phone | Slip Verification API | Official Doc: `/guide/rest-api/qr-code` | **VERIFIED** |
| - | - | ShopeePay, Rabbit LINE Pay, GrabPay | - | **UNKNOWN / NOT VERIFIED** (Not in official API docs) | Official Doc: `/guide/rest-api/qr-code` | **UNVERIFIED** |

---

## 4. Authoritative Proof of `000001` Mini-QR Structure

### 4.1 Specification Chain & Structure
The Thai Interbank Slip Verification Mini-QR is a TLV (Tag-Length-Value) standardized structure endorsed by Bank of Thailand and National ITMX:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Tag 00: Transfer Payload Container (Length: 35–45 characters)                │
│   ├── Subtag 00 (06 chars): "000001" (Thai Interbank Slip Service Standard) │
│   ├── Subtag 01 (03 chars): sendingBank 3-digit BOT code (e.g., "004")      │
│   └── Subtag 02 (15-25 chars): transRef (Alphanumeric Bank Reference)       │
├─────────────────────────────────────────────────────────────────────────────┤
│ Tag 51 (02 chars): "TH" (Country Code)                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ Tag 91 (04 chars): Checksum / CRC16-CCITT (XMODEM)                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Concrete Grounded Evidence

1. **Slip2Go Official Guide Example (`/guide/rest-api/qr-code`):**
   - Payload: `0041000600000101030040220014242082547BPM049885102TH9104xxxx`
   - Breakdown:
     - `Tag 00` (length `41`): `0006000001` (`Subtag 00 = 000001`), `0103004` (`Subtag 01 = 004` / Kasikorn), `0220014242082547BPM04988` (`Subtag 02 = transRef`)
     - `Tag 51` (length `02`): `TH`
     - `Tag 91` (length `04`): CRC16 checksum
2. **Real Production Slip Fixture (`media_1788247359485.jpg`):**
   - Decoded raw string: `0042000600000101030060221C202608316243157527745102TH9104C41E`
   - Breakdown:
     - `Tag 00` (length `42`): `0006000001` (`000001`), `0103006` (`006` / Krungthai), `0221C20260831624315752774` (`transRef`)
     - `Tag 51`: `TH`
     - `Tag 91`: `C41E`
3. **Reference Implementation Verification (`promptparse/slipVerify`):**
   ```typescript
   const apiType = ppqr?.getTagValue('00', '00');     // Must equal '000001'
   const sendingBank = ppqr?.getTagValue('00', '01'); // 3-digit bank code
   const transRef = ppqr?.getTagValue('00', '02');    // Transaction reference
   ```

### 4.3 Why AIDs (`A000000677010111` / `A000000677010112`) Must Be Excluded
- `A000000677010111` resides in **Tag `29`** (PromptPay Merchant AnyID).
- `A000000677010112` resides in **Tag `30`** (Domestic Bill Payment).
- Both are **Payment Initiation QR Codes** (e.g. counters, utility bills, restaurant QR). They contain payment destination proxies and biller IDs, but **NO** `sendingBank` and **NO** `transRef`.
- **Architectural Mandate:** These AIDs represent non-slip payment requests. They MUST NOT be routed to Slip2Go.

---

## 5. Audited Finding: Existing Slip2Go Response Mapping Discrepancy

> [!CAUTION]
> **FINDING: Existing Slip2Go response mapping may diverge from current official API semantics.**
> - Status: **AUDITED & LOGGED AS DEFECT — NOT FIXED IN THIS STEP**
> - Context: Identified during Step 1 authoritative documentation review. Any code fix must be separated into an approved remediation work item after the routing design gate.

| HTTP Status | Slip2Go Code | Official Documentation Meaning (`/guide/response`) | Current Jodtang Mapping (`slip2go.adapter.ts`) | Divergence Impact & Root Cause Analysis |
| :---: | :---: | :--- | :--- | :--- |
| `400` | **`400001`** | **QR Code is missing (QR Code ไม่ถูกต้อง)** | `status: 'NOT_FOUND'` (Line 160) | **CRITICAL DEFECT:** When an image lacks a valid bank QR, Slip2Go returns `400001`. Current code maps this to `NOT_FOUND` instead of `INVALID_IMAGE`, **blocking Receipt OCR Fallback**! |
| `400` | **`400004`** | **Image url format is not Valid** | `status: 'DUPLICATE'` (Line 133) | **LOGIC DEFECT:** `400004` is an HTTP 400 bad request for malformed image URL. Official duplicate slip code is `200501` (HTTP 200). |
| `400` | **`400005`** | **Base64 format is not Valid** | `status: 'QUOTA_EXCEEDED'` (Line 233) | **LOGIC DEFECT:** `400005` is Base64 format error. Official quota exhaustion code is `401005` (HTTP 401). |
| `200` | **`200500`** | **Slip is fraud (สลิปเสีย/สลิปปลอม)** | `status: 'FRAUD'` (Line 199) | **CORRECT:** Correctly mapped to `FRAUD` and blocks OCR. |
| `200` | **`200501`** | **Slip is Duplicated (สลิปซ้ำ)** | `status: 'DUPLICATE'` (Line 133) | **CORRECT:** Correctly mapped to `DUPLICATE` (alongside redundant 400004). |
| `401` | **`401005`** | **Insufficient Token (โทเคนหมด)** | (Handled via generic 401) | **GAP:** `401005` should specifically map to `QUOTA_EXCEEDED`. |

---

## 6. Threat Model for Routing: Guarding Against Cropped Bank Slips

### 6.1 The Attack / Failure Vector
```text
Attacker / User
      ↓
Takes a Bank Slip (potentially forged or already used)
      ↓
Crops out the QR Code area
      ↓
Uploads image to LINE
      ↓
Local QR Router detects NO QR (or retail QR)
      ↓
Routes to Typhoon OCR
```

If Typhoon OCR simply extracts text (Merchant, Amount, Date) and automatically creates a Receipt Draft, **the security boundary fails**. The user could confirm a cropped fraudulent bank slip as an expense without Slip2Go verification!

### 6.2 Hardened Architecture Pipeline

```text
               [In-Memory Image Stream]
                          │
                          ▼
            [Local QR Router (Classifier)]
                          │
         ┌────────────────┴────────────────┐
         │                                 │
 [BANK_SLIP_QR Detected]          [NO_QR / NON_BANK_QR]
 (Tag 00.00 = '000001')                    │
         │                                 ▼
         ▼                      [Typhoon OCR Extractor]
 [Slip2Go Verifier]                        │
         │                                 ▼
         ├─ 200000 → Slip Draft    [Bank-Slip Likelihood Guard]
         ├─ 200500 → HARD STOP                     │
         ├─ 200501 → HARD STOP     ├─ High Bank-Slip Evidence ──> HARD STOP (Fraud Alert)
         └─ Error  → HARD STOP     ├─ Ambiguous / Conflicted ───> HARD STOP (Ask Clearer Photo)
                                   └─ High Receipt Evidence ────> Receipt Draft (source = 'receipt')
                                                                            │
                                                                            ▼
                                                                 [User Explicit Confirm]
```

### 6.3 Bank-Slip Likelihood Guard Contract
- **Receipt Evidence Signals:** Retail merchant headers (7-Eleven, Lotus, Big C), Tax Invoice / Receipt header (`ใบเสร็จรับเงิน`, `ใบกำกับภาษีอย่างย่อ`, `TAX ID`, `POS ID`), payment breakdown (Cash, Change, Credit Card).
- **Bank Slip Evidence Signals:** Transfer keywords (`โอนเงินสำเร็จ`, `พร้อมเพย์`, `ธนาคาร`, `เลขที่รายการ`, `จากบัญชี`, `ไปยังบัญชี`, `Ref No`).
- **Policy:** If an image has **zero bank QR** but exhibits **Bank Slip keywords**, it is classified as `SUSPECTED_CROPPED_SLIP` and terminated with a **HARD STOP**.

---

## 7. Next Steps (Step 2 Preview)

Before initiating Step 2 (Routing Specification & Threat Model Sign-off):
1. Keep `docs/audit/slip2go-provider-qr-support-research.md` as the locked baseline.
2. Formally track `FINDING: 400001 / 400004 / 400005` in a separate remediation ticket/task.
3. Advance to drafting the **Local QR Router Specification** and **Bank-Slip Likelihood Guard Contract**.

---

## 8. Final Compliance Statement

- **Source Code Modified:** 0 files
- **Configuration Modified:** 0 files
- **Dependencies Added:** 0 packages
- **Database Migrations:** 0 migrations
- **Provider Calls:** 0 side-effect calls
- **Git Commit / Push / Deploy:** NONE

```text
STEP 1.1 EVIDENCE HARDENING COMPLETE
Implementation: NOT AUTHORIZED
Commit: NOT AUTHORIZED
Push: NOT AUTHORIZED
Deploy: NOT AUTHORIZED
```
