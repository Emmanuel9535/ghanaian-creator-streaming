# MoMo Ledger — Stage 4 Handover

## Float Management

Float Management is available at `/float-management`. It uses the existing `financial_accounts`, `transaction_postings`, and `ledger_entries` model rather than maintaining a second balance store.

The page shows separate opening, money-in, money-out, closing, and available balances for physical cash, MTN MoMo, Telecel Cash, and AT Money. It records deposits, withdrawals, adjustments, and physical-cash/network transfers. Transfers are posted atomically as a debit and credit under one posting and every movement requires a stable idempotency key.

Opening balances remain append-only and are read from workspace setup. The page never overwrites them. Corrections are recorded as adjustments. Minimum network-float thresholds are owner-controlled and each change is recorded in `float_threshold_history`; low-float alerts are calculated against the live balance plus any local provisional movements.

## Offline behavior

When the device is offline, a movement is stored in the browser queue with its final request ID and shown as provisional. When connectivity returns, the queue calls `record_float_movement` with the same request ID. The database's unique idempotency key makes retries safe and prevents duplicate financial postings.

## Database migration

`supabase/migrations/0007_float_management.sql` adds `float_thresholds`, `float_threshold_history`, `set_float_threshold(...)`, and `record_float_movement(...)`. Both write RPCs are `SECURITY DEFINER`, validate business/booth access with existing authorization helpers, and are executable only by the authenticated role. Historical ledger rows are not updated or deleted.

## Validation

- `npm run build` passed with TypeScript validation and static route generation.
- `git diff --check` passed.
- Existing Supabase project migration applied successfully.
- New tables have RLS enabled with member read / owner management policies.
- Anonymous execution is revoked for both new write RPCs.
- `/manus-routes.json` returns HTTP 200 without authentication; protected application routes continue redirecting unauthenticated users.
