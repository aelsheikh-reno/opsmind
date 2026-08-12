import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  try {
    const { serviceId } = await params;
    const { name, description, status } = await req.json();

    if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });

    const last = await prisma.projectServiceActivity.findFirst({
      where: { serviceId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const activity = await prisma.projectServiceActivity.create({
      data: {
        serviceId,
        name: name.trim(),
        description: description?.trim() || null,
        status: status ?? "pending",
        order: last ? last.order + 1 : 0,
      },
    });

    return NextResponse.json(activity, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
