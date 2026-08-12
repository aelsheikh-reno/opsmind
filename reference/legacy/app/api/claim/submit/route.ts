import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
    heic: "image/heic", heif: "image/heif",
  };
  return map[ext] ?? "application/octet-stream";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();

    const tokenId    = formData.get("tokenId") as string;
    const otp        = formData.get("otp") as string;
    const claimCount = parseInt(formData.get("claimCount") as string ?? "1", 10);

    if (!tokenId || !otp) return NextResponse.json({ error: "Missing token or OTP" }, { status: 400 });

    const token = await prisma.claimToken.findUnique({ where: { id: tokenId } });
    if (!token || token.used)         return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
    if (token.expiresAt < new Date()) return NextResponse.json({ error: "OTP has expired. Please restart." }, { status: 400 });
    if (token.otp !== otp)            return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 400 });

    await prisma.claimToken.update({ where: { id: tokenId }, data: { used: true } });

    const person = token.personId
      ? await prisma.person.findUnique({ where: { id: token.personId } })
      : null;

    const expenseIds: string[] = [];

    for (let i = 0; i < claimCount; i++) {
      const file = formData.get(`file_${i}`) as File | null;
      const metaRaw = formData.get(`meta_${i}`) as string | null;
      const meta = metaRaw ? JSON.parse(metaRaw) : {};

      if (!file) continue;

      const floatId = meta.pettyCashFloatId ?? null;
      const expense = await prisma.expense.create({
        data: {
          name:              meta.notes ? `${meta.notes} — ${person?.name ?? "Unknown"}` : `Claim — ${person?.name ?? "Unknown"}`,
          currency:          meta.currency || "AED",
          amount:            meta.amount   ? parseFloat(meta.amount) : null,
          dueOn:             meta.date     ? new Date(meta.date)     : null,
          notes:             meta.notes    || null,
          expenseType:       meta.expenseType || null,
          submitterEmail:    token.email,
          personId:          token.personId ?? null,
          claimStatus:       "pending",
          paymentMethod:     floatId ? "petty_cash" : null,
          pettyCashFloatId:  floatId,
        },
      });

      const buffer      = Buffer.from(await file.arrayBuffer());
      const contentType = file.type || mimeFromName(file.name);
      const storageKey  = await uploadFile(
        `expense-attachments/claims/${expense.id}/${Date.now()}-${file.name}`,
        buffer,
        contentType,
      );

      await prisma.expenseAttachment.create({
        data: {
          expenseId:   expense.id,
          name:        file.name,
          downloadUrl: storageKey,
          size:        buffer.length,
        },
      });

      expenseIds.push(expense.id);
    }

    return NextResponse.json({ ok: true, expenseIds });
  } catch (err) {
    console.error("[claim/submit]", err);
    return NextResponse.json({ error: "Submission failed. Please try again." }, { status: 500 });
  }
}
