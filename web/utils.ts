export function cleanLabel(value?: string) {
  return String(value || "unknown")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatNumber(value?: number | null) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

export function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function relativeTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export function engagementTone(status?: string) {
  if (["ready_for_call", "call_scheduled", "call_booked"].includes(status || "")) return "good";
  if (["escalated_to_human", "missed_call", "opted_out"].includes(status || "")) return "bad";
  if (["warm_follow_up", "re_engagement"].includes(status || "")) return "warn";
  if (["active_conversation"].includes(status || "")) return "info";
  return "neutral";
}

export function flagTone(type?: string) {
  if (type === "urgent") return "bad";
  if (type === "warn") return "warn";
  if (type === "info") return "info";
  return "neutral";
}
