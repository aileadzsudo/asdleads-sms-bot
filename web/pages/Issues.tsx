import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "../api";
import { ContactList } from "../components/ContactList";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import type { DashboardData } from "../types";

export function Issues() {
  const { data } = useQuery<DashboardData>({ queryKey: ["dashboard"], queryFn: getDashboard, refetchInterval: 20_000 });
  return (
    <main className="page-shell">
      <PageHeader eyebrow="Triage" title="Issues" subtitle="Operational queue for escalations, DND blocks, duplicates, timezone gaps, and bot confusion." />
      <div className="page-scroll">
        <div className="dashboard-grid two">
          <Panel title="Contact issues">
            <ContactList contacts={data?.issueContacts || []} emptyText="No contact issues." />
          </Panel>
          <Panel title="Escalation SLA">
            <div className="table-wrap">
              <table><thead><tr><th>Contact</th><th>Reason</th><th>Waiting</th><th>Status</th></tr></thead><tbody>
                {(data?.escalationSla || []).map((item) => (
                  <tr key={item.id}><td>{item.name}</td><td>{item.reason}</td><td>{Math.round(item.waitingMinutes || 0)}m</td><td>{item.stage}</td></tr>
                ))}
              </tbody></table>
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
