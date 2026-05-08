import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getDashboard } from "../api";
import { MetricCard } from "../components/MetricCard";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";

export function Performance() {
  const { data } = useQuery<any>({ queryKey: ["dashboard"], queryFn: getDashboard, refetchInterval: 60_000 });
  const totals = data?.totals || {};
  return (
    <main className="page-shell">
      <PageHeader eyebrow="Analytics" title="Performance" subtitle="Reply, qualification, sequence, and source performance." />
      <div className="page-scroll">
        <div className="metric-grid">
          <MetricCard label="Outbound" value={totals.outboundMessages} note="all time" />
          <MetricCard label="Inbound" value={totals.inboundMessages} note="all time" />
          <MetricCard label="Escalations" value={totals.escalations} note="all time" />
          <MetricCard label="Booked" value={totals.callScheduled} note="scheduled" />
        </div>
        <Panel title="Message volume">
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={(data?.activityHistory || []).slice(-30)}>
                <CartesianGrid stroke="#E7E6E2" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="outbound" fill="#B6500B" />
                <Bar dataKey="inbound" fill="#2B5BA7" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </main>
  );
}
