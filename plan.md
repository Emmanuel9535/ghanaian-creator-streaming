# MoMo Ledger authenticated UI refinement plan

## Scope and implementation

Refine the deployed MoMo Ledger baseline at commit `e6b3cea` on branch `momo-ledger-visual-refinement`. Keep this a visual-only change: do not alter Supabase queries, mutations, authentication, authorization, accounting formulas, transaction state, or security behavior. Reuse the app’s existing Next.js 14, Tailwind, Lucide, Supabase and Vercel setup. Apply shared typography, palette, surfaces, form controls, tables and status styling in `app/globals.css`; load the licensed Nunito Sans variable family through `next/font/google` in `app/layout.tsx`; refine responsive navigation and brand presentation in `components/app-shell.tsx`; make only presentation-layer adjustments to the existing pages under `app/`.

The current app groups Deposit, Withdrawal, Airtime and Data Bundle in the working New Transaction flow. Preserve its validation, draft recovery, duplicate-safe ledger retry and posting flow. Keep the existing business and booth scoping and all data disclosures. The existing customer UI has no identified Money Owed route or receivable data model in this baseline; do not fabricate a placeholder or financial calculation. Record that limitation rather than changing the backend.

Before preview deployment, run the repository’s lint and production build commands, review the responsive shell and key action states, and synchronize `public/manus-routes.json` only if the actual route set changes. Push only `momo-ledger-visual-refinement` to the existing GitHub repo so its connected Vercel project can produce a preview. Verify the preview, including a mobile viewport, and stop for the user’s acceptance. Production deployment is explicitly deferred until acceptance.

## Project structure

- `app/` contains the App Router pages: dashboard, transaction capture and history, customers, expenses, cashbook, reconciliation, reports, settings, setup and account pages.
- `components/app-shell.tsx` owns authenticated desktop/mobile navigation, account controls and the shared page frame.
- `app/globals.css` owns global design tokens and reusable component styles; `app/layout.tsx` owns global font loading, metadata and the footer.
- `public/manus-routes.json` declares the site’s actual page routes.
- Existing Supabase and transaction logic under `lib/` remains unchanged.

## Design direction

- **Design movement:** MTN MoMo-inspired mobile money interface, based solely on the user’s reference screenshot; retain original MoMo Ledger identity and artwork.
- **Core principles:** spacious and scan-friendly; calm, rounded white financial surfaces; lightweight, consistent type; clear financial meaning and actions.
- **Color philosophy:** use deep teal-blue `#004F71` for financial confidence and navigation; darker teal `#004060` for anchors; yellow `#FFCB05` sparingly for primary actions and highlights; white cards on `#F1F1F1`; text grey `#62666A` for secondary information.
- **Layout paradigm:** a persistent responsive app shell, left-aligned page headers, stacked mobile content, a clear balance summary and compact service shortcuts; use wide tabular views only where they improve desktop scanning.
- **Signature elements:** thin-stroke teal Lucide icons and softly elevated rounded white cards.
- **Interaction philosophy:** preserve all existing actions and status meaning; give controls comfortable tap targets, visible keyboard focus and restrained hover/pressed feedback.
- **Animation:** short, subtle transitions only; respect reduced-motion preferences.
- **Typography:** Nunito Sans variable font, self-hosted by Next.js at build time. Use normal/light-feeling body copy, moderate 500–600 labels and 600–700 headings. Avoid extra-heavy 800–900 display weights. MTN’s Brighter Sans is not used because no authorization for this brand was verified.
- **Brand essence:** practical financial clarity for Ghanaian mobile-money vendors; calm, clear, dependable.
- **Brand voice:** concise and reassuring. Preserve **“A calmer way to run your MoMo business.”** Supporting example: “Keep every booth movement easy to review.”
- **Wordmark and mark:** retain the existing MoMo Ledger name and yellow “M” monogram; do not use MTN names, logos or proprietary artwork.
- **Signature brand color:** `#004F71`.
