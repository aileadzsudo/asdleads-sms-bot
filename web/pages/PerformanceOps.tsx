import { useMemo, useState } from "react";
import type { DashboardData } from "../types";
import { fmt, pct, safeText } from "../safe";
import { Empty, Metric, Panel } from "../components/OpsPrimitives";

const ranges = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "all", label: "All time", days: 365 }
];

export function PerformanceOps({ data }: { data?: DashboardData }) {
  const [range, setRange] = useState("7d");
  const selected = ranges.find((item) => item.id === range) || ranges[1];
  const history = useMemo(() => (data?.activityHistory || []).slice(-selected.days), [data?.activityHistory, selected.days]);
  const totals = history.reduce((acc, item) => {
    acc.inbound += Number(item.inbound || 0);
    acc.outbound += Number(item.outbound || 0);
    acc.bookings += Number(item.bookings || 0);
    acc.escalations += Number(item.escalations || 0);
    return acc;
  }, { inbound: 0, outbound: 0, bookings: 0, escalations: 0 });
  const max = Math.max(1, ...history.map((item) => Number(item.inbound || 0) + Number(item.outbound || 0) + Number(item.bookings || 0)));

  return (
    <section className="page-content">
      <div className="page-toolbar">
        <strong>Range</strong>
        {ranges.map((item) => (
          <button className={range === item.id ? "active" : ""} type="button" onClick={() => setRange(item.id)} key={item.id}>{item.label}</button>
        ))}
      </div>

      <div className="metrics-grid">
        <Metric label="Inbound" value={totals.inbound} tone="good" />
        <Metric label="Outbound" value={totals.outbound} />
        <Metric label="Bookings" value={totals.bookings} tone="good" />
        <Metric label="Escalations" value={totals.escalations} tone={totals.escalations ? "warn" : "neutral"} />
        <Metric label="LLM contacts" value={data?.llmUsage?.contactsClassified || 0} />
        <Metric label="LLM failures" value={data?.llmUsage?.failures || 0} tone={data?.llmUsage?.failures ? "danger" : "neutral"} />
      </div>

      <Panel title="Message movement" subtitle="Clickable days open conversations filtered by activity date.">
        <div className="bar-chart performance-chart">
          {history.map((item) => (
            <a className="bar-day" href={`/dashboard/conversations?date=${encodeURIComponent(item.key)}`} key={item.key}>
              <div className="bars">
                <span className="bar inbound" style={{ height: `${Math.max(4, (Number(item.inbound || 0) / max) * 100)}%` }} title={`Inbound ${item.inbound || 0}`} />
                <span className="bar outbound" style={{ height: `${Math.max(4, (Number(item.outbound || 0) / max) * 100)}%` }} title={`Outbound ${item.outbound || 0}`} />
                <span className="bar booked" style={{ height: `${Math.max(4, (Number(item.bookings || 0) / max) * 100)}%` }} title={`Bookings ${item.bookings || 0}`} />
              </div>
              <small>{item.label}</small>
            </a>
          ))}
        </div>
        <div className="legend"><span className="inbound" />Inbound <span className="outbound" />Outbound <span className="booked" />Booked</div>
      </Panel>

      <div className="split-grid">
        <Panel title="Source performance" subtitle="Safe-normalized source labels. No raw objects rendered.">
          <table className="data-table">
            <thead><tr><th>Source</th><th>Contacts</th><th>Reply</th><th>Booked</th><th>Escalated</th><th>Opt-out</th></tr></thead>
            <tbody>
              {(data?.sourcePerformance || []).map((item: any, index: number) => (
                <tr key={`${safeText(item.source)}-${index}`}>
                  <td><a href={`/dashboard/conversations?source=${encodeURIComponent(safeText(item.source))}`}>{safeText(item.source)}</a></td>
                  <td>{fmt(item.contacts)}</td>
                  <td>{pct(item.replyRate)}</td>
                  <td>{pct(item.bookingRate)}</td>
                  <td>{fmt(item.escalated)}</td>
                  <td>{fmt(item.optedOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Template performance">
          <table className="data-table">
            <thead><tr><th>Template</th><th>Sends</th><th>Replies</th><th>Rate</th></tr></thead>
            <tbody>
              {(data?.templatePerformance || []).slice(0, 24).map((item: any) => (
                <tr key={`${item.group}-${item.key}`}>
                  <td>{safeText(item.groupLabel)}<br /><small>{safeText(item.key)}</small></td>
                  <td>{fmt(item.sends)}</td>
                  <td>{fmt(item.replies)}</td>
                  <td>{pct(item.responseRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.templatePerformance?.length ? <Empty>No template sends recorded.</Empty> : null}
        </Panel>
      </div>
    </section>
  );
}
