import { useMutation, useQueryClient } from "@tanstack/react-query";
import { adminContactAction } from "../api";
import type { ContactSummary, DashboardData } from "../types";
import { clean, shortBody, when } from "../safe";
import { Empty, Metric, Panel } from "../components/OpsPrimitives";

export function PauseAudit({ data }: { data?: DashboardData }) {
  const queryClient = useQueryClient();
  const pausedContacts = data?.pausedContacts || [];
  const audit = data?.pauseAudit || [];
  const adminPauses = pausedContacts.filter((contact) => contact.automationPauseReason === "admin_pause");
  const unknownSource = pausedContacts.filter((contact) => !contact.lastAutomationPauseSource || contact.lastAutomationPauseSource === "unknown");
  const actionMutation = useMutation({
    mutationFn: ({ contactId, action }: { contactId: string; action: string }) => adminContactAction(contactId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    }
  });

  return (
    <section className="page-content">
      <div className="metrics-grid">
        <Metric label="Paused contacts" value={pausedContacts.length} tone={pausedContacts.length ? "warn" : "neutral"} />
        <Metric label="Admin paused" value={adminPauses.length} tone={adminPauses.length ? "danger" : "neutral"} />
        <Metric label="Unknown source" value={unknownSource.length} tone={unknownSource.length ? "danger" : "neutral"} />
        <Metric label="Pause events" value={audit.length} />
      </div>

      <Panel
        title="Currently paused contacts"
        subtitle="Every active pause should show why it exists, where it came from, and what to do next."
      >
        <div className="issue-stack">
          {pausedContacts.map((contact: ContactSummary) => (
            <div className="issue-row warn" key={contact.id}>
              <strong>{contact.name || "Unknown"} | {contact.phone || "-"} | {clean(contact.automationPauseReason)}</strong>
              <span>
                Source: {clean(contact.lastAutomationPauseSource || "unknown")} | At: {when(contact.lastAutomationPauseAt)} | Note: {shortBody(contact.lastAutomationPauseNote, 120)}
              </span>
              <span>
                Status: {clean(contact.engagementStatus)} | Progress: {clean(contact.qualificationProgress)} | Last: {shortBody(contact.lastInboundMessage || contact.lastOutboundMessage, 120)}
              </span>
              <div className="row-actions">
                <a href={`/dashboard/conversations?contact=${encodeURIComponent(contact.id)}`}>Open contact</a>
                {contact.ghlContactLink ? <a href={contact.ghlContactLink} target="_blank" rel="noreferrer">Open GHL</a> : null}
                <button
                  type="button"
                  disabled={actionMutation.isPending}
                  onClick={() => actionMutation.mutate({ contactId: contact.id, action: "return_to_bot" })}
                >
                  Return to bot
                </button>
              </div>
            </div>
          ))}
          {!pausedContacts.length ? <Empty>No contacts are paused right now.</Empty> : null}
        </div>
      </Panel>

      <Panel
        title="Pause event audit"
        subtitle="New pause events include source, raw action, request path, and note. Older events may show unknown because that data was not recorded yet."
      >
        <div className="issue-stack">
          {audit.map((event: any) => (
            <div className="issue-row info" key={event.id || `${event.contactId}-${event.createdAt}`}>
              <strong>{event.name || event.contactId || "Unknown"} | {clean(event.reason)} | {when(event.createdAt)}</strong>
              <span>
                Source: {clean(event.source || "unknown")} | Action: {clean(event.rawAction || event.reason || "-")} | Path: {event.requestPath || "-"}
              </span>
              <span>
                From {clean(event.beforeStatus)} to {clean(event.afterStatus)} | Note: {shortBody(event.note, 140)}
              </span>
              <div className="row-actions">
                {event.contactId ? <a href={`/dashboard/conversations?contact=${encodeURIComponent(event.contactId)}`}>Open contact</a> : null}
                {event.ghlContactLink ? <a href={event.ghlContactLink} target="_blank" rel="noreferrer">Open GHL</a> : null}
              </div>
            </div>
          ))}
          {!audit.length ? <Empty>No pause events recorded yet.</Empty> : null}
        </div>
      </Panel>
    </section>
  );
}
