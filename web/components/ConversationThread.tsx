import type { Message } from "../types";
import { formatTime } from "../utils";

type ConversationThreadProps = {
  messages?: Message[];
};

export function ConversationThread({ messages = [] }: ConversationThreadProps) {
  if (!messages.length) return <p className="small muted-pad">No stored messages yet.</p>;
  return (
    <div className="conversation-thread">
      {messages.map((message, index) => (
        <div className={`bubble-row ${message.direction === "inbound" ? "inbound" : "outbound"}`} key={message.id || index}>
          <div className="bubble">
            <p>{message.body}</p>
            <small>{formatTime(message.createdAt)}</small>
          </div>
        </div>
      ))}
    </div>
  );
}
