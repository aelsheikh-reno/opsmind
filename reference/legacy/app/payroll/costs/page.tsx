import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { resolvePermissions } from "@/lib/permissions";
import { getUsdRates } from "@/lib/fx";
import SidebarWrapper from "../../components/SidebarWrapper";
import TopBar from "../../components/TopBar";
import PayrollCostsClient from "./PayrollCostsClient";

export const dynamic = "force-dynamic";

function toUSD(amount: number, currency: string, rates: Record<string, number>) {
  if (currency === "USD") return amount;
  const r = rates[currency];
  return r ? amount / r : amount;
}

export default async function PayrollCostsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const perms = resolvePermissions(session.user.role, session.user.permissions);
  if (perms.payroll === "none") redirect("/");

  const [rates, runs, paidClaims] = await Promise.all([
    getUsdRates(),

    // All payroll runs with their paid entries
    prisma.payrollRun.findMany({
      where: { month: { not: null }, year: { not: null } },
      select: {
        id: true,
        month: true,
        year: true,
        isProcessed: true,
        entries: {
          where: { isPaid: true },
          select: {
            id: true,
            employeeName: true,
            salary: true,
            currency: true,
            bankingFee: true,
            bankingFeeCurrency: true,
            budgetId: true,
            budget: { select: { name: true, color: true } },
            person: { select: { id: true, name: true } },
            personId: true,
          },
        },
      },
      orderBy: [{ year: "desc" }, { month: "desc" }],
    }),

    // Paid expense claims assigned to a person (payroll-linked)
    prisma.expense.findMany({
      where: {
        completed: true,
        personId: { not: null },
        amount: { not: null },
        OR: [{ claimStatus: null }, { claimStatus: { not: "rejected" } }],
      },
      select: {
        id: true,
        name: true,
        amount: true,
        currency: true,
        payrollMonth: true,
        payrollYear: true,
        dueOn: true,
        createdAt: true,
        personId: true,
        person: { select: { name: true } },
        budgetId: true,
        budget: { select: { name: true, color: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Build month rows
  type MonthRow = {
    key: string;           // "2026-05"
    month: number;
    year: number;
    salariesUSD: number;
    bankingFeesUSD: number;
    claimsUSD: number;
    totalUSD: number;
    entries: {
      id: string;
      employeeName: string;
      salaryUSD: number;
      bankingFeeUSD: number;
      budget: { name: string; color: string | null } | null;
    }[];
    claims: {
      id: string;
      name: string;
      personName: string | null;
      amountUSD: number;
      budget: { name: string; color: string | null } | null;
    }[];
  };

  const monthMap = new Map<string, MonthRow>();

  for (const run of runs) {
    if (!run.month || !run.year) continue;
    if (run.entries.length === 0) continue;
    const key = `${run.year}-${String(run.month).padStart(2, "0")}`;
    const existing = monthMap.get(key) ?? {
      key,
      month: run.month,
      year: run.year,
      salariesUSD: 0,
      bankingFeesUSD: 0,
      claimsUSD: 0,
      totalUSD: 0,
      entries: [],
      claims: [],
    };
    for (const e of run.entries) {
      const salUSD = toUSD(e.salary, e.currency, rates);
      const feeUSD = e.bankingFee ? toUSD(e.bankingFee, e.bankingFeeCurrency ?? e.currency, rates) : 0;
      existing.salariesUSD += salUSD;
      existing.bankingFeesUSD += feeUSD;
      existing.entries.push({
        id: e.id,
        employeeName: e.employeeName,
        salaryUSD: salUSD,
        bankingFeeUSD: feeUSD,
        budget: e.budget,
      });
    }
    monthMap.set(key, existing);
  }

  for (const claim of paidClaims) {
    // Assign claim to month: use explicit payrollMonth/Year, else dueOn, else createdAt
    let month: number | null = null;
    let year: number | null = null;
    if (claim.payrollMonth && claim.payrollYear) {
      month = claim.payrollMonth;
      year = claim.payrollYear;
    } else if (claim.dueOn) {
      const d = new Date(claim.dueOn);
      month = d.getMonth() + 1;
      year = d.getFullYear();
    } else {
      const d = new Date(claim.createdAt);
      month = d.getMonth() + 1;
      year = d.getFullYear();
    }
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const existing = monthMap.get(key) ?? {
      key,
      month: month!,
      year: year!,
      salariesUSD: 0,
      bankingFeesUSD: 0,
      claimsUSD: 0,
      totalUSD: 0,
      entries: [],
      claims: [],
    };
    const amtUSD = toUSD(claim.amount!, claim.currency, rates);
    existing.claimsUSD += amtUSD;
    existing.claims.push({
      id: claim.id,
      name: claim.name,
      personName: claim.person?.name ?? null,
      amountUSD: amtUSD,
      budget: claim.budget,
    });
    monthMap.set(key, existing);
  }

  // Compute totals and sort desc
  const rows = Array.from(monthMap.values())
    .map(r => ({ ...r, totalUSD: r.salariesUSD + r.bankingFeesUSD + r.claimsUSD }))
    .sort((a, b) => b.key.localeCompare(a.key));

  // Per-person aggregation — keyed by personId when linked, else lowercased employeeName
  type PersonSummary = {
    employeeName: string;
    personId: string | null;
    salaryUSD: number;
    claimsUSD: number;
    bankingFeeUSD: number;
    totalUSD: number;
  };
  const personMap = new Map<string, PersonSummary>();

  for (const run of runs) {
    for (const e of run.entries) {
      const key = e.personId ?? e.employeeName.toLowerCase().trim();
      const p = personMap.get(key) ?? {
        employeeName: e.employeeName,
        personId: e.personId ?? null,
        salaryUSD: 0, claimsUSD: 0, bankingFeeUSD: 0, totalUSD: 0,
      };
      p.salaryUSD += toUSD(e.salary, e.currency, rates);
      p.bankingFeeUSD += e.bankingFee ? toUSD(e.bankingFee, e.bankingFeeCurrency ?? e.currency, rates) : 0;
      personMap.set(key, p);
    }
  }

  for (const claim of paidClaims) {
    if (!claim.personId) continue;
    const p = personMap.get(claim.personId);
    if (p) {
      p.claimsUSD += toUSD(claim.amount!, claim.currency, rates);
    } else {
      personMap.set(claim.personId, {
        employeeName: claim.person?.name ?? "Unknown",
        personId: claim.personId,
        salaryUSD: 0,
        claimsUSD: toUSD(claim.amount!, claim.currency, rates),
        bankingFeeUSD: 0,
        totalUSD: 0,
      });
    }
  }

  const personRows = Array.from(personMap.values())
    .map(p => ({ ...p, totalUSD: p.salaryUSD + p.claimsUSD + p.bankingFeeUSD }))
    .sort((a, b) => b.totalUSD - a.totalUSD);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Team" }, { label: "Payroll", href: "/payroll" }, { label: "People Cost" }]} />
        <main className="px-4 sm:px-8 py-4 sm:py-6 flex-1">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">People Cost</h1>
            <p className="text-sm text-gray-500 mt-1">
              All paid salaries, expense claims, and banking fees — grouped by payroll month.
            </p>
          </div>
          <PayrollCostsClient rows={rows} personRows={personRows} />
        </main>
      </div>
    </div>
  );
}
