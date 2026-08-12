import PageShell from "../components/PageShell";
import ComingSoon from "../components/ComingSoon";

export default function ContractIntelPage() {
  return (
    <PageShell
      crumbs={[{ label: "Reno Holdings" }, { label: "Insight" }, { label: "Contract intel" }]}
      title="Contract intel"
      subtitle="AI analysis of contract terms, obligations, and renewal leverage across all vendors."
    >
      <ComingSoon
        icon="🧠"
        description="OpsMind compares contract terms across vendors, flags unusual clauses, and surfaces renewal leverage points — so you negotiate from a position of knowledge."
      />
    </PageShell>
  );
}
