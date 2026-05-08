import type { ContactSummary } from "../types";
import { cleanLabel, engagementTone, flagTone, relativeTime } from "../utils";
import { Avatar } from "./Avatar";
import { Pill } from "./Pill";

type ContactListProps = {
  contacts?: ContactSummary[];
  selectedId?: string;
  onSelect?: (contact: ContactSummary) => void;
  emptyText?: string;
};

export function ContactList({ contacts = [], selectedId, onSelect, emptyText = "No contacts found." }: ContactListProps) {
  if (!contacts.length) return <p className="small muted-pad">{emptyText}</p>;
  return (
    <div className="contact-list">
      {contacts.map((contact) => (
        <button
          className={contact.id === selectedId ? "contact-row active" : "contact-row"}
          key={contact.id}
          type="button"
          onClick={() => onSelect?.(contact)}
        >
          <Avatar name={contact.name || "Unknown"} size={30} />
          <span className="contact-main">
            <span className="contact-title">
              <strong>{contact.name || "Unknown"}</strong>
              <em>{relativeTime(contact.lastActivityAt)}</em>
            </span>
            <span className="contact-preview">{contact.lastInboundMessage || contact.lastOutboundMessage || contact.phone || ""}</span>
            <span className="chip-row">
              <Pill tone={engagementTone(contact.engagementStatus) as any} dot>
                {cleanLabel(contact.engagementStatus)}
              </Pill>
              {(contact.issueFlags || []).slice(0, 2).map((flag) => (
                <Pill tone={flagTone(flag.type) as any} key={flag.code}>
                  {flag.label}
                </Pill>
              ))}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
