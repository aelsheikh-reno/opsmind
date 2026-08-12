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
  if (typeof body.completed !== "boolean") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const expense = await prisma.expense.update({
    where: { id },
    data: { completed: body.completed },
  });

  return NextResponse.json({ ok: true, completed: expense.completed });
}
