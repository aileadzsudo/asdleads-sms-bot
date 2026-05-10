import type { ContactDetail, ContactSummary, Job } from "../types";
import { clean, fmt, initials, shortBody, statusTone, when } from "../safe";
import { Empty, Panel } from "./OpsPrimitives";

export function ContactMiniList({ title, contacts }: { title: string; contacts?: ContactSummary[] }) {
  return (
    <Panel title={title}>
      <div className="compact-list">
        {(contacts || []).slice(0, 12).map((contact) => (
          <a href={`/dashboard/conversations?contact=${encodeURIComponent(contact.id)}`} className="compact-contact" key={contact.id}>
            <span className="avatar">{initials(contact.name)}</span>
            <span>
              <strong>{contact.name || "Unknown"}</strong>
              <small>{clean(contact.engagementStatus)} | {shortBody(contact.lastInboundMessage || contact.lastOutboundMessage, 72)}</small>
            </span>
            <em className={statusTone(contact)}>{contact.issueFlags?.length || 0} issues</em>
          </a>
        ))}
        {!(contacts || []).length ? <Empty>No contacts here right now.</Empty> : null}
      </div>
    </Panel>
  );
}

export function ContactControls({
  detail,
  busy,
  onAction
}: {
  detail?: ContactDetail;
  busy: boolean;
  onAction: (action: string) => void;
}) {
  if (!detail) return <div className="empty state">Select a contact.</div>;
  const contact = detail.contact;
  const pendingJobs = (detail.jobs || []).filter((job) => job.status === "pending");
  const failedJobs = (detail.jobs || []).filter((job) => job.status === "failed");
  const skippedJobs = (detail.jobs || []).filter((job) => job.status === "skipped");

  return (
    <div className="control-scroll">
      <Panel title="Bot controls">
        <div className="button-grid">
          <button disabled={busy} onClick={() => onAction("return_to_bot")} type="button">Return to bot</button>
          <button disabled={busy} onClick={() => onAction("schedule_warm_followups")} type="button">Restart chase</button>
          <button disabled={busy} onClick={() => onAction("pause_bot")} type="button">Pause bot</button>
          <button disabled={busy} onClick={() => onAction("human_acknowledged")} type="button">Human ack</button>
          <button disabled={busy} onClick={() => onAction("ensure_appointment_reminders")} type="button">Ensure reminders</button>
          <button disabled={busy} onClick={() => onAction("mark_no_show")} type="button">Mark no-show</button>
          <button disabled={busy} onClick={() => onAction("refresh_timezone")} type="button">Refresh timezone</button>
          <button disabled={busy} onClick={() => onAction("repair_primary_call_time")} type="button">Repair call time</button>
        </div>
      </Panel>

      <Panel title="Current state">
        <dl className="detail-list">
          <dt>Status</dt><dd><span className={`badge ${statusTone(contact)}`}>{clean(contact.engagementStatus)}</span></dd>
          <dt>Progress</dt><dd>{clean(contact.qualificationProgress)}</dd>
          <dt>Sequence</dt><dd>{clean(contact.currentSequenceName)} day {fmt(contact.currentSequenceDay)}</dd>
          <dt>Timezone</dt><dd>{contact.timezone || "-"} <small>({contact.timezoneSource || "unknown"})</small></dd>
          <dt>Next job</dt><dd>{contact.nextScheduledJob ? `${contact.nextScheduledJob.type} at ${when(contact.nextScheduledJob.runAt)}` : "-"}</dd>
          <dt>Last decision</dt><dd>{contact.lastBotDecision ? `${clean(contact.lastBotDecision.action)}: ${contact.lastBotDecision.reason || "-"}` : "-"}</dd>
          <dt>Pause source</dt><dd>{contact.automationPaused ? `${clean(contact.lastAutomationPauseSource || "unknown")} at ${when(contact.lastAutomationPauseAt)}` : "-"}</dd>
          <dt>Pause note</dt><dd>{contact.automationPaused ? shortBody(contact.lastAutomationPauseNote, 80) : "-"}</dd>
        </dl>
      </Panel>

      <Panel title="Qualification and appointment">
        <dl className="detail-list">
          <dt>Accident</dt><dd>{contact.accidentDate || "-"}</dd>
          <dt>Fault</dt><dd>{clean(contact.faultAnswer)}</dd>
          <dt>Medical</dt><dd>{clean(contact.medicalTreatmentAnswer)}</dd>
          <dt>Primary</dt><dd>{contact.preferredCallTime || "-"}</dd>
          <dt>Backup</dt><dd>{contact.backupCallTime || "-"}</dd>
          <dt>Appointment</dt><dd>{contact.appointmentId || "-"}</dd>
        </dl>
      </Panel>

      <Panel title="Why bot did this">
        <div className="issue-stack">
          {(detail.decisionLogs || []).slice(-8).reverse().map((log) => (
            <div className="issue-row info" key={log.id || `${log.createdAt}-${log.action}`}>
              <strong>{clean(log.action)} | {log.reason || "-"}</strong>
              <span>{when(log.createdAt)} {log.message ? `| ${shortBody(log.message, 90)}` : ""}</span>
            </div>
          ))}
          {!(detail.decisionLogs || []).length ? <Empty>No decision log yet.</Empty> : null}
        </div>
      </Panel>

      <Panel title="Needs attention">
        <div className="issue-stack">
          {(detail.issueFlags || []).map((flag) => (
            <div className={`issue-row ${flag.type}`} key={flag.code}>
              <strong>{flag.label}</strong>
              <span>{flag.recommendedAction || flag.code}</span>
            </div>
          ))}
          {!detail.issueFlags?.length ? <Empty>No active issue flags.</Empty> : null}
        </div>
      </Panel>

      <Panel title={`Pending jobs (${pendingJobs.length})`}>
        <JobList jobs={pendingJobs.slice(0, 10)} />
      </Panel>

      {failedJobs.length ? (
        <Panel title={`Failed jobs (${failedJobs.length})`}>
          <JobList jobs={failedJobs.slice(0, 8)} />
        </Panel>
      ) : null}

      {skippedJobs.length ? (
        <Panel title={`Skipped jobs (${skippedJobs.length})`}>
          <JobList jobs={skippedJobs.slice(0, 8)} />
        </Panel>
      ) : null}
    </div>
  );
}

function JobList({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return <Empty>No jobs in this bucket.</Empty>;
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <div className="job-row" key={job.id}>
          <strong>{job.type}</strong>
          <span>{job.status} | {when(job.runAt || job.finishedAt)}</span>
          {job.skipReason ? <small>{job.skipReason}</small> : null}
          {job.error || job.lastError ? <small>{shortBody(job.error || job.lastError, 120)}</small> : null}
        </div>
      ))}
    </div>
  );
}
