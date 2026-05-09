export function safeText(value: unknown, fallback = "-"): string {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const text = value.map((item) => safeText(item, "")).filter(Boolean).join(", ");
    return text || fallback;
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    const direct = item.label || item.name || item.source || item.utm_source || item.utmSource || item.sessionSource || item.medium;
    if (direct) return safeText(direct, fallback);
    const text = Object.entries(item)
      .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
      .map(([key, entry]) => `${key}: ${safeText(entry, "")}`)
      .filter(Boolean)
      .join(", ");
    return text || fallback;
  }
  return fallback;
}

export function fmt(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  return safeText(value);
}

export function pct(value = 0) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0%";
  return `${Math.round(number * 1000) / 10}%`;
}

export function when(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeText(value);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function clean(value?: unknown) {
  return safeText(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function initials(name?: string) {
  return safeText(name, "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

export function shortBody(text?: unknown, max = 150) {
  const body = safeText(text, "");
  return body.length > max ? `${body.slice(0, max)}...` : body || "-";
}

export function statusTone(contact?: { automationPaused?: boolean; engagementStatus?: string }) {
  if (!contact) return "muted";
  if (contact.automationPaused || contact.engagementStatus === "escalated_to_human") return "danger";
  if (contact.engagementStatus === "call_scheduled") return "good";
  if (contact.engagementStatus === "active_conversation" || contact.engagementStatus === "warm_follow_up") return "warn";
  return "muted";
}
