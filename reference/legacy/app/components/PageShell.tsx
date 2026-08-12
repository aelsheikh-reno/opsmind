import SidebarWrapper from "./SidebarWrapper";
import TopBar from "./TopBar";

type Crumb = { label: string; href?: string };

type PageShellProps = {
  crumbs: Crumb[];
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

export default function PageShell({ crumbs, title, subtitle, action, children }: PageShellProps) {
  // TopBar prepends the entity name itself, so skip the first crumb (entity name)
  const breadcrumb = crumbs.slice(1);

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      <SidebarWrapper />
      <div className="flex-1 overflow-y-auto flex flex-col">
        <TopBar breadcrumb={breadcrumb} />
        <main className="px-4 sm:px-8 py-4 sm:py-6 max-w-5xl">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
              {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
            </div>
            {action && <div>{action}</div>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
