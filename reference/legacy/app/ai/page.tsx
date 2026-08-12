import PageShell from "../components/PageShell";
import ComingSoon from "../components/ComingSoon";

export default function AiAssistantPage() {
  return (
    <PageShell
      crumbs={[{ label: "Reno Holdings" }, { label: "Insight" }, { label: "AI assistant" }]}
      title="AI assistant"
      subtitle="Ask anything about your operations, contracts, or team in plain English or Arabic."
    >
      <ComingSoon
        icon="✨"
        description='Ask questions like "Which visas are expiring next month?" or "What are the payment terms in the Acme vendor contract?" — OpsMind answers from your actual documents.'
      />
    </PageShell>
  );
}
