import SidebarWrapper from "../../components/SidebarWrapper";
import TopBar from "../../components/TopBar";
import NewContractForm from "./NewContractForm";

export default function NewContractPage() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Documents & renewals", href: "/records" }, { label: "New record" }]} />
        <NewContractForm />
      </div>
    </div>
  );
}
