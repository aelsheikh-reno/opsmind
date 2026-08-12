import { prisma } from "@/lib/prisma";
import { requireRead } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import SidebarWrapper from "@/app/components/SidebarWrapper";
import TopBar from "@/app/components/TopBar";
import ProjectsClient from "./ProjectsClient";
import { getUsdRates } from "@/lib/fx";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const denied = await requireRead("projects");
  if (denied) redirect("/");

  const session = await auth();
  const perms = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null);
  const canWrite = perms.projects === "write";

  const [projects, fxRates] = await Promise.all([
    prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      milestones: { orderBy: { order: "asc" }, select: { id: true, name: true, completedAt: true, billingAmount: true, billingPercent: true } },
      invoices: { select: { amount: true, currency: true, status: true } },
      documentLinks: {
        select: {
          milestoneId: true,
          serviceId: true,
          document: { select: { amount: true, isPaid: true, currency: true } },
        },
      },
      timesheets: {
        include: {
          entries: { select: { hoursLogged: true, hourlyRate: true, currency: true, employeeName: true } },
        },
      },
      expenses: { select: { amount: true, currency: true } },
      teamMembers: { select: { name: true, costPerHour: true, currency: true, hidden: true } },
    },
  }),
    getUsdRates(),
  ]);

  const serialised = projects.map(p => ({
    ...p,
    startDate: p.startDate?.toISOString() ?? null,
    endDate: p.endDate?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    timesheets: p.timesheets.map(t => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
    milestones: p.milestones.map(m => ({
      ...m,
      completedAt: m.completedAt?.toISOString() ?? null,
    })),
    invoices: p.invoices,
    documentLinks: p.documentLinks.map(l => ({ milestoneId: l.milestoneId, serviceId: l.serviceId, document: l.document })),
    expenses: p.expenses,
    teamMembers: p.teamMembers,
  }));

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Project Intelligence" }]} />
        <main className="p-4 sm:p-6 max-w-6xl w-full">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-gray-900">Project Intelligence</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Track project budgets, timesheets, milestones, and invoicing.
            </p>
          </div>
          <ProjectsClient projects={serialised} canWrite={canWrite} fxRates={fxRates} />
        </main>
      </div>
    </div>
  );
}
