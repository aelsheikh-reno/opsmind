import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const body = await req.json();
  // personId can be a string (assign) or null (unassign)
  const personId = body.personId === null ? null : typeof body.personId === "string" ? body.personId : undefined;
  if (personId === undefined) {
    return NextResponse.json({ error: "Invalid personId" }, { status: 400 });
  }

  const expense = await prisma.expense.update({
    where: { id },
    data: { personId },
    include: { person: { select: { id: true, name: true, jobTitle: true } } },
  });

  return NextResponse.json({ ok: true, person: expense.person });
}
