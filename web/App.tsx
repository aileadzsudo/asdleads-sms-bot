import { Frame } from "./components/Frame";
import { Sidebar } from "./components/Sidebar";
import { ABTesting } from "./pages/ABTesting";
import { Appointments } from "./pages/Appointments";
import { Inbox } from "./pages/Inbox";
import { Issues } from "./pages/Issues";
import { Leads } from "./pages/Leads";
import { Performance } from "./pages/Performance";
import { Review } from "./pages/Review";
import { Templates } from "./pages/Templates";
import { Today } from "./pages/Today";
import { hasDashboardPassword, setDashboardPassword } from "./api";
import { useState } from "react";
import type { FormEvent } from "react";

function activeRoute(pathname: string) {
  const part = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  return part || "overview";
}

export function App() {
  const active = activeRoute(window.location.pathname);
  const [authed, setAuthed] = useState(hasDashboardPassword());

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    setDashboardPassword(password);
    setAuthed(true);
  }

  if (!authed) {
    return (
      <div className="login-shell">
        <form className="login-card" onSubmit={submitPassword}>
          <span className="eyebrow">Accident Support Desk</span>
          <h1>Dashboard password</h1>
          <p>Enter the admin password configured as ADMIN_PASSWORD.</p>
          <input name="password" type="password" autoComplete="current-password" autoFocus />
          <button type="submit">Open dashboard</button>
        </form>
      </div>
    );
  }

  const page = {
    overview: <Today />,
    inbox: <Inbox />,
    leads: <Leads />,
    issues: <Issues />,
    appointments: <Appointments />,
    performance: <Performance />,
    "ab-testing": <ABTesting />,
    templates: <Templates />,
    review: <Review />
  }[active] || <Today />;

  return (
    <Frame>
      <Sidebar active={active} />
      {page}
    </Frame>
  );
}
