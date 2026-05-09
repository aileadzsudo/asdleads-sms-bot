import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminContactAction } from "../api";
import type { DashboardData } from "../types";
import { clean, fmt, when } from "../safe";
import { Empty, Metric, Panel } from "../components/OpsPrimitives";

export function AppointmentsOps({ data }: { data?: DashboardData }) {
  const queryClient = useQueryClient();
  const rows = data?.appointmentPipeline || [];
  const actionMutation = useMutation({
    mutationFn: ({ contactId, action }: { contactId: string; action: string }) => adminContactAction(contactId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    }
  });
  const missingReminders = rows.filter((item: any) => item.appointmentId && !item.reminderJobs).length;
  const noShows = rows.filter((item: any) => item.status === "missed_call").length;

  return (
    <section className="page-content">
      <div className="metrics-grid">
        <Metric label="Appointment rows" value={rows.length} />
        <Metric label="No reminders" value={missingReminders} tone={missingReminders ? "danger" : "neutral"} />
        <Metric label="No-show/missed" value={noShows} tone={noShows ? "warn" : "neutral"} />
        <Metric label="Ready for call" value={data?.totals?.readyForCall || 0} />
        <Metric label="Scheduled" value={data?.totals?.callScheduled || 0} tone="good" />
        <Metric label="Booked today" value={data?.dailySummary?.bookedToday || 0} />
      </div>

      <Panel title="Appointment pipeline" subtitle="Primary time, backup visibility, reminder count, timezone source, and repair controls.">
        <table className="data-table">
          <thead><tr><th>Contact</th><th>Status</th><th>Primary time</th><th>Reminders</th><th>Flags</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((item: any) => (
              <tr key={item.id}>
                <td><a href={`/dashboard/conversations?contact=${encodeURIComponent(item.id)}`}><strong>{item.name || "Unknown"}</strong></a><br /><small>{item.phone}</small></td>
                <td>{clean(item.status)}</td>
                <td>{item.preferredCallTime || "-"}<br /><small>{when(item.preferredCallTimeIso)}</small></td>
                <td>{fmt(item.reminderJobs)} pending<br /><small>{fmt(item.missedFollowups)} no-show jobs</small></td>
                <td>
                  {!item.reminderJobs && item.appointmentId ? <span className="badge danger">no reminders</span> : null}
                  {item.status === "missed_call" ? <span className="badge warn">missed/no-show</span> : null}
                </td>
                <td className="row-actions">
                  <button type="button" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ contactId: item.id, action: "ensure_appointment_reminders" })}>Ensure reminders</button>
                  <button type="button" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ contactId: item.id, action: "mark_no_show" })}>Mark no-show</button>
                  <button type="button" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ contactId: item.id, action: "refresh_timezone" })}>Refresh timezone</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? <Empty>No appointments found.</Empty> : null}
      </Panel>
    </section>
  );
}
