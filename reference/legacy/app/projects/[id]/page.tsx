import { prisma } from "@/lib/prisma";
import { requireRead } from "@/lib/permissions";
import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import { getUsdRates } from "@/lib/fx";
import SidebarWrapper from "@/app/components/SidebarWrapper";
import TopBar from "@/app/components/TopBar";
import ProjectDetailClient from "./ProjectDetailClient";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const denied = await requireRead("projects");
  if (denied) redirect("/");

  const { id } = await params;

  const session = await auth();
  const perms = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null);
  const canWrite = perms.projects === "write";

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, country: true, currency: true } },
      milestones: {
        orderBy: { order: "asc" },
        include: {
          invoices: { orderBy: { createdAt: "desc" } },
        },
      },
      timesheets: {
        orderBy: { month: "desc" },
        include: {
          entries: {
            include: {
              milestone: { select: { id: true, name: true } },
              service: { select: { id: true, name: true } },
            },
          },
        },
      },
      teamMembers: {
        orderBy: { createdAt: "asc" },
        include: { person: { select: { id: true, name: true, jobTitle: true } } },
      },
      services: {
        orderBy: { order: "asc" },
        include: { activities: { orderBy: { order: "asc" } } },
      },
      expenses: { orderBy: { date: "desc" } },
      invoices: {
        orderBy: { createdAt: "desc" },
        include: {
          milestone: { select: { id: true, name: true } },
          service: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!project) notFound();

  const fxRates = await getUsdRates();

  const serialised = {
    ...project,
    client: project.client ?? null,
    startDate: project.startDate?.toISOString() ?? null,
    endDate: project.endDate?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    milestones: project.milestones.map(m => ({
      ...m,
      startDate: m.startDate?.toISOString() ?? null,
      dueDate: m.dueDate?.toISOString() ?? null,
      completedAt: m.completedAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      invoices: m.invoices.map(i => ({
        ...i,
        issuedAt: i.issuedAt?.toISOString() ?? null,
        dueDate: i.dueDate?.toISOString() ?? null,
        paidAt: i.paidAt?.toISOString() ?? null,
        createdAt: i.createdAt.toISOString(),
      })),
    })),
    teamMembers: project.teamMembers.map(m => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
    services: project.services.map(s => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      activities: s.activities.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })),
    })),
    timesheets: project.timesheets.map(t => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
    expenses: project.expenses.map(e => ({
      ...e,
      date: e.date.toISOString(),
      createdAt: e.createdAt.toISOString(),
    })),
    invoices: project.invoices.map(i => ({
      ...i,
      issuedAt: i.issuedAt?.toISOString() ?? null,
      dueDate: i.dueDate?.toISOString() ?? null,
      paidAt: i.paidAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
    })),
  };

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar
          breadcrumb={[
            { label: "Project Intelligence", href: "/projects" },
            { label: project.name },
          ]}
        />
        <main className="p-4 sm:p-6 max-w-6xl w-full">
          <ProjectDetailClient project={serialised} canWrite={canWrite} fxRates={fxRates} />
        </main>
      </div>
    </div>
  );
}
