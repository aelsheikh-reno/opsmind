"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SidebarCounts = {
  documents: number;
  contracts: number;
  invoices: number;
  people: number;
  govDocs: number;
  leases: number;
  purchaseOrders: number;
};

export type SidebarProps = {
  counts: SidebarCounts;
  entityName?: string;
  userRole?: string;
  userPermissions?: Record<string, string>;
  payrollMonth?: string;
  onClose?: () => void;
};

type NavItem = {
  label: string;
  href?: string; // optional — if absent the item is a non-navigable group label
  icon: React.ReactNode;
  badge?: string | number;
  badgeVariant?: "count" | "ai" | "month";
  hasPlus?: boolean;
  permSection?: string;
  permSections?: string[];
  requireWrite?: boolean;
  children?: Omit<NavItem, "children">[];
};

type NavSection = {
  title: string;
  items: NavItem[];
};

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function CommandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1" y="4" width="14" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.7" />
      <path d="M4 8h2M7 8h2M10 8h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
      <circle cx="4.5" cy="8" r="1" fill="currentColor" opacity="0.7" />
      <path d="M8 6v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1" y="3" width="14" height="2" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="1" y="7" width="14" height="2" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="1" y="11" width="14" height="2" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M5 1v4M11 1v4M1 7h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function SimulatorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <polyline points="1,13 5,8 8,10 11,5 15,3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" fill="none" />
      <path d="M12 3h3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

function PlusCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}


function DriveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M7.5 2L2 12l2.5 2 2.5-4z" fill="#0F9D58" opacity="0.85" />
      <path d="M8.5 2L14 12l-2.5 2-2.5-4z" fill="#4285F4" opacity="0.85" />
      <path d="M8 2L4 10h8L8 2z" fill="#FBBC05" opacity="0.9" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <circle cx="8" cy="8" r="7" fill="#25D366" />
      <path d="M8 3.5a4.5 4.5 0 0 1 3.9 6.75l.6 2.25-2.3-.6A4.5 4.5 0 1 1 8 3.5z" fill="white" />
      <path d="M6.5 7c.1-.2.5-.8.9-.8.2 0 .3.1.4.2l.5 1.1c.05.1 0 .25-.1.35l-.3.3c.3.55.8 1 1.35 1.25l.3-.3c.1-.1.25-.15.35-.1l1.1.5c.15.05.2.2.15.35-.2.5-.7.9-1.3.9C8 10.75 5.25 8 5.25 5.75c0-.6.4-1.1.9-1.3.15-.05.3 0 .35.15z" fill="#25D366" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M3 2h7l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M10 2v4h4" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
    </svg>
  );
}

function ContractIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M3 2h7l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M5 7h6M5 9.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function GovIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M8 1l7 4H1l7-4z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <rect x="2" y="6" width="2" height="6" rx="0.5" fill="currentColor" opacity="0.7" />
      <rect x="7" y="6" width="2" height="6" rx="0.5" fill="currentColor" opacity="0.7" />
      <rect x="12" y="6" width="2" height="6" rx="0.5" fill="currentColor" opacity="0.7" />
      <rect x="1" y="13" width="14" height="1.5" rx="0.5" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function InvoiceIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M2 2h12v12l-2-1-2 1-2-1-2 1-2-1V2z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M5 6h6M5 8.5h6M5 11h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <circle cx="6" cy="5" r="3" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M1 14c0-3 2-5 5-5s5 2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <path d="M11 7c1.5.5 3 2 3 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.5" />
      <circle cx="11" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.5" />
    </svg>
  );
}

function PayrollIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M8 5v1.5m0 3V11m-2-2.5h3.5a1 1 0 0 0 0-2H6.5a1 1 0 0 1 0-2H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M8 1l1.5 4.5L14 7l-4.5 1.5L8 13l-1.5-4.5L2 7l4.5-1.5L8 1z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M8 1l6 2.5v5C14 11 11.5 13.5 8 15c-3.5-1.5-6-4-6-6.5v-5L8 1z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
    </svg>
  );
}

function BrainIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M6 13c-2.5 0-4-1.5-4-3.5 0-1 .5-1.8 1.2-2.3C3 6.8 3 6.4 3 6c0-2 1.5-3.5 3-3.5.5 0 1 .15 1.4.4C7.8 2.3 8.4 2 9 2c1.5 0 3 1.5 3 3.5v.5c.8.5 1 1.3 1 2 0 2-1.5 3-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M8 8v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}



function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M2 14V7.5l6-5 6 5V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M6 15v-5h4v5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M3 1h10v13l-1.5-1L10 14l-1.5-1L7 14l-1.5-1L4 14l-1.5-1L1 14V1h2z" stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.7" />
      <path d="M5 5h6M5 7.5h6M5 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function PurchaseOrderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M3 2h7l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M5 7h6M5 9.5h4M5 12h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
      <circle cx="11.5" cy="11.5" r="2.5" fill="currentColor" opacity="0.15" />
      <path d="M10.5 11.5h2M11.5 10.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

function TrendingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path d="M1 12l4-4 3 3 4-5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <path d="M11 4h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <circle cx="5.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M1 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.7" />
      <circle cx="11.5" cy="4.5" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" opacity="0.5" />
      <path d="M13.5 11.5c0-1.5-1-2.5-2.5-2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" opacity="0.5" />
    </svg>
  );
}

function TaxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M4.5 8h3M4.5 10.5h2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10 6.5l1.5 4M11.5 6.5L10 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 5h13" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function PettyCashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <circle cx="8" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
      <path d="M4 4V3a3 3 0 0 1 6 0v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

function BudgetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1" y="3" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.8" />
      <path d="M1 6.5h14" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
      <rect x="4" y="9" width="3" height="2" rx="0.6" fill="currentColor" opacity="0.7" />
      <rect x="9" y="9" width="3" height="2" rx="0.6" fill="currentColor" opacity="0.4" />
    </svg>
  );
}

function AllocationIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.7" />
      <path d="M5 2v12" stroke="currentColor" strokeWidth="1.3" opacity="0.4" />
      <rect x="6" y="5" width="5" height="2" rx="0.7" fill="currentColor" opacity="0.7" />
      <rect x="6" y="9" width="3" height="2" rx="0.7" fill="currentColor" opacity="0.5" />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <rect x="1" y="3" width="14" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.7" />
      <path d="M5 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
      <path d="M4 8h8M4 11h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.7" />
      <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function Badge({ children, variant }: { children: React.ReactNode; variant?: "count" | "ai" | "month" }) {
  if (variant === "ai") {
    return <span className="ml-auto text-[10px] font-semibold text-indigo-500 tracking-wide">AI</span>;
  }
  if (variant === "month") {
    return <span className="ml-auto text-[10px] font-medium text-gray-400 tabular-nums">{children}</span>;
  }
  return (
    <span className="ml-auto text-[10px] font-medium text-gray-400 tabular-nums">
      {children}
    </span>
  );
}

function buildSections(counts: SidebarCounts, userRole: string, perms: Record<string, string>, payrollMonth: string): NavSection[] {
  const allowed = (section: string) => (perms[section] ?? "none") !== "none";

  const raw: NavSection[] = [
    {
      title: "OPERATE",
      items: [
        { label: "Command Center", href: "/executive", icon: <CommandIcon /> },
        { label: "Dashboard", href: "/dashboard", icon: <GridIcon /> },
        { label: "Project Intelligence", href: "/projects", icon: <ProjectsIcon />, permSection: "projects" },
        { label: "All operations", href: "/operations", icon: <ListIcon /> },
        { label: "Calendar", href: "/calendar", icon: <CalendarIcon /> },
        { label: "Simulator", href: "/simulator", icon: <SimulatorIcon /> },
      ],
    },
    {
      title: "CAPTURE",
      items: [
        { label: "Add to OpsMind", href: "/", icon: <PlusCircleIcon />, badge: "AI", badgeVariant: "ai", requireWrite: true  },
        { label: "WhatsApp inbox", href: "/inbox/whatsapp", icon: <WhatsAppIcon /> },
        { label: "Google Drive", href: "/integrations/google-drive", icon: <DriveIcon /> },
      ],
    },
    {
      title: "RECORDS",
      items: [
        {
          label: "Documents & renewals",
          // Only link to the all-documents page when user can see all 5 sections.
          // Partial access → no parent link; user navigates via children only.
          href: ["contracts", "government", "invoices", "leases", "purchase_orders"].every(s => allowed(s)) ? "/records" : undefined,
          icon: <FileIcon />,
          badge: counts.documents,
          badgeVariant: "count",
          permSections: ["contracts", "government", "invoices", "leases", "purchase_orders"],
          children: [
            { label: "Contracts", href: "/records/contracts", icon: <ContractIcon />, badge: counts.contracts, badgeVariant: "count", permSection: "contracts" },
            { label: "Rentals & Leases", href: "/records/leases", icon: <HomeIcon />, badge: counts.leases, badgeVariant: "count", permSection: "leases" },
            { label: "Invoices", href: "/records/invoices", icon: <InvoiceIcon />, badge: counts.invoices, badgeVariant: "count", permSection: "invoices" },
            { label: "Purchase Orders", href: "/records/purchase-orders", icon: <PurchaseOrderIcon />, badge: counts.purchaseOrders, badgeVariant: "count", permSection: "purchase_orders" },
            { label: "Governmental docs", href: "/records/government", icon: <GovIcon />, badge: counts.govDocs, badgeVariant: "count", permSection: "government" },
          ],
        },
      ],
    },
    {
      title: "TEAM",
      items: [
        { label: "People", href: "/people", icon: <PeopleIcon />, badge: counts.people, badgeVariant: "count", permSection: "people" },
        { label: "Payroll", href: "/payroll", icon: <PayrollIcon />, badge: payrollMonth, badgeVariant: "month", permSection: "payroll" },
        { label: "Allocation", href: "/resources", icon: <AllocationIcon />, permSection: "people" },
      ],
    },
    {
      title: "FINANCE",
      items: [
        { label: "Commitments", href: "/finances", icon: <TrendingIcon />, permSection: "finances" },
        { label: "Budgets", href: "/budgets", icon: <BudgetIcon />, permSection: "finances" },
        { label: "Claims & Expenses", href: "/expenses", icon: <ReceiptIcon />, permSection: "finances" },
        { label: "Petty Cash", href: "/finances/petty-cash", icon: <PettyCashIcon />, permSection: "finances" },
        { label: "VAT", href: "/vat", icon: <TaxIcon />, permSection: "finances" },
        { label: "Taxes", href: "/taxes", icon: <TaxIcon />, permSection: "finances" },
      ],
    },
    {
      title: "INSIGHT",
      items: [
        { label: "AI assistant", href: "/ai", icon: <SparkleIcon />, badge: "AI", badgeVariant: "ai" },
        { label: "Risk center", href: "/risk", icon: <ShieldIcon />, badge: "AI", badgeVariant: "ai" },
        { label: "Contract intel", href: "/intel", icon: <BrainIcon />, badge: "AI", badgeVariant: "ai", permSection: "intel" },

      ],
    },
    {
      title: "SYSTEM",
      items: [
        ...(userRole === "admin" ? [{ label: "Users", href: "/team", icon: <UsersIcon /> }] : []),
        { label: "Settings", href: "/settings", icon: <GearIcon />, permSection: "settings" },
      ],
    },
  ];

  return raw
    .map(section => ({
      ...section,
      items: section.items
        .filter(item => {
          if (item.requireWrite) return ["contracts","government","invoices","leases","purchase_orders"].some(s => perms[s] === "write");
          if (item.permSection) return allowed(item.permSection);
          if (item.permSections) return item.permSections.some(allowed);
          return true;
        })
        .map(item => ({
          ...item,
          children: item.children?.filter(c => !c.permSection || allowed(c.permSection)),
        })),
    }))
    .filter(section => section.items.length > 0);
}

export default function Sidebar({ counts = { documents: 0, contracts: 0, invoices: 0, people: 0, govDocs: 0, leases: 0, purchaseOrders: 0 }, entityName = "OpsMind", userRole = "viewer", userPermissions = {}, payrollMonth = "", onClose }: SidebarProps) {
  const pathname = usePathname();
  const sections = buildSections(counts, userRole, userPermissions, payrollMonth);

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <aside className="w-[232px] shrink-0 h-screen bg-[#fafafa] border-r border-surface-border flex flex-col sticky top-0">

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-[52px] border-b border-surface-border shrink-0">
        <div className="w-6 h-6 rounded-md bg-gray-900 flex items-center justify-center shrink-0">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <rect x="1" y="1" width="4.5" height="4.5" rx="1" fill="white" opacity="0.9"/>
            <rect x="7.5" y="1" width="4.5" height="4.5" rx="1" fill="white" opacity="0.5"/>
            <rect x="1" y="7.5" width="4.5" height="4.5" rx="1" fill="white" opacity="0.5"/>
            <rect x="7.5" y="7.5" width="4.5" height="4.5" rx="1" fill="white" opacity="0.9"/>
          </svg>
        </div>
        <span className="text-[13px] font-semibold text-gray-900 tracking-tight">OpsMind</span>
        {onClose ? (
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-surface-hover text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close menu">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 2l9 9M11 2L2 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        ) : (
          <span className="ml-auto text-[10px] text-gray-300 font-medium">v0.7</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {sections.map((section) => (
          <div key={section.title} className="mb-3">
            <p className="text-[10px] font-medium text-gray-400/80 tracking-[0.07em] px-2 py-1 uppercase">
              {section.title}
            </p>
            {section.items.map((item) => {
              const active = item.href ? isActive(item.href) : false;
              const anyChildActive = item.children?.some((c) => c.href ? isActive(c.href) : false);
              const isItemActive = active && !anyChildActive;

              const itemClass = `w-full flex items-center gap-2 px-2 py-[5px] rounded-md text-[13px] transition-colors ${
                isItemActive
                  ? "bg-gray-900 text-white font-medium"
                  : "text-gray-600 hover:bg-surface-hover hover:text-gray-900"
              }`;

              const itemInner = (
                <>
                  <span className={isItemActive ? "text-white/80" : "text-gray-400"}>
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                  {item.badge !== undefined && (
                    <Badge variant={item.badgeVariant}>{item.badge}</Badge>
                  )}
                </>
              );

              return (
                <div key={item.label}>
                  {item.href
                    ? <Link href={item.href} className={itemClass}>{itemInner}</Link>
                    : <div className={`${itemClass} cursor-default select-none`}>{itemInner}</div>
                  }

                  {item.children && (
                    <div className="ml-4 pl-2.5 border-l border-gray-200 mt-0.5 mb-1 space-y-px">
                      {item.children.map((child) => {
                        const childActive = child.href ? isActive(child.href) : false;
                        return (
                          <Link
                            key={child.label}
                            href={child.href ?? "#"}
                            className={`flex items-center gap-2 px-2 py-[4px] rounded-md text-[12px] transition-colors ${
                              childActive
                                ? "bg-gray-900 text-white font-medium"
                                : "text-gray-500 hover:bg-surface-hover hover:text-gray-800"
                            }`}
                          >
                            <span className={childActive ? "text-white/70" : "text-gray-300"}>
                              {child.icon}
                            </span>
                            <span className="truncate">{child.label}</span>
                            {child.badge !== undefined && (
                              <Badge variant={child.badgeVariant}>{child.badge}</Badge>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Workspace footer */}
      <div className="border-t border-surface-border px-3 py-3 flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-md bg-gray-200 flex items-center justify-center shrink-0">
          <span className="text-gray-700 text-[10px] font-bold">
            {entityName.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-gray-800 truncate leading-tight">{entityName}</p>
          <p className="text-[10px] text-gray-400 truncate leading-tight">Workspace</p>
        </div>
      </div>
    </aside>
  );
}
