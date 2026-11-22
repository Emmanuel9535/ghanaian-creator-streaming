# MoMo Ledger

MoMo Ledger is an offline-first Mobile Money transaction recording and business management application for Ghanaian MoMo vendors. It is designed for MTN Mobile Money, Telecel Cash and AT Money workflows.

## Stage 2 foundation

Stage 2 adds secure Supabase Auth owner registration, login, logout, password recovery/reset, protected workspace routes, a resumable business setup wizard, first-booth creation, integer-pesewa opening balances, business settings, and pending attendant invitations. Transaction posting, reconciliation and offline synchronization remain deferred to later stages.

## Existing infrastructure

The project is a Next.js 14 App Router application using TypeScript, React, Tailwind CSS and Supabase. Existing profile/payment migrations, middleware, server utilities and Paystack test-mode routes are preserved. Stage 2 adds `supabase/migrations/0005_business_onboarding.sql` without deleting or altering existing tables. Never commit `.env.local`, service-role keys, Paystack secrets or other credentials.

## Local setup

```bash
npm install
npm run build
npm run dev
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` to exercise authentication and onboarding locally. The JSON health endpoints are available at `/health` and `/api/health`.

## Next stage

Continue with **Stage 3: CORE MOMO TRANSACTION RECORDING**. Read [`docs/STAGE-2-HANDOVER.md`](docs/STAGE-2-HANDOVER.md) for the exact schema, RLS decisions, migration status and authenticated-test limitations.
