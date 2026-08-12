import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import Sidebar from "./Sidebar";
import MobileDrawerOverlay from "./MobileDrawerOverlay";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function pendingPayrollMonth(
  latestProcessed: { month: number | null; year: number | null } | null,
): string {
  const now = new Date();
  if (latestProcessed?.month && latestProcessed?.year) {
    // Next month after the last processed run, but no later than current month
    const nextMonth = latestProcessed.month === 12 ? 1 : latestProcessed.month + 1;
    const nextYear  = latestProcessed.month === 12 ? latestProcessed.year + 1 : latestProcessed.year;
    const nowKey    = now.getFullYear() * 12 + now.getMonth() + 1; // 1-indexed
    const nextKey   = nextYear * 12 + nextMonth;
    const pendingKey = Math.min(nextKey, nowKey);
    const pendingMonth = ((pendingKey - 1) % 12) + 1;
    return MONTH_SHORT[pendingMonth - 1];
  }
  return MONTH_SHORT[now.getMonth()];
}

export default async function SidebarWrapper() {
  const [documents, contracts, invoices, people, govDocs, leases, purchaseOrders, entitySetting, session, latestProcessedRun] = await Promise.all([
    prisma.document.count(),
    prisma.document.count({ where: { status: "extracted", docType: { in: ["employee_contract", "client_contract"] } } }),
    prisma.document.count({ where: { status: "extracted", docType: "invoice" } }),
    prisma.person.count(),
    prisma.document.count({ where: { status: "extracted", docType: { in: ["visa", "emirates_id", "labor_card", "trade_license", "government_permit"] } } }),
    prisma.document.count({ where: { status: "extracted", docType: "lease_contract" } }),
    prisma.document.count({ where: { status: "extracted", docType: "purchase_order" } }),
    prisma.setting.findUnique({ where: { key: "entityName" } }),
    auth(),
    prisma.payrollRun.findFirst({
      where: { isProcessed: true },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      select: { month: true, year: true },
    }),
  ]);

  const role = session?.user?.role ?? "viewer";
  const perms = resolvePermissions(role, session?.user?.permissions ?? null);

  const sidebarProps = {
    counts: { documents, contracts, invoices, people, govDocs, leases, purchaseOrders },
    entityName: entitySetting?.value || "OpsMind",
    userRole: role,
    userPermissions: perms,
    payrollMonth: pendingPayrollMonth(latestProcessedRun),
  };

  return (
    <>
      <div className="hidden md:block">
        <Sidebar {...sidebarProps} />
      </div>
      <MobileDrawerOverlay {...sidebarProps} />
    </>
  );
}
