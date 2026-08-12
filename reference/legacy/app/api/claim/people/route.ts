import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const people = await prisma.person.findMany({
    where: { exitDate: null },
    select: {
      id: true,
      name: true,
      email: true,
      pettyCashFloats: {
        where: { status: "open" },
        select: { id: true, amount: true, currency: true, handedAt: true, note: true },
        orderBy: { handedAt: "desc" },
      },
    },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(people);
}
