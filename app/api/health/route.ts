import { NextResponse } from "next/server";

export function GET() {
  const paystackConfigured = process.env.PAYSTACK_TEST_MODE === "true" && process.env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_") === true;
  return NextResponse.json({
    status: "ok",
    service: "ghana-first-streaming",
    stage: 3,
    authentication: "enabled",
    creator_dashboard: "enabled",
    payments: "paystack_test_mode",
    paystack_configured: paystackConfigured,
  });
}
