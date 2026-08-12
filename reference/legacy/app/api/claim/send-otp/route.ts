import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendOtpEmail } from "@/lib/email";

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: NextRequest) {
  try {
    const { personId, name } = await req.json();

    let email: string;
    let displayName: string;

    if (personId) {
      const person = await prisma.person.findUnique({ where: { id: personId } });
      if (!person) return NextResponse.json({ error: "Person not found" }, { status: 404 });
      if (!person.email) return NextResponse.json({ error: "No email registered for this person. Contact your admin." }, { status: 400 });
      email = person.email;
      displayName = person.name;
    } else {
      // "Name not listed" — they provided a free-text name; no OTP possible without email
      return NextResponse.json({ error: "Please select your name from the list to receive an OTP." }, { status: 400 });
    }

    // Invalidate any previous unused tokens for this email
    await prisma.claimToken.updateMany({
      where: { email, used: false },
      data: { used: true },
    });

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    const token = await prisma.claimToken.create({
      data: { email, personId, otp, expiresAt },
    });

    await sendOtpEmail(email, otp, displayName);

    return NextResponse.json({ tokenId: token.id, maskedEmail: email.replace(/(.{2}).+(@.+)/, "$1***$2") });
  } catch (err) {
    console.error("[send-otp]", err);
    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
  }
}
