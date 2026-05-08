const LABELS = [
  "accident_date",
  "fault_not_at_fault",
  "fault_at_fault",
  "fault_unclear",
  "medical_yes",
  "medical_no",
  "call_now",
  "call_later",
  "opt_out",
  "wrong_number",
  "asks_who_this_is",
  "human_request",
  "prefers_text",
  "document_or_report",
  "confused",
  "needs_escalation",
  "off_topic",
  "acknowledgement",
  "unknown"
];

function promptForContact(contact, inboundText) {
  return JSON.stringify(
    {
      previous_outbound_message: contact.lastOutboundMessage || "",
      lead_reply: inboundText || "",
      engagement_status: contact.engagementStatus || "",
      qualification_progress: contact.qualificationProgress || "",
      known_answers: {
        accident_date: contact.accidentDate || "",
        fault: contact.faultAnswer || "",
        medical: contact.medicalTreatmentAnswer || ""
      }
    },
    null,
    2
  );
}

function instructions() {
  return `
You classify inbound SMS replies from accident leads for an intake bot.
Return only JSON matching the schema.
Use previous_outbound_message and qualification_progress as context.

Labels: ${LABELS.join(", ")}

Escalate when the reply is angry, complicated, legal/medical/insurance heavy, asks for a human/professional, includes document/report handling, says they already signed/retained a firm, complains about the firm, indicates post-retainer support, or confidence is low.

Core labels:
- accident_date: timing/date of accident.
- fault_not_at_fault/fault_at_fault/fault_unclear: fault answer.
- medical_yes/medical_no: medical treatment or injury answer.
- call_now/call_later: call intent or scheduling.
- opt_out/wrong_number: stop/remove/wrong number.
- prefers_text: asks to continue by text instead of phone.
- document_or_report: report, photos, license, insurance card, DocuSign, email/doc upload.
- needs_escalation: sensitive legal/medical/insurance detail, complaint, signed client, post-intake, already has lawyer, language barrier.
- acknowledgement: ok/thanks/yes/sure when it does not answer the current question by itself.
- unknown: cannot determine.
`.trim();
}

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

async function classifyWithLlm(config, contact, inboundText) {
  if (!config.llm?.fallbackEnabled || !config.llm.apiKey) return null;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      label: { type: "string", enum: LABELS },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      should_escalate: { type: "boolean" },
      normalized_value: { type: "string" },
      reason: { type: "string" }
    },
    required: ["label", "confidence", "should_escalate", "normalized_value", "reason"]
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.llm.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.llm.classifierModel,
      instructions: instructions(),
      input: promptForContact(contact, inboundText),
      text: {
        format: {
          type: "json_schema",
          name: "sms_reply_classification",
          schema,
          strict: true
        }
      }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI classifier failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return JSON.parse(extractOutputText(data));
}

module.exports = { classifyWithLlm, LABELS };
