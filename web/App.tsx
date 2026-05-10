import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { getDashboard, hasDashboardPassword, setDashboardPassword } from "./api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OpsShell, routeId } from "./components/OpsShell";
import { AppointmentsOps } from "./pages/AppointmentsOps";
import { CommandCenter } from "./pages/CommandCenter";
import { Conversations } from "./pages/Conversations";
import { IssuesOps } from "./pages/IssuesOps";
import { LifecycleMap } from "./pages/LifecycleMap";
import { PauseAudit } from "./pages/PauseAudit";
import { PerformanceOps } from "./pages/PerformanceOps";
import { TemplatesOps } from "./pages/TemplatesOps";
import type { DashboardData } from "./types";

function AppLogin({ onLogin }: { onLogin: () => void }) {
  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") || "");
    setDashboardPassword(password);
    onLogin();
  }

  return (
    <main className="login-view">
      <form className="login-panel" onSubmit={submitPassword}>
        <div className="brand-block">ASD</div>
        <p className="overline">Accident Support Desk</p>
        <h1>Operations dashboard</h1>
        <p>Enter the admin password. This dashboard controls and audits the live SMS bot.</p>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" autoFocus />
        </label>
        <button type="submit">Open dashboard</button>
      </form>
    </main>
  );
}

function pageFor(active: string, data?: DashboardData): ReactNode {
  if (active === "conversations" || active === "leads" || active === "inbox") return <Conversations />;
  if (active === "issues" || active === "review") return <IssuesOps />;
  if (active === "pauses" || active === "pause-audit") return <PauseAudit data={data} />;
  if (active === "appointments") return <AppointmentsOps data={data} />;
  if (active === "performance") return <PerformanceOps data={data} />;
  if (active === "templates" || active === "ab-testing") return <TemplatesOps data={data} />;
  if (active === "lifecycle") return <LifecycleMap data={data} />;
  return <CommandCenter data={data} />;
}

export function App() {
  const [authed, setAuthed] = useState(hasDashboardPassword());
  const active = routeId(window.location.pathname);
  const dashboardQuery = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: getDashboard,
    enabled: authed,
    refetchInterval: 20_000
  });

  if (!authed) return <AppLogin onLogin={() => setAuthed(true)} />;

  return (
    <OpsShell active={active} data={dashboardQuery.data} onRefresh={() => dashboardQuery.refetch()}>
      {dashboardQuery.error ? <div className="global-error">Dashboard failed to load. Check the admin password or server health.</div> : null}
      <ErrorBoundary routeName={active}>
        {pageFor(active, dashboardQuery.data)}
      </ErrorBoundary>
    </OpsShell>
  );
}
