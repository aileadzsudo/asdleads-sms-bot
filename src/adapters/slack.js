const { contactLink } = require("./ghl");

function answerLines(contact) {
  return [
    `Accident date: ${contact.accidentDate || "unknown"}`,
    `Fault: ${contact.faultAnswer || "unknown"}`,
    `Medical: ${contact.medicalTreatmentAnswer || "unknown"}`
  ].join("\n");
}

function baseEscalationText(config, contact, title, reason, extra = {}) {
  const lines = [
    `*${title}*`,
    `Reason: ${reason}`,
    `Name: ${contact.name || "unknown"}`,
    `Phone: ${contact.phone || "unknown"}`,
    `Source: ${contact.leadSource || "unknown"}`,
    `Status: ${contact.engagementStatus || "unknown"}`,
    `Next needed: ${contact.qualificationProgress || "unknown"}`,
    answerLines(contact),
    `Last inbound: ${contact.lastInboundMessage || "unknown"}`,
    `GHL: ${contactLink(config, contact) || "unknown"}`
  ];
  for (const [key, value] of Object.entries(extra)) {
    if (value) lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

async function postSlack(config, text, channel = config.slack.channel) {
  if (config.dryRun || !config.slack.token) {
    return { ok: true, skipped: true, reason: "Slack post skipped by dry run or missing token", channel, text };
  }
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slack.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ channel, text, mrkdwn: true })
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(`Slack post failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function sendEscalation(config, contact, reason, extra = {}) {
  return postSlack(config, baseEscalationText(config, contact, "SMS escalation", reason, extra));
}

async function sendUrgentCallNow(config, contact, extra = {}) {
  return postSlack(config, baseEscalationText(config, contact, "URGENT: PC wants a call now", "call_now", extra));
}

async function sendAppointmentBooked(config, contact, extra = {}) {
  const lines = [
    "*Call appointment booked*",
    `Name: ${contact.name || "unknown"}`,
    `Phone: ${contact.phone || "unknown"}`,
    `Primary: ${extra["Primary call time"] || contact.preferredCallTime || "unknown"}`,
    `Backup: ${extra["Backup time"] || contact.backupCallTime || "none"}`,
    `Timezone: ${extra.Timezone || contact.timezone || "unknown"}`,
    answerLines(contact),
    `Appointment: ${extra["GHL appointment"] || contact.appointmentId || "unknown"}`,
    `GHL: ${contactLink(config, contact) || "unknown"}`
  ];
  if (extra.Action) lines.splice(1, 0, `Action: ${extra.Action}`);
  return postSlack(config, lines.join("\n"), config.slack.bookingChannel || config.slack.channel);
}

async function sendBotError(config, title, details = {}) {
  const channel = config.slack.botErrorsChannel;
  if (!channel) {
    return { ok: true, skipped: true, reason: "SLACK_BOT_ERRORS_CHANNEL not configured" };
  }
  const lines = [`*${title}*`];
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined && value !== null && value !== "") lines.push(`${key}: ${value}`);
  }
  return postSlack(config, lines.join("\n"), channel);
}

module.exports = { sendEscalation, sendUrgentCallNow, sendAppointmentBooked, sendBotError };
