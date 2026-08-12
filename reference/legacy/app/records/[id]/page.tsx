import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { DOC_TYPE_LABELS, DOC_TYPE_COLORS } from "@/lib/doc-types";
import { formatDateTime, fmtDays } from "@/lib/format-date";
import Sidebar from "../../components/SidebarWrapper";
import TopBar from "../../components/TopBar";
import DeleteButton from "../../components/DeleteButton";
import PaymentScheduleEditor from "../../components/PaymentScheduleEditor";
import MarkInvoicePaidButton from "../../components/MarkInvoicePaidButton";
import InvoiceFileManager from "../../components/InvoiceFileManager";
import EditDateField from "../../components/EditDateField";
import EditPaidDateButton from "../../components/EditPaidDateButton";
import PartyChips from "../../components/PartyChips";
import EditableParties from "../../components/EditableParties";
import EditDocumentModal from "../../components/EditDocumentModal";
import EntityPicker from "../../components/EntityPicker";
import { getUsdRates, rateNote, getBestMonthRates } from "@/lib/fx";
import Money from "../../components/Money";
import ActivityTimeline from "../../components/ActivityTimeline";
import DocxViewer from "../../components/DocxViewer";
import { auth } from "@/auth";
import { resolvePermissions } from "@/lib/permissions";
import CreateProjectFromPOButton from "./CreateProjectFromPOButton";

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86400000);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <div className="text-sm text-gray-800">{children}</div>
    </div>
  );
}

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  const _perms = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null);
  const canWrite = ["contracts", "government", "invoices", "leases"].some(s => _perms[s as keyof typeof _perms] === "write");

  const [doc, liveRates] = await Promise.all([
    prisma.document.findUnique({
      where: { id },
      include: {
        alerts: { orderBy: { dueDate: "asc" } },
        paymentSchedules: {
          orderBy: { dueDate: "asc" },
          include: { invoice: { select: { id: true, filename: true, referenceNumber: true } } },
        },
        legalEntity: { select: { id: true, name: true } },
      },
    }),
    getUsdRates(),
  ]);

  if (!doc) notFound();

  // Compute best month rates for each unique month in the payment schedule
  const uniqueMonthKeys = [...new Set(
    doc.paymentSchedules.map(p => `${p.dueDate.getFullYear()}-${p.dueDate.getMonth() + 1}`)
  )];
  const monthRatesMap: Record<string, Record<string, number>> = {};
  await Promise.all(uniqueMonthKeys.map(async key => {
    const [year, month] = key.split("-").map(Number);
    monthRatesMap[key] = await getBestMonthRates(year, month);
  }));

  const parties: string[] = doc.parties ? JSON.parse(doc.parties) : [];
  const hasFile = !!doc.filePath;
  const fileUrl = `/api/documents/${doc.id}/file?v=${Date.now()}`;
  const isPdf = doc.mimeType === "application/pdf";
  const isImage = doc.mimeType.startsWith("image/");
  const isDocx =
    doc.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    doc.mimeType === "application/msword";

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <Sidebar />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Records", href: "/records" }, { label: doc.filename }]} />

        <main className="px-8 py-6">
          {/* Title row */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-start gap-3">
              <Link href="/records" className="mt-1 text-gray-400 hover:text-gray-600 transition-colors">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900 truncate max-w-lg">{doc.filename}</h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  Uploaded {formatDateTime(doc.createdAt)} · {doc.source}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {hasFile && (
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 bg-white border border-gray-200 hover:bg-surface-hover text-gray-700 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 2v7M4 6l3 4 3-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2 11h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  View original
                </a>
              )}
              {doc.docType === "invoice" && canWrite && (
                <MarkInvoicePaidButton documentId={doc.id} isPaid={doc.isPaid} variant="detail" />
              )}
              {canWrite && (
                <EditDocumentModal doc={{
                  id: doc.id,
                  filename: doc.filename,
                  docType: doc.docType,
                  parties,
                  referenceNumber: doc.referenceNumber,
                  issueDate: doc.issueDate ? doc.issueDate.toISOString().split("T")[0] : null,
                  expiryDate: doc.expiryDate ? doc.expiryDate.toISOString().split("T")[0] : null,
                  renewalDeadline: doc.renewalDeadline ? doc.renewalDeadline.toISOString().split("T")[0] : null,
                  amount: doc.amount,
                  currency: doc.currency,
                  paymentTerms: doc.paymentTerms,
                  summary: doc.summary,
                  notes: doc.notes,
                }} />
              )}
              <DeleteButton documentId={doc.id} redirectTo="/records" hidden={!canWrite} />
              {doc.docType === "purchase_order" && canWrite && (
                <CreateProjectFromPOButton
                  po={{
                    clientName: parties[0] ?? "",
                    contractValue: doc.amount,
                    currency: doc.currency,
                    startDate: doc.issueDate ? doc.issueDate.toISOString().split("T")[0] : null,
                    endDate: doc.expiryDate ? doc.expiryDate.toISOString().split("T")[0] : null,
                    description: doc.summary,
                    referenceNumber: doc.referenceNumber,
                  }}
                />
              )}
              {canWrite && (
                <Link
                  href="/"
                  className="flex items-center gap-1.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  Upload another
                </Link>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            {/* Left: extraction data */}
            <div className="col-span-2 space-y-4">

              {/* Type + status */}
              <div className="bg-white border border-surface-border rounded-xl p-5">
                <div className="flex items-center gap-3 mb-4">
                  {doc.docType && (
                    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${DOC_TYPE_COLORS[doc.docType] ?? DOC_TYPE_COLORS.other}`}>
                      {DOC_TYPE_LABELS[doc.docType] ?? doc.docType}
                    </span>
                  )}
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    doc.status === "extracted" ? "bg-green-50 text-green-700" :
                    doc.status === "manual"    ? "bg-indigo-50 text-indigo-700" :
                    doc.status === "failed"    ? "bg-red-50 text-red-700" :
                    "bg-blue-50 text-blue-700"
                  }`}>
                    {doc.status === "manual" ? "Manual entry" : doc.status}
                  </span>
                  {doc.confidence != null && (
                    <span className="text-xs text-gray-400">
                      {Math.round(doc.confidence * 100)}% confidence
                    </span>
                  )}
                </div>
                {doc.summary && (
                  <p className="text-sm text-gray-700 leading-relaxed">{doc.summary}</p>
                )}
              </div>

              {/* Key fields */}
              <div className="bg-white border border-surface-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-900 mb-4">Extracted fields</h2>
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  <div className="col-span-2">
                    <Field label="Parties">
                      <div className="mt-1">
                        <EditableParties documentId={doc.id} initialParties={parties} />
                      </div>
                    </Field>
                  </div>
                  {doc.docType === "invoice" && (
                    <div className="col-span-2">
                      <Field label="Issuing entity">
                        {canWrite
                          ? <EntityPicker
                              documentId={doc.id}
                              currentEntityId={doc.legalEntity?.id ?? null}
                              currentEntityName={doc.legalEntity?.name ?? null}
                            />
                          : <span className="text-sm text-gray-700">{doc.legalEntity?.name ?? "—"}</span>
                        }
                      </Field>
                    </div>
                  )}
                  {doc.referenceNumber && (
                    <Field label="Reference number">
                      <span className="font-mono">{doc.referenceNumber}</span>
                    </Field>
                  )}
                  <Field label="Issue date">
                    <EditDateField
                      documentId={doc.id}
                      field="issueDate"
                      value={doc.issueDate ? doc.issueDate.toISOString().split("T")[0] : null}
                    />
                  </Field>
                  <Field label="Expiry date">
                    <div className="flex items-center gap-2 flex-wrap">
                      <EditDateField
                        documentId={doc.id}
                        field="expiryDate"
                        value={doc.expiryDate ? doc.expiryDate.toISOString().split("T")[0] : null}
                      />
                      {doc.expiryDate && (() => {
                        const days = daysUntil(doc.expiryDate!);
                        const cls = days < 0 ? "text-red-600" : days < 30 ? "text-red-600" : days < 90 ? "text-amber-600" : "text-green-600";
                        return (
                          <span className={`text-xs font-medium ${cls}`}>
                            {days < 0 ? `Expired ${fmtDays(Math.abs(days))} ago` : `${fmtDays(days)} left`}
                          </span>
                        );
                      })()}
                    </div>
                  </Field>
                  {doc.docType === "invoice" ? (
                    <Field label="Paid date">
                      {canWrite ? (
                        <EditPaidDateButton
                          documentId={doc.id}
                          paidAt={doc.paidAt ? doc.paidAt.toISOString().split("T")[0] : null}
                        />
                      ) : (
                        <span className="text-sm text-gray-800">
                          {doc.paidAt
                            ? doc.paidAt.toISOString().split("T")[0]
                            : <span className="text-gray-400">—</span>}
                        </span>
                      )}
                    </Field>
                  ) : (
                    <Field label="Renewal deadline">
                      <div className="flex items-center gap-2 flex-wrap">
                        <EditDateField
                          documentId={doc.id}
                          field="renewalDeadline"
                          value={doc.renewalDeadline ? doc.renewalDeadline.toISOString().split("T")[0] : null}
                        />
                        {doc.renewalDeadline && (() => {
                          const daysLeft = daysUntil(doc.renewalDeadline!);
                          const isPast = daysLeft < 0;
                          const isUrgent = daysLeft >= 0 && daysLeft <= 14;
                          return (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                              isPast ? "bg-red-50 text-red-600" :
                              isUrgent ? "bg-amber-50 text-amber-600" :
                              "bg-gray-100 text-gray-500"
                            }`}>
                              {isPast
                                ? `${fmtDays(Math.abs(daysLeft))} overdue`
                                : daysLeft === 0 ? "Today"
                                : `${fmtDays(daysLeft)} remaining`}
                            </span>
                          );
                        })()}
                      </div>
                    </Field>
                  )}
                  {doc.amount != null && doc.currency != null && (
                    <Field label="Amount">
                      <Money
                        amount={doc.amount}
                        currency={doc.currency}
                        rates={liveRates}
                        align="left"
                      />
                      {doc.docType === "invoice" && doc.currency !== "USD" && (() => {
                        const note = rateNote(doc.currency, doc.fxRateSnapshot, liveRates);
                        return note ? <span className="block text-[10px] text-gray-400 mt-0.5">{note}</span> : null;
                      })()}
                    </Field>
                  )}
                  {doc.paymentTerms && (
                    <div className="col-span-2">
                      <Field label="Payment terms">{doc.paymentTerms}</Field>
                    </div>
                  )}
                  {doc.notes && (
                    <div className="col-span-2">
                      <Field label="Notes">{doc.notes}</Field>
                    </div>
                  )}
                </div>
              </div>


              {/* Payment schedule — not shown for invoices or permit/identity documents */}
              {doc.docType !== "invoice" && doc.docType !== "invoice_report" && doc.docType !== "government_permit" && doc.docType !== "visa" && doc.docType !== "emirates_id" && doc.docType !== "labor_card" && doc.docType !== "trade_license" && doc.docType !== "insurance" && <PaymentScheduleEditor
                documentId={doc.id}
                docType={doc.docType ?? null}
                rates={liveRates}
                monthRatesMap={monthRatesMap}
                canEdit={canWrite}
                initialSchedule={doc.paymentSchedules.map(p => ({
                  id: p.id,
                  dueDate: p.dueDate.toISOString(),
                  amount: p.amount,
                  currency: p.currency,
                  description: p.description,
                  scheduleType: p.scheduleType ?? "salary",
                  isPaid: p.isPaid,
                  invoiceId: p.invoiceId,
                  invoice: p.invoice ?? null,
                  fxRateSnapshot: p.fxRateSnapshot ?? null,
                }))}
              />}
            </div>

            {/* Right: file preview */}
            <div className="space-y-4">
              <div className="bg-white border border-surface-border rounded-xl p-5">
                <h2 className="text-sm font-semibold text-gray-900 mb-3">Original file</h2>
                {hasFile ? (
                  isPdf ? (
                    <div className="rounded-lg overflow-hidden border border-gray-200">
                      <iframe
                        src={fileUrl}
                        className="w-full h-96"
                        title={doc.filename}
                      />
                    </div>
                  ) : isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={fileUrl}
                      alt={doc.filename}
                      className="w-full rounded-lg border border-gray-200 object-contain max-h-96"
                    />
                  ) : isDocx ? (
                    <DocxViewer
                      src={`/api/documents/${doc.id}/docx-preview`}
                      filename={doc.filename}
                    />
                  ) : (
                    <div className="bg-surface-inset rounded-lg p-4 text-center">
                      <p className="text-xs text-gray-500">{doc.filename}</p>
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-block text-xs text-indigo-600 hover:underline"
                      >
                        Open file →
                      </a>
                    </div>
                  )
                ) : canWrite ? null : (
                  <div className="bg-surface-inset rounded-lg p-6 text-center">
                    <p className="text-xs text-gray-400">No file attached</p>
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-surface-border space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Type</span>
                    <span className="text-gray-600 font-mono">{doc.mimeType}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">Uploaded</span>
                    <span className="text-gray-600">{formatDateTime(doc.createdAt)}</span>
                  </div>
                </div>

                {canWrite && (
                  <InvoiceFileManager
                    documentId={doc.id}
                    hasFile={hasFile}
                    filename={doc.filename}
                  />
                )}
              </div>

              {/* Renewal reminders */}
              <div className="bg-white border border-surface-border rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-gray-900">Reminders</h2>
                  {doc.alerts.length > 0 && (
                    <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      {doc.alerts.filter(a => daysUntil(a.dueDate) >= 0).length} upcoming
                    </span>
                  )}
                </div>

                {doc.alerts.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-5 text-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-gray-300">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="text-xs text-gray-400">No reminders set</p>
                    <p className="text-[11px] text-gray-300 leading-relaxed">Auto-created when a renewal<br />deadline is detected</p>
                  </div>
                ) : (() => {
                  const upcoming = doc.alerts.filter(a => daysUntil(a.dueDate) >= 0).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
                  const past = doc.alerts.filter(a => daysUntil(a.dueDate) < 0).sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());
                  return (
                    <div className="space-y-1.5">
                      {upcoming.map((alert) => {
                        const days = daysUntil(alert.dueDate);
                        const isUrgent = days <= 14;
                        const isSoon = days <= 60;
                        return (
                          <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-lg border ${
                            isUrgent ? "bg-red-50 border-red-100" : isSoon ? "bg-amber-50 border-amber-100" : "bg-indigo-50 border-indigo-100"
                          }`}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className={`mt-0.5 shrink-0 ${isUrgent ? "text-red-500" : isSoon ? "text-amber-500" : "text-indigo-400"}`}>
                              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-gray-800 leading-snug">{alert.message}</p>
                              <p className="text-[11px] text-gray-400 mt-0.5">{alert.dueDate.toISOString().split("T")[0]}</p>
                            </div>
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 whitespace-nowrap ${
                              isUrgent ? "bg-red-100 text-red-700" : isSoon ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                            }`}>
                              {days === 0 ? "Today" : `${days}d`}
                            </span>
                          </div>
                        );
                      })}
                      {past.length > 0 && (
                        <>
                          {upcoming.length > 0 && (
                            <div className="flex items-center gap-2 pt-1 pb-0.5">
                              <div className="flex-1 h-px bg-surface-border" />
                              <span className="text-[10px] uppercase tracking-wide text-gray-400 font-medium">Past</span>
                              <div className="flex-1 h-px bg-surface-border" />
                            </div>
                          )}
                          {past.map((alert) => (
                            <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg border bg-surface-inset border-surface-border opacity-60">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-gray-400">
                                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                                <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                              </svg>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-gray-600 leading-snug">{alert.message}</p>
                                <p className="text-[11px] text-gray-400 mt-0.5">{alert.dueDate.toISOString().split("T")[0]}</p>
                              </div>
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 bg-gray-100 text-gray-400">done</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Activity timeline */}
              <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-border">
                  <h2 className="text-sm font-semibold text-gray-900">Activity</h2>
                </div>
                <ActivityTimeline entityId={doc.id} />
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
