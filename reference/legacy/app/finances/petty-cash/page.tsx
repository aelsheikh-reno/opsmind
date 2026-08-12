import { prisma } from "@/lib/prisma";
import { requireRead } from "@/lib/permissions";
import { redirect } from "next/navigation";
import SidebarWrapper from "@/app/components/SidebarWrapper";
import TopBar from "@/app/components/TopBar";
import PettyCashClient from "./PettyCashClient";

export const dynamic = "force-dynamic";

export default async function PettyCashPage() {
  const denied = await requireRead("finances");
  if (denied) redirect("/");

  const [floats, people] = await Promise.all([
    prisma.pettyCashFloat.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        person: { select: { id: true, name: true } },
        expenses: {
          select: {
            id: true,
            amount: true,
            currency: true,
            claimStatus: true,
            claimNote: true,
            dueOn: true,
            expenseType: true,
            notes: true,
            attachments: { select: { id: true, name: true, downloadUrl: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.person.findMany({
      where: { exitDate: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Finance" }, { label: "Petty Cash" }]} />
        <main className="p-4 sm:p-6 max-w-5xl w-full">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-gray-900">Petty Cash</h1>
            <p className="text-sm text-gray-400 mt-0.5">Track cash handed to employees and reconcile submitted receipts.</p>
          </div>
          <PettyCashClient
            floats={floats.map(f => ({
              ...f,
              handedAt: f.handedAt.toISOString(),
              createdAt: f.createdAt.toISOString(),
              updatedAt: f.updatedAt.toISOString(),
              expenses: f.expenses.map(e => ({
                ...e,
                dueOn: e.dueOn?.toISOString() ?? null,
              })),
            }))}
            people={people}
          />
        </main>
      </div>
    </div>
  );
}
