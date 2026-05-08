import type { ContactDetail } from "../types";
import { cleanLabel, flagTone, formatTime } from "../utils";
import { Avatar } from "./Avatar";
import { Pill } from "./Pill";

type ContactRailProps = {
  detail?: ContactDetail;
  onAck?: () => void;
  onPause?: () => void;
  onReturn?: () => void;
};

export function ContactRail({ detail, onAck, onPause, onReturn }: ContactRailProps) {
  if (!detail) return <aside className="contact-rail"><p className="small muted-pad">Select a contact.</p></aside>;
  const contact = detail.contact;
  return (
    <aside className="contact-rail">
      <div className="rail-hero">
        <Avatar name={contact.name || "Unknown"} size={42} />
        <div>
          <h2>{contact.name || "Unknown"}</h2>
          <p>{contact.phone || "-"}</p>
        </div>
      </div>

      <div className="rail-actions">
        <button type="button" onClick={onAck}>Human Ack</button>
        <button type="button" onClick={onPause}>Pause Bot</button>
        <button className="primary" type="button" onClick={onReturn}>Return to Bot</button>
      </div>

      <section className="rail-section">
        <h3>Lead Details</h3>
        <dl>
          <dt>Status</dt><dd>{cleanLabel(contact.engagementStatus)}</dd>
          <dt>Progress</dt><dd>{cleanLabel(contact.qualificationProgress)}</dd>
          <dt>Source</dt><dd>{contact.leadSource || "-"}</dd>
          <dt>Timezone</dt><dd>{contact.timezone || "-"}</dd>
          <dt>Last activity</dt><dd>{formatTime(contact.lastActivityAt)}</dd>
        </dl>
      </section>

      <section className="rail-section">
        <h3>Qualification</h3>
        <dl>
          <dt>Accident</dt><dd>{contact.accidentDate || "-"}</dd>
          <dt>Fault</dt><dd>{contact.faultAnswer || "-"}</dd>
          <dt>Medical</dt><dd>{contact.medicalTreatmentAnswer || "-"}</dd>
          <dt>Call time</dt><dd>{contact.preferredCallTime || "-"}</dd>
        </dl>
      </section>

      <section className="rail-section">
        <h3>Issues</h3>
        <div className="chip-row">
          {detail.issueFlags?.length ? detail.issueFlags.map((flag) => (
            <Pill tone={flagTone(flag.type) as any} key={flag.code}>{flag.label}</Pill>
          )) : <span className="small">No current issues.</span>}
        </div>
      </section>
    </aside>
  );
}
