# MoMo Ledger — Stage 3 Handover

## Scope completed

Stage 3 adds operational recording for deposits, withdrawals, airtime purchases, and bill payments. It does not calculate balances, commissions, profit, reconciliation, offline synchronization, or settled ledger postings; those belong to Stage 4.

The UI is available at `/new-transaction` and `/transactions`, with dashboard counts and recent activity connected to the real Supabase data. The recorder is mobile-first and supports MTN, Telecel Cash, and AT Money.

## Transaction behavior

Each record receives a database-generated internal reference such as `MOMO-20261122-000001` and a unique idempotency key. The optional provider reference is stored separately. Amounts and customer charges are integer pesewas. Charges are explicitly recorded and are not treated as agent income or commission.

Statuses are `PENDING`, `SUCCESSFUL`, `FAILED`, and `REVERSED`. A successful record is marked `MANUALLY_CONFIRMED` by the attendant; no MTN, Telecel, or AT provider API verification is claimed. New records are append-only from the client because Stage 4 must preserve correction and reversal history.

Customer phones are normalized to the Ghana local `0XXXXXXXXX` form for search and deduplication. Existing customer rows are reused per business. History masks phones in list views and shows the complete number only in the selected details panel. PINs, OTPs, and passwords are never collected.

## Migration

`supabase/migrations/0006_transactions.sql` creates:

- `customers`: business-scoped normalized phone and optional name.
- `transactions`: the operational record, including `internal_reference`, `idempotency_key`, `provider_reference`, `business_id`, `booth_id`, `customer_id`, `attendant_id`, `network`, `transaction_type`, `principal_amount_pesewas`, `customer_charge_pesewas`, `agent_commission_pesewas`, `customer_phone`, `transaction_status`, `confirmation_method`, `notes`, `transaction_at`, `created_at`, and `updated_at`.
- `transaction_status_history`: initial and subsequent status history for Stage 4 audit/reversal work.
- `momo_transaction_reference_seq` and `generate_momo_transaction_reference()` for unique internal references.

Indexes cover business/date, status, type, network, customer phone, provider reference, and status-history lookup.

## RLS and tenant boundaries

All three Stage 3 tables have RLS enabled. Members can read customers in their business. Active members can create/update customer records in their business. Owners can read all booths in their business; attendants can read and write transactions only for their assigned booth. Owners can operate all booths. There is no client update/delete policy for transactions. Supabase functions use `auth.uid()` and the existing `business_members` records; the service-role key is not exposed to the browser.

## Tests executed

- `npm run build` — passed, including TypeScript validation and static generation.
- `git diff --check` — passed.
- Supabase migration `transactions` — applied successfully to project `txeobytsmfjbweoyetqh`.
- Supabase metadata verification — `customers`, `transactions`, and `transaction_status_history` exist with RLS enabled.
- Fresh local production server on port 3101: `/health` and `/auth` returned HTTP 200; `/new-transaction`, `/transactions`, and `/dashboard` redirected unauthenticated requests to `/auth`.

A full authenticated acceptance run using a real owner and attendant account was not executed in this sandbox because no `.env.local` test credentials were available. It remains required before production promotion.

## Stage 4 contract

Only `SUCCESSFUL` records with `confirmation_method = MANUALLY_CONFIRMED` are candidates for settled financial posting. `PENDING`, `FAILED`, and `REVERSED` records must not alter opening balances. Stage 4 should calculate principal movements, provider/network float, charges, commissions, reversals, and audit corrections without overwriting these source transaction records.
