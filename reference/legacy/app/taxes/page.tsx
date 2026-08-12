import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import SidebarWrapper from "../components/SidebarWrapper";
import TopBar from "../components/TopBar";
import TaxesClient from "./TaxesClient";
import { generateTaxPeriods } from "@/lib/tax";
import { getUsdRates } from "@/lib/fx";
import { resolvePermissions } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function TaxesPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const canWrite = resolvePermissions(session.user.role, session.user.permissions ?? null).finances === "write";

  const taxConfigs = await prisma.taxConfig.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    include: { payments: { include: { document: { select: { filename: true } } } } },
  });

  // FX rates for cross-currency invoice conversion (pivot: USD)
  const fxRates = await getUsdRates();

  // Fetch payroll runs once — shared across all configs
  const allPayrollRuns = await prisma.payrollRun.findMany({
    where: { month: { not: null }, year: { not: null } },
    select: {
      month: true,
      year: true,
      entries: { select: { salary: true, currency: true } },
    },
  });

  const configData = await Promise.all(
    taxConfigs.map(async (config) => {
      const periods = generateTaxPeriods(
        config.startDate,
        config.frequencyMonths,
        config.anchorMonth,
        config.filingDeadlineDays,
        config.periodsAhead,
      );

      // Conversion helper: any currency → config currency via USD pivot
      const toConfigCurrency = (amount: number, currency: string): number => {
        if (currency === config.currency) return amount;
        const toUsd = currency === "USD" ? amount : (fxRates[currency] ? amount / fxRates[currency] : amount);
        if (config.currency === "USD") return toUsd;
        return fxRates[config.currency] ? toUsd * fxRates[config.currency] : toUsd;
      };

      const periodData = await Promise.all(
        periods.map(async (p) => {
          const invoices = await prisma.document.findMany({
            where: {
              docType: "invoice",
              issueDate: { gte: p.periodStart, lte: p.periodEnd },
              amount: { not: null },
              ...(config.companyName
                ? { legalEntity: { name: config.companyName, country: config.country } }
                : {}),
            },
            select: { id: true, amount: true, currency: true, referenceNumber: true, parties: true },
            orderBy: { issueDate: "asc" },
          });
          const revenueTotal = invoices.reduce(
            (s, i) => s + toConfigCurrency(i.amount ?? 0, i.currency ?? config.currency),
            0,
          );
          const invoiceCount = invoices.length;

          const periodInvoices = invoices.map((inv) => {
            const origCurrency = inv.currency ?? config.currency;
            const converted = toConfigCurrency(inv.amount ?? 0, origCurrency);
            const parties = inv.parties ? (JSON.parse(inv.parties) as string[]) : [];
            const exchangeRate =
              origCurrency !== config.currency && (inv.amount ?? 0) > 0
                ? parseFloat((converted / inv.amount!).toFixed(4))
                : null;
            return {
              id: inv.id,
              referenceNumber: inv.referenceNumber ?? null,
              party: parties[0] ?? null,
              amount: inv.amount!,
              currency: origCurrency,
              convertedAmount: Math.round(converted),
              exchangeRate,
            };
          });

          // Expense data — only computed for profit-based configs
          let payrollExpenses = 0;
          let commitmentExpenses = 0;

          if (!config.revenueBase) {
            // Payroll: sum all entries in period runs, converted to config currency
            payrollExpenses = allPayrollRuns
              .filter((run) => {
                if (!run.month || !run.year) return false;
                const runDate = new Date(run.year, run.month - 1, 1);
                return runDate >= p.periodStart && runDate <= p.periodEnd;
              })
              .flatMap((run) => run.entries)
              .reduce((s, e) => s + toConfigCurrency(e.salary, e.currency), 0);

            // Payment schedules (lease / contract commitments) within the period, converted to config currency
            const schedules = await prisma.paymentSchedule.findMany({
              where: { dueDate: { gte: p.periodStart, lte: p.periodEnd } },
              select: { amount: true, currency: true },
            });
            commitmentExpenses = schedules.reduce((s, c) => s + toConfigCurrency(c.amount, c.currency), 0);
          }

          const payment = config.payments.find(
            (pay) => pay.periodStart.getTime() === p.periodStart.getTime()
          );

          const effectiveDueDate = payment?.dueDate ?? p.dueDate;
          const isPaid = payment != null && (payment.paidAmount != null || payment.paidAt != null);
          const isOverdue = !isPaid && effectiveDueDate < new Date() && p.isPast;

          return {
            periodStart: p.periodStart.toISOString(),
            periodEnd: p.periodEnd.toISOString(),
            dueDate: effectiveDueDate.toISOString(),
            label: p.label,
            isPast: p.isPast,
            isOverdue,
            revenueTotal: Math.round(revenueTotal),
            invoiceCount,
            invoices: periodInvoices,
            payrollExpenses: Math.round(payrollExpenses),
            commitmentExpenses: Math.round(commitmentExpenses),
            payment: payment
              ? {
                  id: payment.id,
                  paidAmount: payment.paidAmount,
                  paidAt: payment.paidAt?.toISOString() ?? null,
                  notes: payment.notes,
                  documentId: payment.documentId ?? null,
                  documentName: payment.document?.filename ?? null,
                }
              : null,
          };
        })
      );

      return {
        id: config.id,
        country: config.country,
        taxType: config.taxType,
        currency: config.currency,
        rate: config.rate,
        frequencyMonths: config.frequencyMonths,
        companyName: config.companyName ?? null,
        taxId: config.taxId ?? null,
        notes: config.notes ?? null,
        revenueBase: config.revenueBase,
        thresholdActive: config.thresholdActive,
        profitThreshold: config.profitThreshold ?? null,
        periods: periodData,
      };
    })
  );

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Taxes" }]} />
        <main className="px-4 sm:px-8 py-4 sm:py-6">
          <TaxesClient configs={configData} canWrite={canWrite} />
        </main>
      </div>
    </div>
  );
}
