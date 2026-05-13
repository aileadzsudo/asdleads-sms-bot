const DECISIONS = [
  "allow",
  "block_clarify",
  "block_escalate",
  "correct_time",
  "switch_to_reschedule",
  "switch_to_call_now",
  "do_nothing"
];

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if ((content.type === "output_text" || content.type === "text") && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function safeText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function compactContact(contact = {}) {
  return {
    id: contact.id || "",
    name: contact.name || "",
    phone: contact.phone || "",
    engagement_status: contact.engagementStatus || "",
    qualification_progress: contact.qualificationProgress || "",
    sequence: contact.currentSequenceName || "",
    timezone: contact.timezone || "",
    timezone_source: contact.timezoneSource || contact.timezoneCorrectionSource || contact.lastAppointmentSyncTimeSource || "",
    tags: contact.tags || [],
    stop_flags: {
      opted_out: Boolean(contact.optOutStatus),
      automation_paused: Boolean(contact.automationPaused),
      automation_pause_reason: contact.automationPauseReason || "",
      human_escalation: Boolean(contact.humanEscalationStatus),
      human_stage: contact.humanEscalationStage || ""
    },
    known_answers: {
      accident_date: contact.accidentDate || "",
      fault: contact.faultAnswer || "",
      medical: contact.medicalTreatmentAnswer || ""
    },
    appointment: {
      appointment_id: contact.appointmentId || "",
      current_time_text: contact.preferredCallTime || "",
      current_time_iso: contact.preferredCallTimeIso || "",
      backup_time_text: contact.backupCallTime || "",
      backup_time_iso: contact.backupCallTimeIso || "",
      awaiting_backup: Boolean(contact.awaitingBackupTime),
      awaiting_specific_call_time: Boolean(contact.awaitingSpecificCallTime),
      appointment_type: contact.appointmentType || "",
      appointment_source: contact.appointmentSource || ""
    },
    last_inbound: contact.lastInboundMessage || "",
    last_outbound: contact.lastOutboundMessage || "",
    last_human_outbound: contact.lastHumanOutboundMessage || ""
  };
}

function compactMessages(messages = []) {
  return messages
    .slice(-10)
    .map((message) => ({
      at: message.createdAt || "",
      direction: message.direction || "",
      body: safeText(message.body || message.message || "")
    }))
    .filter((message) => message.body);
}

function instructions() {
  return `
You are a strict safety decision gate for an SMS intake bot in personal injury lead intake.
Your job is to review the conversation context and the bot's proposed high-risk action BEFORE the bot does it.
Return only JSON matching the schema. Do not write SMS copy. Do not invent facts.

High-risk actions include booking, rescheduling, confirming a call time, urgent call-now, no-show rebooking, backup-time finalization, relative-time auto-booking, and human handoff resume.

Core rules:
- If the proposed action clearly matches the latest lead/human context, return allow.
- If the proposed time conflicts with the latest message, return correct_time when the correct time is clear.
- If the lead says they cannot make the current appointment, are unavailable, or asks to reschedule, never allow a confirmation of the old time.
- If the lead says "not right now", "busy", "can't talk", or similar, never allow call_now. Ask for a later exact time.
- Accident date/time is not call appointment time unless the message also clearly asks for a call or scheduling.
- A human outbound message can override bot assumptions. If the human says they will schedule 3pm, the bot must not book or confirm 4pm.
- If a lead gives primary and backup times in one message, allow booking only if both are captured or return block_clarify/correct_time.
- For "in an hour" after the bot already asked one clarification and the lead did not answer, allow rounded auto-booking only if it does not conflict with later messages.
- For no-show recovery, do not restart intake. Only rebook or clarify call timing.
- If risk is high and the correct action is not clear, return block_escalate.

Decision meanings:
- allow: proposed action is safe.
- block_clarify: do not do the proposed action; ask one safe clarification.
- block_escalate: do not do the proposed action; human should review.
- correct_time: proposed time is wrong but the correct time is clear; corrected_time_text must explain the intended time in plain text.
- switch_to_reschedule: the lead is changing an existing appointment.
- switch_to_call_now: the lead clearly wants a call now.
- do_nothing: no bot message/action should happen now.
`.trim();
}

function schema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: DECISIONS },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
      corrected_intent: { type: "string" },
      corrected_time_text: { type: "string" },
      risk_flags: { type: "array", items: { type: "string" } },
      safe_template_key: { type: "string" }
    },
    required: [
      "decision",
      "confidence",
      "reason",
      "corrected_intent",
      "corrected_time_text",
      "risk_flags",
      "safe_template_key"
    ]
  };
}

function normalizeDecision(raw = {}) {
  const decision = DECISIONS.includes(raw.decision) ? raw.decision : "block_escalate";
  const confidence = Number(raw.confidence);
  return {
    decision,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    reason: safeText(raw.reason).slice(0, 500),
    corrected_intent: safeText(raw.corrected_intent).slice(0, 200),
    corrected_time_text: safeText(raw.corrected_time_text).slice(0, 200),
    risk_flags: Array.isArray(raw.risk_flags) ? raw.risk_flags.map(safeText).slice(0, 10) : [],
    safe_template_key: safeText(raw.safe_template_key).slice(0, 100)
  };
}

async function runDecisionGate(config, context) {
  if (!config.llm?.decisionGateEnabled || !config.llm.apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.llm.decisionGateModel || config.llm.classifierModel || "gpt-5-mini",
      instructions: instructions(),
      input: JSON.stringify(
        {
          contact: compactContact(context.contact),
          recent_conversation: compactMessages(context.messages || []),
          latest_inbound_message: context.latestInboundMessage || "",
          proposed_action: context.proposedAction || "",
          proposed: context.proposed || {},
          generated_at: new Date().toISOString()
        },
        null,
        2
      ),
      text: {
        format: {
          type: "json_schema",
          name: "sms_bot_decision_gate",
          schema: schema(),
          strict: true
        }
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI decision gate failed: ${response.status} ${JSON.stringify(data)}`);
  }
  const parsed = JSON.parse(extractOutputText(data));
  return {
    ...normalizeDecision(parsed),
    usage: data.usage || null,
    model: data.model || config.llm.decisionGateModel || config.llm.classifierModel || "gpt-5-mini"
  };
}

module.exports = {
  DECISIONS,
  runDecisionGate
};
