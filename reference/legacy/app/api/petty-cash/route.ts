import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { requireRead, requireWrite } from "@/lib/permissions";

export async function GET() {
  const denied = await requireRead("finances");
  if (denied) return denied;

  const floats = await prisma.pettyCashFloat.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      person: { select: { id: true, name: true } },
      expenses: { select: { amount: true, claimStatus: true } },
    },
  });

  return NextResponse.json(floats);
}

export async function POST(req: Request) {
  const denied = await requireWrite("finances");
  if (denied) return denied;

  const { personId, amount, currency, handedAt, note } = await req.json();
  if (!amount || !handedAt) {
    return NextResponse.json({ error: "amount and handedAt are required" }, { status: 400 });
  }

  const float = await prisma.pettyCashFloat.create({
    data: {
      personId: personId || null,
      amount: parseFloat(amount),
      currency: currency || "AED",
      handedAt: new Date(handedAt),
      note: note?.trim() || null,
    },
    include: { person: { select: { id: true, name: true } } },
  });

  return NextResponse.json(float, { status: 201 });
}
