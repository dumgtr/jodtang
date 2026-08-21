# 🔒 JODTANG — PRODUCTION BASELINE SPECIFICATION
**Version:** `v1.1.0-production-baseline`  
**Git Tag:** `v1.1.0-production-baseline`  
**Target Environment:** Neon Serverless PostgreSQL + Render Cloud + LINE Messaging API  
**Frozen Date:** 2026-08-21  

---

## 1. 🏗️ Architecture & Core Components

- **Runtime:** Node.js (TypeScript) + Express
- **Database Schema:** PostgreSQL (Neon Serverless) with Migrations `001` through `005`
- **Natural Thai Date Parser:** Conversational date inputs (`17/8`, `17 สิงหา`, `วันที่ 19`, `เมื่อวาน`) defaulting to current month and current year in `Asia/Bangkok` timezone. Bare numeric inputs (`19`) strictly rejected by ambiguity guard.
- **Post-Commit Transaction Management:** Deterministic field preservation (100% lock on unselected fields) and soft voiding with `status = 'voided'` and audit logging.
- **AI Regression Suite:** 301 Golden Test Cases across 6 difficulty tiers (`scripts/benchmark-dataset.json` + `scripts/benchmark-ai.ts`).

---

## 2. 🤖 AI Backend: DeepSeek V4 Flash

- **Provider:** DeepSeek API (`https://api.deepseek.com`)
- **Model Config:** `OPENAI_MODEL=deepseek-v4-flash`
- **Base URL Config:** `OPENAI_BASE_URL=https://api.deepseek.com`
- **Verification Status:**
  - ✅ **Production Smoke Test:** 10/10 PASS (100% financial structure extraction)
  - ✅ **LINE Real-World Smoke Test:** 8/8 PASS (All conversation & carousel flows verified)
  - ✅ **DeepSeek Dashboard Verification:** Account billed under `deepseek-v4-flash` tier
  - ✅ **Verified Benchmark Token Cost:** ~$0.03 USD / 301 requests

> **Historical Reference Note (DeepSeek Chat Benchmark):**  
> During pre-release benchmarking under `model: "deepseek-chat"`, the engine scored:
> - Overall Weighted Accuracy: `97.8%`
> - Critical Failures: `7 / 301 cases`
> - Average Latency: `0.85s` (P95: `1.10s`)  
> *(Kept as historical reference; any future model evaluation will be benchmarked directly against the 301 Golden Cases under identical parameters).*

---

## 3. ⚙️ Frozen Environment Configuration

```env
# Server
PORT=3000
NODE_ENV=production

# Database (Neon PostgreSQL)
DATABASE_URL=postgresql://...
DATABASE_SSL_REJECT_UNAUTHORIZED=true

# LINE Official Account
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...

# AI Backend (DeepSeek V4 Flash)
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
OPENAI_API_KEY=sk-*** (Masked & Rotated)
```

---

## 4. 🛡️ Verification Gate & Safety Checklist

- [x] `npm run build` (0 TypeScript errors)
- [x] `npm test` (All 5 test suites pass)
- [x] `npm run test:migration-gate` (100% pass on disposable isolated DB)
- [x] `npm run test:webhook` (All 6 P0/P1 security audit checks pass)
- [x] Secret audit: `.env` is gitignored, 0 secrets in codebase, API keys rotated
- [x] Production `/health`: HTTP 200 OK
- [x] Production smoke tests (CLI & LINE OA): 100% PASS
