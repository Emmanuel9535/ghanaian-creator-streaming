# Archived numbered migration sources

The SQL files in this directory are byte-for-byte copies of the nine files present in the inspected Stage 5 source commit before migration recovery. They are retained for provenance and are not active Supabase CLI migrations. Some differ from the authorized project ledger, and several repository-only auth/payment effects are present in the live schema but absent from the live migration ledger. No synthetic migration versions were assigned to them. The active `supabase/migrations/` directory contains exact ledger-recovered sources and a separate Stage 5.1 security migration. See `docs/STAGE-5.1-HANDOVER.md` for drift and replay limitations.

| Original file | SHA-256 | Bytes |
|---|---|---:|
| `0001_foundation.sql` | `657b59bbfb93cc5d4452cf1d8f55f2ce662bb0f777326b068a686ab33b87c170` | 1486 |
| `0002_auth_hardening.sql` | `2ece8657e33d8cb0408070cf21e796eb033ec3d8df35af4bf378eebb239f8586` | 1105 |
| `0003_payments.sql` | `db526c021615fe36a34a6828db88c124d0481d8ef33342d2e34dd8f579e3e169` | 2007 |
| `0004_payment_update_hardening.sql` | `4439de092c5d5ec2628439653cacc7e2365575f11f6730e97070f6e6113b2a76` | 92 |
| `0005_business_onboarding.sql` | `9d61d6a1df015a2cda6b2705f18bce0525d28c8b402ece7e76570e05ef1ce207` | 12257 |
| `0006_transactions.sql` | `024b307c05ec412d824e235d16d0a4f4627313bb26b696a816814411514c441e` | 7856 |
| `0007_stage4_1_dashboard_access_hardening.sql` | `112a63c374a40fc11e45f230bb2c0fd874322755dabdca0e4773a610c339e42e` | 3819 |
| `0008_stage5_expense_cashbook_read_rpcs.sql` | `bce996fde32b596797c9c3d94b40631ab7db435e0db39872ba195cfbc043ec24` | 9854 |
| `0009_stage5_rpc_access_hardening.sql` | `dc818ba10117a9357981d78c3a8c8ebef2e471b8ba85f34a1794fa36df237750` | 1707 |
