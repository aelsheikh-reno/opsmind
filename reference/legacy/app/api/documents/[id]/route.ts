import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { deleteFile } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { requireAnyRecordsWrite } from "@/lib/permissions";
import { auth } from "@/auth";

function isoDate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().split("T")[0] : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [denied, session] = await Promise.all([requireAnyRecordsWrite(), auth()]);
  if (denied) return denied;
  const auditUser = { userId: session?.user?.id ?? null, userName: session?.user?.name ?? null };

  const { id } = await params;
  const body = await request.json();

  const before = await prisma.document.findUnique({
    where: { id },
    select: { filename: true, docType: true, issueDate: true, expiryDate: true, renewalDeadline: true, parties: true, referenceNumber: true, summary: true, amount: true, currency: true, paymentTerms: true, notes: true, poStatus: true },
  });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, Date | string | number | null> = {};
  if ("issueDate" in body) data.issueDate = body.issueDate ? new Date(body.issueDate) : null;
  if ("renewalDeadline" in body) data.renewalDeadline = body.renewalDeadline ? new Date(body.renewalDeadline) : null;
  if ("parties" in body) data.parties = Array.isArray(body.parties) ? JSON.stringify(body.parties) : null;
  if ("docType" in body && body.docType) data.docType = body.docType;
  if ("filename" in body && body.filename?.trim()) data.filename = body.filename.trim();
  if ("referenceNumber" in body) data.referenceNumber = body.referenceNumber ?? null;
  if ("summary" in body) data.summary = body.summary ?? null;
  if ("amount" in body) data.amount = body.amount != null ? Number(body.amount) : null;
  if ("currency" in body) data.currency = body.currency ?? null;
  if ("paymentTerms" in body) data.paymentTerms = body.paymentTerms ?? null;
  if ("notes" in body) data.notes = body.notes ?? null;
  if ("legalEntityId" in body) data.legalEntityId = body.legalEntityId ?? null;
  if ("poStatus" in body && ["open", "closed", "archived"].includes(body.poStatus)) data.poStatus = body.poStatus;

  if ("expiryDate" in body) {
    const newExpiry = body.expiryDate ? new Date(body.expiryDate) : null;
    data.expiryDate = newExpiry;
    // Auto-recalculate renewal deadline (90 days before expiry) when expiry changes,
    // unless the caller also explicitly set a new renewalDeadline in this same request
    if (!("renewalDeadline" in body)) {
      if (newExpiry) {
        const deadline = new Date(newExpiry);
        deadline.setDate(deadline.getDate() - 90);
        data.renewalDeadline = deadline;
      } else {
        data.renewalDeadline = null;
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const doc = await prisma.document.update({ where: { id }, data });

  // Keep the linked employee's contractEnd in sync when expiryDate changes on their contract
  if ("expiryDate" in data && (doc.docType === "employee_contract" || before.docType === "employee_contract")) {
    const newExpiry = data.expiryDate as Date | null;
    await prisma.person.updateMany({
      where: { documentId: id },
      data: { contractEnd: newExpiry },
    });
  }

  // Build diff for audit log
  const changes: Record<string, unknown> = {};

  if ("issueDate" in data) {
    const from = isoDate(before.issueDate);
    const to = isoDate(doc.issueDate);
    if (from !== to) changes.issueDate = { from, to };
  }
  if ("expiryDate" in data) {
    const from = isoDate(before.expiryDate);
    const to = isoDate(doc.expiryDate);
    if (from !== to) changes.expiryDate = { from, to };
  }
  if ("renewalDeadline" in data || "expiryDate" in data) {
    const from = isoDate(before.renewalDeadline);
    const to = isoDate(doc.renewalDeadline);
    if (from !== to) changes.renewalDeadline = { from, to };
  }
  if ("parties" in data) {
    const parse = (p: string | null): string[] => { try { return p ? JSON.parse(p) : []; } catch { return []; } };
    const oldP = parse(before.parties);
    const newP = parse(doc.parties);
    const added   = newP.filter(p => !oldP.includes(p));
    const removed = oldP.filter(p => !newP.includes(p));
    if (added.length > 0 || removed.length > 0) changes.parties = { added, removed };
  }
  for (const f of ["docType", "filename", "referenceNumber", "summary", "amount", "currency", "paymentTerms", "notes"] as const) {
    if (f in data && before[f] !== doc[f]) changes[f] = { from: before[f] ?? null, to: doc[f] ?? null };
  }

  if (Object.keys(changes).length > 0) {
    const onlyParties = Object.keys(changes).every(k => k === "parties");
    const action = onlyParties ? "document.parties_updated" : "document.updated";
    await audit({ action, entityType: "document", entityId: id, entityLabel: before.filename, details: { changes }, ...auditUser });
  }

  return NextResponse.json({ ok: true, issueDate: doc.issueDate, expiryDate: doc.expiryDate, renewalDeadline: doc.renewalDeadline, parties: doc.parties });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireAnyRecordsWrite();
  if (denied) return denied;

  const { id } = await params;

  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      projectLinks: {
        select: {
          id: true,
          projectId: true,
          milestoneId: true,
          serviceId: true,
        },
      },
    },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Explicitly remove all project document links (milestone or service) before deletion.
  // onDelete: Cascade in the schema also covers this at DB level, but we do it explicitly
  // so the intent is clear and the affected project IDs are known.
  const linkedProjectIds = doc.projectLinks
    .filter(l => l.milestoneId != null || l.serviceId != null)
    .map(l => l.projectId);

  if (doc.projectLinks.length > 0) {
    await prisma.projectDocumentLink.deleteMany({ where: { documentId: id } });
  }

  if (doc.filePath) {
    await deleteFile(doc.filePath).catch(() => {}); // file already gone — continue
  }

  // onDelete: Cascade on Alert handles associated alerts
  await prisma.document.delete({ where: { id } });

  return NextResponse.json({ success: true, unlinkedProjectIds: linkedProjectIds });
}
