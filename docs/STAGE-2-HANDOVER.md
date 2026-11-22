# MoMo Ledger — Stage 2 handover

## Technical assessment

Stage 1 is a Next.js 14 App Router application in TypeScript with React, Tailwind CSS, Supabase SSR/browser clients, a responsive MoMo Ledger shell and truthful dashboard empty states. Before this stage, the database contained only the legacy `profiles` and `payments` tables. There was no owner registration screen, business model, onboarding wizard or protected Stage 1 routes. The repository had no `.env.local`, so local browser auth could not be run against Supabase until deployment environment variables are present.

## Implemented

- Supabase Auth owner registration with full name, email, Ghanaian/international phone validation, password confirmation and secure password requirements.
- Owner login, logout, recovery-link request and password reset flows.
- Auth callback fallback to `/setup`.
- Middleware protection for the workspace routes. `/auth`, `/auth/callback`, `/health` and `/api/health` remain public; the application dashboard and API routes require a valid Supabase session.
- Resumable mobile-first setup wizard: business, booth, opening balances and review/confirmation.
- Duplicate-safe resume behavior: existing owner business, booth and opening-balance rows are loaded before new records are inserted.
- Business profile management in Settings.
- First booth creation/editing with active status foundation and future multi-booth support.
- Integer-pesewa opening balance storage for physical cash, MTN, Telecel and AT Money. Opening balance tables use `record_type = 'opening_balance'` and are separate from customer transactions, revenue and commissions.
- Opening balance lock behavior in the UI: once saved, the setup form does not update or overwrite them.
- Pending attendant invitation records with owner-only access. No fake credentials or passwords are generated. Email delivery remains pending until a configured invitation provider is available.
- Dashboard integration for real business name, owner name, booth, opening cash and network opening floats.

## Exact database schema

Migration: `supabase/migrations/0005_business_onboarding.sql`

- `businesses`: owner profile, business type, contact/location data and `setup_status`.
- `business_members`: `OWNER` or `ATTENDANT` membership, status and optional booth assignment.
- `booths`: business-owned booth name, location, description and active/inactive status.
- `business_settings`: GHS currency and Africa/Accra timezone defaults.
- `business_opening_balances`: one physical cash opening record per business, integer `physical_cash_pesewas`.
- `booth_opening_balances`: one integer pesewa opening record per booth/network for `MTN`, `TELECEL` and `AT`.
- `invitations`: pending attendant invitation metadata, expiry, status and inviter; no secrets.

All seven tables have RLS enabled. Owner/member policies restrict reads and writes by `auth.uid()`, business membership and `OWNER` role. Attendants cannot self-promote to OWNER through the policies.

## Migration status

The migration was applied to the existing Supabase project `txeobytsmfjbweoyetqh`. The database inspection confirmed only `profiles` and `payments` existed before application; afterward all seven new tables exist with RLS enabled. No existing tables or user data were deleted.

## Tests actually executed

- `npm run build` — passed after fixing the `useSearchParams` Suspense boundary and nullable digital-address typing.
- Supabase project discovery — existing project found and healthy.
- Pre-migration public table inspection — confirmed `payments` and `profiles` only.
- Migration application — succeeded.
- Post-migration table/RLS inspection — all seven Stage 2 tables present with RLS enabled.
- Full live registration/login/business setup/attendant flow — not executed in this sandbox because no `.env.local` or test Supabase credentials were present. The deployed Vercel environment must be used for those authenticated acceptance tests.

## Outstanding configuration

1. Confirm Vercel has `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` configured for Preview and Production.
2. Configure Supabase Auth email confirmation and redirect URL: `https://ghanaian-creator-streaming.vercel.app/auth/callback?next=/setup`.
3. Configure an email provider or Supabase invite flow before turning pending attendant invitations into delivered invitations. The UI intentionally keeps them pending until that exists.
4. Do not enable transaction posting in this stage.

## Stage 3 handover

Stage 3 can safely build transaction tables and posting logic on `businesses.id`, `business_members`, `booths.id`, and the opening-balance records. Treat opening balance rows as initial positions, not income. Preserve their integer-pesewa representation and keep transaction records separate. The next development stage is **STAGE 3 — CORE MOMO TRANSACTION RECORDING**.
