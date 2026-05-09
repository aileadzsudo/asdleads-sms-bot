import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  adminContactAction,
  getContact,
  getContacts,
  getDashboard,
  hasDashboardPassword,
  setDashboardPassword
} from "./api";
import type { ContactDetail, ContactSummary, DashboardData, Job, Message } from "./types";

const nav = [
  { id: "overview", label: "Command", href: "/dashboard" },
  { id: "inbox", label: "Conversations", href: "/dashboard/inbox" },
  { id: "issues", label: "Issues", href: "/dashboard/issues" },
  { id: "appointments", label: "Appointments", href: "/dashboard/appointments" },
  { id: "performance", label: "Performance", href: "/dashboard/performance" },
  { id: "templates", label: "Templates", href: "/dashboard/templates" },
  { id: "review", label: "Review", href: "/dashboard/review" }
];

function activeRoute(pathname: string) {
  const part = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  return part || "overview";
}

function fmt(value: unknown) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  return String(value);
}

function when(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function clean(value?: string) {
  return String(value || "-")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function initials(name?: string) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function shortBody(text?: string, max = 150) {
  const body = String(text || "");
  return body.length > max ? `${body.slice(0, max)}...` : body;
}

function statusTone(contact?: ContactSummary) {
  if (!contact) return "muted";
  if (contact.automationPaused || contact.engagementStatus === "escalated_to_human") return "danger";
  if (contact.engagementStatus === "call_scheduled") return "good";
  if (contact.engagementStatus === "active_conversation" || contact.engagementStatus === "warm_follow_up") return "warn";
  return "muted";
}

function AppLogin({ onLogin }: { onLogin: () => void }) {
  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") || "");
    setDashboardPassword(password);
    onLogin();
  }

  return (
    <main className="login-view">
      <form className="login-panel" onSubmit={submitPassword}>
        <div className="brand-block">ASD</div>
        <p className="overline">Accident Support Desk</p>
        <h1>Operator dashboard</h1>
        <p>Enter the admin password. This dashboard controls the live SMS bot.</p>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" autoFocus />
        </label>
        <button type="submit">Open dashboard</button>
      </form>
    </main>
  );
}

function Shell({ active, children, data, onRefresh }: { active: string; children: React.ReactNode; data?: DashboardData; onRefresh: () => void }) {
  return (
    <div className="ops-shell">
      <aside className="ops-sidebar">
        <a className="ops-brand" href="/dashboard">
          <span>ASD</span>
          <strong>Accident Support Desk</strong>
          <small>Bot command center</small>
        </a>
        <nav>
          {nav.map((item) => (
            <a className={active === item.id ? "active" : ""} href={item.href} key={item.id}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="side-status">
          <span className={data?.dryRun ? "dot warn" : "dot good"} />
          {data?.dryRun ? "Dry run" : "Live mode"}
        </div>
      </aside>
      <div className="ops-main">
        <header className="topbar">
          <div>
            <p className="overline">Live operations</p>
            <h1>{nav.find((item) => item.id === active)?.label || "Command"}</h1>
          </div>
          <div className="topbar-actions">
            <span>Updated {when(data?.generatedAt)}</span>
            <button type="button" onClick={onRefresh}>Refresh</button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

function Metric({ label, value, help, tone = "neutral" }: { label: string; value: unknown; help?: string; tone?: string }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{fmt(value)}</strong>
      {help ? <small>{help}</small> : null}
    </article>
  );
}

function Overview({ data }: { data?: DashboardData }) {
  const totals = data?.totals || {};
  const history = (data?.activityHistory || []).slice(-14);
  const max = Math.max(1, ...history.map((item) => Number(item.inbound || 0) + Number(item.outbound || 0)));

  return (
    <section className="page-content">
      <div className="metrics-grid">
        <Metric label="Tracked contacts" value={totals.contacts} help="All contacts known by bot" />
        <Metric label="Inbound 24h" value={totals.inbound24h} help="Replies received" tone="good" />
        <Metric label="Outbound 24h" value={totals.outbound24h} help="Bot messages sent" />
        <Metric label="Pending jobs" value={totals.pendingJobs} help="Scheduled work" />
        <Metric label="Needs human" value={totals.unacknowledgedEscalations} help="Unacknowledged" tone={totals.unacknowledgedEscalations ? "danger" : "neutral"} />
        <Metric label="Bot errors" value={totals.botErrors || 0} help="Throttled, dashboard-first" tone={totals.botErrors ? "danger" : "neutral"} />
      </div>

      <div className="split-grid">
        <Panel title="Message movement" subtitle="Inbound and outbound by day. Click Performance for deeper breakdowns.">
          <div className="bar-chart" role="img" aria-label="Recent message volume">
            {history.map((item) => {
              const inbound = Number(item.inbound || 0);
              const outbound = Number(item.outbound || 0);
              return (
                <div className="bar-day" key={item.key || item.label}>
                  <div className="bars">
                    <span className="bar inbound" style={{ height: `${Math.max(4, (inbound / max) * 100)}%` }} title={`Inbound ${inbound}`} />
                    <span className="bar outbound" style={{ height: `${Math.max(4, (outbound / max) * 100)}%` }} title={`Outbound ${outbound}`} />
                  </div>
                  <small>{item.label}</small>
                </div>
              );
            })}
          </div>
          <div className="legend"><span className="inbound" />Inbound <span className="outbound" />Outbound</div>
        </Panel>

        <Panel title="Need attention now" subtitle="These are the items that can break lead flow.">
          <IssueList data={data} />
        </Panel>
      </div>

      <div className="split-grid">
        <ContactPanel title="Hot leads" contacts={data?.hotLeads || []} />
        <ContactPanel title="Recent activity" contacts={data?.recentContacts || []} />
      </div>
    </section>
  );
}

function IssueList({ data }: { data?: DashboardData }) {
  const alerts = data?.alerts || {};
  const items = [
    ...(alerts.unacknowledgedEscalations || []).map((item) => ({ tone: "danger", title: "Human escalation waiting", text: `${item.name || "Unknown"}: ${shortBody(item.lastInboundMessage, 80)}` })),
    ...(alerts.failedJobs || []).map((item) => ({ tone: "danger", title: `Failed job: ${item.type}`, text: `${item.contactId || ""} ${shortBody(item.error || item.lastError, 90)}` })),
    ...(alerts.botErrors || []).map((item) => ({ tone: item.operationalOnly ? "warn" : "danger", title: item.title || "Bot error", text: shortBody(item.details?.Error || item.details?.Path || item.signature, 100) })),
    ...(alerts.smsBlocked || []).slice(0, 8).map((item) => ({ tone: "info", title: "SMS blocked by GHL DND", text: `${item.contactId || ""} ${shortBody(item.error, 90)}` })),
    ...(alerts.dueJobs || []).slice(0, 8).map((item) => ({ tone: "warn", title: `Due job: ${item.type}`, text: `${item.contactId || ""} due ${when(item.runAt)}` }))
  ];
  if (!items.length) return <p className="empty">No critical issues right now.</p>;
  return (
    <div className="issue-stack">
      {items.slice(0, 16).map((item, index) => (
        <div className={`issue-row ${item.tone}`} key={`${item.title}-${index}`}>
          <strong>{item.title}</strong>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function ContactPanel({ title, contacts }: { title: string; contacts: ContactSummary[] }) {
  return (
    <Panel title={title}>
      <div className="compact-list">
        {contacts.slice(0, 10).map((contact) => (
          <a href={`/dashboard/inbox?contact=${encodeURIComponent(contact.id)}`} className="compact-contact" key={contact.id}>
            <span className="avatar">{initials(contact.name)}</span>
            <span>
              <strong>{contact.name || "Unknown"}</strong>
              <small>{clean(contact.engagementStatus)} · {shortBody(contact.lastInboundMessage || contact.lastOutboundMessage, 70)}</small>
            </span>
            <em className={statusTone(contact)}>{contact.pendingJobs || 0} jobs</em>
          </a>
        ))}
        {!contacts.length ? <p className="empty">No contacts in this group.</p> : null}
      </div>
    </Panel>
  );
}

function Workbench({ mode }: { mode: "all" | "hot" | "waiting" | "paused" | "issues" }) {
  const queryClient = useQueryClient();
  const url = new URL(window.location.href);
  const [queue, setQueue] = useState(mode === "issues" ? "all" : mode);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(url.searchParams.get("contact") || "");
  const contactsQuery = useQuery<any>({
    queryKey: ["contacts", queue],
    queryFn: () => getContacts(queue as any),
    refetchInterval: 15_000
  });
  const allContacts: ContactSummary[] = contactsQuery.data?.contacts || [];
  const contacts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = allContacts;
    if (mode === "issues") filtered = filtered.filter((contact) => contact.issueFlags?.length);
    if (q) {
      filtered = filtered.filter((contact) =>
        [contact.name, contact.phone, contact.lastInboundMessage, contact.lastOutboundMessage, contact.engagementStatus]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q))
      );
    }
    return filtered;
  }, [allContacts, mode, search]);
  const selected = selectedId || contacts[0]?.id || "";
  const detailQuery = useQuery<ContactDetail>({
    queryKey: ["contact", selected],
    queryFn: () => getContact(selected) as Promise<ContactDetail>,
    enabled: Boolean(selected),
    refetchInterval: 15_000
  });
  const actionMutation = useMutation({
    mutationFn: ({ contactId, action }: { contactId: string; action: string }) => adminContactAction(contactId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      if (selected) queryClient.invalidateQueries({ queryKey: ["contact", selected] });
    }
  });

  function runAction(action: string) {
    if (!selected) return;
    actionMutation.mutate({ contactId: selected, action });
  }

  return (
    <section className="workbench">
      <aside className="contact-list-pane">
        <div className="toolbar">
          <select value={queue} onChange={(event) => setQueue(event.target.value)}>
            <option value="waiting">Needs reply</option>
            <option value="hot">Hot leads</option>
            <option value="paused">Paused</option>
            <option value="all">All contacts</option>
          </select>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, message..." />
        </div>
        <div className="contact-list">
          {contacts.map((contact) => (
            <button
              type="button"
              className={selected === contact.id ? "contact-card active" : "contact-card"}
              onClick={() => setSelectedId(contact.id)}
              key={contact.id}
            >
              <span className="avatar">{initials(contact.name)}</span>
              <span className="contact-main">
                <strong>{contact.name || "Unknown"}</strong>
                <small>{contact.phone || "-"} · {clean(contact.engagementStatus)}</small>
                <em>{shortBody(contact.lastInboundMessage || contact.lastOutboundMessage, 110)}</em>
              </span>
              {contact.issueFlags?.length ? <b>{contact.issueFlags.length}</b> : null}
            </button>
          ))}
          {!contacts.length ? <p className="empty">No contacts match this view.</p> : null}
        </div>
      </aside>

      <main className="conversation-pane">
        <Conversation detail={detailQuery.data} loading={detailQuery.isLoading} />
      </main>

      <aside className="control-pane">
        <ContactControls detail={detailQuery.data} busy={actionMutation.isPending} onAction={runAction} />
      </aside>
    </section>
  );
}

function Conversation({ detail, loading }: { detail?: ContactDetail; loading: boolean }) {
  if (loading) return <div className="empty state">Loading conversation...</div>;
  if (!detail) return <div className="empty state">Select a contact to see the full conversation and bot state.</div>;
  return (
    <>
      <header className="conversation-header">
        <div>
          <h2>{detail.contact.name || "Unknown"}</h2>
          <p>{detail.contact.phone || "-"} · {clean(detail.contact.engagementStatus)} · {clean(detail.contact.qualificationProgress)}</p>
        </div>
        {detail.contact.ghlContactLink ? <a className="ghost-btn" href={detail.contact.ghlContactLink} target="_blank" rel="noreferrer">Open GHL</a> : null}
      </header>
      <div className="messages">
        {detail.messages.map((message: Message) => (
          <article className={`message ${message.direction === "inbound" ? "inbound" : "outbound"}`} key={message.id || `${message.createdAt}-${message.body}`}>
            <p>{message.body}</p>
            <small>{when(message.createdAt)} {message.templateKey ? `· ${message.templateKey}` : ""}</small>
          </article>
        ))}
        {!detail.messages.length ? <p className="empty">No stored messages for this contact.</p> : null}
      </div>
    </>
  );
}

function ContactControls({ detail, busy, onAction }: { detail?: ContactDetail; busy: boolean; onAction: (action: string) => void }) {
  if (!detail) return <div className="empty state">No contact selected.</div>;
  const contact = detail.contact;
  const pendingJobs = (detail.jobs || []).filter((job) => job.status === "pending");
  const failedJobs = (detail.jobs || []).filter((job) => job.status === "failed");
  return (
    <div className="control-scroll">
      <Panel title="Bot controls">
        <div className="button-grid">
          <button disabled={busy} onClick={() => onAction("return_to_bot")} type="button">Return to bot</button>
          <button disabled={busy} onClick={() => onAction("schedule_warm_followups")} type="button">Restart chase</button>
          <button disabled={busy} onClick={() => onAction("pause_bot")} type="button">Pause bot</button>
          <button disabled={busy} onClick={() => onAction("human_acknowledged")} type="button">Human ack</button>
          <button disabled={busy} onClick={() => onAction("ensure_appointment_reminders")} type="button">Ensure reminders</button>
          <button disabled={busy} onClick={() => onAction("mark_no_show")} type="button">Mark no-show</button>
        </div>
      </Panel>

      <Panel title="Current state">
        <dl className="detail-list">
          <dt>Status</dt><dd><span className={`badge ${statusTone(contact)}`}>{clean(contact.engagementStatus)}</span></dd>
          <dt>Progress</dt><dd>{clean(contact.qualificationProgress)}</dd>
          <dt>Sequence</dt><dd>{clean(contact.currentSequenceName)} day {fmt(contact.currentSequenceDay)}</dd>
          <dt>Timezone</dt><dd>{contact.timezone || "-"}</dd>
          <dt>Escalation</dt><dd>{contact.humanEscalationStage ? clean(contact.humanEscalationStage) : "-"}</dd>
          <dt>Reason</dt><dd>{clean(contact.escalationReason)}</dd>
        </dl>
      </Panel>

      <Panel title="Qualification">
        <dl className="detail-list">
          <dt>Accident date</dt><dd>{contact.accidentDate || "-"}</dd>
          <dt>Fault</dt><dd>{clean(contact.faultAnswer)}</dd>
          <dt>Medical</dt><dd>{clean(contact.medicalTreatmentAnswer)}</dd>
          <dt>Call time</dt><dd>{contact.preferredCallTime || "-"}</dd>
          <dt>Backup</dt><dd>{contact.backupCallTime || "-"}</dd>
        </dl>
      </Panel>

      <Panel title="Why it needs attention">
        <div className="issue-stack">
          {detail.issueFlags?.map((flag) => (
            <div className={`issue-row ${flag.type}`} key={flag.code}>
              <strong>{flag.label}</strong>
              <span>{flag.code}</span>
            </div>
          ))}
          {!detail.issueFlags?.length ? <p className="empty">No active issue flags.</p> : null}
        </div>
      </Panel>

      <Panel title={`Pending jobs (${pendingJobs.length})`}>
        <JobList jobs={pendingJobs.slice(0, 10)} />
      </Panel>

      {failedJobs.length ? (
        <Panel title={`Failed jobs (${failedJobs.length})`}>
          <JobList jobs={failedJobs.slice(0, 8)} />
        </Panel>
      ) : null}
    </div>
  );
}

function JobList({ jobs }: { jobs: Job[] }) {
  if (!jobs.length) return <p className="empty">No jobs in this bucket.</p>;
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <div className="job-row" key={job.id}>
          <strong>{job.type}</strong>
          <span>{job.status} · {when(job.runAt || job.finishedAt)}</span>
          {job.error || job.lastError ? <small>{shortBody(job.error || job.lastError, 100)}</small> : null}
        </div>
      ))}
    </div>
  );
}

function Appointments({ data }: { data?: DashboardData }) {
  return (
    <section className="page-content">
      <Panel title="Appointment pipeline" subtitle="Booked calls, reminders, no-shows, and ready-for-call leads.">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Status</th><th>Primary time</th><th>Reminders</th><th>Confirmed</th></tr></thead>
          <tbody>
            {(data?.appointmentPipeline || []).map((item) => (
              <tr key={item.id}>
                <td>{item.name}<br /><small>{item.phone}</small></td>
                <td>{clean(item.status)}</td>
                <td>{item.preferredCallTime || "-"}</td>
                <td>{fmt(item.reminderJobs)}</td>
                <td>{item.confirmed ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

function Performance({ data }: { data?: DashboardData }) {
  return (
    <section className="page-content">
      <div className="split-grid">
        <Panel title="Sources">
          <table className="data-table">
            <thead><tr><th>Source</th><th>Contacts</th><th>Reply</th><th>Booked</th></tr></thead>
            <tbody>
              {(data?.sourcePerformance || []).map((item) => (
                <tr key={item.source}>
                  <td>{item.source}</td>
                  <td>{fmt(item.contacts)}</td>
                  <td>{Math.round((item.replyRate || 0) * 100)}%</td>
                  <td>{Math.round((item.bookingRate || 0) * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="LLM fallback">
          <dl className="detail-list">
            {Object.entries(data?.llmUsage || {}).map(([key, value]) => (
              <Fragment key={key}>
                <dt>{clean(key)}</dt>
                <dd>{fmt(value)}</dd>
              </Fragment>
            ))}
          </dl>
        </Panel>
      </div>
    </section>
  );
}

function Templates({ data }: { data?: DashboardData }) {
  return (
    <section className="page-content">
      <Panel title="Template performance" subtitle="Current scripts and response rates. Editing still lives in the template page until the next pass.">
        <table className="data-table">
          <thead><tr><th>Template</th><th>Sends</th><th>Replies</th><th>Rate</th><th>Current copy</th></tr></thead>
          <tbody>
            {(data?.templatePerformance || []).slice(0, 80).map((item) => (
              <tr key={`${item.group}-${item.key}`}>
                <td>{item.groupLabel}<br /><small>{item.key}</small></td>
                <td>{fmt(item.sends)}</td>
                <td>{fmt(item.replies)}</td>
                <td>{Math.round((item.responseRate || 0) * 100)}%</td>
                <td className="copy-cell">{shortBody(item.body, 220)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </section>
  );
}

export function App() {
  const [authed, setAuthed] = useState(hasDashboardPassword());
  const active = activeRoute(window.location.pathname);
  const dashboardQuery = useQuery<DashboardData>({ queryKey: ["dashboard"], queryFn: getDashboard, enabled: authed, refetchInterval: 20_000 });

  if (!authed) return <AppLogin onLogin={() => setAuthed(true)} />;

  let page: React.ReactNode = <Overview data={dashboardQuery.data} />;
  if (active === "inbox" || active === "leads") page = <Workbench mode={active === "leads" ? "all" : "waiting"} />;
  if (active === "issues" || active === "review") page = <Workbench mode="issues" />;
  if (active === "appointments") page = <Appointments data={dashboardQuery.data} />;
  if (active === "performance") page = <Performance data={dashboardQuery.data} />;
  if (active === "templates" || active === "ab-testing") page = <Templates data={dashboardQuery.data} />;

  return (
    <Shell active={active} data={dashboardQuery.data} onRefresh={() => dashboardQuery.refetch()}>
      {dashboardQuery.error ? <div className="global-error">Dashboard failed to load. Check the admin password or server health.</div> : null}
      {page}
    </Shell>
  );
}
