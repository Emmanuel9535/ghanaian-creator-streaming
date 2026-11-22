import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok", service: "momo-ledger", stage: 3, database: "supabase-stage-3-transactions" });
}
