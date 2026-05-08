import type { ReactNode } from "react";
import { TOKENS, fonts } from "../tokens";

type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "info";

const palettes: Record<Tone, [string, string, string]> = {
  neutral: [TOKENS.surfaceMuted, TOKENS.borderStrong, TOKENS.text],
  accent: [TOKENS.accentSoft, "#E8B689", TOKENS.accent],
  good: [TOKENS.goodSoft, "#B7DCC6", TOKENS.good],
  warn: [TOKENS.warnSoft, "#E5CB80", TOKENS.warn],
  bad: [TOKENS.badSoft, "#E5B7B2", TOKENS.bad],
  info: [TOKENS.infoSoft, "#B5C6E1", TOKENS.info]
};

type PillProps = {
  tone?: Tone;
  children: ReactNode;
  mono?: boolean;
  dot?: boolean;
};

export function Pill({ tone = "neutral", children, mono, dot }: PillProps) {
  const [bg, border, color] = palettes[tone];
  return (
    <span
      className="pill"
      style={{
        background: bg,
        borderColor: border,
        color,
        fontFamily: mono ? fonts.mono : fonts.sans
      }}
    >
      {dot ? <span className="pill-dot" style={{ background: color }} /> : null}
      {children}
    </span>
  );
}
