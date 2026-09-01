# Slip Verification Architecture (Slip2Go)

This document describes the slip verification architecture integrated into Jodtang via **Slip2Go Connect API**.

---

## 1. Architectural Principles

1. **Provider-Agnostic Adapter Pattern (`ISlipProvider`):**
   - Jodtang domain logic communicates through `ISlipProvider` interface (`src/modules/slip/slip-provider.interface.ts`).
   - `Slip2GoAdapter` (`src/modules/slip/slip2go.adapter.ts`) implements this interface, communicating with `https://connect.slip2go.com/api/verify-slip/qr-image/info`.
   - Adding or swapping providers in the future requires zero changes to the transaction pipeline.

2. **Strict Invariant: Slip Verification $\neq$ Transaction Confirmation:**
   - Slip verification creates a `TransactionDraft` in status `pending_confirmation`.
   - **No permanent financial transaction is created** directly from a slip.
   - The user must explicitly tap **"✅ ยืนยัน"** in LINE to commit the draft into the `transactions` table.

3. **Two-Tier Duplicate Slip Protection:**
   - **Provider-Level:** Slip2Go API payload `checkDuplicate: true` rejects slips already scanned across merchant accounts (`code: 400004`).
   - **Database-Level:** Jodtang queries `transaction_drafts` for `user_id` where `extracted_data->>'transRef' = ?` with status `pending_confirmation` or `confirmed`. Duplicate submissions are rejected before creating duplicate drafts.

4. **Zero Disk Storage (Ephemeral In-Memory Processing):**
   - Image content is streamed directly into an in-memory buffer via `MessagingApiBlobClient.getMessageContent(messageId)`.
   - The buffer is sent as multipart form-data to Slip2Go and immediately garbage collected.
   - No slip images are written to the local filesystem or server disk.

5. **Group Chat Privacy Guard:**
   - If an image message is sent in a group chat (`event.source.type !== 'user'`), Jodtang replies with a privacy notice and does not invoke the slip provider or store any data.

6. **Zero Database Migrations:**
   - Uses existing PostgreSQL JSONB `extracted_data` in `transaction_drafts` to store `transRef`, `sender`, and `slipProvider`.
   - Preserves the strict 5-migration schema invariant.

---

## 2. Environment Variables

Add to `.env`:
```env
# Slip Verification (Slip2Go API Connect)
SLIP2GO_API_SECRET=your_slip2go_api_secret_here
SLIP2GO_BASE_URL=https://connect.slip2go.com
```

---

## 3. End-to-End User Flow

```
[User sends Slip Image in LINE]
       │
       ▼
[handleWebhookEvent (webhook-event.handler.ts)]
       │  Group Chat? ──Yes──> [Reply Privacy Guard & Exit]
       │  No (Private Chat)
       ▼
[handleImageMessage (image.handler.ts)]
       │
       ├──> In-memory stream download (MessagingApiBlobClient)
       │
       ├──> SlipService.processSlip()
       │        ├──> Slip2GoAdapter.verifySlipImage()
       │        ├──> Check transRef in transaction_drafts
       │        ├──> Heuristic category resolution
       │        └──> DraftRepository.createDraft(status='pending_confirmation')
       │
       ▼
[Reply Flex Draft Confirmation Bubble]
       │
       ├── User taps "✅ ยืนยัน" ──> [commitDraft() -> creates permanent Transaction & Audit Log]
       │
       └── User taps "🗑️ ยกเลิก" ──> [cancelDraft() -> marks Draft cancelled, 0 Transaction created]
```

---

## 4. Test Verification Suite

- **Unit Tests:** `npm run test:slip2go` (Tests all response codes, error handling, secret sanitization)
- **Integration Tests:** `npm run test:slip-integration` (Tests end-to-end webhook, duplicate protection, confirmation postback, group privacy)
- **Full Isolated Regression:** `npm test` (Runs all 16 test suites on an ephemeral database, verifying 100% pass and 5 migrations)
