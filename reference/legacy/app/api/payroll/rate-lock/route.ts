import { prisma } from "@/lib/prisma";
import { getHistoricalUsdRates, getUsdRates } from "@/lib/fx";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

// PATCH /api/payroll/rate-lock?runId=xxx&action=lock|unlock|edit[&CURRENCY=value...]
export async function PATCH(req: NextRequest) {
  const denied = await requireWrite("payroll");
  if (denied) return denied;

  const sp     = req.nextUrl.searchParams;
  const runId  = sp.get("runId");
  const action = sp.get("action"); // "lock" | "unlock" | "edit"

  if (!runId || !action) {
    return NextResponse.json({ error: "runId and action required" }, { status: 400 });
  }

  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, month: true, year: true, fxRateSnapshot: true },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "unlock") {
    await prisma.payrollRun.update({ where: { id: runId }, data: { fxRateSnapshot: null } });
    return NextResponse.json({ ok: true });
  }

  if (action === "lock") {
    if (!run.month || !run.year) {
      return NextResponse.json({ error: "Run has no month/year" }, { status: 400 });
    }
    const now = new Date();
    const isCurrentOrFuture =
      run.year > now.getFullYear() ||
      (run.year === now.getFullYear() && run.month >= now.getMonth() + 1);

    let rates: Record<string, number> | null = null;
    if (isCurrentOrFuture) {
      rates = await getUsdRates();
    } else {
      const refDate = new Date(run.year, run.month, 0);
      rates = await getHistoricalUsdRates(refDate);
      if (!rates) rates = await getUsdRates();
    }

    if (!rates) return NextResponse.json({ error: "Could not fetch rates" }, { status: 502 });

    await prisma.payrollRun.update({
      where: { id: runId },
      data: { fxRateSnapshot: JSON.stringify(rates) },
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "edit") {
    if (!run.month || !run.year) {
      return NextResponse.json({ error: "Run has no month/year" }, { status: 400 });
    }

    // Collect currency=value pairs from query params (skip runId and action)
    const customRates: Record<string, number> = {};
    for (const [k, v] of sp.entries()) {
      if (k === "runId" || k === "action") continue;
      const num = parseFloat(v);
      if (!isNaN(num) && num > 0) customRates[k] = num;
    }
    if (Object.keys(customRates).length === 0) {
      return NextResponse.json({ error: "No valid rates provided" }, { status: 400 });
    }

    // Base: existing snapshot if present, otherwise fetch live/historical
    let base: Record<string, number> = {};
    if (run.fxRateSnapshot) {
      try { base = JSON.parse(run.fxRateSnapshot); } catch { /* ignore */ }
    } else {
      const now = new Date();
      const isCurrentOrFuture =
        run.year > now.getFullYear() ||
        (run.year === now.getFullYear() && run.month >= now.getMonth() + 1);
      if (isCurrentOrFuture) {
        base = (await getUsdRates()) ?? {};
      } else {
        const refDate = new Date(run.year, run.month, 0);
        base = (await getHistoricalUsdRates(refDate)) ?? (await getUsdRates()) ?? {};
      }
    }

    const merged = { ...base, ...customRates };
    await prisma.payrollRun.update({
      where: { id: runId },
      data: { fxRateSnapshot: JSON.stringify(merged) },
    });
    return NextResponse.json({ ok: true, rates: merged });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
