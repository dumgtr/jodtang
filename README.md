# จดตัง (JodTang) - Backend Service

A personal finance and expense tracking assistant LINE Bot built with TypeScript, Node.js, Express, and PostgreSQL.

---

## 🏛️ Core Architectural Principles
1. **Database = Truth**: PostgreSQL is the single source of truth.
2. **Code = Deterministic**: Validations, business logic, and math are strictly executed in TypeScript.
3. **AI = Understanding**: AI is only used to parse natural language into structured JSON draft entities.
4. **Atomic Commits**: All transaction state changes and commitments are protected by strict ACID PostgreSQL transactions (`BEGIN ... COMMIT ... ROLLBACK`) with audit logging.

---

## 📂 Project Structure

```
C:\jodtang\
├── package.json                          # Scripts & dependencies
├── tsconfig.json                         # TypeScript configuration
├── .env.example                          # Environment variable template
├── .env                                  # Local environment configuration
├── README.md                             # Project documentation
└── src/
    ├── index.ts                          # Express server & LINE Webhook handler
    ├── config/
    │   └── env.ts                        # Zod environment validation
    ├── types/
    │   └── database.ts                   # Exact DB schema TypeScript interfaces
    ├── db/
    │   ├── client.ts                     # PostgreSQL pool & withTransaction wrapper
    │   ├── migrate.ts                    # Migration runner script
    │   └── migrations/                  # Ordered schema migrations 001–004
    └── modules/
        ├── user/
        │   └── user.repository.ts        # User upsert & lookup
        ├── draft/
        │   └── draft.repository.ts       # Transaction draft management
        └── transaction/
            └── transaction.repository.ts # Atomic draft confirmation & audit logging
```

---

## 🗄️ Database Schema

The database consists of 4 core tables:
1. `users` - Maps LINE user IDs to internal UUIDs.
2. `transaction_drafts` - Stores temporary AI-extracted draft records with expiration.
3. `transactions` - Stores committed financial transactions.
4. `audit_logs` - Records all state transitions and commits.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your PostgreSQL and LINE credentials:
```env
PORT=3000
NODE_ENV=development
DATABASE_URL=
DATABASE_SSL_REJECT_UNAUTHORIZED=true
LINE_CHANNEL_ACCESS_TOKEN=
LINE_CHANNEL_SECRET=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

`DATABASE_URL`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, and
`OPENAI_API_KEY` are supplied through your local environment or deployment secret
store. Do not place real credentials in `.env.example` or commit `.env`.

The bundled Docker PostgreSQL password (`postgrespassword`) is for local
development only. Never reuse it in production; production deployments must use
an environment-provided `DATABASE_URL` and managed secret storage.

For local development (`NODE_ENV=development`), a local PostgreSQL URL uses no
TLS by default. Production and managed-provider URLs enable TLS with certificate
verification. Only set `DATABASE_SSL_REJECT_UNAUTHORIZED=false` as an explicit
provider-specific opt-in when that provider documents that certificate
verification cannot be used; this is not recommended for production.

The optional `SLIPOK_API_KEY` and `SLIPOK_BRANCH_ID` variables are reserved for
future slip processing. Sprint 1 image messages receive a maintenance response
and do not perform OCR, QR parsing, AI extraction, or database writes.

### 3. Run Database Migrations
```bash
npm run migrate
```

### 4. Start Development Server
```bash
npm run dev
```
The server will start at `http://localhost:3000`. Webhook URL: `http://localhost:3000/webhook`.
