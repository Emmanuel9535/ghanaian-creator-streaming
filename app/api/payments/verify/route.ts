import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { verifyTransaction } from "@/lib/paystack";
import { createAdminClient } from "@/lib/supabase-admin";

function getUserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  const cookieStore = cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      get(name: string) { return cookieStore.get(name)?.value; },
      set(name: string, value: string, options: Record<string, unknown>) { cookieStore.set({ name, value, ...options }); },
      remove(name: string, options: Record<string, unknown>) { cookieStore.set({ name, value: "", ...options }); },
    },
  });
}

const allowedStatuses = new Set(["success", "failed", "abandoned", "reversed", "pending"]);

export async function POST(request: NextRequest) {
  try {
    const supabase = getUserClient();
    if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in before verifying checkout." }, { status: 401 });
    const body = await request.json().catch(() => ({}));
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (!reference || reference.length > 100) return NextResponse.json({ error: "A valid payment reference is required." }, { status: 400 });

    const { data: payment, error: paymentError } = await supabase.from("payments").select("amount, currency, status").eq("reference", reference).eq("user_id", user.id).maybeSingle();
    if (paymentError || !payment) return NextResponse.json({ error: "Payment record not found." }, { status: 404 });
    if (payment.status === "success") return NextResponse.json({ status: "success", reference, message: "Payment already verified." });

    const transaction = await verifyTransaction(reference);
    const expectedAmount = Number(payment.amount);
    const matches = transaction.reference === reference && transaction.amount === expectedAmount && transaction.currency === payment.currency;
    const transactionStatus = matches && allowedStatuses.has(transaction.status) ? transaction.status : "failed";
    const admin = createAdminClient();
    if (!admin) return NextResponse.json({ error: "Payment verification database configuration is missing." }, { status: 503 });
    const { error: updateError } = await admin.from("payments").update({ status: transactionStatus, paystack_transaction_id: transaction.id, gateway_response: transaction.gateway_response ?? null, paid_at: transaction.status === "success" && matches ? transaction.paid_at ?? new Date().toISOString() : null }).eq("reference", reference).eq("user_id", user.id);
    if (updateError) return NextResponse.json({ error: "Payment status could not be recorded." }, { status: 500 });
    return NextResponse.json({ status: transactionStatus, reference, amount: transaction.amount, currency: transaction.currency, message: matches ? transaction.gateway_response ?? "Verification complete." : "The verified payment did not match the expected amount or currency." });
  } catch {
    return NextResponse.json({ error: "Payment verification is unavailable in this environment." }, { status: 502 });
  }
}
