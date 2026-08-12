import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppTemplate } from "@/lib/whatsapp";
import { requireWrite } from "@/lib/permissions";

export async function POST() {
  const denied = await requireWrite("settings");
  if (denied) return denied;

  const phoneSetting = await prisma.setting.findUnique({ where: { key: "whatsappPhone" } });
  if (!phoneSetting?.value) {
    return NextResponse.json({ error: "No WhatsApp number configured" }, { status: 400 });
  }

  try {
    await sendWhatsAppTemplate(phoneSetting.value, "hello_world");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[whatsapp/test]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
