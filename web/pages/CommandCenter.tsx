import type { DashboardData } from "../types";
import { fmt, shortBody, when } from "../safe";
import { ContactMiniList } from "../components/ContactWidgets";
import { Empty, Metric, Panel } from "../components/OpsPrimitives";

export function CommandCenter({ data }: { data?: DashboardData }) {
  const totals = data?.totals || {};
  const history = (data?.activityHistory || []).slice(-14);
  const max = Math.max(1, ...history.map((item) => Number(item.inbound || 0) + Number(item.outbound || 0) + Number(item.bookings || 0)));

  return (
    <section className="page-content">
      <div className="metrics-grid">
        <Metric label="Contacts" value={totals.contacts} help="Known by bot" />
        <Metric label="Inbound 24h" value={totals.inbound24h} help="Lead replies" tone="good" />
        <Metric label="Outbound 24h" value={totals.outbound24h} help="Bot sends" />
        <Metric label="Booked calls" value={totals.callScheduled} help="Current scheduled" tone="good" />
        <Metric label="Needs human" value={totals.unacknowledgedEscalations} help="Unacknowledged" tone={totals.unacknowledgedEscalations ? "danger" : "neutral"} />
        <Metric label="DND blocks" value={totals.smsBlocked} help="Dashboard only" tone={totals.smsBlocked ? "warn" : "neutral"} />
      </div>

      <div className="split-grid">
        <Panel title="Message volume" subtitle="Inbound, outbound, and bookings over the last two weeks.">
          <div className="bar-chart" role="img" aria-label="Recent message volume">
            {history.map((item) => {
              const inbound = Number(item.inbound || 0);
              const outbound = Number(item.outbound || 0);
              const bookings = Number(item.bookings || 0);
              return (
                <a className="bar-day" href={`/dashboard/performance?date=${encodeURIComponent(item.key || "")}`} key={item.key || item.label}>
                  <div className="bars">
                    <span className="bar inbound" style={{ height: `${Math.max(4, (inbound / max) * 100)}%` }} title={`Inbound ${inbound}`} />
                    <span className="bar outbound" style={{ height: `${Math.max(4, (outbound / max) * 100)}%` }} title={`Outbound ${outbound}`} />
                    <span className="bar booked" style={{ height: `${Math.max(4, (bookings / max) * 100)}%` }} title={`Bookings ${bookings}`} />
                  </div>
                  <small>{item.label}</small>
                </a>
              );
            })}
          </div>
          <div className="legend"><span className="inbound" />Inbound <span className="outbound" />Outbound <span className="booked" />Booked</div>
        </Panel>

        <Panel title="Needs attention now" subtitle="Grouped operational items. Slack should only be urgent lead issues and true failures.">
          <NeedAttention data={data} />
        </Panel>
      </div>

      <div className="split-grid">
        <ContactMiniList title="Hot leads" contacts={data?.hotLeads || []} />
        <ContactMiniList title="Recent activity" contacts={data?.recentContacts || []} />
      </div>
    </section>
  );
}

function NeedAttention({ data }: { data?: DashboardData }) {
  const scanner = data?.scanner?.buckets || {};
  const rows = [
    ...(scanner.humanWaiting || []).slice(0, 5).map((item: any) => ({ tone: "urgent", title: "Human waiting", item })),
    ...(scanner.stuckBotState || []).slice(0, 5).map((item: any) => ({ tone: "warn", title: "Stuck bot state", item })),
    ...(scanner.appointmentIssues || []).slice(0, 5).map((item: any) => ({ tone: "warn", title: "Appointment issue", item })),
    ...(scanner.timezoneIssues || []).slice(0, 5).map((item: any) => ({ tone: "warn", title: "Timezone issue", item })),
    ...(scanner.systemIssues || []).slice(0, 5).map((item: any) => ({ tone: "danger", title: "System issue", item })),
    ...(scanner.smsBlocked || []).slice(0, 4).map((item: any) => ({ tone: "info", title: "SMS blocked by GHL DND", item }))
  ];
  if (!rows.length) return <Empty>No critical issues right now.</Empty>;
  return (
    <div className="issue-stack">
      {rows.map((row, index) => (
        <a className={`issue-row ${row.tone}`} href={`/dashboard/conversations?contact=${encodeURIComponent(row.item.contactId)}`} key={`${row.item.contactId}-${row.title}-${index}`}>
          <strong>{row.title}: {row.item.name || row.item.contactId}</strong>
          <span>{row.item.reason?.label || row.item.reason?.code || row.item.recommendedAction || shortBody(row.item.lastBotDecision?.reason, 80)} | {when(row.item.lastActivityAt)}</span>
        </a>
      ))}
      <a className="ghost-link" href="/dashboard/issues">Open full issue scanner ({fmt(data?.totals?.issueContacts || 0)})</a>
    </div>
  );
}
