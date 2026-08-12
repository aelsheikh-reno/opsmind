import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

const INCLUDE_PERSON = { person: { select: { id: true, name: true, jobTitle: true } } } as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { id: projectId } = await params;
  const { name, personId, costPerHour, billingRate, currency, hidden, allocationPercent } = await req.json() as {
    name: string;
    personId?: string | null;
    costPerHour?: number | null;
    billingRate?: number | null;
    currency?: string;
    hidden?: boolean;
    allocationPercent?: number | null;
  };

  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

  // If linking to a person and no rates provided, pull from Person record
  let resolvedCost = costPerHour ?? null;
  let resolvedBilling = billingRate ?? null;
  let resolvedCurrency = currency ?? "AED";
  if (personId && resolvedCost == null && resolvedBilling == null) {
    const p = await prisma.person.findUnique({
      where: { id: personId },
      select: { costPerHour: true, billingRate: true, rateCurrency: true },
    });
    if (p) {
      resolvedCost = p.costPerHour ?? null;
      resolvedBilling = p.billingRate ?? null;
      resolvedCurrency = p.rateCurrency ?? "AED";
    }
  }

  const member = await prisma.projectTeamMember.upsert({
    where: { projectId_name: { projectId, name } },
    create: {
      projectId,
      name,
      personId: personId ?? null,
      costPerHour: resolvedCost,
      billingRate: resolvedBilling,
      currency: resolvedCurrency,
      hidden: hidden === true,
      allocationPercent: allocationPercent ?? 100,
    },
    update: {
      ...(personId !== undefined ? { person: personId ? { connect: { id: personId } } : { disconnect: true } } : {}),
      costPerHour: resolvedCost,
      billingRate: resolvedBilling,
      currency: resolvedCurrency,
      ...(hidden !== undefined ? { hidden } : {}),
      ...(allocationPercent !== undefined ? { allocationPercent: allocationPercent ?? 100 } : {}),
    },
    include: INCLUDE_PERSON,
  });

  return NextResponse.json(member);
}
