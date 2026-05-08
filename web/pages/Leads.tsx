import { useQuery } from "@tanstack/react-query";
import { getContacts } from "../api";
import { ContactList } from "../components/ContactList";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import type { ContactSummary } from "../types";

const columns = [
  ["New / Cold", ["initial_sms_sent", "cold_outreach"]],
  ["Active", ["active_conversation", "warm_follow_up", "re_engagement"]],
  ["Call Ready", ["ready_for_call", "call_scheduled"]],
  ["Human / Paused", ["escalated_to_human", "opted_out"]]
] as const;

export function Leads() {
  const { data } = useQuery<any>({ queryKey: ["contacts", "all"], queryFn: () => getContacts("all"), refetchInterval: 30_000 });
  const contacts: ContactSummary[] = data?.contacts || [];
  return (
    <main className="page-shell">
      <PageHeader eyebrow="Leads" title="Lead Board" subtitle="Pipeline grouped by bot lifecycle stage." />
      <div className="page-scroll">
        <div className="kanban-grid">
          {columns.map(([title, statuses]) => (
            <Panel title={`${title} (${contacts.filter((contact) => statuses.includes(contact.engagementStatus as any)).length})`} key={title}>
              <ContactList contacts={contacts.filter((contact) => statuses.includes(contact.engagementStatus as any))} emptyText="No leads in this stage." />
            </Panel>
          ))}
        </div>
      </div>
    </main>
  );
}
