import type { ReactNode } from "react";
import { fmt } from "../safe";

export function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="panel">
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Metric({ label, value, help, tone = "neutral" }: { label: string; value: unknown; help?: string; tone?: string }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{fmt(value)}</strong>
      {help ? <small>{help}</small> : null}
    </article>
  );
}

export function Empty({ children = "No data in this bucket." }: { children?: ReactNode }) {
  return <p className="empty">{children}</p>;
}
