import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";

type PaystackWebhook = {
  event?: string;
  data?: {
    id?: number;
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    gateway_response?: string;
    paid_at?: string | null;
  };
};

function validSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const received = Buffer.from(signature, "utf8");
  const calculated = Buffer.from(expected, "utf8");
  return received.length === calculated.length && timingSafeEqual(received, calculated);
}

export async function POST(request: NextRequest) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !secret.startsWith("sk_test_") || process.env.PAYSTACK_TEST_MODE !== "true") return NextResponse.json({ error: "Paystack test-mode webhook is not configured." }, { status: 503 });
  const rawBody = await request.text();
  if (!validSignature(rawBody, request.headers.get("x-paystack-signature"), secret)) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });

  let event: PaystackWebhook;
  try { event = JSON.parse(rawBody) as PaystackWebhook; } catch { return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 }); }
  if (event.event !== "charge.success" || !event.data?.reference) return NextResponse.json({ received: true });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Webhook database configuration is missing." }, { status: 503 });
  const reference = event.data.reference;
  const { data: payment } = await admin.from("payments").select("amount, currency, status").eq("reference", reference).maybeSingle();
  if (!payment) return NextResponse.json({ received: true });
  const matches = event.data.status === "success" && event.data.amount === payment.amount && event.data.currency === payment.currency;
  if (!matches) return NextResponse.json({ received: true });
  await admin.from("payments").update({ status: "success", paystack_transaction_id: event.data.id ?? null, gateway_response: event.data.gateway_response ?? null, paid_at: event.data.paid_at ?? new Date().toISOString() }).eq("reference", reference).neq("status", "success");
  return NextResponse.json({ received: true });
}
