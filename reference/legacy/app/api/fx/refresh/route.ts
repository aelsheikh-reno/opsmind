import { NextResponse } from "next/server";
import { fetchAndCacheRates, getRatesCachedAt } from "@/lib/fx";
import { requireWrite } from "@/lib/permissions";

export async function GET() {
  const cachedAt = await getRatesCachedAt();
  return NextResponse.json({ cachedAt: cachedAt?.toISOString() ?? null });
}

export async function POST() {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  try {
    const { rates, cachedAt } = await fetchAndCacheRates();
    return NextResponse.json({
      ok: true,
      cachedAt: cachedAt.toISOString(),
      EGP: rates.EGP,
      AED: rates.AED,
    });
  } catch (err) {
    console.error("[fx/refresh] fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch rates" }, { status: 502 });
  }
}
