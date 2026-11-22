import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok", service: "momo-ledger", stage: 2, database: "supabase-stage-2-schema" });
}
