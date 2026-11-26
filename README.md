# MoMo Ledger

MoMo Ledger is an offline-first Mobile Money transaction recording and business management application for Ghanaian MoMo vendors. It is designed for MTN Mobile Money, Telecel Cash and AT Money workflows.

## Current capabilities

MoMo Ledger includes secure Supabase Auth, resumable business setup, first-booth creation, integer-pesewa opening balances, operational transaction recording, settled financial postings, professional cashbook reads, and Float Management. Float Management keeps physical cash and each network account separate, supports atomic transfers, low-float thresholds, searchable movement history, idempotent retries, and provisional offline recording with automatic sync.

## Existing infrastructure

The project is a Next.js 14 App Router application using TypeScript, React, Tailwind CSS and Supabase. Existing profile/payment migrations, middleware, server utilities and Paystack test-mode routes are preserved. Float Management extends the live ledger with `supabase/migrations/0007_float_management.sql` without deleting or altering historical transactions or opening balances. Never commit `.env.local`, service-role keys, Paystack secrets or other credentials.

## Local setup

```bash
npm install
npm run build
npm run dev
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` to exercise authentication and onboarding locally. The JSON health endpoints are available at `/health` and `/api/health`.

## Financial safety

All financial amounts are integer pesewas. Historical postings are append-only. Movement retries use a unique idempotency key, transfers debit and credit both accounts in one database transaction, and write RPCs enforce authenticated business/booth permissions.
