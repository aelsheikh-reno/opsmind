import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

const INCLUDE_PERSON = { person: { select: { id: true, name: true, jobTitle: true } } } as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { memberId } = await params;
  const body = await req.json() as {
    hidden?: boolean;
    personId?: string | null;
    costPerHour?: number | null;
    billingRate?: number | null;
    currency?: string;
    allocationPercent?: number | null;
  };

  const data: Record<string, unknown> = {};
  if (body.hidden !== undefined) data.hidden = body.hidden;
  if ("costPerHour" in body) data.costPerHour = body.costPerHour ?? null;
  if ("billingRate" in body) data.billingRate = body.billingRate ?? null;
  if ("currency" in body) data.currency = body.currency;
  if ("allocationPercent" in body) data.allocationPercent = body.allocationPercent ?? 100;

  // Use relation connect/disconnect instead of raw personId FK
  if ("personId" in body) {
    data.person = body.personId ? { connect: { id: body.personId } } : { disconnect: true };
  }

  // When linking a person and no rates explicitly set, pull from Person
  if (body.personId && !("costPerHour" in body) && !("billingRate" in body)) {
    const p = await prisma.person.findUnique({
      where: { id: body.personId },
      select: { costPerHour: true, billingRate: true, rateCurrency: true },
    });
    if (p) {
      data.costPerHour = p.costPerHour ?? null;
      data.billingRate = p.billingRate ?? null;
      data.currency = p.rateCurrency ?? "AED";
    }
  }

  const member = await prisma.projectTeamMember.update({
    where: { id: memberId },
    data,
    include: INCLUDE_PERSON,
  });
  return NextResponse.json(member);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  const { memberId } = await params;
  await prisma.projectTeamMember.delete({ where: { id: memberId } });
  return NextResponse.json({ success: true });
}
