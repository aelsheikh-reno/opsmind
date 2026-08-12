import { prisma } from "@/lib/prisma";

const FALLBACK: Record<string, number> = { EGP: 50, AED: 3.67, EUR: 0.92, GBP: 0.79 };
const CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23 h — refresh before the 24-h daily window

/**
 * Fetch historical USD rates for a specific date from the jsdelivr free API.
 * Returns null on failure. Results are long-cached — historical rates never change.
 */
export async function getHistoricalUsdRates(date: Date): Promise<Record<string, number> | null> {
  for (let offset = 0; offset < 4; offset++) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() - offset);
    const dateStr = d.toISOString().split("T")[0];
    try {
      const res = await fetch(
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dateStr}/v1/currencies/usd.json`,
        { next: { revalidate: 86400 * 30 } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      const rates: Record<string, number> = {};
      for (const [k, v] of Object.entries(data.usd ?? {})) rates[k.toUpperCase()] = v as number;
      return rates;
    } catch { continue; }
  }
  return null;
}

/** Fetch live rates from the API, persist them in the Setting table, and return them. */
export async function fetchAndCacheRates(): Promise<{ rates: Record<string, number>; cachedAt: Date }> {
  // Primary: fawazahmed0 "latest" — same source used for historical, tracks interbank closely.
  // Fallback: open.er-api.com free tier.
  let rates: Record<string, number> = {};
  try {
    const res = await fetch(
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
      { cache: "no-store" },
    );
    if (res.ok) {
      const data = await res.json();
      for (const [k, v] of Object.entries(data.usd ?? {})) rates[k.toUpperCase()] = v as number;
    }
  } catch { /* fall through to backup */ }

  if (Object.keys(rates).length === 0) {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (!res.ok) throw new Error(`Rate API returned ${res.status}`);
    const data = await res.json();
    rates = data.rates ?? {};
  }

  if (Object.keys(rates).length === 0) throw new Error("Empty rates payload");
  const cachedAt = new Date();
  await prisma.setting.upsert({
    where: { key: "fx_rates_cache" },
    update: { value: JSON.stringify({ rates, cachedAt: cachedAt.toISOString() }) },
    create: { key: "fx_rates_cache", value: JSON.stringify({ rates, cachedAt: cachedAt.toISOString() }) },
  });
  return { rates, cachedAt };
}

/** Return live USD rates. Uses DB cache (< 23 h) before hitting the network. */
export async function getUsdRates(): Promise<Record<string, number>> {
  try {
    const cached = await prisma.setting.findUnique({ where: { key: "fx_rates_cache" } });
    if (cached) {
      const { rates, cachedAt } = JSON.parse(cached.value) as { rates: Record<string, number>; cachedAt: string };
      if (Date.now() - new Date(cachedAt).getTime() < CACHE_TTL_MS) return rates;
    }
    const { rates } = await fetchAndCacheRates();
    return rates;
  } catch {
    return FALLBACK;
  }
}

/** Return the timestamp of the last successful rate fetch, or null if never fetched. */
export async function getRatesCachedAt(): Promise<Date | null> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "fx_rates_cache" } });
    if (!row) return null;
    const { cachedAt } = JSON.parse(row.value) as { cachedAt: string };
    return new Date(cachedAt);
  } catch { return null; }
}

export function toUSD(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "USD") return amount;
  const rate = rates[currency];
  return rate ? amount / rate : amount;
}

/** Parse a stored fxRateSnapshot JSON string. Returns null if missing/invalid. */
export function parseSnapshot(snapshot: string | null | undefined): Record<string, number> | null {
  if (!snapshot) return null;
  try { return JSON.parse(snapshot); } catch { return null; }
}

/**
 * Convert using locked historical rates when available, live rates as fallback.
 * Pass `snapshot` from the DB record; it is non-null only for paid/processed items.
 */
export function toUSDWithSnapshot(
  amount: number,
  currency: string,
  liveRates: Record<string, number>,
  snapshot: string | null | undefined,
): number {
  const rates = parseSnapshot(snapshot) ?? liveRates;
  return toUSD(amount, currency, rates);
}

/** Format the rate note shown alongside a historical amount, e.g. "1 USD = 50 EGP (locked)" */
/**
 * Return historical USD rates for a given year+month, persisting the result
 * in the Setting table so repeated page loads never hit the external API again.
 * Historical rates are immutable so once cached they are valid forever.
 */
export async function getMonthRates(
  year: number,
  month: number,
  liveRates: Record<string, number>,
): Promise<Record<string, number>> {
  const key = `fx_hist_${year}_${String(month).padStart(2, "0")}`;
  try {
    const cached = await prisma.setting.findUnique({ where: { key } });
    if (cached) return JSON.parse(cached.value) as Record<string, number>;
    const rates = await getHistoricalUsdRates(new Date(year, month, 0)); // last day of month
    if (rates) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: JSON.stringify(rates) },
        create: { key, value: JSON.stringify(rates) },
      });
      return rates;
    }
  } catch { /* fall through */ }
  return liveRates;
}

/**
 * Return the best available rates for a given year+month, in priority order:
 *   1. Locked PayrollRun snapshot for that month (most authoritative)
 *   2. Historical rate fetched from the public API — same source as the Settings
 *      exchange-rate table, so all pages always agree on the rate shown there.
 *      Result is written to fx_hist_YYYY_MM as a Docker-restart fallback only.
 *   3. DB cache (fx_hist_YYYY_MM) — only when the API is unavailable
 *   4. Live rates (current/future months or total fallback)
 */
export async function getBestMonthRates(year: number, month: number): Promise<Record<string, number>> {
  // 1. Locked payroll run for this month
  try {
    const run = await prisma.payrollRun.findFirst({
      where: { year, month, isProcessed: true, fxRateSnapshot: { not: null } },
      select: { fxRateSnapshot: true },
    });
    if (run?.fxRateSnapshot) return JSON.parse(run.fxRateSnapshot);
  } catch { /* fall through */ }

  const key = `fx_hist_${year}_${String(month).padStart(2, "0")}`;
  const now = new Date();
  const isPast = year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1);

  if (isPast) {
    try {
      // Always fetch from API (Next.js caches the response for 30 days at the
      // fetch level), matching exactly what the Settings exchange-rate table shows.
      const rates = await getHistoricalUsdRates(new Date(year, month, 0));
      if (rates) {
        // Keep DB updated in the background as a fallback for container restarts.
        prisma.setting.upsert({
          where: { key },
          update: { value: JSON.stringify(rates) },
          create: { key, value: JSON.stringify(rates) },
        }).catch(() => {});
        return rates;
      }
    } catch { /* fall through */ }

    // API unavailable — use DB cache as last resort
    try {
      const cached = await prisma.setting.findUnique({ where: { key } });
      if (cached) return JSON.parse(cached.value) as Record<string, number>;
    } catch { /* fall through */ }
  }

  // 4. Live rates for current and future months
  return getUsdRates();
}

export function rateNote(currency: string, snapshot: string | null | undefined, liveRates: Record<string, number>): string | null {
  if (currency === "USD") return null;
  const locked = parseSnapshot(snapshot);
  const rates  = locked ?? liveRates;
  const rate   = rates[currency];
  if (!rate) return null;
  const rounded = Math.round(rate * 100) / 100;
  return locked
    ? `1 USD = ${rounded} ${currency} (rate at payment)`
    : `1 USD ≈ ${rounded} ${currency} (live)`;
}
