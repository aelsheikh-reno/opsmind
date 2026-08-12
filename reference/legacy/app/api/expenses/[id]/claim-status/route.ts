import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWrite } from "@/lib/permissions";
import { sendClaimStatusEmail } from "@/lib/email";
import { auth } from "@/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await requireWrite("finances");
    if (denied) return denied;
    const session = await auth();
    const reviewerName = session?.user?.name ?? undefined;

    const { id } = await params;
    const { status, note } = await req.json() as { status: "approved" | "rejected"; note?: string };

    if (!["approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const expense = await prisma.expense.findUnique({
      where: { id },
      select: { id: true, name: true, submitterEmail: true, claimStatus: true, pettyCashFloatId: true },
    });
    if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Petty cash claims: approval = cash was legitimately spent (auto-complete).
    // Rejection = cash may be returned or disputed (revert to incomplete).
    const completedUpdate = expense.pettyCashFloatId
      ? { completed: status === "approved" }
      : {};

    await prisma.expense.update({
      where: { id },
      data: { claimStatus: status, claimNote: note ?? null, ...completedUpdate },
    });

    if (expense.submitterEmail) {
      await sendClaimStatusEmail(expense.submitterEmail, status, note ?? null, reviewerName).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[claim-status]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
