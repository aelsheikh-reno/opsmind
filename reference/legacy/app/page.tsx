import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { resolvePermissions, RECORD_SECTIONS } from "@/lib/permissions";
import Sidebar from "./components/SidebarWrapper";
import TopBar from "./components/TopBar";
import AddToOpsMindTabs from "./components/AddToOpsMindTabs";

export default async function AddToOpsMindPage() {
  const session = await auth();
  const perms = resolvePermissions(session?.user?.role ?? "viewer", session?.user?.permissions ?? null);
  const canUpload = RECORD_SECTIONS.some(s => perms[s] === "write");
  if (!canUpload) redirect("/dashboard");

  const canSettings = perms.settings !== "none";

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <Sidebar />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={[{ label: "Add to OpsMind" }]} />
        <main className="px-4 sm:px-8 py-4 sm:py-6">
          <div className="mb-6 max-w-3xl">
            <h1 className="text-2xl font-bold text-gray-900">Add to OpsMind</h1>
            <p className="text-sm text-gray-500 mt-1">
              Upload a file or sync from a source — AI extracts the key fields automatically.
            </p>
          </div>
          <AddToOpsMindTabs canSettings={canSettings} />
        </main>
      </div>
    </div>
  );
}
