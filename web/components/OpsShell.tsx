import type { ReactNode } from "react";
import type { DashboardData } from "../types";
import { when } from "../safe";

export const navItems = [
  { id: "overview", label: "Command", href: "/dashboard" },
  { id: "conversations", label: "Conversations", href: "/dashboard/conversations" },
  { id: "issues", label: "Issues", href: "/dashboard/issues" },
  { id: "pauses", label: "Pause Audit", href: "/dashboard/pauses" },
  { id: "appointments", label: "Appointments", href: "/dashboard/appointments" },
  { id: "performance", label: "Performance", href: "/dashboard/performance" },
  { id: "templates", label: "Templates", href: "/dashboard/templates" },
  { id: "lifecycle", label: "Lifecycle", href: "/dashboard/lifecycle" }
];

export function routeId(pathname: string) {
  const part = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  if (!part) return "overview";
  if (part === "inbox") return "conversations";
  return part;
}

export function OpsShell({
  active,
  children,
  data,
  onRefresh
}: {
  active: string;
  children: ReactNode;
  data?: DashboardData;
  onRefresh: () => void;
}) {
  const title = navItems.find((item) => item.id === active)?.label || "Command";
  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <a className="ops-brand" href="/dashboard">
          <span>ASD</span>
          <strong>Accident Support Desk</strong>
          <small>Operations backend</small>
        </a>
        <nav>
          {navItems.map((item) => (
            <a className={active === item.id ? "active" : ""} href={item.href} key={item.id}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="side-status">
          <span className={data?.dryRun ? "dot warn" : "dot good"} />
          {data?.dryRun ? "Dry run" : "Live mode"}
        </div>
      </aside>
      <div className="ops-main">
        <header className="topbar">
          <div>
            <p className="overline">Live operations</p>
            <h1>{title}</h1>
          </div>
          <div className="topbar-actions">
            <span>Updated {when(data?.generatedAt)}</span>
            <button type="button" onClick={onRefresh}>Refresh</button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
