import type { ReactNode } from "react";

type PanelProps = {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
};

export function Panel({ title, right, children }: PanelProps) {
  return (
    <section className="panel">
      {title || right ? (
        <header className="panel-header">
          <h2>{title}</h2>
          {right}
        </header>
      ) : null}
      <div className="panel-body">{children}</div>
    </section>
  );
}
