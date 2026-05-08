import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "../api";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { formatTime } from "../utils";

export function Review() {
  const { data } = useQuery<any>({ queryKey: ["dashboard"], queryFn: getDashboard, refetchInterval: 30_000 });
  return (
    <main className="page-shell">
      <PageHeader eyebrow="Quality" title="Review Queue" subtitle="Recent messages and bot-confusion records for manual QA." />
      <div className="page-scroll">
        <div className="dashboard-grid two">
          <Panel title="Bot confusion">
            <div className="table-wrap"><table><thead><tr><th>Contact</th><th>Status</th><th>Last inbound</th></tr></thead><tbody>
              {(data?.botConfusion || []).map((contact: any) => <tr key={contact.id}><td>{contact.name}</td><td>{contact.escalationReason || contact.engagementStatus}</td><td>{contact.lastInboundMessage}</td></tr>)}
            </tbody></table></div>
          </Panel>
          <Panel title="Recent messages">
            <div className="table-wrap"><table><thead><tr><th>Time</th><th>Direction</th><th>Message</th></tr></thead><tbody>
              {(data?.recentMessages || []).map((message: any, index: number) => <tr key={message.id || index}><td>{formatTime(message.createdAt)}</td><td>{message.direction}</td><td>{message.body}</td></tr>)}
            </tbody></table></div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
