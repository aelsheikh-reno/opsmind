import PageShell from "../../components/PageShell";
import ComingSoon from "../../components/ComingSoon";

export default function WhatsAppInboxPage() {
  return (
    <PageShell
      crumbs={[{ label: "Reno Holdings" }, { label: "Capture" }, { label: "WhatsApp inbox" }]}
      title="WhatsApp inbox"
      subtitle="Documents and messages forwarded to the OpsMind WhatsApp number."
    >
      <ComingSoon
        icon="💬"
        description="Forward any document photo, PDF, or message to +971 4 OPSMIND and it will appear here for AI extraction and filing."
      />
    </PageShell>
  );
}
