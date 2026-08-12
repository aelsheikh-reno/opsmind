import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRead } from "@/lib/permissions";

export async function GET() {
  const denied = await requireRead("people");
  if (denied) return denied;

  const people = await prisma.person.findMany({
    select: { id: true, name: true, jobTitle: true, costPerHour: true, billingRate: true, rateCurrency: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ people });
}
