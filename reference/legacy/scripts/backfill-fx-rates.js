/**
 * Backfill fxRateSnapshot on paid records that pre-date the rate-locking feature.
 *
 * Date heuristic per model:
 *   PayrollRun        → last day of run.month / run.year
 *   PaymentSchedule   → dueDate
 *   Document (invoice)→ expiryDate (due date) → issueDate → createdAt
 *
 * Historical rates from jsdelivr (@fawazahmed0/currency-api) — free, no key, includes EGP/AED.
 * Keys are lowercase in that API; we normalise them to UPPERCASE to match our lib/fx format.
 *
 * Usage:
 *   DATABASE_URL="file:./prisma/dev.db" node scripts/backfill-fx-rates.js
 */

const { PrismaClient } = require("../node_modules/@prisma/client");

const prisma = new PrismaClient();

// ── helpers ─────────────────────────────────────────────────────────────────

function toISODate(date) {
  return date.toISOString().split("T")[0];
}

/** Last calendar day of a given month (1-based). */
function lastDayOf(year, month) {
  return new Date(year, month, 0); // day=0 → last day of previous month
}

/** Fetch historical USD rates for a YYYY-MM-DD date string. Returns null on failure. */
async function fetchHistoricalRates(dateStr) {
  const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dateStr}/v1/currencies/usd.json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`  ⚠  HTTP ${res.status} for ${dateStr} — will try fallback date`);
      return null;
    }
    const data = await res.json();
    // data.usd = { egp: 50.12, aed: 3.67, ... } — convert keys to UPPERCASE
    const rates = {};
    for (const [k, v] of Object.entries(data.usd ?? {})) {
      rates[k.toUpperCase()] = v;
    }
    return rates;
  } catch (err) {
    console.warn(`  ⚠  Failed to fetch rates for ${dateStr}:`, err.message);
    return null;
  }
}

/**
 * Try the given date, then up to 3 days earlier (handles weekends/holidays
 * where some APIs don't have data).
 */
async function getRatesForDate(dateStr, cache) {
  if (cache.has(dateStr)) return cache.get(dateStr);

  let rates = null;
  let d = new Date(dateStr + "T00:00:00Z");
  for (let i = 0; i < 4 && !rates; i++) {
    const key = toISODate(d);
    if (cache.has(key)) { rates = cache.get(key); break; }
    console.log(`  Fetching rates for ${key}${i > 0 ? ` (fallback from ${dateStr})` : ""}…`);
    rates = await fetchHistoricalRates(key);
    if (rates) cache.set(key, rates);
    d.setUTCDate(d.getUTCDate() - 1);
  }

  cache.set(dateStr, rates); // even if null — don't retry
  return rates;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  const rateCache = new Map();
  let updated = 0;
  let skipped = 0;

  // ── 1. PayrollRun ────────────────────────────────────────────────────────
  console.log("\n── PayrollRun (processed, no snapshot) ──");
  const runs = await prisma.payrollRun.findMany({
    where: { isProcessed: true, fxRateSnapshot: null, month: { not: null }, year: { not: null } },
    select: { id: true, month: true, year: true, processedAt: true },
  });
  console.log(`Found ${runs.length} run(s).`);

  for (const run of runs) {
    // Use the last day of the payroll month as the reference rate date.
    const refDate = toISODate(lastDayOf(run.year, run.month));
    console.log(`  Run ${run.id.slice(-6)} (${run.year}-${String(run.month).padStart(2,"0")}) → ref date ${refDate}`);
    const rates = await getRatesForDate(refDate, rateCache);
    if (!rates) { console.warn("  → Skipped (no rates available)"); skipped++; continue; }
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: { fxRateSnapshot: JSON.stringify(rates) },
    });
    const egp = rates.EGP ? `1 USD = ${rates.EGP.toFixed(2)} EGP` : "EGP n/a";
    console.log(`  → Updated (${egp})`);
    updated++;
  }

  // ── 2. PaymentSchedule ───────────────────────────────────────────────────
  console.log("\n── PaymentSchedule (paid, no snapshot) ──");
  const schedules = await prisma.paymentSchedule.findMany({
    where: { isPaid: true, fxRateSnapshot: null },
    select: { id: true, dueDate: true, currency: true },
  });
  console.log(`Found ${schedules.length} entry(s).`);

  for (const s of schedules) {
    if (s.currency === "USD") {
      // No conversion needed; store a minimal snapshot so this never re-runs.
      await prisma.paymentSchedule.update({
        where: { id: s.id },
        data: { fxRateSnapshot: JSON.stringify({ USD: 1 }) },
      });
      console.log(`  Schedule ${s.id.slice(-6)} (USD) → trivial snapshot stored`);
      updated++;
      continue;
    }
    const refDate = toISODate(s.dueDate);
    console.log(`  Schedule ${s.id.slice(-6)} (${s.currency}, due ${refDate})`);
    const rates = await getRatesForDate(refDate, rateCache);
    if (!rates) { console.warn("  → Skipped"); skipped++; continue; }
    await prisma.paymentSchedule.update({
      where: { id: s.id },
      data: { fxRateSnapshot: JSON.stringify(rates) },
    });
    const note = rates[s.currency] ? `1 USD = ${rates[s.currency].toFixed(2)} ${s.currency}` : "rate n/a";
    console.log(`  → Updated (${note})`);
    updated++;
  }

  // ── 3. Document / Invoice ────────────────────────────────────────────────
  console.log("\n── Invoice Documents (paid, no snapshot) ──");
  const invoices = await prisma.document.findMany({
    where: { isPaid: true, fxRateSnapshot: null, docType: "invoice" },
    select: { id: true, currency: true, expiryDate: true, issueDate: true, createdAt: true },
  });
  console.log(`Found ${invoices.length} invoice(s).`);

  for (const inv of invoices) {
    if (!inv.currency || inv.currency === "USD") {
      await prisma.document.update({
        where: { id: inv.id },
        data: { fxRateSnapshot: JSON.stringify({ USD: 1 }) },
      });
      console.log(`  Invoice ${inv.id.slice(-6)} (USD/no currency) → trivial snapshot`);
      updated++;
      continue;
    }
    // Best date proxy: due date (expiryDate) → issue date → upload date
    const refDate = toISODate(inv.expiryDate ?? inv.issueDate ?? inv.createdAt);
    console.log(`  Invoice ${inv.id.slice(-6)} (${inv.currency}, ref ${refDate})`);
    const rates = await getRatesForDate(refDate, rateCache);
    if (!rates) { console.warn("  → Skipped"); skipped++; continue; }
    await prisma.document.update({
      where: { id: inv.id },
      data: { fxRateSnapshot: JSON.stringify(rates) },
    });
    const note = rates[inv.currency] ? `1 USD = ${rates[inv.currency].toFixed(2)} ${inv.currency}` : "rate n/a";
    console.log(`  → Updated (${note})`);
    updated++;
  }

  console.log(`\n✓ Done — ${updated} record(s) updated, ${skipped} skipped (no data available).`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
