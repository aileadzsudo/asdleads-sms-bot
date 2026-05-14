const { contactLink } = require("./ghl");

const CALL_NOW_LEADS_CHANNEL = "C09N85J9G4Q";

function baseEscalationText(config, contact, title, reason, extra = {}) {
  const hiddenExtraFields = new Set(["Confidence", "Accident date", "Fault", "Medical"]);
  const lines = [
    `*${title}*`,
    `Reason: ${reason}`,
    `Name: ${contact.name || "unknown"}`,
    `Phone: ${contact.phone || "unknown"}`,
    `Last inbound: ${contact.lastInboundMessage || "unknown"}`,
    `GHL: ${contactLink(config, contact) || "unknown"}`
  ];
  for (const [key, value] of Object.entries(extra)) {
    if (hiddenExtraFields.has(key)) continue;
    if (value) lines.push(`${key}: ${value}`);
  }
  return lines.join("\n");
}

function smsEscalationText(config, contact) {
  return [
    `Name: ${contact.name || "unknown"}`,
    `Message: ${contact.lastInboundMessage || "unknown"}`,
    `Link: ${contactLink(config, contact) || "unknown"}`
  ].join("\n");
}

async function postSlack(config, text, channel = config.slack.channel) {
  if ((config.dryRun && !config.slack.sendInDryRun) || !config.slack.token) {
    return { ok: true, skipped: true, reason: "Slack post skipped by dry run setting or missing token", channel, text };
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
  const message = String(contact.lastInboundMessage || "").trim();
  if (!message || message.toLowerCase() === "unknown") {
    return { ok: true, skipped: true, reason: "Slack escalation skipped because no inbound message was available" };
  }
  return postSlack(config, smsEscalationText(config, contact));
}

async function sendUrgentCallNow(config, contact, extra = {}) {
  return postSlack(
    config,
    baseEscalationText(config, contact, "URGENT: PC wants a call now", "call_now", extra),
    CALL_NOW_LEADS_CHANNEL
  );
}

async function sendEscalatedInbound(config, contact) {
  return postSlack(
    config,
    [
      "*New reply on escalated lead*",
      `Name: ${contact.name || "unknown"}`,
      `Message: ${contact.lastInboundMessage || "unknown"}`,
      `Link: ${contactLink(config, contact) || "unknown"}`
    ].join("\n")
  );
}

async function sendAppointmentBooked(config, contact, extra = {}) {
  const lines = [
    `*${extra.Title || "Call appointment booked"}*`,
    `Name: ${contact.name || "unknown"}`,
    `Phone: ${contact.phone || "unknown"}`,
    `Primary: ${extra["Primary call time"] || contact.preferredCallTime || "unknown"}`,
    `Backup: ${extra["Backup time"] || contact.backupCallTime || "none"}`,
    `Timezone: ${extra.Timezone || contact.timezone || "unknown"}`,
    `Appointment: ${extra["GHL appointment"] || contact.appointmentId || "unknown"}`,
    `GHL: ${contactLink(config, contact) || "unknown"}`
  ];
  if (extra.Action) lines.splice(1, 0, `Action: ${extra.Action}`);
  return postSlack(config, lines.join("\n"), config.slack.bookingChannel || config.slack.channel);
}

async function sendAppointmentNotice(config, contact, title, extra = {}) {
  const lines = [
    `*${title}*`,
    `Name: ${contact.name || "unknown"}`,
    `Phone: ${contact.phone || "unknown"}`,
    `Primary: ${extra.Primary || contact.preferredCallTime || "unknown"}`,
    `Backup: ${extra.Backup || contact.backupCallTime || "none"}`,
    `Action: ${extra.Action || "Review appointment status"}`,
    `GHL: ${contactLink(config, contact) || "unknown"}`
  ];
  if (extra.Appointment) lines.splice(5, 0, `Appointment: ${extra.Appointment}`);
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

module.exports = { sendEscalation, sendUrgentCallNow, sendEscalatedInbound, sendAppointmentBooked, sendAppointmentNotice, sendBotError };
