import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { getDashboard } from "../api";
import { ContactList } from "../components/ContactList";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { Pill } from "../components/Pill";
import type { DashboardData } from "../types";
import { cleanLabel, formatNumber, formatTime } from "../utils";

export function Today() {
  const { data, isLoading, error } = useQuery<DashboardData>({ queryKey: ["dashboard"], queryFn: getDashboard, refetchInterval: 30_000 });
  const totals = data?.totals || {};

  return (
    <main className="page-shell">
      <PageHeader
        eyebrow="Overview"
        title="Today"
        subtitle="A command view for bot health, live lead movement, escalations, and blocked sends."
        right={<Pill tone={data?.dryRun ? "warn" : "good"} dot>{data?.dryRun ? "Dry run" : "Live"}</Pill>}
      />
      <div className="page-scroll">
        {error ? <div className="alert bad">Dashboard failed to load. Check the password or server logs.</div> : null}
        <div className="metric-grid">
          <MetricCard label="Contacts" value={totals.contacts} note="tracked by bot" />
          <MetricCard label="Inbound SMS" value={totals.inbound24h} note="last 24h" />
          <MetricCard label="Outbound SMS" value={totals.outbound24h} note="last 24h" />
          <MetricCard label="Ready Now" value={totals.readyForCall} note="call requests" />
          <MetricCard label="Escalations" value={totals.unacknowledgedEscalations} note="unacknowledged" />
          <MetricCard label="SMS Blocked" value={totals.smsBlocked} note="GHL DND, no Slack" />
        </div>

        <div className="dashboard-grid two">
          <Panel title="Needs attention">
            <div className="alert-stack">
              {isLoading ? <p className="small muted-pad">Loading...</p> : null}
              {totals.unacknowledgedEscalations ? <div className="alert bad"><strong>{formatNumber(totals.unacknowledgedEscalations)} escalation(s)</strong><span>Human team needs to acknowledge these.</span></div> : null}
              {totals.smsBlocked ? <div className="alert info"><strong>{formatNumber(totals.smsBlocked)} SMS blocked by GHL DND</strong><span>Tracked here only. No Slack alert needed.</span></div> : null}
              {totals.failedJobs ? <div className="alert bad"><strong>{formatNumber(totals.failedJobs)} failed job(s)</strong><span>These need engineering review.</span></div> : null}
              {!isLoading && !totals.unacknowledgedEscalations && !totals.smsBlocked && !totals.failedJobs ? <p className="small muted-pad">No major safety issues right now.</p> : null}
            </div>
          </Panel>
          <Panel title="Hot leads">
            <ContactList contacts={data?.hotLeads?.slice(0, 8)} emptyText="No hot leads currently." />
          </Panel>
        </div>

        <div className="dashboard-grid two">
          <Panel title="Lifecycle funnel">
            <div className="funnel-list">
              {(data?.funnel || []).map((item) => (
                <div className="funnel-row" key={item.key}>
                  <span>{item.label}</span>
                  <strong>{formatNumber(item.count)}</strong>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Daily executive summary">
            <dl className="summary-list">
              {Object.entries(data?.dailySummary || {}).map(([key, value]) => (
                <Fragment key={key}>
                  <dt>{cleanLabel(key)}</dt>
                  <dd>{key === "date" ? formatTime(String(value)) : String(value)}</dd>
                </Fragment>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </main>
  );
}
