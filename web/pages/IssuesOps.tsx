import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminContactAction, getScanner } from "../api";
import { clean, shortBody, when } from "../safe";
import { Empty, Metric, Panel } from "../components/OpsPrimitives";

const bucketLabels: Record<string, string> = {
  humanWaiting: "Human waiting",
  stuckBotState: "Stuck bot state",
  appointmentIssues: "Appointment issues",
  timezoneIssues: "Timezone issues",
  systemIssues: "System issues",
  smsBlocked: "SMS blocked/DND",
  duplicateConflicts: "Duplicate phone conflicts",
  recoverable: "Recoverable"
};

export function IssuesOps() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<any>({ queryKey: ["scanner"], queryFn: getScanner, refetchInterval: 20_000 });
  const scanner = data?.scanner || {};
  const buckets = scanner.buckets || {};
  const actionMutation = useMutation({
    mutationFn: ({ contactId, action }: { contactId: string; action: string }) => adminContactAction(contactId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scanner"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    }
  });

  if (isLoading) return <section className="page-content"><Empty>Loading issue scanner...</Empty></section>;

  return (
    <section className="page-content">
      <div className="metrics-grid">
        {Object.entries(bucketLabels).slice(0, 6).map(([key, label]) => (
          <Metric label={label} value={scanner.counts?.[key] || 0} key={key} tone={key === "humanWaiting" || key === "systemIssues" ? "danger" : key === "smsBlocked" ? "warn" : "neutral"} />
        ))}
      </div>

      <div className="issue-page-grid">
        {Object.entries(bucketLabels).map(([key, label]) => (
          <Panel title={label} subtitle={key === "smsBlocked" ? "Not sent to Slack. Operational only." : "Click into GHL/contact or repair safely."} key={key}>
            <div className="issue-stack">
              {(buckets[key] || []).slice(0, 40).map((item: any, index: number) => (
                <div className={`issue-row ${item.reason?.type || "warn"}`} key={`${key}-${item.contactId}-${index}`}>
                  <strong>{item.name || item.contactId || "Unknown"} | {clean(item.reason?.label || item.reason?.code)}</strong>
                  <span>{item.phone || ""} | {shortBody(item.recommendedAction || item.reason?.recommendedAction, 130)} | {when(item.lastActivityAt)}</span>
                  <div className="row-actions">
                    <a href={`/dashboard/conversations?contact=${encodeURIComponent(item.contactId)}`}>Open contact</a>
                    {item.ghlContactLink ? <a href={item.ghlContactLink} target="_blank" rel="noreferrer">Open GHL</a> : null}
                    {safeActionFor(item.reason?.code) ? (
                      <button type="button" disabled={actionMutation.isPending} onClick={() => actionMutation.mutate({ contactId: item.contactId, action: safeActionFor(item.reason?.code) || "" })}>
                        {clean(safeActionFor(item.reason?.code))}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
              {!(buckets[key] || []).length ? <Empty>No items.</Empty> : null}
            </div>
          </Panel>
        ))}
      </div>
    </section>
  );
}

function safeActionFor(code?: string) {
  if (code === "scheduled_without_reminders") return "ensure_appointment_reminders";
  if (code === "awaiting_backup_without_timeout") return "ensure_appointment_reminders";
  if (code === "missing_timezone") return "refresh_timezone";
  if (code === "no_pending_automation") return "schedule_warm_followups";
  if (code === "unacknowledged_escalation") return "human_acknowledged";
  return "";
}
