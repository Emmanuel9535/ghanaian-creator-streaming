# Ghana First — Creator Streaming Network

A creator-first streaming foundation for Ghanaian film and independent stories.

## Stage 1 foundation

This stage establishes a responsive Next.js and TypeScript application shell, Tailwind styling, public health-check endpoint, Supabase browser client, and an initial profiles table with row-level security. Mux and Paystack integrations are intentionally deferred to their approved stages, and no live payments or payouts are enabled.

## Local setup

Copy `.env.example` to `.env.local` and provide the Supabase project URL and anonymous browser key. Never commit `.env.local`, service-role keys, Mux secrets, Paystack secrets, or any other credentials. Apply `supabase/migrations/0001_foundation.sql` in the selected Supabase project before enabling authenticated profile flows.

## Commands

```bash
npm install
npm run build
npm run dev
```

The health endpoint is available at `/api/health` and returns a JSON status response.

## Approved architecture

GitHub is the source repository, Vercel is the application host, Supabase provides PostgreSQL and authentication, Mux will provide video processing and signed playback in Stage 5, and Paystack will be used in test mode for Stage 6.
