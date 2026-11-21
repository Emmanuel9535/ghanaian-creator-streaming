# MoMo Ledger

MoMo Ledger is an offline-first Mobile Money transaction recording and business management application for Ghanaian MoMo vendors. It is designed for MTN Mobile Money, Telecel Cash and AT Money workflows.

## Stage 1 foundation

This stage establishes the responsive MoMo Ledger application shell, fintech design system, dashboard empty states, navigation for the future financial modules, direct health checks, and a maintainable folder structure. It does not create financial records or fabricate balances. Transaction recording, business setup, authentication improvements, reconciliation and offline synchronization are intentionally deferred.

## Existing infrastructure

The project is a Next.js 14 App Router application using TypeScript, React, Tailwind CSS and Supabase. Existing Supabase auth, profile/payment migrations, server utilities, middleware and Paystack test-mode routes are preserved. Never commit `.env.local`, service-role keys, Paystack secrets or any other credentials.

## Local setup

```bash
npm install
npm run build
npm run dev
```

The JSON health endpoints are available at `/health` and `/api/health`.

## Stage 2 handover

Continue with **Stage 2: AUTHENTICATION AND BUSINESS SETUP**. See [`docs/STAGE-1-HANDOVER.md`](docs/STAGE-1-HANDOVER.md) for the inspected architecture, preserved infrastructure and decisions.
