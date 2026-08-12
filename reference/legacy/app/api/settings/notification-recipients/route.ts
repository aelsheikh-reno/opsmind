import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const recipients = await prisma.notificationRecipient.findMany({
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(recipients);
}

export async function POST(req: Request) {
  const { email, name } = await req.json();
  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "email required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }
  try {
    const recipient = await prisma.notificationRecipient.create({
      data: { email: email.trim().toLowerCase(), name: name?.trim() || null },
    });
    return NextResponse.json(recipient);
  } catch {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }
}
