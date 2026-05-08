import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
};

export function PageHeader({ eyebrow, title, subtitle, right }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {right ? <div className="page-actions">{right}</div> : null}
    </header>
  );
}
