import { Panel } from "../components/Panel";
import { Pill } from "../components/Pill";

export function Today() {
  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <span className="eyebrow">Overview</span>
          <h1>Today</h1>
          <p>React dashboard shell is live. Data cards and charts arrive in PR 4.</p>
        </div>
        <Pill tone="accent" dot>
          PR 1
        </Pill>
      </header>

      <div className="empty-grid">
        <Panel title="Operator cockpit foundation">
          <div className="empty-state">
            <strong>Dashboard v2 shell is ready</strong>
            <p>
              The new React frame, navigation, design tokens, and base components are mounted. The legacy dashboard remains available while the remaining pages are ported.
            </p>
            <a className="text-link" href="/dashboard-legacy">
              Open legacy dashboard
            </a>
          </div>
        </Panel>
        <Panel title="Next PR">
          <div className="empty-state compact">
            <strong>API wiring</strong>
            <p>PR 2 adds the contact list/detail/message APIs that power the inbox and lead rail.</p>
          </div>
        </Panel>
      </div>
    </main>
  );
}
