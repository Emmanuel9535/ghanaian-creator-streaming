# MoMo Ledger — Stage 4 handover

## Scope completed

Stage 4 was implemented against the existing Supabase project `txeobytsmfjbweoyetqh` without creating a new project, repository, or Vercel project. The migration is registered in Supabase as `stage_4_financial_ledger`.

The verified Stage 2 and Stage 3 source tables reused were:

- `business_opening_balances` — one business-level physical cash opening balance.
- `booth_opening_balances` — one opening balance per booth and network (`MTN`, `TELECEL`, `AT`).
- `businesses`, `booths`, `business_members` — tenant and booth authorization.
- `transactions` — deposits, withdrawals, airtime, and bill payments.
- `transaction_status_history` — append-only status history.

No production transaction rows were created or modified.

## Database objects created

- `financial_accounts`: controlled cash and electronic-float accounts with integer pesewa balances, opening balances, overdraft flag, and tenant/booth scope.
- `transaction_accounting_treatments`: owner-controlled configuration for cash-charge treatment, float settlement, and whether commission is treated as received by default. Provider tariffs are not invented.
- `transaction_postings`: one original posting and at most one reversal per transaction, protected by unique posting and idempotency keys.
- `ledger_entries`: immutable debit/credit movements with signed balance delta and resulting balance.
- `commission_records`: separates recorded/earned commission from received commission.
- `financial_adjustments`: owner-controlled adjustment records with reason and approval fields.

Opening balances were seeded from the actual existing rows. Verification returned exactly four accounts for the existing business: one physical cash account and three network float accounts. No duplicate opening accounts were created.

## RPC contracts

### `public.post_momo_transaction(target_transaction_id uuid, request_id text)`

The atomic posting function:

- requires an authenticated operator who can operate the transaction booth;
- accepts only `SUCCESSFUL` transactions with a confirmation method;
- returns an idempotent `already_posted` response on safe retry;
- locks the transaction and relevant accounts with `FOR UPDATE`;
- posts deposit principal as physical cash increase and network float decrease;
- posts withdrawal principal as physical cash decrease and network float increase;
- requires an explicit treatment for airtime and bill payments;
- keeps customer charges separate and never adds an uncollected charge to cash;
- records commissions as earned unless the owner configuration explicitly says received;
- blocks insufficient cash or float unless overdraft is explicitly enabled;
- rolls the complete operation back if any validation or posting step fails.

### `public.reverse_momo_transaction(target_transaction_id uuid, reversal_reason text, request_id text)`

The owner-authorized reversal function:

- requires a reason and owner authorization;
- preserves the original transaction and original posting;
- creates a linked reversal posting and opposite ledger entries;
- blocks duplicate reversal attempts through unique constraints and idempotency;
- marks the original transaction `REVERSED` and preserves the existing status-history trigger;
- blocks a reversal that would create a negative balance unless an overdraft/adjustment policy permits it.

### `public.financial_dashboard(target_business_id uuid, target_booth_id uuid default null)`

Returns tenant-scoped account balances and activity totals, including separate physical cash, network floats, transaction volumes, earned/received commissions, pending transactions, and successful airtime/bill-payment transactions requiring configured financial review.

## Security

RLS is enabled on all new tables. Members can read only records for businesses they belong to. Owners control accounting-treatment and financial-adjustment rows. Financial accounts, postings, ledger entries, and commission records have read-only client grants; their financial writes occur inside security-definer RPCs. Service-role credentials are not exposed.

## Actual verification performed

- Supabase project discovery: passed; existing project confirmed active.
- Existing schema/migrations inspected: passed; prior migrations were `initial_platform_foundation`, `business_onboarding`, and `transactions`.
- Stage 4 migration applied: passed; Supabase registered `stage_4_financial_ledger`.
- Post-migration table/column/foreign-key inspection: passed.
- RPC signature inspection: passed.
- RLS/policy inspection: passed.
- Opening-account verification: passed; four accounts, seeded from actual opening-balance rows.
- Local `pnpm check`: passed.
- Local `pnpm test`: passed (1 existing authentication test).
- Local `pnpm build`: passed.

## Acceptance limitation

The restored local checkout available in this session is only the initial web template and does not contain the Stage 3 application UI, Supabase client integration, or Stage 3 handover referenced by the stage brief. Because no authorized owner/attendant test credentials were available, no authenticated end-to-end posting, reversal, or cross-business RLS test was fabricated or claimed. The Stage 4 database engine is implemented and verified structurally, but the application UI wiring and authenticated acceptance test must be completed from the actual Stage 3 application checkout before this stage can be called production-ready.

## Next stage boundary

Stage 5 may build on the RPCs and tables above for expenses and daily cashbook. It should not bypass `post_momo_transaction` or write directly to ledger balances.
