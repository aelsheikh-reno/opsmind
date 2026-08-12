import { NextResponse } from "next/server";
import { fetchAndCacheRates } from "@/lib/fx";

// Called by Vercel Cron (or any external scheduler) at 10:00 AM UAE time (06:00 UTC).
// Vercel automatically sets Authorization: Bearer <CRON_SECRET> for scheduled invocations.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const { rates, cachedAt } = await fetchAndCacheRates();
    return NextResponse.json({ ok: true, cachedAt: cachedAt.toISOString(), currencies: Object.keys(rates).length });
  } catch (err) {
    console.error("[cron/fx] fetch failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
