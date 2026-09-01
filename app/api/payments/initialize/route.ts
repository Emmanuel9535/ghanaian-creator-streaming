import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { initializeTransaction, PaystackConfigurationError } from "@/lib/paystack";
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

export async function POST(request: NextRequest) {
  try {
    const supabase = getUserClient();
    if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return NextResponse.json({ error: "Sign in before starting checkout." }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const amount = Number(body.amount);
    const filmId = typeof body.film_id === "string" ? body.film_id.slice(0, 120) : "demo-film";
    if (!Number.isInteger(amount) || amount < 100 || amount > 100000000) return NextResponse.json({ error: "Amount must be a whole-number GHS subunit between 100 and 100,000,000." }, { status: 400 });

    const reference = `ghfirst_${crypto.randomUUID().replaceAll("-", "")}`;
    const { error: insertError } = await supabase.from("payments").insert({ user_id: user.id, reference, film_id: filmId, amount, currency: "GHS", status: "initialized", metadata: { test_mode: true } });
    if (insertError) return NextResponse.json({ error: "Could not create the payment record." }, { status: 500 });

    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const data = await initializeTransaction({ email: user.email, amount, reference, callback_url: `${origin}/checkout?reference=${encodeURIComponent(reference)}`, metadata: { reference, film_id: filmId, user_id: user.id, test_mode: true } });
    const admin = createAdminClient();
    if (admin) await admin.from("payments").update({ status: "pending" }).eq("reference", reference).eq("user_id", user.id);
    return NextResponse.json({ authorization_url: data.authorization_url, reference: data.reference });
  } catch (error) {
    const message = error instanceof PaystackConfigurationError ? error.message : "Payment initialization is unavailable in this environment.";
    return NextResponse.json({ error: message }, { status: error instanceof PaystackConfigurationError ? 503 : 502 });
  }
}
