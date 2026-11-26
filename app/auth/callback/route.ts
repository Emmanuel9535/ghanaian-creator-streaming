import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/setup";
  const cookieStore = cookies();

  if (code && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set(name: string, value: string, options: Record<string, unknown>) { cookieStore.set({ name, value, ...options }); },
        remove(name: string, options: Record<string, unknown>) { cookieStore.set({ name, value: "", ...options }); },
      },
    });
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/setup", getAppUrl()));
}
