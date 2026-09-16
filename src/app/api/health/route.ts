import { NextResponse } from "next/server";

import { getServerConfig } from "@/lib/config/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health
 * Proves that server configuration parses and the Supabase stack answers.
 * Returns 200 only when Supabase is reachable and healthy; otherwise 503.
 */
export async function GET() {
  const config = getServerConfig();

  let ok = false;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/health`, {
      headers: { apikey: config.supabaseServiceRoleKey },
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
    });
    ok = response.ok;
  } catch {
    ok = false;
  }

  return NextResponse.json(
    {
      ok,
      supabaseUrl: config.supabaseUrl,
      supabase: ok ? "reachable" : "unreachable",
    },
    { status: ok ? 200 : 503 },
  );
}
