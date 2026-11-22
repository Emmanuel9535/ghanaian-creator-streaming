import { NextResponse } from "next/server";

export function GET() {
  const paystackConfigured = process.env.PAYSTACK_TEST_MODE === "true" && process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_") === true;
  return NextResponse.json({
    status: "ok",
    service: "momo-ledger",
    stage: 2,
    authentication: "supabase_auth",
    onboarding: "business_booth_opening_balances",
    database: "supabase_stage_2_migration",
    payments: "deferred",
    paystack_test_configuration_detected: paystackConfigured,
  });
}
