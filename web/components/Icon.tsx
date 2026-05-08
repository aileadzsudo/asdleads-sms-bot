import type { CSSProperties } from "react";

export const ICONS = {
  alert: "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01",
  bot: "M12 8V4H8 M3 12h2 M19 12h2 M12 16h.01 M9 12h.01 M15 12h.01 M5 12a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z",
  cal: "M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18",
  chart: "M3 3v18h18 M7 14l4-4 3 3 5-6",
  check: "M20 6 9 17l-5-5",
  flag: "M4 22V4 M4 4c4-2 8 2 12 0v10c-4 2-8-2-12 0",
  inbox: "M22 12h-6l-2 3h-4l-2-3H2 M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z",
  msg: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  user: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  zap: "M13 2 3 14h9l-1 8 10-12h-9l1-8z"
} as const;

type IconProps = {
  d: string;
  size?: number;
  stroke?: string;
  sw?: number;
  style?: CSSProperties;
};

export function Icon({ d, size = 14, stroke = "currentColor", sw = 1.75, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
