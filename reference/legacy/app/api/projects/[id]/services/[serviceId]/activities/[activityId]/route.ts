import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { requireWrite } from "@/lib/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string; activityId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  try {
    const { activityId } = await params;
    const { name, description, status } = await req.json();

    const activity = await prisma.projectServiceActivity.update({
      where: { id: activityId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(status !== undefined && { status }),
      },
    });

    return NextResponse.json(activity);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; serviceId: string; activityId: string }> }
) {
  const denied = await requireWrite("projects");
  if (denied) return denied;

  try {
    const { activityId } = await params;
    await prisma.projectServiceActivity.delete({ where: { id: activityId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
