import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export type ExcludeAccount = { id: string; name: string };

function parseExcludeAccounts(raw: string | null): ExcludeAccount[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    // Support old format (string[]) and new format ({id,name}[])
    return parsed.map((v: unknown) =>
      typeof v === "string" ? { id: v, name: v } : (v as ExcludeAccount)
    );
  } catch { return []; }
}

export async function GET() {
  const conn = await prisma.zohoConnection.findFirst({
    select: { pullExcludeAccounts: true, pullExcludePaymentModes: true },
  });
  if (!conn) return NextResponse.json({ excludeAccounts: [], excludePaymentModes: [] });

  const excludePaymentModes: string[] = (() => {
    try { return JSON.parse(conn.pullExcludePaymentModes ?? "[]"); } catch { return []; }
  })();

  return NextResponse.json({
    excludeAccounts: parseExcludeAccounts(conn.pullExcludeAccounts),
    excludePaymentModes,
  });
}

export async function PATCH(req: NextRequest) {
  const conn = await prisma.zohoConnection.findFirst();
  if (!conn) return NextResponse.json({ error: "Zoho not connected" }, { status: 400 });

  const body = await req.json() as { excludeAccounts?: ExcludeAccount[]; excludePaymentModes?: string[] };

  await prisma.zohoConnection.update({
    where: { id: conn.id },
    data: {
      pullExcludeAccounts:     body.excludeAccounts     != null ? JSON.stringify(body.excludeAccounts)     : undefined,
      pullExcludePaymentModes: body.excludePaymentModes != null ? JSON.stringify(body.excludePaymentModes) : undefined,
    },
  });

  return NextResponse.json({ ok: true });
}
