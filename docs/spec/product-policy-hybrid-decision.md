# Product Policy Decision: Hybrid Routing & Non-Slip2Go Transaction Handling
**Document Version:** 1.0.0
**Status:** 🔒 APPROVED PRODUCT POLICY
**Date:** 2026-09-02
**Target Repository:** `C:\jodtang`

---

## 1. Executive Summary & Policy Context

During production testing on LINE, two non-standard financial slip images caused historical user failures when submitted to Slip2Go:
- **Case 1 (13:38):** เป๋าตัง / G-Wallet payment of 32.00 THB (ร้านตงล้ง). Lacks bank Mini-QR.
- **Case 2 (13:41):** Krungthai NEXT Bill Payment of 8,715.89 THB to KTC Credit Card. Lacks bank Mini-QR.

When sent to Slip2Go, both transactions triggered `200500: Slip is fraud (สลิปเสีย/สลิปปลอม)` because they are non-bank interbank transfer slips. Under Jodtang's immutable security invariants, `200500` strictly triggered a **HARD STOP**, blocking users from logging valid daily living expenses.

To resolve this without compromising bank slip security invariants, Product Management and Security Engineering have agreed on the **Hybrid Product Policy**.

---

## 2. The Hybrid Policy Framework

Transactions submitted to Jodtang are governed by two distinct policy classifications based on document type:

```text
                                [Input Image]
                                      │
                                      ▼
                        [Local QR Router (Classifier)]
                                      │
           ┌──────────────────────────┴──────────────────────────┐
           │                                                     │
   [BANK_SLIP_QR]                                       [NO_QR / NON_BANK_QR]
           │                                                     │
           ▼                                                     ▼
   [Slip2Go Verifier]                                    [Typhoon OCR 1.5]
   (Bank Verification)                                           │
           │                                                     ▼
     200500 / 200501                               [Bank-Slip Likelihood Guard]
           │                                                     │
           ▼                                   ┌─────────────────┴─────────────────┐
       HARD STOP                               │                                   │
  (Absolute Invariant)                 [Document Type?]                    [Pure Retail Receipt]
                                               │                                   │
                       ┌───────────────────────┴───────────────────────┐           ▼
                       │                                               │     [Receipt Draft]
             [Policy A: ATM Paper]                    [Policy B: e-Wallet/Bill]
                       │                                               │
                       ▼                                               ▼
                   HARD STOP                                 [Unverified Draft ⚠️]
             (Ask manual text entry)                     (Requires explicit user confirm)
```

---

## 3. Detailed Policy Rules

### 3.1 Policy A: Physical ATM Paper Slips (Fail-Closed)
- **Scope:** Physical thermal paper slips dispensed by ATM machines (e.g. cash withdrawals, ATM funds transfers).
- **Technical Reality:** ATM physical slips lack 2D QR codes and contain banking transfer action verbs.
- **Product Decision:** **POLICY A — HARD STOP (Fail-Closed).**
- **Rationale:** Physical ATM slips can be easily staged, altered, or duplicated without cryptographic or digital verification. Permitting unverified ATM transfer slips creates an unacceptable risk of phantom/fraudulent expense recording.
- **User Action:** The bot advises the user to log ATM transactions manually via natural language text:
  > *"⚠️ ไม่สามารถยืนยันสลิปตู้ ATM ได้ กรุณาพิมพ์บอกรายการเพื่อบันทึกแทนได้เลยครับ เช่น 'ถอนเงิน 1000' หรือ 'โอนเงิน 500' ✨"*

---

### 3.2 Policy B: Non-Slip2Go e-Wallets (G-Wallet, ShopeePay, etc.)
- **Scope:** Electronic wallet confirmation screenshots that are NOT supported by Slip2Go's interbank verification API (e.g. เป๋าตัง / G-Wallet, ShopeePay, TrueMoney screenshots lacking Mini-QR).
- **Product Decision:** **POLICY B — Unverified Draft with Explicit Warning ⚠️.**
- **Pipeline:**
  1. Image classifies as `NO_QR` or `NON_BANK_QR`.
  2. Typhoon OCR extracts merchant/payee name, total amount, and transaction timestamp.
  3. Bank-Slip Likelihood Guard identifies e-Wallet metadata (`G-Wallet`, `เป๋าตัง`, `ShopeePay`).
  4. System creates a `transaction_draft` with `source = 'ewallet_unverified'`.
  5. Reply message presents LINE Flex confirmation bubble with prominent badge:
     > `[Unverified e-Wallet ⚠️]`
  6. Explicit user confirmation is strictly mandatory before writing to permanent transactions.

---

### 3.3 Policy B: Domestic Bill Payments (Tag 30 / Biller Screenshots)
- **Scope:** Credit card payments (KTC, etc.), utility bills (MEA, MWA, PEA), and telecommunications payments processed as Bill Payments.
- **Product Decision:** **POLICY B — Unverified Draft with Explicit Warning ⚠️.**
- **Pipeline:**
  1. Image classifies as `NON_BANK_QR` (Tag 30 AID `A000000677010112`) or `NO_QR` (screenshot without QR).
  2. Typhoon OCR extracts biller name (e.g. `บริษัท บัตรกรุงไทย จำกัด (มหาชน)`), amount, and date.
  3. Bank-Slip Likelihood Guard identifies bill payment metadata (`จ่ายบิลสำเร็จ`, `เลขที่บัตรเครดิต`).
  4. System creates a `transaction_draft` with `source = 'bill_unverified'`.
  5. Reply message presents LINE Flex confirmation bubble with prominent badge:
     > `[Unverified Bill Payment ⚠️]`
  6. Explicit user confirmation is strictly mandatory before writing to permanent transactions.

---

## 4. Immutable Non-Verification Rule

> [!CAUTION]
> **STRICT AUDIT INVARIANT:**
> All drafts generated under Policy B (`source: 'ewallet_unverified'` or `source: 'bill_unverified'`) are **NON-VERIFIED DRAFTS**.
> - They must **NEVER** be marked as `verified: true` in the database.
> - They must **NEVER** record a banking verification reference or claim Slip2Go validation.
> - If user cancels or ignores the draft, it expires or is cancelled with zero financial side-effects.

---

## 5. Summary Table

| Category | Typical Example | Detection Signal | Policy | Final Pipeline Route | Resulting Draft Status |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **Interbank Transfer Slip** | KBank to SCB transfer | Mini-QR `000001` | Canonical | **Slip2Go Verifier** | Slip Draft (`source: 'slip'`) on 200000; HARD STOP on 200500/200501 |
| **Retail Receipt** | 7-Eleven, Lotus receipt | Zero QR or URL | Canonical | **Typhoon OCR** | Receipt Draft (`source: 'receipt'`) |
| **Physical ATM Slip** | ATM withdrawal slip | No QR + ATM text | **Policy A** | **HARD STOP** | No Draft; Prompt user to type manual entry |
| **e-Wallet Payment** | เป๋าตัง (G-Wallet) 32 THB | No QR + G-Wallet text | **Policy B** | **Typhoon OCR** | Draft with `[Unverified e-Wallet ⚠️]` |
| **Bill Payment** | KTB to KTC Bill Payment | Tag 30 or No QR + Bill text | **Policy B** | **Typhoon OCR** | Draft with `[Unverified Bill Payment ⚠️]` |
