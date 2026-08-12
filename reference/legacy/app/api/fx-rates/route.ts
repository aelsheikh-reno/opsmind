import { prisma } from "@/lib/prisma";
import { getUsdRates, getHistoricalUsdRates } from "@/lib/fx";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export type RateOption = {
  year: number;
  month: number;
  key: string;
  label: string;
  rate: number | null;
  source: "locked" | "historical" | "live" | "forecast";
};

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const currency = searchParams.get("currency")?.toUpperCase();
  if (!currency || currency === "USD") return NextResponse.json({ options: [] });

  const now = new Date();
  const nowMonth = now.getMonth() + 1;
  const nowYear = now.getFullYear();
  const toKey = (y: number, m: number) => y * 12 + m;

  const [allProcessedRuns, allRunBounds, horizonSetting, liveRates] = await Promise.all([
    prisma.payrollRun.findMany({
      where: { isProcessed: true, month: { not: null }, year: { not: null } },
      select: { month: true, year: true, fxRateSnapshot: true },
      orderBy: [{ year: "asc" }, { month: "asc" }],
    }),
    prisma.payrollRun.findMany({
      where: { month: { not: null }, year: { not: null } },
      select: { month: true, year: true },
    }),
    prisma.setting.findUnique({ where: { key: "payrollHorizonYear" } }),
    getUsdRates(),
  ]);

  const horizonYear = horizonSetting ? parseInt(horizonSetting.value, 10) : null;

  const runByKey = new Map<string, { fxRateSnapshot: string | null }>();
  for (const run of allProcessedRuns) {
    if (!run.month || !run.year) continue;
    runByKey.set(`${run.year}-${run.month}`, { fxRateSnapshot: run.fxRateSnapshot });
  }

  let startYear = nowYear - 1, startMonth = 1;
  for (const run of allRunBounds) {
    if (!run.month || !run.year) continue;
    if (run.year < startYear || (run.year === startYear && run.month < startMonth)) {
      startYear = run.year;
      startMonth = run.month;
    }
  }

  let endKey: number;
  if (horizonYear) {
    endKey = toKey(horizonYear, 12);
  } else {
    endKey = toKey(nowYear, nowMonth) + 3;
    for (const run of allRunBounds) {
      if (!run.month || !run.year) continue;
      endKey = Math.max(endKey, toKey(run.year, run.month));
    }
  }

  // Gather past months that need a historical lookup (no locked snapshot)
  const pastNeedingHistory: { year: number; month: number; key: string }[] = [];
  for (let k = toKey(startYear, startMonth); k < toKey(nowYear, nowMonth); k++) {
    const y = Math.floor((k - 1) / 12);
    const m = ((k - 1) % 12) + 1;
    const mapKey = `${y}-${m}`;
    if (!runByKey.get(mapKey)?.fxRateSnapshot) {
      pastNeedingHistory.push({ year: y, month: m, key: mapKey });
    }
  }

  // Check DB cache first (written by getBestMonthRates / getMonthRates), then fetch
  const historicalByKey = new Map<string, Record<string, number>>();
  await Promise.all(
    pastNeedingHistory.map(async ({ year, month, key }) => {
      const cacheKey = `fx_hist_${year}_${String(month).padStart(2, "0")}`;
      try {
        const cached = await prisma.setting.findUnique({ where: { key: cacheKey } });
        if (cached) { historicalByKey.set(key, JSON.parse(cached.value)); return; }
      } catch { /* fall through */ }
      const rates = await getHistoricalUsdRates(new Date(year, month, 0));
      if (rates) historicalByKey.set(key, rates);
    })
  );

  const options: RateOption[] = [];

  for (let k = toKey(startYear, startMonth); k <= endKey; k++) {
    const y = Math.floor((k - 1) / 12);
    const m = ((k - 1) % 12) + 1;
    const mapKey = `${y}-${m}`;
    const isPast = toKey(y, m) < toKey(nowYear, nowMonth);
    const isCurrent = y === nowYear && m === nowMonth;
    const run = runByKey.get(mapKey);

    let rate: number | null = null;
    let source: RateOption["source"] = "forecast";

    if (run?.fxRateSnapshot) {
      try {
        const snap = JSON.parse(run.fxRateSnapshot) as Record<string, number>;
        rate = snap[currency] ?? null;
        source = "locked";
      } catch { /* keep null */ }
    } else if (isPast) {
      rate = historicalByKey.get(mapKey)?.[currency] ?? null;
      source = "historical";
    } else {
      rate = liveRates[currency] ?? null;
      source = isCurrent ? "live" : "forecast";
    }

    const rateStr = rate != null ? ` — ${rate.toFixed(2)} ${currency}` : " — N/A";
    const srcLabel = { locked: "locked", historical: "hist", live: "live", forecast: "est" }[source];
    const label = `${MONTHS_SHORT[m - 1]} ${y}${rateStr} (${srcLabel})`;

    options.push({ year: y, month: m, key: mapKey, label, rate, source });
  }

  options.reverse(); // most recent first

  return NextResponse.json({ options });
}
