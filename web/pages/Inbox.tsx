import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { acknowledgeContact, getContact, getContacts, pauseContactBot, returnContactToBot } from "../api";
import { ContactList } from "../components/ContactList";
import { ContactRail } from "../components/ContactRail";
import { ConversationThread } from "../components/ConversationThread";
import { PageHeader } from "../components/PageHeader";
import { Pill } from "../components/Pill";
import type { ContactDetail, ContactSummary } from "../types";

export function Inbox() {
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<"all" | "hot" | "waiting" | "paused">("waiting");
  const [selectedId, setSelectedId] = useState("");
  const contactsQuery = useQuery<any>({ queryKey: ["contacts", queue], queryFn: () => getContacts(queue), refetchInterval: 20_000 });
  const contacts: ContactSummary[] = contactsQuery.data?.contacts || [];
  useEffect(() => {
    if (!selectedId && contacts[0]?.id) setSelectedId(contacts[0].id);
  }, [contacts, selectedId]);
  const detailQuery = useQuery<ContactDetail>({ queryKey: ["contact", selectedId], queryFn: () => getContact(selectedId) as Promise<ContactDetail>, enabled: Boolean(selectedId), refetchInterval: 20_000 });
  const action = useMutation({
    mutationFn: (type: "ack" | "pause" | "return") => {
      if (!selectedId) throw new Error("Select a contact first.");
      if (type === "ack") return acknowledgeContact(selectedId);
      if (type === "pause") return pauseContactBot(selectedId);
      return returnContactToBot(selectedId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["contact", selectedId] });
    }
  });

  return (
    <main className="inbox-shell">
      <PageHeader eyebrow="Inbox" title="Operator Cockpit" subtitle="Work hot leads, escalations, and bot-paused conversations from one screen." right={<Pill tone="accent">Auto-refresh 20s</Pill>} />
      <div className="cockpit">
        <aside className="queue-rail">
          {(["waiting", "hot", "paused", "all"] as const).map((item) => (
            <button className={queue === item ? "queue-item active" : "queue-item"} key={item} type="button" onClick={() => { setQueue(item); setSelectedId(""); }}>
              <span>{item === "waiting" ? "Needs reply" : item}</span>
            </button>
          ))}
        </aside>
        <section className="thread-list">
          <ContactList contacts={contacts} selectedId={selectedId} onSelect={(contact) => setSelectedId(contact.id)} />
        </section>
        <section className="thread-pane">
          <ConversationThread messages={detailQuery.data?.messages || []} />
        </section>
        <ContactRail
          detail={detailQuery.data}
          onAck={() => action.mutate("ack")}
          onPause={() => action.mutate("pause")}
          onReturn={() => action.mutate("return")}
        />
      </div>
    </main>
  );
}
