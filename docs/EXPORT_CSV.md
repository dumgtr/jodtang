# Export CSV — M14 Future Function

## Scope

Export the authenticated user's transaction history as a UTF-8 CSV from the Large Rich Menu `📥 Export CSV` action.

## User flow

1. User taps `📥 Export CSV` in the Rich Menu.
2. LINE sends the configured message action through the signed webhook.
3. The validated webhook already has the LINE user identity and resolves the internal JodTang user.
4. JodTang queries only transactions owned by that user.
5. JodTang issues a short-lived opaque download token (15 minutes).
6. Bot replies with a Flex Message containing a URI download button.
7. Browser requests `/exports/transactions.csv?token=...`.
8. Server validates/decrypts the token, re-checks ownership through the token's internal user UUID, generates the CSV, and returns it as an attachment.

## Export contract

Columns, in order:

1. `transaction_id`
2. `type`
3. `amount`
4. `category`
5. `merchant`
6. `account`
7. `description`
8. `status`
9. `occurred_at`
10. `created_at`
11. `updated_at`

All transaction statuses are exported, including `voided`, so the export preserves transaction history.

## Encoding / spreadsheet safety

- UTF-8 with BOM for Thai/Excel compatibility.
- CRLF row endings.
- Every field is double-quoted and embedded quotes are doubled.
- User-controlled fields beginning with spreadsheet formula-triggering characters are prefixed with a tab in the exported representation only. Stored PostgreSQL data is unchanged.

## Security invariants

- Browser never supplies a user ID to select export data.
- Export token is encrypted with AES-256-GCM and expires after 15 minutes.
- `EXPORT_TOKEN_SECRET` may be supplied as dedicated key material; when absent, the existing LINE channel secret is used as fallback key material.
- Production requires `PUBLIC_BASE_URL` unless the platform provides `RENDER_EXTERNAL_URL`.
- Production download URLs must use HTTPS.
- Download responses use `Cache-Control: private, no-store, max-age=0` and `X-Content-Type-Options: nosniff`.
- No export files are persisted to disk or object storage.
- No new database table or migration is required.
- The Export command bypasses the generic AI/transaction-write pipeline and is read-only.
- Export is blocked in group and multi-person chats so a user-specific download link cannot be exposed to other chat members.

## Test contract

`npm run test:export-csv` verifies:

- multi-tenant isolation;
- UTF-8 BOM and CSV quoting;
- formula-injection hardening;
- token confidentiality, expiry, and tamper rejection;
- download URL / Flex URI contract;
- webhook dispatch bypasses the generic AI/text pipeline;
- group-chat privacy guard.

The test is included in `test:regression:raw` and therefore in the normal isolated `npm test` path.
