import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Sidebar from "@/app/components/SidebarWrapper";
import TopBar from "@/app/components/TopBar";
import GoogleDriveSync from "./GoogleDriveSync";

export default async function GoogleDrivePage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="flex h-screen bg-surface-inset">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar breadcrumb={[{ label: "Google Drive" }]} />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            <Suspense fallback={<div className="text-sm text-gray-400 mt-8">Loading…</div>}>
              <GoogleDriveSync />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
