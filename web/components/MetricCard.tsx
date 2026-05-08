import { formatNumber } from "../utils";

type MetricCardProps = {
  label: string;
  value?: number | string;
  note?: string;
};

export function MetricCard({ label, value, note }: MetricCardProps) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{typeof value === "number" ? formatNumber(value) : value || "0"}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}
