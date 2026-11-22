# MoMo Ledger — Stage 4.1 handover

## What caused the discrepancy

The restored local checkout was an internal Manus web-template mirror at commit `6095bf5`, not the authoritative GitHub application history. Its `origin` pointed to an internal artifacts URL and contained only the bootstrap client/server template. The public GitHub repository `Emmanuel9535/ghanaian-creator-streaming` did contain the real application history, including Stage 1, Stage 2, and the requested Stage 3 commit.

The missing application was therefore not rebuilt. It was restored from the exact GitHub Stage 3 commit `0ec54d7d3676ebb471ac3269e081941a2a784f22`.

## Restored application

The restored application is the Next.js/Supabase MoMo Ledger application with the existing white and sky-blue design system, authentication, business setup, booth setup, opening balances, customer lookup, transaction recording, transaction history, and existing routes/navigation. The earlier bootstrap template files were removed from this Stage 4.1 branch rather than mixed into the application.

The Stage 4 database migration was preserved and the Stage 4.1 dashboard access migration was added. No existing Supabase financial records were deleted or overwritten.

## Stage 4 functions integrated

The transaction recorder at `/new-transaction` now invokes `public.post_momo_transaction(target_transaction_id, request_id)` only after a transaction is recorded with `SUCCESSFUL` status. `PENDING` and `FAILED` records do not invoke the posting RPC. If the RPC rejects the record because of insufficient balances, missing confirmation, duplicate posting, or unconfigured airtime/bill-payment treatment, the interface keeps the operational record and displays a clear financial-review message.

The owner dashboard at `/dashboard` now invokes `public.financial_dashboard(target_business_id, target_booth_id)` and displays actual physical cash, MTN float, Telecel float, AT Money float, total electronic float, successful deposit and withdrawal volumes, pending transactions, review-required transactions, earned commission, and received commission. Physical cash and electronic float are shown as separate figures.

The dashboard sends a business-wide request only for an owner. For attendants it sends the assigned booth ID. The Stage 4.1 database hardening migration independently enforces that an attendant cannot request business-wide totals or another booth’s totals.

## Database verification

The applied Stage 4 functions verified in Supabase are:

- `financial_account_id(uuid, uuid, text)`
- `financial_dashboard(uuid, uuid)`
- `post_momo_transaction(uuid, text)`
- `reverse_momo_transaction(uuid, text, text)`

The Stage 4 tables, RLS policies, opening-balance account synchronization, idempotency constraints, and reversal records remain in place. Stage 4.1 replaced only the dashboard RPC body to enforce owner-versus-attendant scope.

## Tests executed

The real restored application was installed with `npm ci` and passed `npm run build`. Next.js compiled the application, linted and type-checked it, generated all 23 pages, and completed the production build.

The Stage 4 Supabase migration was already applied and verified before restoration. The Stage 4.1 dashboard access migration was applied successfully afterward.

No authenticated owner/attendant end-to-end run was claimed because authorized test credentials were not available in this session. In particular, live posting, duplicate retry, reversal, tenant isolation, and booth-isolation scenarios still require authorized test accounts.

## Deployment status

The code is ready for a preview deployment from the existing project, but the Vercel connector in this session requires authentication before its existing project and preview deployment can be inspected or triggered. Production promotion was not attempted.

## Commit

The requested commit message is:

`Stage 4.1: Restore application and integrate financial ledger`
