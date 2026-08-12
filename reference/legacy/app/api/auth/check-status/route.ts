import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    if (!email) return NextResponse.json({ deactivated: false });

    const user = await prisma.user.findUnique({
      where: { email: String(email) },
      select: { isActive: true },
    });

    return NextResponse.json({ deactivated: user ? !user.isActive : false });
  } catch {
    return NextResponse.json({ deactivated: false });
  }
}
