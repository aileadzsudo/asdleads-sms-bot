import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { adminContactAction, getContact, getContacts } from "../api";
import type { ContactDetail, ContactSummary, Message } from "../types";
import { clean, initials, shortBody, statusTone, when } from "../safe";
import { ContactControls } from "../components/ContactWidgets";

const filters = [
  { id: "waiting", label: "Awaiting reply" },
  { id: "hot", label: "Hot leads" },
  { id: "active", label: "Active" },
  { id: "escalated", label: "Escalated" },
  { id: "paused", label: "Paused" },
  { id: "booked", label: "Booked" },
  { id: "no_show", label: "No-show" },
  { id: "dnd", label: "DND/SMS blocked" },
  { id: "all", label: "All" }
];

export function Conversations() {
  const queryClient = useQueryClient();
  const url = new URL(window.location.href);
  const [filter, setFilter] = useState(url.searchParams.get("filter") || "waiting");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(url.searchParams.get("contact") || "");
  const contactsQuery = useQuery<any>({
    queryKey: ["contacts", filter],
    queryFn: () => getContacts(["hot", "waiting", "paused"].includes(filter) ? (filter as any) : "all"),
    refetchInterval: 15_000
  });
  const allContacts: ContactSummary[] = contactsQuery.data?.contacts || [];
  const contacts = useMemo(() => filterContacts(allContacts, filter, search), [allContacts, filter, search]);
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

  function selectContact(id: string) {
    setSelectedId(id);
    const next = new URL(window.location.href);
    next.searchParams.set("contact", id);
    window.history.replaceState(null, "", next.toString());
  }

  function runAction(action: string) {
    if (selected) actionMutation.mutate({ contactId: selected, action });
  }

  return (
    <section className="workbench">
      <aside className="contact-list-pane">
        <div className="toolbar tall">
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            {filters.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
          </select>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone, message..." />
        </div>
        <div className="contact-list">
          {contacts.map((contact) => (
            <button
              type="button"
              className={selected === contact.id ? "contact-card active" : "contact-card"}
              onClick={() => selectContact(contact.id)}
              key={contact.id}
            >
              <span className="avatar">{initials(contact.name)}</span>
              <span className="contact-main">
                <strong>{contact.name || "Unknown"}</strong>
                <small>{contact.phone || "-"} | {clean(contact.engagementStatus)} | {contact.leadSourceLabel || contact.leadSource || "unknown"}</small>
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

function filterContacts(contacts: ContactSummary[], filter: string, search: string) {
  let filtered = contacts;
  if (filter === "active") filtered = filtered.filter((contact) => ["active_conversation", "warm_follow_up", "re_engagement", "ready_for_call"].includes(contact.engagementStatus || ""));
  if (filter === "escalated") filtered = filtered.filter((contact) => contact.humanEscalationStatus || contact.engagementStatus === "escalated_to_human");
  if (filter === "booked") filtered = filtered.filter((contact) => contact.engagementStatus === "call_scheduled" || Boolean((contact as any).appointmentId));
  if (filter === "no_show") filtered = filtered.filter((contact) => contact.engagementStatus === "missed_call");
  if (filter === "dnd") filtered = filtered.filter((contact) => contact.issueFlags?.some((flag) => flag.code === "sms_dnd_blocked"));
  const q = search.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter((contact) =>
      [contact.name, contact.phone, contact.lastInboundMessage, contact.lastOutboundMessage, contact.engagementStatus, contact.leadSourceLabel]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }
  return filtered;
}

function Conversation({ detail, loading }: { detail?: ContactDetail; loading: boolean }) {
  if (loading) return <div className="empty state">Loading conversation...</div>;
  if (!detail) return <div className="empty state">Select a contact to see the conversation, bot state, and decision log.</div>;
  const contact = detail.contact;
  return (
    <>
      <header className="conversation-header">
        <div>
          <h2>{contact.name || "Unknown"}</h2>
          <p>{contact.phone || "-"} | <span className={`badge ${statusTone(contact)}`}>{clean(contact.engagementStatus)}</span> | {clean(contact.qualificationProgress)}</p>
        </div>
        {contact.ghlContactLink ? <a className="ghost-btn" href={contact.ghlContactLink} target="_blank" rel="noreferrer">Open GHL</a> : null}
      </header>
      <div className="messages">
        {(detail.messages || []).map((message: Message) => (
          <article className={`message ${message.direction === "inbound" ? "inbound" : "outbound"}`} key={message.id || `${message.createdAt}-${message.body}`}>
            <p>{message.body || "-"}</p>
            <small>{when(message.createdAt)} {message.templateKey ? `| ${message.templateKey}` : ""}</small>
          </article>
        ))}
        {!detail.messages?.length ? <p className="empty">No stored messages for this contact.</p> : null}
      </div>
    </>
  );
}
