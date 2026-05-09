import type { DashboardData } from "../types";
import { fmt } from "../safe";
import { Panel } from "../components/OpsPrimitives";

const flow = [
  { key: "started", label: "Lead enters bot", detail: "NR tag/disposition starts cold outreach after safety checks." },
  { key: "cold", label: "Cold outreach", detail: "Day 1 immediate/follow-up messages, then AM/PM sequence." },
  { key: "replied", label: "Inbound buffer", detail: "Replies wait 30 seconds so back-to-back texts are handled together." },
  { key: "fault", label: "Qualification memory", detail: "Date/fault/medical are remembered. The bot does not reset progress." },
  { key: "ready", label: "Call intent", detail: "Exact times book. Vague times ask for clarification." },
  { key: "booked", label: "Booked and reminders", detail: "GHL appointment, Slack booking, and reminder jobs." },
  { key: "missed", label: "No-show recovery", detail: "No-show webhook starts backup or missed-call sequence." },
  { key: "escalated", label: "Human escalation", detail: "Complex, upset, legal, or low-confidence messages pause bot." },
  { key: "opted_out", label: "Safety stops", detail: "STOP, NQ, signed, hold, DND, and duplicate conflicts stop or skip automation." }
];

export function LifecycleMap({ data }: { data?: DashboardData }) {
  const counts = new Map((data?.funnel || []).map((item: any) => [item.key, item.count]));
  const statusCounts = data?.breakdowns?.engagement || {};
  return (
    <section className="page-content">
      <Panel title="Accident Support Desk lead lifecycle" subtitle="This is the operating map for why the bot acts, pauses, escalates, books, or stays silent.">
        <div className="lifecycle-flow">
          {flow.map((step, index) => (
            <a className="lifecycle-node" href={`/dashboard/conversations?stage=${encodeURIComponent(step.key)}`} key={step.key}>
              <span>{index + 1}</span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
              <b>{fmt(counts.get(step.key) || statusCounts[step.key] || 0)}</b>
            </a>
          ))}
        </div>
      </Panel>

      <div className="split-grid">
        <Panel title="Engagement states">
          <table className="data-table">
            <tbody>
              {Object.entries(statusCounts).map(([key, value]) => (
                <tr key={key}><td>{key.replace(/_/g, " ")}</td><td>{fmt(value)}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Highest-risk fall points">
          <div className="issue-stack">
            <div className="issue-row warn"><strong>Timezone mismatch</strong><span>Wrong timezone creates wrong appointments and reminders. Check timezone source on every booked lead.</span></div>
            <div className="issue-row warn"><strong>Manual GHL activity</strong><span>Human calls/texts/bookings need webhooks or tags so the bot does not operate with stale state.</span></div>
            <div className="issue-row warn"><strong>Appointment sync</strong><span>Manual edits must reconcile reminder jobs. Use Ensure reminders after edits.</span></div>
            <div className="issue-row info"><strong>Slack noise</strong><span>DND and skipped jobs belong here in dashboard, not in Slack.</span></div>
          </div>
        </Panel>
      </div>
    </section>
  );
}
