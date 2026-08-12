import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getValidToken, getExpenses, getExpenseDetail, ZohoExpense } from "@/lib/zoho-books";

function normalizeName(s: string): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function buildNotes(ze: ZohoExpense): string | null {
  const parts: string[] = [];

  if (ze.vendor_name) parts.push(`Vendor: ${ze.vendor_name}`);

  const items = ze.line_items ?? [];
  if (items.length > 1) {
    const lines = items.map(li => {
      const label = li.description
        ? `${li.account_name} – ${li.description}`
        : li.account_name;
      return `  • ${label}: ${ze.currency_code} ${li.amount.toFixed(2)}`;
    });
    parts.push(`Items:\n${lines.join("\n")}`);
  }

  if (ze.notes) parts.push(ze.notes);

  return parts.length > 0 ? parts.join("\n") : null;
}

export async function DELETE() {
  const { count } = await prisma.expense.deleteMany({
    where: { zohoExpenseId: { not: null } },
  });
  return NextResponse.json({ deleted: count });
}

export async function POST() {
  try {
  const conn = await prisma.zohoConnection.findFirst();
  if (!conn) return NextResponse.json({ error: "Zoho not connected" }, { status: 400 });

  // Load user-configured exclusion rules
  type ExcludeAccount = { id: string; name: string };
  const excludeAccounts: ExcludeAccount[] = (() => {
    try {
      const parsed = JSON.parse(conn.pullExcludeAccounts ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.map((v: unknown) =>
        typeof v === "string" ? { id: v, name: v } : (v as ExcludeAccount)
      );
    } catch { return []; }
  })();
  const excludePaymentModes: string[] = (() => {
    try { return JSON.parse(conn.pullExcludePaymentModes ?? "[]"); } catch { return []; }
  })();

  const excludeAccountIds   = new Set(excludeAccounts.map(a => a.id.toLowerCase()));
  const excludeAccountNames = new Set(excludeAccounts.map(a => a.name.toLowerCase()));
  const excludePaymentModeSet = new Set(excludePaymentModes.map(s => s.toLowerCase()));

  const { accessToken, updated } = await getValidToken(conn);
  if (updated) {
    await prisma.zohoConnection.update({
      where: { id: conn.id },
      data: { accessToken: updated.accessToken, expiresAt: updated.expiresAt },
    });
  }

  const zohoExpenses = await getExpenses(accessToken, conn.organizationId);

  // All existing expense zohoExpenseIds (already pushed from OpsMind)
  const existingZohoIds = new Set(
    (await prisma.expense.findMany({ where: { zohoExpenseId: { not: null } }, select: { zohoExpenseId: true } }))
      .map(e => e.zohoExpenseId!)
  );

  // All existing expenses for dedup by amount + normalized name
  const existingExpenses = await prisma.expense.findMany({
    where: { amount: { not: null } },
    select: { amount: true, name: true },
  });
  const existingKeys = new Set(
    existingExpenses.map(e => `${e.amount}|${normalizeName(e.name)}`)
  );

  let importedCount = 0;
  let skippedAlreadyTracked = 0;
  let skippedAsanaDup = 0;
  let skippedExcluded = 0;

  for (const ze of zohoExpenses) {
    // Skip if top-level account is in exclusion list (match by ID or name)
    const accountIdLower   = (ze.account_id   ?? "").toLowerCase();
    const accountNameLower = (ze.account_name ?? "").toLowerCase();
    if (excludeAccountIds.has(accountIdLower) || excludeAccountNames.has(accountNameLower)) {
      skippedExcluded++;
      continue;
    }

    // If account exclusion rules are configured, check line items too.
    // The list API does not return line_items, so fetch the full detail for every
    // expense that passes the top-level check to inspect its line items.
    if (excludeAccountIds.size > 0) {
      const detail = await getExpenseDetail(accessToken, conn.organizationId, ze.expense_id);
      if (detail) {
        const lineItems = detail.line_items ?? [];
        const hasExcludedItem = lineItems.some(li =>
          excludeAccountIds.has((li.account_id ?? "").toLowerCase()) ||
          excludeAccountNames.has((li.account_name ?? "").toLowerCase())
        );
        if (hasExcludedItem) {
          skippedExcluded++;
          continue;
        }
        // Use the richer detail data (includes line_items, used for notes)
        Object.assign(ze, detail);
      }
    }

    // Skip if payment mode is in exclusion list
    if (ze.payment_mode && excludePaymentModeSet.has(ze.payment_mode.toLowerCase())) {
      skippedExcluded++;
      continue;
    }

    // Skip if already pushed from OpsMind (zohoExpenseId match)
    if (existingZohoIds.has(ze.expense_id)) {
      skippedAlreadyTracked++;
      continue;
    }

    const amount = ze.total ?? ze.amount ?? 0;
    const name = normalizeName(ze.description || ze.account_name);

    // Dedup against Asana/existing expenses by amount + normalized name
    const key = `${amount}|${name}`;
    if (existingKeys.has(key)) {
      skippedAsanaDup++;
      continue;
    }

    // Import
    await prisma.expense.create({
      data: {
        name:          ze.description || ze.account_name,
        amount,
        currency:      ze.currency_code ?? "USD",
        dueOn:         ze.date ? new Date(ze.date) : null,
        notes:         buildNotes(ze),
        zohoExpenseId: ze.expense_id,
        expenseType:   ze.account_name,
        claimStatus:   null,
      },
    });

    existingKeys.add(key);
    importedCount++;
  }

  return NextResponse.json({
    imported:              importedCount,
    skippedAlreadyTracked,
    skippedAsanaDup,
    skippedExcluded,
    total:                 zohoExpenses.length,
  });
  } catch (err) {
    console.error("[pull-expenses]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
