import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "../api";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { formatTime } from "../utils";

export function Appointments() {
  const { data } = useQuery<any>({ queryKey: ["dashboard"], queryFn: getDashboard, refetchInterval: 30_000 });
  return (
    <main className="page-shell">
      <PageHeader eyebrow="Calendar" title="Appointments" subtitle="Scheduled calls, reminder coverage, and missed-call recovery." />
      <div className="page-scroll">
        <Panel title="Appointment pipeline">
          <div className="table-wrap">
            <table><thead><tr><th>Name</th><th>Phone</th><th>Time</th><th>Backup</th><th>Reminder jobs</th><th>Missed follow-ups</th></tr></thead><tbody>
              {(data?.appointmentPipeline || []).map((item: any) => (
                <tr key={item.id}><td>{item.name}</td><td>{item.phone}</td><td>{item.preferredCallTime || formatTime(item.preferredCallTimeIso)}</td><td>{item.backupCallTime || "-"}</td><td>{item.reminderJobs}</td><td>{item.missedFollowups}</td></tr>
              ))}
            </tbody></table>
          </div>
        </Panel>
      </div>
    </main>
  );
}
