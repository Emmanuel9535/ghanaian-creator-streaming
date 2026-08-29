import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "ghana-first-streaming",
    stage: 2,
    authentication: "enabled",
    creator_dashboard: "enabled",
  });
}
