import PageShell from "../components/PageShell";
import ComingSoon from "../components/ComingSoon";

export default function OperationsPage() {
  return (
    <PageShell
      crumbs={[{ label: "Reno Holdings" }, { label: "Operate" }, { label: "All operations" }]}
      title="All operations"
      subtitle="Every active item across contracts, renewals, invoices, and compliance."
    >
      <ComingSoon
        icon="📋"
        description="A unified timeline of all operational items — sortable, filterable, and searchable across every document type."
      />
    </PageShell>
  );
}
