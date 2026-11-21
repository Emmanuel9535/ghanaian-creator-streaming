import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok", service: "momo-ledger", stage: 1, database: "supabase-connection-preserved" });
}
