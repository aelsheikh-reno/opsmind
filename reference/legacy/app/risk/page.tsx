import PageShell from "../components/PageShell";
import ComingSoon from "../components/ComingSoon";

export default function RiskCenterPage() {
  return (
    <PageShell
      crumbs={[{ label: "Reno Holdings" }, { label: "Insight" }, { label: "Risk center" }]}
      title="Risk center"
      subtitle="AI-identified compliance risks, missing documents, and overdue renewals."
    >
      <ComingSoon
        icon="🛡️"
        description="OpsMind scans your documents for expired items, missing coverage gaps, and compliance issues — surfacing risks before they become problems."
      />
    </PageShell>
  );
}
