import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import VatClient from "./VatClient";
import { generateVatPeriods } from "@/lib/vat";
import { getUsdRates, getHistoricalUsdRates, toUSD } from "@/lib/fx";

export const dynamic = "force-dynamic";

function convertToNative(amount: number, from: string, to: string, rates: Record<string, number>): number {
  if (from === to) return amount;
  const usd = toUSD(amount, from, rates);
  if (to === "USD") return usd;
  const targetRate = rates[to];
  return targetRate ? usd * targetRate : usd;
}

function getExchangeRate(from: string, to: string, rates: Record<string, number>): number | null {
  if (from === to) return null;
  if (from === "USD") return rates[to] ?? null;
  if (to === "USD") return rates[from] ? 1 / rates[from] : null;
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!fromRate || !toRate) return null;
  return toRate / fromRate;
}

export default async function VatPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const rates = await getUsdRates();

  const vatConfigs = await prisma.vatConfig.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    include: { payments: { include: { document: { select: { filename: true } } } } },
  });

  const configData = await Promise.all(
    vatConfigs.map(async (config) => {
      const periods = generateVatPeriods(
        config.startDate,
        config.frequencyMonths,
        config.anchorMonth,
        config.filingDeadlineDays,
        config.periodsAhead,
      );

      const periodTotals = await Promise.all(
        periods.map(async (p) => {
          const invoices = await prisma.document.findMany({
            where: {
              docType: "invoice",
              amount: { not: null },
              vatAmount: { not: null },
              ...(config.companyName
                ? { legalEntity: { name: config.companyName, country: config.country } }
                : { currency: config.currency }),
              OR: [
                { issueDate: { gte: p.periodStart, lte: p.periodEnd } },
                { issueDate: null, createdAt: { gte: p.periodStart, lte: p.periodEnd } },
              ],
            },
            select: { id: true, amount: true, vatAmount: true, currency: true, referenceNumber: true, parties: true, issueDate: true, createdAt: true },
          });

          // Pre-fetch historical rates for months where currency conversion is needed
          const monthRateCache = new Map<string, Record<string, number>>();
          const monthsToFetch = new Set<string>();
          for (const inv of invoices) {
            if ((inv.currency ?? config.currency) !== config.currency) {
              const d = inv.issueDate ?? inv.createdAt;
              monthsToFetch.add(`${d.getFullYear()}-${d.getMonth() + 1}`);
            }
          }
          await Promise.all(Array.from(monthsToFetch).map(async (ym) => {
            const [y, m] = ym.split("-").map(Number);
            const hist = await getHistoricalUsdRates(new Date(y, m, 0));
            monthRateCache.set(ym, hist ?? rates);
          }));

          function ratesForInv(inv: { currency: string | null; issueDate: Date | null; createdAt: Date }) {
            if ((inv.currency ?? config.currency) === config.currency) return rates;
            const d = inv.issueDate ?? inv.createdAt;
            return monthRateCache.get(`${d.getFullYear()}-${d.getMonth() + 1}`) ?? rates;
          }

          const invoiceTotal = invoices.reduce((s, i) => s + convertToNative(i.amount ?? 0, i.currency ?? config.currency, config.currency, ratesForInv(i)), 0);
          const vatEstimate = invoices.reduce((s, i) => s + convertToNative(i.vatAmount ?? 0, i.currency ?? config.currency, config.currency, ratesForInv(i)), 0);

          const invoiceList = invoices.map((i) => {
            let party: string | null = null;
            try { const arr = JSON.parse(i.parties ?? "[]"); party = arr[0] ?? null; } catch { /* */ }
            const invCurrency = i.currency ?? config.currency;
            const invRates = ratesForInv(i);
            const exchangeRate = invCurrency !== config.currency
              ? getExchangeRate(invCurrency, config.currency, invRates)
              : null;
            return {
              id: i.id,
              referenceNumber: i.referenceNumber,
              party,
              amount: i.amount ?? 0,
              vatAmount: i.vatAmount,
              currency: invCurrency,
              exchangeRate,
            };
          });

          const payment = config.payments.find(
            (pay) => pay.periodStart.getTime() === p.periodStart.getTime()
          );

          const effectiveDueDate = payment?.customDueDate ?? p.dueDate;

          return {
            periodStart: p.periodStart.toISOString(),
            periodEnd: p.periodEnd.toISOString(),
            dueDate: effectiveDueDate.toISOString(),
            label: p.label,
            isPast: p.isPast,
            isOverdue: effectiveDueDate < new Date() && p.periodEnd < new Date(),
            invoiceTotal: Math.round(invoiceTotal),
            invoiceCount: invoices.length,
            vatEstimate: Math.round(vatEstimate * 100) / 100,
            invoices: invoiceList,
            payment: payment
              ? {
                  id: payment.id,
                  paidAmount: payment.paidAmount,
                  paidAt: payment.paidAt?.toISOString() ?? null,
                  notes: payment.notes,
                  documentId: payment.documentId ?? null,
                  documentName: payment.document?.filename ?? null,
                  customDueDate: payment.customDueDate?.toISOString() ?? null,
                }
              : null,
          };
        })
      );

      return {
        id: config.id,
        country: config.country,
        currency: config.currency,
        rate: config.rate,
        frequencyMonths: config.frequencyMonths,
        companyName: config.companyName ?? null,
        taxId: config.taxId ?? null,
        periods: periodTotals,
      };
    })
  );

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "VAT" }]} />
        <main className="px-4 sm:px-8 py-4 sm:py-6">
          <VatClient configs={configData} />
        </main>
      </div>
    </div>
  );
}
