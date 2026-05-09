const { ENGAGEMENT, QUALIFICATION } = require("./constants");
const {
  coldOutreachTemplates,
  freshLeadFollowUpTemplates,
  qualificationTemplates,
  humanReturnTemplates,
  reengagementTemplates,
  persistentReengagementTemplates,
  warmFollowUpTemplates,
  reminderTemplates,
  missedCallTemplates,
  noShowTemplates,
  backupReminderTemplates,
  render
} = require("./templates");
const {
  normalize,
  isOptOut,
  escalationReason,
  classifyHumanContextIntent,
  parseAccidentDate,
  parseCallTime,
  parseExpectedAnswer
} = require("./classifier");
const { classifyWithLlm } = require("./llmClassifier");
const {
  addMinutes,
  formatForContact,
  getLocalParts,
  isWithinTextingWindow,
  localDateToUtc,
  localSlotDate,
  nextTextingWindow,
  sameLocalDay
} = require("./time");
const { resolveContactTimezone, timezoneFromText } = require("./timezoneResolver");
const ghl = require("./adapters/ghl");
const slack = require("./adapters/slack");
const { recordBotError } = require("./opsLog");
const { chooseTemplateVariant } = require("./templateManager");

const WARM_FOLLOW_UP_MINUTES = [5, 15, 30, 60, 120, 240];
const REENGAGEMENT_DAYS = [1, 2, 3, 4, 5, 6, 7];
const REENGAGEMENT_SLOTS = ["am", "pm"];
const HUMAN_ESCALATION_SLA_MINUTES = [5, 15, 30];
const HUMAN_REPLY_TIMEOUT_MINUTES = 5;
const HUMAN_CALL_TIMEOUT_MINUTES = 30;
const INBOUND_BUFFER_SECONDS = 30;
const FRESH_LEAD_FOLLOW_UP_MINUTES = [15, 60];
const NO_SHOW_SAME_DAY_MINUTES = [10, 45, 120, 240, 360];
const NO_SHOW_DAYS = [2, 3, 4, 5, 6, 7];
const BOT_SEQUENCE_JOB_TYPES = [
  "initial_sms",
  "cold_entry_check",
  "send_cold_template",
  "fresh_lead_followup",
  "warm_followup",
  "enter_reengagement",
  "send_reengagement_template",
  "appointment_reminder",
  "missed_call_followup",
  "backup_time_timeout",
  "backup_no_show_reminder"
];

function customValue(payload, key) {
  return payload.customData?.[key] || payload.custom_data?.[key] || "";
}

function isEmptyTextToken(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return ["undefined", "null", "[object object]", "nan"].includes(text.toLowerCase());
}

function textValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return isEmptyTextToken(value) ? "" : value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textValue(item);
      if (text) return text;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const key of [
      "message",
      "body",
      "text",
      "content",
      "value",
      "reply",
      "latestReply",
      "latest_reply",
      "name",
      "fullName",
      "full_name",
      "firstName",
      "first_name",
      "state"
    ]) {
      const text = textValue(value[key]);
      if (text) return text;
    }
  }
  return "";
}

function tagLookupFailedAfter(contact, startedAt) {
  if (!contact?.lastTagLookupFailedAt || !startedAt) return false;
  return new Date(contact.lastTagLookupFailedAt).getTime() >= new Date(startedAt).getTime();
}

function normalizePayload(payload, config) {
  const source = payload.contact || payload.contactData || payload.contact_data || payload;
  const firstName = payload.firstName || payload.first_name || source.firstName || source.first_name;
  const lastName = payload.lastName || payload.last_name || source.lastName || source.last_name;
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const contactId =
    payload.contactId ||
    payload.ghlContactId ||
    payload.contact_id ||
    payload["contact.id"] ||
    payload["Contact ID"] ||
    payload.id ||
    source.contactId ||
    source.contact_id ||
    source.id ||
    source.phone ||
    source.phoneNumber ||
    payload.phone;
  const normalized = { id: contactId };
  const fields = {
    ghlContactId: payload.ghlContactId || payload.contactId || payload.contact_id || payload["contact.id"] || payload["Contact ID"] || payload.id || source.contactId || source.contact_id || source.id,
    name:
      payload.name ||
      payload.fullName ||
      payload.contactName ||
      payload.full_name ||
      payload["contact.name"] ||
      payload["Contact Name"] ||
      fullName ||
      payload.firstName ||
      source.name ||
      source.fullName ||
      source.contactName ||
      source.full_name ||
      [source.firstName || source.first_name, source.lastName || source.last_name].filter(Boolean).join(" ") ||
      source.firstName,
    phone: payload.phone || payload.phoneNumber || payload.phone_number || payload["contact.phone"] || payload["Contact Phone"] || source.phone || source.phoneNumber || source.phone_number,
    timezone: payload.timezone || payload.timeZone || source.timezone || source.timeZone,
    state: payload.state || payload.locationState || payload["contact.state"] || source.state || source.locationState || source.address?.state,
    owner: [
      payload.owner,
      payload.contactOwner,
      payload.contact_owner,
      payload.assignedTo,
      payload.assigned_to,
      payload.assignedUser,
      payload.assigned_user,
      payload.user,
      source.owner,
      source.contactOwner,
      source.contact_owner,
      source.assignedTo,
      source.assigned_to,
      source.assignedUser,
      source.assigned_user,
      source.user
    ].map(textValue).find(Boolean),
    leadSource: payload.leadSource || payload.source || payload.lead_source || payload["contact.source"] || source.leadSource || source.source || source.lead_source,
    ghlContactLink: payload.ghlContactLink || payload.contactLink,
    tags: payload.tags || payload.contactTags || payload.tag || source.tags,
    lastInboundMessage: [
      payload.message,
      payload.body,
      payload.text,
      payload.messageBody,
      payload.message_body,
      payload["message.body"],
      payload["AI MVP Latest Reply"],
      customValue(payload, "message"),
      customValue(payload, "body"),
      customValue(payload, "text"),
      customValue(payload, "messageBody"),
      customValue(payload, "message_body"),
      customValue(payload, "AI MVP Latest Reply")
    ].map(textValue).find(Boolean)
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") normalized[key] = value;
  }
  if (normalized.timezone || normalized.state || normalized.owner || normalized.tags || !contactId) {
    normalized.timezone = resolveContactTimezone(normalized, config);
  }
  return normalized;
}

function normalizeTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) {
    return tags.flatMap((tag) => normalizeTags(tag));
  }
  if (typeof tags === "object") {
    return [tags.name, tags.label, tags.value, tags.tag, tags.text].flatMap((tag) => normalizeTags(tag)).filter(Boolean);
  }
  const raw = String(tags).toLowerCase().trim();
  if (!raw) return [];
  if (raw.includes(",")) return raw.split(",").flatMap((tag) => normalizeTags(tag));
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? [raw, ...parts] : [raw];
}

function hasSignedTag(contact) {
  return hasAnyTag(contact, ["signed", "contract_set"]);
}

function hasNqTag(contact) {
  return normalizeTags(contact.tags).some((tag) => tag === "nq" || tag === "#nq" || tag === "notqualified" || tag === "not_qualified");
}

function actionFromTags(tags) {
  const normalizedTags = normalizeTags(tags).map((tag) => tag.replace(/^#/, "").replace(/[-\s]+/g, "_"));
  if (normalizedTags.some((tag) => ["return_to_bot", "returntobot", "resume_bot", "bot_resume"].includes(tag))) {
    return "return_to_bot";
  }
  if (normalizedTags.some((tag) => ["human_acknowledged", "human_ack", "human_working"].includes(tag))) {
    return "human_acknowledged";
  }
  if (normalizedTags.some((tag) => ["nq", "notqualified", "not_qualified"].includes(tag))) return "nq";
  if (normalizedTags.some((tag) => tag === "signed")) return "signed";
  if (normalizedTags.some((tag) => ["do_not_contact", "dnc", "opt_out"].includes(tag))) return "do_not_contact";
  return "";
}

function hasAnyTag(contact, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase().replace(/^#/, "").replace(/[-\s]+/g, "_")));
  return normalizeTags(contact.tags).some((tag) => wanted.has(tag.replace(/^#/, "").replace(/[-\s]+/g, "_")));
}

function hasManualHumanHoldTag(contact) {
  return hasAnyTag(contact, [
    "human_hold",
    "keep_human",
    "manual_hold",
    "do_not_return_to_bot",
    "manual_follow_up",
    "qr"
  ]);
}

function hasExistingRepresentation(text) {
  const t = normalize(text);
  return /\b(already|currently|now)\s+(have|got|hired|with|represented by|working with)\s+(a\s+)?(lawyer|attorney|law firm|representation|counsel)\b/.test(t) ||
    /\b(i have|i've got|ive got|my)\s+(a\s+)?(lawyer|attorney|law firm|representation)\b/.test(t) ||
    /\b(represented|have representation|already represented)\b/.test(t);
}

function isBenignAppointmentAcknowledgement(text) {
  const t = normalize(text);
  if (!t || t.includes("?")) return false;
  return /^(thanks|thank you|thank u|thx|ok thanks|okay thanks|appreciate it|sounds good|great|perfect|got it|ok|okay|k|cool)$/i.test(t);
}

function hasBookedAppointment(contact) {
  return Boolean(
    contact?.appointmentId ||
      contact?.preferredCallTimeIso ||
      contact?.preferredCallTime ||
      contact?.engagementStatus === ENGAGEMENT.CALL_SCHEDULED ||
      contact?.qualificationProgress === QUALIFICATION.CALL_BOOKED ||
      contact?.qualificationProgress === QUALIFICATION.COMPLETE
  );
}

function looksPostSignedOrFirmIssue(text) {
  const t = normalize(text);
  return [
    "case manager",
    "my case",
    "your firm",
    "your office",
    "already signed",
    "i signed",
    "docusign",
    "attorney people",
    "lack of communication",
    "called your office",
    "missed call",
    "ai service",
    "too much ai",
    "accident report",
    "police report",
    "insurance card",
    "driver license",
    "documents",
    "paperwork"
  ].some((phrase) => t.includes(phrase));
}

function callAskTemplateForTime(contact, config, now = new Date()) {
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  const local = getLocalParts(now, timeZone);
  const lateEvening = local.hour >= 20;
  if (!isWithinTextingWindow(contact, config, now) || lateEvening) {
    return "Based on what you’ve shared, we can definitely help you out! 💰 The next step is to connect you with an Accident Support Desk Specialist who can create a compensation gameplan for you. What time works best tomorrow or the next day? 📞";
  }
  if (local.hour >= 18) {
    return "Based on what you’ve shared, we can definitely help you out! 💰 The next step is to connect you with an Accident Support Desk Specialist who can create a compensation gameplan for you. Are you open for a call this evening or tomorrow? 📞";
  }
  return qualificationTemplates.callAsk;
}

function currentQuestionTemplate(contact, config) {
  if (contact.qualificationProgress === QUALIFICATION.NEEDS_FAULT) return qualificationTemplates.fault;
  if (contact.qualificationProgress === QUALIFICATION.NEEDS_MEDICAL) return qualificationTemplates.medical;
  if (contact.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME) return callAskTemplateForTime(contact, config);
  return "";
}

function humanReturnTemplate(contact, config) {
  return humanReturnTemplates[contact.qualificationProgress] || currentQuestionTemplate(contact, config);
}

function warmFollowUpTemplate(contact, step, config) {
  const key =
    contact.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME && contact.awaitingSpecificCallTime
      ? "needs_call_time_specific"
      : contact.qualificationProgress;
  const byProgress = warmFollowUpTemplates[key];
  return byProgress?.[step] || currentQuestionTemplate(contact, config);
}

function reengagementTemplateKey(day, slot) {
  return `day_${day}_${slot}`;
}

function reengagementTemplate(sequence, payload = {}) {
  if (payload.templateKey) return persistentReengagementTemplates[sequence]?.[payload.templateKey] || "";
  return reengagementTemplates[sequence]?.[payload.day] || "";
}

function isAffirmativeConfirmation(text) {
  return /^(yes|y|yeah|yep|confirmed|confirm|still good|good)$/i.test(normalize(text));
}

function canTreatDateAsColdOutreachAnswer(contact) {
  return (
    contact.qualificationProgress === QUALIFICATION.NEEDS_FAULT &&
    !contact.faultAnswer &&
    [
      ENGAGEMENT.CALLED_NO_ANSWER,
      ENGAGEMENT.INITIAL_SMS_SENT,
      ENGAGEMENT.COLD_OUTREACH,
      ENGAGEMENT.ACTIVE_CONVERSATION
    ].includes(contact.engagementStatus)
  );
}

function isBotManagedContact(contact) {
  if (!contact) return false;
  return Boolean(
    contact.engagementStatus ||
      contact.currentSequenceName ||
      contact.qualificationProgress ||
      contact.backfilledAt ||
      contact.lastOutboundTimestamp ||
      (Array.isArray(contact.sentColdTemplateKeys) && contact.sentColdTemplateKeys.length)
  );
}

function humanContextResponse(contact, intent, config) {
  if (intent.intent === "prefers_text") {
    const template = currentQuestionTemplate(contact, config);
    return template ? `Absolutely, we can keep this over text 🙏 ${render(template, contact)}` : "";
  }
  if (contact.qualificationProgress === QUALIFICATION.NEEDS_FAULT) {
    return "No worries at all 🙏 I can keep this quick over text. I just need a couple details about the accident to see if we can help. First, were you at fault for the accident, or was it the other driver?";
  }
  if (contact.qualificationProgress === QUALIFICATION.NEEDS_MEDICAL) {
    return "No worries at all 🙏 I can keep this quick over text. I just need a couple details about the accident to see if we can help. Have you needed to see a doctor or get any medical treatment after the accident? 🤕";
  }
  if (contact.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME) {
    return "No worries at all 🙏 What time works best tomorrow or the next day for a quick Specialist call? 📞";
  }
  return "";
}

function looksLikeCallScheduling(text) {
  const t = normalize(text);
  return (
    /\b(call|talk|speak|schedule|appointment|specialist|available|free|later|tomorrow|today|tonight|morning|afternoon|evening|noon)\b/.test(t) ||
    /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/.test(t)
  );
}

function hasCallIntentText(text) {
  const t = normalize(text);
  return /\b(open|available|free|call|talk|speak|meeting|appointment|schedule|specialist)\b/.test(t);
}

function isSoftEscalationReason(reason = "") {
  return [
    "message_after_bot_paused",
    "llm_asks_who_this_is",
    "company_question",
    "low_confidence_answer",
    "llm_needs_escalation",
    "llm_unhandled_needs_escalation",
    "llm_unknown"
  ].includes(String(reason || ""));
}

function canAutoReturnUnacknowledgedEscalation(contact, job = {}) {
  if (!contact?.humanEscalationStatus || contact.humanEscalationStage !== "human_review_pending") return false;
  if (contact.automationPaused) return false;
  if (
    contact.optOutStatus ||
    hasSignedTag(contact) ||
    hasNqTag(contact) ||
    hasManualHumanHoldTag(contact) ||
    contact.engagementStatus === ENGAGEMENT.CALL_SCHEDULED ||
    contact.qualificationProgress === QUALIFICATION.CALL_BOOKED ||
    contact.qualificationProgress === QUALIFICATION.COMPLETE ||
    contact.appointmentId
  ) {
    return false;
  }
  const minutes = Number(job.payload?.minutes || 0);
  if (minutes < 30) return false;
  const reason = String(job.payload?.reason || contact.escalationReason || "");
  return [
    "detailed_information",
    "low_confidence_answer",
    "llm_unknown",
    "llm_needs_escalation",
    "llm_unhandled_needs_escalation",
    "llm_low_confidence_answer",
    "llm_unhandled_unknown",
    "llm_call_time_unknown",
    "message_after_bot_paused"
  ].includes(reason);
}

function canAutoResumeFromSoftEscalation(contact, text, config) {
  if (contact.engagementStatus !== ENGAGEMENT.ESCALATED_TO_HUMAN) return false;
  if (contact.automationPaused) return false;
  if (!isSoftEscalationReason(contact.escalationReason)) return false;
  if (contact.humanEscalationStage && contact.humanEscalationStage !== "human_review_pending") return false;
  if (parseAccidentDate(text)) return true;
  return Boolean(looksLikeCallScheduling(text) && parseCallTime(text, contact, config));
}

function canAutoResumeHumanScheduling(contact, text, config) {
  if (contact.engagementStatus !== ENGAGEMENT.ESCALATED_TO_HUMAN) return false;
  if (!["human_working", "human_replied_waiting"].includes(contact.humanEscalationStage)) return false;
  if (contact.automationPauseReason && contact.automationPauseReason !== "human_working") return false;
  if (contact.appointmentId || contact.qualificationProgress === QUALIFICATION.CALL_BOOKED) return false;
  const schedulingContact = { ...contact, qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME };
  return Boolean(looksLikeCallScheduling(text) && parseCallTime(text, schedulingContact, config));
}

function needsQualificationReply(contact) {
  return [QUALIFICATION.NEEDS_FAULT, QUALIFICATION.NEEDS_MEDICAL, QUALIFICATION.NEEDS_CALL_TIME].includes(
    contact?.qualificationProgress
  );
}

function hasPendingJob(jobs, types) {
  const wanted = new Set(types);
  return jobs.some((job) => job.status === "pending" && wanted.has(job.type));
}

function hasExplicitCallDate(text) {
  const t = normalize(text);
  return /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month)\b/.test(t) ||
    /\b\d{1,2}[/-]\d{1,2}/.test(t) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/.test(t);
}

function isRescheduleRequest(text) {
  const t = normalize(text);
  return /\b(reschedule|re-schedule|move it|move the call|change the time|change my time|different time|another time|another day|instead|push it back|push back|can't make it|cant make it|need to move|need a new time)\b/.test(t);
}

function isPrimaryCallCorrectionWhileAwaitingBackup(text, contact, config) {
  if (!contact.preferredCallTimeIso) return false;
  const t = normalize(text);
  const parsed = parseCallTime(text, contact, config);
  if (parsed?.type !== "scheduled") return false;
  if (/\b(not tomorrow|not for tomorrow|today|call today|you can call today|u can call today)\b/.test(t)) return true;
  if (/\b(primary|main time|first time|actual time)\b/.test(t)) return true;
  if (hasExplicitCallDate(text) && hasCallIntentText(text)) {
    return new Date(parsed.startsAt) < new Date(contact.preferredCallTimeIso);
  }
  return false;
}

function hasLocationTimezoneSignal(contact = {}) {
  return Boolean(
    contact.state ||
    contact.locationState ||
    contact.owner ||
    contact.contactOwner ||
    contact.assignedTo ||
    contact.assignedUser ||
    contact.user ||
    contact.tags
  );
}

function chooseContactTimezone(existing = {}, inbound = {}, config) {
  if (hasLocationTimezoneSignal(inbound)) return resolveContactTimezone(inbound, config);
  const defaultTimezone = config.texting.defaultTimezone;
  if (inbound.timezone && inbound.timezone !== defaultTimezone) return inbound.timezone;
  return existing.timezone || inbound.timezone || defaultTimezone;
}

function anchorBackupTimeToPrimaryDate(parsed, contact, config) {
  if (!contact.preferredCallTimeIso || parsed?.type !== "scheduled") return parsed;
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  const backupClock = getLocalParts(new Date(parsed.startsAt), timeZone);
  const primaryDate = getLocalParts(new Date(contact.preferredCallTimeIso), timeZone);
  return {
    ...parsed,
    startsAt: localDateToUtc({
      year: primaryDate.year,
      month: primaryDate.month,
      day: primaryDate.day,
      hour: backupClock.hour,
      minute: backupClock.minute
    }, timeZone).toISOString()
  };
}

function parseBackupWindow(text) {
  const t = normalize(String(text || "").replace(/[–—]/g, "-"));
  const match = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|through|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (!match) return null;
  let startHour = Number(match[1]);
  const startMinute = Number(match[2] || 0);
  const startMeridiem = match[3];
  let endHour = Number(match[4]);
  const endMinute = Number(match[5] || 0);
  const endMeridiem = match[6];
  const sharedMeridiem = endMeridiem || startMeridiem;
  if (sharedMeridiem === "pm") {
    if (startHour < 12) startHour += 12;
    if (endHour < 12) endHour += 12;
  }
  if (sharedMeridiem === "am") {
    if (startHour === 12) startHour = 0;
    if (endHour === 12) endHour = 0;
  }
  if (!sharedMeridiem && startHour >= 1 && startHour <= 7 && endHour >= 1 && endHour <= 7) {
    startHour += 12;
    endHour += 12;
  }
  if (startHour >= endHour && endMeridiem === "pm" && !startMeridiem && startHour < 12) startHour += 12;
  const meridiem = endHour >= 12 ? "PM" : "AM";
  const displayHour = (hour) => {
    const h = hour % 12 || 12;
    return String(h);
  };
  const displayMinute = (minute) => (minute ? `:${String(minute).padStart(2, "0")}` : "");
  return {
    value: `${displayHour(startHour)}${displayMinute(startMinute)}-${displayHour(endHour)}${displayMinute(endMinute)} ${meridiem}`,
    startHour,
    startMinute,
    endHour,
    endMinute,
    confidence: 0.86
  };
}

function backupWindowStartIso(contact, config) {
  if (!contact.preferredCallTimeIso) return "";
  const startHour = Number(contact.backupWindowStartHour);
  const startMinute = Number(contact.backupWindowStartMinute || 0);
  if (!Number.isFinite(startHour)) return "";
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  const primaryDate = getLocalParts(new Date(contact.preferredCallTimeIso), timeZone);
  return localDateToUtc(
    {
      year: primaryDate.year,
      month: primaryDate.month,
      day: primaryDate.day,
      hour: startHour,
      minute: startMinute
    },
    timeZone
  ).toISOString();
}

function backupReminderTargetIso(contact, config) {
  if (contact.backupCallTimeIso) return contact.backupCallTimeIso;
  if (contact.backupCallTimeType === "window") return backupWindowStartIso(contact, config);
  return "";
}

function looksLikeInjuryContext(text) {
  const t = normalize(text);
  return /\b(injury|injuries|injured|hurt|hurting|pain|painful|sore|soreness|neck|back|shoulder|headache|whiplash|hospital|er|urgent care|doctor|medical|treatment)\b/.test(t);
}

function isPermanentSmsBlockError(error) {
  return /DND is active for SMS|do not disturb|opted out|unsubscribed/i.test(error?.message || "");
}

function formatTimeOnly(date, contact, config) {
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone
  }).format(date);
}

function roundToQuarterHour(date) {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  const remainder = minutes % 15;
  if (remainder >= 8) rounded.setMinutes(minutes + (15 - remainder), 0, 0);
  else rounded.setMinutes(minutes - remainder, 0, 0);
  return rounded;
}

function relativeTimeClarification(parsed, contact, config) {
  if (!parsed.relativeTarget) return "";
  const first = roundToQuarterHour(new Date(parsed.relativeTarget));
  const second = addMinutes(first, 15);
  return `Just to confirm, do you mean around ${formatTimeOnly(first, contact, config)} or ${formatTimeOnly(second, contact, config)}? Reply with the exact time that works best.`;
}

function appointmentNotes(contact, extra = {}) {
  const lines = [
    "Booked by Accident Support Desk SMS bot",
    `Primary call time: ${extra.primaryTime || contact.preferredCallTime || "unknown"}`,
    `Backup time: ${extra.backupTime || contact.backupCallTime || "pending"}`,
    `Timezone: ${contact.timezone || "unknown"}`
  ];
  if (extra.reason) lines.push(`Note: ${extra.reason}`);
  return lines.join("\n");
}

function timezoneCorrectionFromText(text) {
  const t = normalize(text);
  const timezoneAlias = t.match(/\b(pacific|pst|pdt|mountain|mst|mdt|central|cst|cdt|eastern|est|edt)\b/);
  if (timezoneAlias) return timezoneFromText(timezoneAlias[0]);

  const stateName = t.match(
    /\b(california|colorado|texas|washington|north dakota|nevada|kentucky|arizona|oregon|florida|new york)\b/
  );
  if (stateName && /\b(i am|i'm|im|we are|located|live|staying|based|in|from)\b/.test(t)) {
    return timezoneFromText(stateName[0]);
  }

  const explicitStateCode = t.match(/\b(?:in|from|located in|live in|staying in)\s+(ca|co|tx|wa|nd|nv|ky|az|or|fl|ny)\b/);
  if (explicitStateCode) return timezoneFromText(explicitStateCode[1]);

  return "";
}

class SmsBot {
  constructor(store, config) {
    this.store = store;
    this.config = config;
  }

  async notifyBotError(title, details = {}, options = {}) {
    try {
      const recorded = await recordBotError(this.store, title, details, options);
      if (!recorded.shouldNotifySlack) return;
      await slack.sendBotError(this.config, title, details);
    } catch (error) {
      console.error("bot error notification failed", title, error.message);
    }
  }

  async syncAppointmentNotes(contact, extra = {}) {
    if (!contact.appointmentId || !contact.preferredCallTimeIso) return false;
    try {
      await ghl.updateAppointment(
        this.config,
        contact,
        contact.appointmentId,
        contact.preferredCallTimeIso,
        addMinutes(new Date(contact.preferredCallTimeIso), 15).toISOString(),
        appointmentNotes(contact, extra)
      );
      return true;
    } catch (error) {
      await this.notifyBotError("GHL appointment notes update failed", {
        Name: contact.name || "unknown",
        Phone: contact.phone || "unknown",
        "GHL contact": contact.ghlContactId || contact.id,
        "Appointment ID": contact.appointmentId || "unknown",
        Error: error.message
      });
      return false;
    }
  }

  async applyTimezoneCorrection(contact, inboundText) {
    const correctedTimezone = timezoneCorrectionFromText(inboundText);
    if (!correctedTimezone || correctedTimezone === contact.timezone) return contact;
    const oldTimezone = contact.timezone || this.config.texting.defaultTimezone;
    let patch = {
      ...contact,
      timezone: correctedTimezone,
      timezoneCorrectedAt: new Date().toISOString(),
      timezoneCorrectionSource: inboundText
    };
    if (contact.preferredCallTimeIso) {
      const oldLocal = getLocalParts(new Date(contact.preferredCallTimeIso), oldTimezone);
      const correctedStart = localDateToUtc(
        {
          year: oldLocal.year,
          month: oldLocal.month,
          day: oldLocal.day,
          hour: oldLocal.hour,
          minute: oldLocal.minute
        },
        correctedTimezone
      );
      patch = {
        ...patch,
        preferredCallTimeIso: correctedStart.toISOString(),
        preferredCallTime: formatForContact(correctedStart, { ...contact, timezone: correctedTimezone }, this.config)
      };
      if (contact.appointmentId) {
        try {
          await ghl.updateAppointment(
            this.config,
            patch,
            contact.appointmentId,
            patch.preferredCallTimeIso,
            addMinutes(correctedStart, 15).toISOString(),
            appointmentNotes(patch, { reason: `Timezone corrected from ${oldTimezone} to ${correctedTimezone}.` })
          );
        } catch (error) {
          await this.notifyBotError("GHL appointment timezone correction failed", {
            Name: contact.name || "unknown",
            Phone: contact.phone || "unknown",
            "GHL contact": contact.ghlContactId || contact.id,
            "Appointment ID": contact.appointmentId || "unknown",
            Error: error.message
          });
        }
      }
    }
    const updated = await this.store.upsertContact(patch);
    if (updated.preferredCallTimeIso) await this.scheduleAppointmentReminders(updated);
    return updated;
  }

  async refreshTimezoneFromContact(contact, source = "timezone_refresh") {
    const correctedTimezone = resolveContactTimezone(contact, this.config);
    if (!correctedTimezone) return contact;
    const displayedTimezone = timezoneFromText(contact.preferredCallTime || "");
    const needsAppointmentRetime =
      contact.preferredCallTimeIso && displayedTimezone && displayedTimezone !== correctedTimezone;
    if (correctedTimezone === contact.timezone && !needsAppointmentRetime) return contact;
    const oldTimezone = displayedTimezone || contact.timezone || this.config.texting.defaultTimezone;
    let patch = {
      ...contact,
      timezone: correctedTimezone,
      timezoneCorrectedAt: new Date().toISOString(),
      timezoneCorrectionSource: source
    };
    if (contact.preferredCallTimeIso) {
      const oldLocal = getLocalParts(new Date(contact.preferredCallTimeIso), oldTimezone);
      const correctedStart = localDateToUtc(
        {
          year: oldLocal.year,
          month: oldLocal.month,
          day: oldLocal.day,
          hour: oldLocal.hour,
          minute: oldLocal.minute
        },
        correctedTimezone
      );
      patch = {
        ...patch,
        preferredCallTimeIso: correctedStart.toISOString(),
        preferredCallTime: formatForContact(correctedStart, { ...contact, timezone: correctedTimezone }, this.config)
      };
      if (contact.appointmentId) {
        try {
          await ghl.updateAppointment(
            this.config,
            patch,
            contact.appointmentId,
            patch.preferredCallTimeIso,
            addMinutes(correctedStart, 15).toISOString(),
            appointmentNotes(patch, { reason: `Timezone refreshed from ${oldTimezone} to ${correctedTimezone}.` })
          );
        } catch (error) {
          await this.notifyBotError("GHL appointment timezone refresh failed", {
            Name: contact.name || "unknown",
            Phone: contact.phone || "unknown",
            "GHL contact": contact.ghlContactId || contact.id,
            "Appointment ID": contact.appointmentId || "unknown",
            Error: error.message
          });
        }
      }
    }
    const updated = await this.store.upsertContact(patch);
    if (updated.preferredCallTimeIso) await this.scheduleAppointmentReminders(updated);
    return updated;
  }

  async scheduleHumanEscalationWatchdog(contact, reason) {
    await this.store.cancelJobsForContact(contact.id, "human escalation watchdog replaced", (job) =>
      job.type === "human_escalation_sla"
    );
    for (const minutes of HUMAN_ESCALATION_SLA_MINUTES) {
      await this.store.addJob({
        type: "human_escalation_sla",
        contactId: contact.id,
        runAt: addMinutes(new Date(), minutes).toISOString(),
        payload: { minutes, reason }
      });
    }
  }

  async cancelHumanEscalationWatchdog(contactId, reason) {
    await this.store.cancelJobsForContact(contactId, reason, (job) => job.type === "human_escalation_sla");
  }

  async recordDecision(contact, action, reason, extra = {}) {
    if (!contact || !this.store.addDecisionLog) return null;
    try {
      return await this.store.addDecisionLog({
        contactId: contact.id,
        action,
        reason,
        trigger: extra.trigger || "",
        beforeStatus: extra.beforeStatus || "",
        afterStatus: extra.afterStatus || contact.engagementStatus || "",
        beforeProgress: extra.beforeProgress || "",
        afterProgress: extra.afterProgress || contact.qualificationProgress || "",
        message: extra.message || "",
        jobId: extra.jobId || "",
        jobType: extra.jobType || "",
        meta: extra.meta || {}
      });
    } catch (error) {
      console.error("decision log failed", error);
      return null;
    }
  }

  async sendBotMessage(contact, message, options = {}) {
    if (isEmptyTextToken(message)) {
      await this.recordDecision(contact, "skipped", "empty_bot_message", { meta: { templateKey: options.templateKey || "" } });
      return null;
    }
    if (!options.allowAfterOptOut && (contact.optOutStatus || contact.engagementStatus === ENGAGEMENT.OPTED_OUT)) {
      await this.recordDecision(contact, "skipped", "opted_out_or_terminal", { message, meta: { templateKey: options.templateKey || "" } });
      return null;
    }
    if (!options.skipTerminalTagCheck) {
      const tagLookupStartedAt = new Date();
      contact = await this.hydrateContactTags(contact, { force: true });
      if (tagLookupFailedAfter(contact, tagLookupStartedAt)) {
        await this.recordDecision(contact, "skipped", "tag_lookup_failed_no_send", {
          message,
          meta: { error: contact.lastTagLookupError || "GHL contact tag lookup failed" }
        });
        return null;
      }
      if (hasSignedTag(contact)) {
        await this.stopForSignedTag(contact);
        await this.recordDecision(contact, "skipped", "signed_tag", { message });
        return null;
      }
      if (hasNqTag(contact)) {
        await this.stopForNqTag(contact);
        await this.recordDecision(contact, "skipped", "nq_tag", { message });
        return null;
      }
      if (hasManualHumanHoldTag(contact)) {
        await this.stopForManualHoldTag(contact);
        await this.recordDecision(contact, "skipped", "manual_hold_tag", { message });
        return null;
      }
    }
    if (!options.bypassQuietHours && !isWithinTextingWindow(contact, this.config)) {
      const job = await this.store.addJob({
        type: "send_message",
        contactId: contact.id,
        runAt: nextTextingWindow(contact, this.config).toISOString(),
        payload: { message }
      });
      await this.recordDecision(contact, "queued", "quiet_hours", { message, jobId: job.id, jobType: job.type });
      return null;
    }
    try {
      await ghl.sendSms(this.config, contact, message);
    } catch (error) {
      if (isPermanentSmsBlockError(error)) {
        await this.store.upsertContact({
          ...contact,
          lastSmsBlockedAt: new Date().toISOString(),
          lastSmsBlockedReason: error.message
        });
        await this.recordDecision(contact, "skipped", "permanent_sms_block", { message, meta: { error: error.message } });
        if (options.allowAfterOptOut || contact.optOutStatus || contact.engagementStatus === ENGAGEMENT.OPTED_OUT) return null;
        throw error;
      }
      await this.recordDecision(contact, "failed", "sms_send_failed", { message, meta: { error: error.message } });
      await this.notifyBotError("GHL SMS send failed", {
        Name: contact.name || "unknown",
        Phone: contact.phone || "unknown",
        "GHL contact": contact.ghlContactId || contact.id,
        "Bot status": contact.engagementStatus || "unknown",
        Message: message,
        Error: error.message
      });
      throw error;
    }
    const updated = await this.store.upsertContact({
      ...contact,
      lastOutboundMessage: message,
      lastOutboundTimestamp: new Date().toISOString()
    });
    await this.store.addMessage({
      contactId: contact.id,
      direction: "outbound",
      body: message,
      templateGroup: options.templateGroup || "",
      templateKey: options.templateKey || "",
      templateExperimentId: options.templateExperimentId || "",
      templateVariantId: options.templateVariantId || "",
      templateVariantName: options.templateVariantName || ""
    });
    await this.recordDecision(updated, "sent", options.templateKey || options.templateGroup || "bot_message", {
      message,
      meta: {
        templateGroup: options.templateGroup || "",
        templateKey: options.templateKey || "",
        experimentId: options.templateExperimentId || "",
        variantId: options.templateVariantId || ""
      }
    });
    return updated;
  }

  async renderManagedTemplate(contact, group, key, fallback, extra = {}) {
    const selected = await chooseTemplateVariant(this.store, contact, group, key, fallback);
    return {
      message: render(selected.template, contact, extra),
      meta: {
        templateGroup: group,
        templateKey: key,
        templateExperimentId: selected.experimentId,
        templateVariantId: selected.variantId,
        templateVariantName: selected.variantName
      }
    };
  }

  async hydrateContactTags(contact, options = {}) {
    if (!contact || this.config.dryRun || (contact.tags && !options.force)) return contact;
    try {
      const data = await ghl.getContact(this.config, contact.ghlContactId || contact.id);
      const fetched = data?.contact || data;
      if (Object.prototype.hasOwnProperty.call(fetched || {}, "tags")) {
        const withTags = { ...contact, tags: fetched.tags, lastTagLookupFailedAt: "", lastTagLookupError: "" };
        return this.store.upsertContact({
          ...withTags,
          timezone: resolveContactTimezone(withTags, this.config)
        });
      }
    } catch (error) {
      const failed = await this.store.upsertContact({
        ...contact,
        lastTagLookupFailedAt: new Date().toISOString(),
        lastTagLookupError: error.message
      });
      await this.notifyBotError("GHL contact tag lookup failed", {
        Name: contact.name || "unknown",
        Phone: contact.phone || "unknown",
        "GHL contact": contact.ghlContactId || contact.id,
        Error: error.message
      }, { operationalOnly: true, slack: false, level: "warn" });
      return failed;
    }
    return contact;
  }

  async stopForNqTag(contact) {
    const updated = await this.store.upsertContact({
      ...contact,
      automationPaused: true,
      automationPauseReason: "nq_tag",
      currentSequenceName: ""
    });
    await this.store.cancelJobsForContact(updated.id, "NQ tag");
    return updated;
  }

  async stopForSignedTag(contact) {
    const updated = await this.store.upsertContact({
      ...contact,
      automationPaused: true,
      automationPauseReason: "signed_tag",
      currentSequenceName: ""
    });
    await this.store.cancelJobsForContact(updated.id, "signed tag");
    await this.notifyBotError("Signed contact paused SMS bot", {
      Name: updated.name || "unknown",
      Phone: updated.phone || "unknown",
      "GHL contact": updated.ghlContactId || updated.id,
      Tags: normalizeTags(updated.tags).join(", "),
      "Last inbound": updated.lastInboundMessage || "none"
    });
    return updated;
  }

  async stopForManualHoldTag(contact) {
    const updated = await this.store.upsertContact({
      ...contact,
      automationPaused: true,
      automationPauseReason: "manual_hold_tag",
      humanEscalationStatus: true,
      humanEscalationStage: "manual_hold_tag",
      engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
      currentSequenceName: ""
    });
    await this.store.cancelJobsForContact(updated.id, "manual hold tag");
    return updated;
  }

  async resolveInboundContact(inbound) {
    const exact = await this.store.getContact(inbound.id);
    if (exact) {
      if (!isBotManagedContact(exact)) {
        return { contact: { ...exact, ...inbound }, inboundNotEnrolled: true };
      }
      return {
        contact: await this.store.upsertContact({
          ...exact,
          ...inbound,
          timezone: chooseContactTimezone(exact, inbound, this.config)
        }),
        routedFromDuplicate: false
      };
    }

    const activeMatches = await this.store.findActiveContactsByPhone(inbound.phone);
    if (activeMatches.length === 1) {
      const canonical = activeMatches[0];
      const aliases = new Set(canonical.aliasContactIds || []);
      if (inbound.ghlContactId && inbound.ghlContactId !== canonical.ghlContactId) aliases.add(inbound.ghlContactId);
      const updated = await this.store.upsertContact({
        ...canonical,
        ...inbound,
        id: canonical.id,
        ghlContactId: canonical.ghlContactId,
        name: canonical.name || inbound.name,
        timezone: chooseContactTimezone(canonical, inbound, this.config),
        leadSource: canonical.leadSource || inbound.leadSource,
        tags: canonical.tags || inbound.tags,
        inboundGhlContactId: inbound.ghlContactId,
        aliasContactIds: Array.from(aliases)
      });
      await this.notifyBotError("Duplicate phone routed to active bot thread", {
        Phone: inbound.phone,
        "Inbound GHL contact": inbound.ghlContactId || inbound.id,
        "Active bot contact": canonical.ghlContactId || canonical.id,
        "Last inbound": inbound.lastInboundMessage
      }, { operationalOnly: true, slack: false, level: "info" });
      return { contact: updated, routedFromDuplicate: true };
    }

    if (activeMatches.length > 1) {
      const contact = await this.store.upsertContact({
        ...inbound,
        automationPaused: true,
        automationPauseReason: "duplicate_phone_conflict",
        duplicateActiveContactIds: activeMatches.map((item) => item.ghlContactId || item.id)
      });
      await this.store.cancelJobsForContact(contact.id, "duplicate phone conflict");
      await this.notifyBotError("Duplicate phone conflict needs routing", {
        Phone: inbound.phone,
        "Inbound GHL contact": inbound.ghlContactId || inbound.id,
        "Matching active contacts": activeMatches.map((item) => item.ghlContactId || item.id).join(", "),
        "Last inbound": inbound.lastInboundMessage
      });
      return { contact, duplicateConflict: true };
    }

    return { contact: inbound, inboundNotEnrolled: true };
  }

  async scheduleWarmFollowUps(contact, afterHours = false) {
    await this.store.cancelJobsForContact(contact.id, "new warm follow-up scheduled", (job) =>
      ["warm_followup", "enter_reengagement"].includes(job.type)
    );
    if (afterHours) {
      const warmRunAt = addMinutes(new Date(), 15);
      const reengagementRunAt = nextTextingWindow(contact, this.config, addMinutes(new Date(), 16));
      await this.store.addJob({
        type: "warm_followup",
        contactId: contact.id,
        runAt: warmRunAt.toISOString(),
        payload: { step: 1, minutes: 15, afterHours: true }
      });
      await this.store.addJob({
        type: "enter_reengagement",
        contactId: contact.id,
        runAt: (reengagementRunAt > warmRunAt ? reengagementRunAt : addMinutes(warmRunAt, 1)).toISOString(),
        payload: { afterHours: true }
      });
      return;
    }
    for (const [index, minutes] of WARM_FOLLOW_UP_MINUTES.entries()) {
      await this.store.addJob({
        type: "warm_followup",
        contactId: contact.id,
        runAt: addMinutes(new Date(), minutes).toISOString(),
        payload: { step: index + 1, minutes }
      });
    }
    await this.store.addJob({
      type: "enter_reengagement",
      contactId: contact.id,
      runAt: addMinutes(new Date(), 24 * 60).toISOString(),
      payload: {}
    });
  }

  async scheduleColdOutreach(contact) {
    const sentKeys = new Set(contact.sentColdTemplateKeys || []);
    const existingJobs = await this.store.listJobs(contact.id);
    const pendingKeys = new Set(
      existingJobs
        .filter((job) => job.status === "pending" && job.type === "send_cold_template")
        .map((job) => job.payload?.templateKey)
        .filter(Boolean)
    );
    for (let day = 1; day <= 21; day += 1) {
      for (const slot of ["am", "pm"]) {
        const key = `day_${day}_${slot}`;
        if (!coldOutreachTemplates[key]) continue;
        if (sentKeys.has(key)) continue;
        if (pendingKeys.has(key)) continue;
        const runAt = localSlotDate(contact, this.config, day - 1, slot);
        if (runAt <= new Date()) continue;
        await this.store.addJob({
          type: "send_cold_template",
          contactId: contact.id,
          runAt: runAt.toISOString(),
          payload: { templateKey: key, day, slot }
        });
      }
    }
  }

  async scheduleFreshLeadFollowUps(contact) {
    await this.store.cancelJobsForContact(contact.id, "fresh lead follow-ups replaced", (job) => job.type === "fresh_lead_followup");
    const now = new Date();
    const timeZone = contact.timezone || this.config.texting.defaultTimezone;
    const pmSlot = localSlotDate(contact, this.config, 0, "pm");
    for (const [index, minutes] of FRESH_LEAD_FOLLOW_UP_MINUTES.entries()) {
      const runAt = addMinutes(now, minutes);
      if (!sameLocalDay(now, runAt, timeZone)) continue;
      if (!isWithinTextingWindow(contact, this.config, runAt)) continue;
      if (Math.abs(runAt.getTime() - pmSlot.getTime()) <= 45 * 60 * 1000) continue;
      await this.store.addJob({
        type: "fresh_lead_followup",
        contactId: contact.id,
        runAt: runAt.toISOString(),
        payload: { step: index + 1, minutes }
      });
    }
  }

  async scheduleReengagement(contact, options = {}) {
    let sequence = "";
    if (contact.qualificationProgress === QUALIFICATION.NEEDS_FAULT) sequence = "after_date";
    if (contact.qualificationProgress === QUALIFICATION.NEEDS_MEDICAL) sequence = "after_q1";
    if (contact.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME) sequence = "after_call_booking";
    if (!sequence) return;
    await this.store.cancelJobsForContact(contact.id, "new re-engagement scheduled", (job) => job.type === "send_reengagement_template");
    let updated = await this.store.upsertContact({
      ...contact,
      engagementStatus: ENGAGEMENT.RE_ENGAGEMENT,
      currentSequenceName: sequence
    });

    const firstKey = reengagementTemplateKey(1, "am");
    if (options.sendFirstNow) {
      const template = reengagementTemplate(sequence, { templateKey: firstKey, day: 1, slot: "am" });
      if (template) {
        updated = (await this.sendBotMessage(updated, render(template, updated))) || updated;
        updated = await this.store.upsertContact({
          ...updated,
          engagementStatus: ENGAGEMENT.RE_ENGAGEMENT,
          currentSequenceName: sequence,
          currentSequenceDay: 1,
          currentSequenceSlot: "am"
        });
      }
    }

    for (const day of REENGAGEMENT_DAYS) {
      for (const slot of REENGAGEMENT_SLOTS) {
        const templateKey = reengagementTemplateKey(day, slot);
        if (options.sendFirstNow && templateKey === firstKey) continue;
        if (!persistentReengagementTemplates[sequence]?.[templateKey]) continue;
        const runAt = localSlotDate(updated, this.config, day - 1, slot);
        if (runAt <= new Date()) continue;
        await this.store.addJob({
          type: "send_reengagement_template",
          contactId: updated.id,
          runAt: runAt.toISOString(),
          payload: { sequence, day, slot, templateKey }
        });
      }
    }
  }

  async startFromNoResponseDisposition(payload) {
    const contact = await this.store.upsertContact({
      ...normalizePayload(payload, this.config),
      engagementStatus: ENGAGEMENT.CALLED_NO_ANSWER,
      qualificationProgress: payload.qualificationProgress || QUALIFICATION.NEEDS_FAULT,
      optOutStatus: false,
      humanEscalationStatus: false,
      automationPaused: false,
      automationPauseReason: "",
      awaitingBackupTime: false,
      awaitingSpecificCallTime: false,
      currentSequenceName: "",
      currentSequenceDay: 0,
      currentSequenceSlot: "",
      currentMessageCountForDay: 0,
      sentColdTemplateKeys: []
    });
    await this.store.cancelJobsForContact(contact.id, "fresh no-response enrollment", (job) =>
      BOT_SEQUENCE_JOB_TYPES.includes(job.type)
    );
    const hydrated = await this.hydrateContactTags(contact);
    if (hasSignedTag(hydrated)) return this.stopForSignedTag(hydrated);
    if (hasNqTag(hydrated)) return this.stopForNqTag(hydrated);
    if (hasManualHumanHoldTag(hydrated)) return this.stopForManualHoldTag(hydrated);
    const initial = render(coldOutreachTemplates.day_1_am, contact);
    if (!isWithinTextingWindow(contact, this.config)) {
      await this.store.addJob({
        type: "initial_sms",
        contactId: contact.id,
        runAt: nextTextingWindow(contact, this.config).toISOString(),
        payload: { templateKey: "day_1_am", source: "fresh" }
      });
      return contact;
    }
    const sent = await this.sendBotMessage(contact, initial);
    const afterInitial = await this.store.upsertContact({
      ...(sent || contact),
      engagementStatus: ENGAGEMENT.INITIAL_SMS_SENT,
      currentSequenceName: "initial_sms",
      currentSequenceDay: 1,
      currentMessageCountForDay: 1,
      sentColdTemplateKeys: Array.from(new Set([...(sent?.sentColdTemplateKeys || contact.sentColdTemplateKeys || []), "day_1_am"]))
    });
    await this.scheduleColdOutreach(afterInitial);
    await this.scheduleFreshLeadFollowUps(afterInitial);
    await this.store.addJob({
      type: "cold_entry_check",
      contactId: afterInitial.id,
      runAt: addMinutes(new Date(), 15).toISOString(),
      payload: { lastOutboundTimestamp: afterInitial.lastOutboundTimestamp || new Date().toISOString() }
    });
    return afterInitial;
  }

  async queueNoResponseBackfill(payload, runAt) {
    const normalized = normalizePayload(payload, this.config);
    const existing = await this.store.getContact(normalized.id);
    if (existing?.optOutStatus || existing?.automationPaused) {
      return { contact: existing, status: "skipped", reason: "contact already opted out or paused" };
    }
    if (
      existing?.engagementStatus &&
      ![ENGAGEMENT.NEW_LEAD, ENGAGEMENT.CALLED_NO_ANSWER].includes(existing.engagementStatus)
    ) {
      return { contact: existing, status: "skipped", reason: "contact already active in bot memory" };
    }

    let contact = await this.store.upsertContact({
      ...normalized,
      engagementStatus: ENGAGEMENT.CALLED_NO_ANSWER,
      qualificationProgress: payload.qualificationProgress || QUALIFICATION.NEEDS_FAULT,
      optOutStatus: false,
      humanEscalationStatus: false,
      currentSequenceName: "backfill_pending",
      backfilledAt: new Date().toISOString()
    });
    contact = await this.hydrateContactTags(contact);
    if (hasSignedTag(contact)) return { contact: await this.stopForSignedTag(contact), status: "skipped", reason: "signed tag" };
    if (hasNqTag(contact)) return { contact: await this.stopForNqTag(contact), status: "skipped", reason: "NQ tag" };
    if (hasManualHumanHoldTag(contact)) return { contact: await this.stopForManualHoldTag(contact), status: "skipped", reason: "manual hold tag" };
    if (hasAnyTag(contact, ["DNC", "do_not_contact", "opt_out", "opted_out"])) {
      const opted = await this.store.upsertContact({
        ...contact,
        engagementStatus: ENGAGEMENT.OPTED_OUT,
        optOutStatus: true,
        currentSequenceName: ""
      });
      return { contact: opted, status: "skipped", reason: "DNC/opt-out tag" };
    }

    await this.store.cancelJobsForContact(contact.id, "backfill queued", (job) =>
      BOT_SEQUENCE_JOB_TYPES.includes(job.type)
    );
    const targetRunAt = new Date(runAt);
    await this.store.addJob({
      type: "initial_sms",
      contactId: contact.id,
      runAt: targetRunAt.toISOString(),
      payload: { templateKey: "day_1_am", source: "backfill" }
    });
    return { contact, status: "queued", runAt: targetRunAt.toISOString() };
  }

  async queueInboundSms(payload) {
    const inbound = normalizePayload(payload, this.config);
    if (isEmptyTextToken(inbound.lastInboundMessage)) {
      await this.store.setSetting("last_ignored_inbound_sms", {
        contactId: inbound.ghlContactId || inbound.id || "",
        phone: inbound.phone || "",
        name: inbound.name || "",
        message: inbound.lastInboundMessage || "",
        reason: "blank_inbound_message",
        receivedAt: new Date().toISOString()
      });
      return inbound;
    }
    if (isOptOut(inbound.lastInboundMessage)) return this.handleInboundSms(payload);
    const resolution = await this.resolveInboundContact({
      ...inbound,
      lastResponseTimestamp: new Date().toISOString()
    });
    let contact = resolution.contact;
    if (resolution.inboundNotEnrolled) {
      await this.store.setSetting("last_ignored_inbound_sms", {
        contactId: contact.ghlContactId || contact.id || "",
        phone: contact.phone || "",
        name: contact.name || "",
        message: contact.lastInboundMessage || "",
        reason: "contact_not_enrolled_in_bot",
        receivedAt: new Date().toISOString()
      });
      return contact;
    }
    await this.store.addMessage({ contactId: contact.id, direction: "inbound", body: inbound.lastInboundMessage });
    if (resolution.duplicateConflict) return contact;
    const pendingInboundMessages = [...(contact.pendingInboundMessages || []), inbound.lastInboundMessage].filter(Boolean).slice(-6);
    contact = await this.store.upsertContact({
      ...contact,
      pendingInboundMessages,
      pendingInboundLastAt: new Date().toISOString(),
      pendingInboundPayload: {
        contactId: contact.id,
        ghlContactId: contact.ghlContactId,
        name: contact.name,
        phone: contact.phone,
        timezone: contact.timezone,
        state: contact.state,
        owner: contact.owner,
        leadSource: contact.leadSource,
        tags: contact.tags
      }
    });
    await this.store.cancelJobsForContact(contact.id, "inbound buffer replaced", (job) => job.type === "process_inbound_buffer");
    await this.store.addJob({
      type: "process_inbound_buffer",
      contactId: contact.id,
      runAt: addMinutes(new Date(), INBOUND_BUFFER_SECONDS / 60).toISOString(),
      payload: {}
    });
    return contact;
  }

  async handleInboundBuffer(job, contact) {
    let fresh = contact || (await this.store.getContact(job.contactId));
    if (!fresh) return null;
    const messages = (fresh.pendingInboundMessages || []).filter(Boolean);
    if (!messages.length) return fresh;
    const combinedMessage = messages.join("\n");
    if (isEmptyTextToken(combinedMessage)) {
      return this.store.upsertContact({
        ...fresh,
        pendingInboundMessages: [],
        pendingInboundPayload: null,
        pendingInboundLastAt: ""
      });
    }
    const payload = {
      ...(fresh.pendingInboundPayload || {}),
      contactId: fresh.id,
      ghlContactId: fresh.ghlContactId,
      name: fresh.name,
      phone: fresh.phone,
      timezone: fresh.timezone,
      state: fresh.state,
      owner: fresh.owner,
      leadSource: fresh.leadSource,
      tags: fresh.tags,
      message: combinedMessage
    };
    fresh = await this.store.upsertContact({
      ...fresh,
      pendingInboundMessages: [],
      pendingInboundPayload: null,
      pendingInboundLastAt: "",
      lastInboundMessage: combinedMessage,
      lastResponseTimestamp: fresh.pendingInboundLastAt || new Date().toISOString()
    });
    return this.handleInboundSms(payload, { skipMessageRecord: true });
  }

  async handleInboundSms(payload, options = {}) {
    const inbound = normalizePayload(payload, this.config);
    if (isEmptyTextToken(inbound.lastInboundMessage)) {
      await this.store.setSetting("last_ignored_inbound_sms", {
        contactId: inbound.ghlContactId || inbound.id || "",
        phone: inbound.phone || "",
        name: inbound.name || "",
        message: inbound.lastInboundMessage || "",
        reason: "blank_inbound_message",
        receivedAt: new Date().toISOString()
      });
      return inbound;
    }
    const resolution = await this.resolveInboundContact({
      ...inbound,
      lastInboundMessage: inbound.lastInboundMessage,
      lastResponseTimestamp: new Date().toISOString()
    });
    let contact = resolution.contact;
    if (resolution.inboundNotEnrolled) {
      await this.store.setSetting("last_ignored_inbound_sms", {
        contactId: contact.ghlContactId || contact.id || "",
        phone: contact.phone || "",
        name: contact.name || "",
        message: contact.lastInboundMessage || "",
        reason: "contact_not_enrolled_in_bot",
        receivedAt: new Date().toISOString()
      });
      return contact;
    }
    if (!options.skipMessageRecord) {
      await this.store.addMessage({ contactId: contact.id, direction: "inbound", body: inbound.lastInboundMessage });
    }
    if (resolution.duplicateConflict) return contact;
    await this.store.cancelJobsForContact(contact.id, "contact replied", (job) =>
      ["fresh_lead_followup", "send_cold_template", "warm_followup", "enter_reengagement", "send_reengagement_template", "cold_entry_check"].includes(job.type)
    );

    if (isOptOut(inbound.lastInboundMessage)) {
      contact = await this.store.upsertContact({
        ...contact,
        engagementStatus: ENGAGEMENT.OPTED_OUT,
        optOutStatus: true,
        currentSequenceName: "",
        humanEscalationStatus: false
      });
      await this.store.cancelJobsForContact(contact.id, "opted out");
      await this.sendBotMessage(contact, qualificationTemplates.optOutConfirm, {
        bypassQuietHours: true,
        allowAfterOptOut: true
      });
      return contact;
    }

    contact = await this.hydrateContactTags(contact);
    if (hasNqTag(contact)) {
      return this.stopForNqTag(contact);
    }
    if (hasSignedTag(contact)) {
      return this.stopForSignedTag(contact);
    }
    if (hasManualHumanHoldTag(contact)) {
      return this.stopForManualHoldTag(contact);
    }
    contact = await this.applyTimezoneCorrection(contact, inbound.lastInboundMessage);
    if (hasExistingRepresentation(inbound.lastInboundMessage)) {
      const updated = await this.store.upsertContact({
        ...contact,
        automationPaused: true,
        automationPauseReason: "existing_representation",
        currentSequenceName: "",
        qualificationProgress: QUALIFICATION.COMPLETE
      });
      await this.store.cancelJobsForContact(updated.id, "existing representation");
      await this.sendBotMessage(updated, qualificationTemplates.existingRepresentation, { bypassQuietHours: true });
      return this.store.getContact(updated.id);
    }
    let dateAnswer = parseAccidentDate(inbound.lastInboundMessage);
    if (dateAnswer && !contact.accidentDate) {
      contact = await this.store.upsertContact({ ...contact, accidentDate: dateAnswer.value });
    }
    const answeredColdDateQuestion = Boolean(dateAnswer && canTreatDateAsColdOutreachAnswer(contact));
    if (!answeredColdDateQuestion && looksPostSignedOrFirmIssue(inbound.lastInboundMessage)) {
      return this.escalate(contact, "post_intake_or_firm_issue");
    }

    if (
      contact.engagementStatus === ENGAGEMENT.ESCALATED_TO_HUMAN &&
      (contact.automationPaused || ["human_working", "human_replied_waiting", "manual_hold_tag", "admin_paused"].includes(contact.humanEscalationStage))
    ) {
      if (canAutoResumeHumanScheduling(contact, inbound.lastInboundMessage, this.config)) {
        await this.cancelHumanEscalationWatchdog(contact.id, "bot resumed human scheduling reply");
        await this.store.cancelJobsForContact(contact.id, "bot resumed human scheduling reply", (job) => job.type === "human_reply_timeout");
        contact = await this.store.upsertContact({
          ...contact,
          engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
          qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
          humanEscalationStatus: false,
          humanEscalationStage: "bot_resumed_scheduling",
          automationPaused: false,
          automationPauseReason: ""
        });
      } else {
      return this.store.upsertContact({
        ...contact,
        lastHumanManagedInboundAt: new Date().toISOString(),
        lastHumanManagedInboundMessage: inbound.lastInboundMessage
      });
      }
    }

    if (canAutoResumeFromSoftEscalation(contact, inbound.lastInboundMessage, this.config)) {
      await this.cancelHumanEscalationWatchdog(contact.id, "auto-resumed from soft escalation");
      contact = await this.store.upsertContact({
        ...contact,
        engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
        humanEscalationStatus: false,
        humanEscalationStage: "auto_resumed_from_soft_escalation",
        automationPaused: false,
        automationPauseReason: ""
      });
    }

    if (hasBookedAppointment(contact) && isBenignAppointmentAcknowledgement(inbound.lastInboundMessage)) {
      const updated = await this.store.upsertContact({
        ...contact,
        engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
        appointmentConfirmed: true,
        appointmentConfirmedAt: new Date().toISOString(),
        lastAppointmentAcknowledgement: inbound.lastInboundMessage,
        humanEscalationStatus: false,
        humanEscalationStage: "appointment_acknowledged",
        escalationReason: ""
      });
      await this.cancelHumanEscalationWatchdog(updated.id, "appointment acknowledged");
      if (updated.preferredCallTimeIso) await this.scheduleAppointmentReminders(updated);
      return this.store.getContact(updated.id);
    }

    if (contact.engagementStatus === ENGAGEMENT.ESCALATED_TO_HUMAN && contact.humanEscalationStatus) {
      return this.store.upsertContact({
        ...contact,
        lastHumanManagedInboundAt: new Date().toISOString(),
        lastHumanManagedInboundMessage: inbound.lastInboundMessage
      });
    }

    if (contact.engagementStatus === ENGAGEMENT.READY_FOR_CALL || contact.engagementStatus === ENGAGEMENT.ESCALATED_TO_HUMAN) {
      await this.escalate(contact, "message_after_bot_paused");
      return contact;
    }

    if (contact.awaitingBackupTime) {
      if (
        isRescheduleRequest(inbound.lastInboundMessage) ||
        isPrimaryCallCorrectionWhileAwaitingBackup(inbound.lastInboundMessage, contact, this.config)
      ) {
        return this.handleReschedule(contact, inbound.lastInboundMessage);
      }
      return this.handleBackupTime(contact, inbound.lastInboundMessage);
    }

    if (contact.engagementStatus === ENGAGEMENT.CALL_SCHEDULED) {
      if (isRescheduleRequest(inbound.lastInboundMessage)) {
        return this.handleReschedule(contact, inbound.lastInboundMessage);
      }
      if (isAffirmativeConfirmation(inbound.lastInboundMessage) || isBenignAppointmentAcknowledgement(inbound.lastInboundMessage)) {
        return this.store.upsertContact({
          ...contact,
          appointmentConfirmed: true,
          appointmentConfirmedAt: new Date().toISOString(),
          lastAppointmentAcknowledgement: inbound.lastInboundMessage
        });
      }
      const requestedTime = parseCallTime(inbound.lastInboundMessage, contact, this.config);
      if (requestedTime?.type === "scheduled" || requestedTime?.type === "needs_specific_time") {
        return this.handleReschedule(contact, inbound.lastInboundMessage);
      }
      await this.escalate(contact, "appointment_reply_needs_human_review");
      return contact;
    }

    if (contact.engagementStatus === ENGAGEMENT.MISSED_CALL) {
      contact = await this.store.upsertContact({
        ...contact,
        engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
        qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
      });
      return this.handleCallTime(contact, inbound.lastInboundMessage);
    }

    dateAnswer = dateAnswer || parseAccidentDate(inbound.lastInboundMessage);
    if (dateAnswer && !contact.accidentDate) {
      contact = await this.store.upsertContact({ ...contact, accidentDate: dateAnswer.value });
    }

    const reason = escalationReason(inbound.lastInboundMessage);
    if (reason && !(dateAnswer && canTreatDateAsColdOutreachAnswer(contact))) {
      const expectedAnswer = parseExpectedAnswer(contact.qualificationProgress, inbound.lastInboundMessage);
      const canUseExtractedAnswer = ["detailed_information", "outside_question", "document_or_report"].includes(reason);
      if (canUseExtractedAnswer && expectedAnswer) {
        return this.advanceQualification(contact, expectedAnswer);
      }
      await this.escalate(contact, reason);
      return contact;
    }

    if (!contact.qualificationProgress) {
      contact = await this.store.upsertContact({ ...contact, qualificationProgress: QUALIFICATION.NEEDS_FAULT });
    }

    if (contact.qualificationProgress === QUALIFICATION.COMPLETE) {
      await this.escalate(contact, "message_after_completed_flow");
      return contact;
    }

    contact = await this.store.upsertContact({ ...contact, engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION });
    const humanContext = classifyHumanContextIntent(inbound.lastInboundMessage, contact.qualificationProgress);
    if (humanContext) {
      contact = await this.store.upsertContact({
        ...contact,
        lastHumanContextIntent: humanContext.intent,
        lastHumanContextAt: new Date().toISOString()
      });
      const response = humanContextResponse(contact, humanContext, this.config);
      if (response) {
        const sent = await this.sendBotMessage(contact, response, { bypassQuietHours: true });
        const latest = sent || (await this.store.getContact(contact.id)) || contact;
        await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
        return latest;
      }
    }
    if (contact.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME) {
      return this.handleCallTime(contact, inbound.lastInboundMessage);
    }

    if (looksLikeCallScheduling(inbound.lastInboundMessage) && parseCallTime(inbound.lastInboundMessage, contact, this.config)) {
      const schedulingContact = await this.store.upsertContact({
        ...contact,
        qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
        earlyCallTimeBeforeQualification: true
      });
      return this.handleCallTime(schedulingContact, inbound.lastInboundMessage);
    }

    const answer = parseExpectedAnswer(contact.qualificationProgress, inbound.lastInboundMessage);
    if (!answer) {
      if (dateAnswer && canTreatDateAsColdOutreachAnswer(contact)) {
        const attempts = { ...(contact.clarificationAttemptsByQuestion || {}) };
        delete attempts[contact.qualificationProgress];
        contact = await this.store.upsertContact({
          ...contact,
          clarificationAttemptsByQuestion: attempts
        });
        const sent = await this.sendBotMessage(contact, render(qualificationTemplates.fault, contact), {
          bypassQuietHours: true
        });
        const latest = sent || (await this.store.getContact(contact.id)) || contact;
        await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
        return latest;
      }
      const llmResult = await this.tryLlmFallback(contact, inbound.lastInboundMessage);
      if (llmResult) return llmResult;
      const attempts = { ...(contact.clarificationAttemptsByQuestion || {}) };
      const key = contact.qualificationProgress;
      attempts[key] = (attempts[key] || 0) + 1;
      contact = await this.store.upsertContact({ ...contact, clarificationAttemptsByQuestion: attempts });
      if (attempts[key] > 1) {
        await this.escalate(contact, "low_confidence_answer");
        return contact;
      }
      await this.sendBotMessage(contact, qualificationTemplates.clarify, { bypassQuietHours: true });
      return contact;
    }

    return this.advanceQualification(contact, answer);
  }

  async applyBotControl(payload) {
    const normalized = normalizePayload(payload, this.config);
    const action = normalize(
      payload.action ||
        payload.botControl ||
        payload.bot_control ||
        payload.customFieldValue ||
        payload.value ||
        payload.status ||
        payload.control ||
        actionFromTags(payload.tags || payload.contactTags || payload.tag || payload.contact?.tags) ||
        ""
    ).replace(/\s+/g, "_");
    const contact = await this.store.getContact(normalized.id);
    if (!contact) return null;

    if (["human_replied", "human_outbound", "manual_sms_sent", "staff_replied"].includes(action)) {
      await this.recordDecision(contact, "paused", "human_outbound", { trigger: "bot_control", message: payload.message || "" });
      return this.handleHumanOutbound(payload);
    }

    if (["call_started", "call_answered", "manual_call", "manual_call_started", "human_call"].includes(action)) {
      await this.recordDecision(contact, "paused", "human_call", { trigger: "bot_control", message: payload.message || "" });
      return this.handleHumanOutbound({ ...payload, action, message: payload.message || "Manual human call started", timeoutMinutes: HUMAN_CALL_TIMEOUT_MINUTES });
    }

    if (["human_acknowledged", "acknowledged", "human_working", "working"].includes(action)) {
      const updated = await this.store.upsertContact({
        ...contact,
        humanEscalationStage: "human_working",
        humanAcknowledgedAt: new Date().toISOString(),
        humanEscalationStatus: true,
        automationPaused: true,
        automationPauseReason: "human_working",
        engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN
      });
      await this.cancelHumanEscalationWatchdog(updated.id, "human acknowledged escalation");
      await this.store.cancelJobsForContact(updated.id, "human acknowledged escalation");
      await this.recordDecision(updated, "paused", "human_acknowledged", {
        trigger: "admin_action",
        beforeStatus: contact.engagementStatus || "",
        afterStatus: updated.engagementStatus || ""
      });
      return updated;
    }

    if (["return_to_bot", "resume_bot", "bot_resume"].includes(action)) {
      await this.cancelHumanEscalationWatchdog(contact.id, "returned to bot");
      const updated = await this.store.upsertContact({
        ...contact,
        humanEscalationStatus: false,
        humanEscalationStage: "returned_to_bot",
        automationPaused: false,
        automationPauseReason: "",
        engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
        qualificationProgress: contact.qualificationProgress || QUALIFICATION.NEEDS_FAULT
      });
      await this.recordDecision(updated, "repaired", "returned_to_bot", {
        trigger: "admin_action",
        beforeStatus: contact.engagementStatus || "",
        afterStatus: updated.engagementStatus || ""
      });
      if (updated.lastInboundMessage && updated.qualificationProgress === QUALIFICATION.NEEDS_FAULT) {
        let resumeContact = updated;
        const dateAnswer = parseAccidentDate(updated.lastInboundMessage);
        if (dateAnswer && !resumeContact.accidentDate) {
          resumeContact = await this.store.upsertContact({ ...resumeContact, accidentDate: dateAnswer.value });
        }
        const answer = parseExpectedAnswer(resumeContact.qualificationProgress, resumeContact.lastInboundMessage);
        if (answer) {
          return this.advanceQualification(resumeContact, answer);
        }
      }
      if (updated.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME) {
        const recentCallTime = await this.recentCallTimeCandidate(updated);
        if (recentCallTime) {
          const withRecoveredTime = await this.store.upsertContact({
            ...updated,
            recoveredCallTimeMessage: recentCallTime.message,
            recoveredCallTimeAt: new Date().toISOString()
          });
          return this.handleCallTime(withRecoveredTime, recentCallTime.message);
        }
      }
      const template = currentQuestionTemplate(updated, this.config);
      if (template) {
        const sent = await this.sendBotMessage(updated, render(template, updated), { bypassQuietHours: true });
        const latest = sent || (await this.store.getContact(updated.id)) || updated;
        await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
        return latest;
      }
      return updated;
    }

    if (["pause_bot", "manual_pause", "admin_pause"].includes(action)) {
      const updated = await this.store.upsertContact({
        ...contact,
        automationPaused: true,
        automationPauseReason: "admin_pause",
        humanEscalationStatus: true,
        humanEscalationStage: "admin_paused",
        engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN
      });
      await this.store.cancelJobsForContact(updated.id, "admin pause");
      await this.store.addEscalation({
        contactId: updated.id,
        reason: "admin_pause",
        lastInboundMessage: updated.lastInboundMessage
      });
      await this.recordDecision(updated, "paused", "admin_pause", {
        trigger: "admin_action",
        beforeStatus: contact.engagementStatus || "",
        afterStatus: updated.engagementStatus || ""
      });
      return updated;
    }

    if (["schedule_warm_followups", "chase_call_time", "resume_hot_followup"].includes(action)) {
      await this.scheduleWarmFollowUps(contact, !isWithinTextingWindow(contact, this.config));
      await this.recordDecision(contact, "repaired", "warm_followups_scheduled", { trigger: "admin_action" });
      return this.store.getContact(contact.id);
    }

    if (["refresh_timezone", "fix_timezone", "timezone_refresh"].includes(action)) {
      const updated = await this.refreshTimezoneFromContact(contact, "admin_timezone_refresh");
      await this.recordDecision(updated || contact, "repaired", "timezone_refreshed", { trigger: "admin_action" });
      return updated;
    }

    if (["ensure_appointment_reminders", "schedule_appointment_reminders"].includes(action)) {
      await this.scheduleAppointmentReminders(contact);
      await this.recordDecision(contact, "repaired", "appointment_reminders_ensured", { trigger: "admin_action" });
      return this.store.getContact(contact.id);
    }

    if (["mark_no_show", "no_show", "appointment_no_show"].includes(action)) {
      return this.markNoShow({
        contactId: contact.id,
        ghlContactId: contact.ghlContactId,
        name: contact.name,
        phone: contact.phone,
        timezone: contact.timezone,
        leadSource: contact.leadSource,
        preferredCallTime: contact.preferredCallTime,
        preferredCallTimeIso: contact.preferredCallTimeIso,
        appointmentId: contact.appointmentId
      });
    }

    if (["repair_primary_call_time", "fix_primary_call_time", "correct_primary_call_time"].includes(action)) {
      return this.repairPrimaryCallTimeFromLastInbound(contact);
    }

    if (["nq", "not_qualified"].includes(action)) {
      return this.stopForNqTag({ ...contact, tags: [...normalizeTags(contact.tags), "NQ"] });
    }

    if (["signed", "#signed"].includes(action)) {
      return this.stopForSignedTag({ ...contact, tags: [...normalizeTags(contact.tags), "signed"] });
    }

    if (["do_not_contact", "dnc", "opt_out"].includes(action)) {
      const opted = await this.store.upsertContact({
        ...contact,
        engagementStatus: ENGAGEMENT.OPTED_OUT,
        optOutStatus: true,
        humanEscalationStatus: false,
        humanEscalationStage: "closed_by_human",
        currentSequenceName: ""
      });
      await this.store.cancelJobsForContact(opted.id, "closed by human control");
      return opted;
    }

    await this.notifyBotError("Unknown bot control action", {
      "Contact ID": normalized.id,
      Action: action || "missing",
      "Raw value": payload.action || payload.botControl || payload.customFieldValue || payload.value || ""
    });
    return contact;
  }

  async handleHumanOutbound(payload) {
    const normalized = normalizePayload(payload, this.config);
    const contact = await this.store.getContact(normalized.id);
    if (!contact) return null;

    const now = new Date().toISOString();
    const message = textValue(normalized.lastInboundMessage || payload.message || payload.body || payload.text) || "Manual human SMS sent";
    await this.cancelHumanEscalationWatchdog(contact.id, "human sent manual SMS");
    await this.store.cancelJobsForContact(contact.id, "human took over");
    await this.store.addMessage({
      contactId: contact.id,
      direction: "human_outbound",
      body: message
    });
    const updated = await this.store.upsertContact({
      ...contact,
      humanEscalationStatus: true,
      humanEscalationStage: "human_replied_waiting",
      humanAcknowledgedAt: contact.humanAcknowledgedAt || now,
      lastHumanOutboundMessage: message,
      lastHumanOutboundAt: now,
      automationPaused: true,
      automationPauseReason: "human_working",
      engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN
    });
    const timeoutMinutes = Math.max(1, Number(payload.timeoutMinutes || HUMAN_REPLY_TIMEOUT_MINUTES));
    await this.store.addJob({
      type: "human_reply_timeout",
      contactId: updated.id,
      runAt: addMinutes(new Date(), timeoutMinutes).toISOString(),
      payload: { lastHumanOutboundAt: now, timeoutMinutes, sourceAction: payload.action || "" }
    });
    return updated;
  }

  async tryLlmFallback(contact, inboundText) {
    if (!this.config.llm?.fallbackEnabled) return null;
    let classification = null;
    try {
      classification = await classifyWithLlm(this.config, contact, inboundText);
    } catch (error) {
      await this.notifyBotError("LLM fallback failed", {
        Name: contact.name || "unknown",
        Phone: contact.phone || "unknown",
        "GHL contact": contact.ghlContactId || contact.id,
        "Qualification progress": contact.qualificationProgress || "unknown",
        "Last inbound": inboundText,
        Error: error.message
      }, { operationalOnly: true, slack: false, level: "warn" });
      await this.escalate(contact, "llm_fallback_failed", { Error: error.message });
      return this.store.getContact(contact.id);
    }

    const updated = await this.store.upsertContact({
      ...contact,
      lastLlmClassification: classification,
      lastLlmClassificationAt: new Date().toISOString()
    });
    const confidence = Number(classification.confidence || 0);
    const shouldEscalate =
      classification.should_escalate ||
      confidence < this.config.llm.clarifyConfidence ||
      [
        "needs_escalation",
        "human_request",
        "document_or_report",
        "asks_who_this_is",
        "wrong_number",
        "off_topic",
        "unknown"
      ].includes(classification.label);

    if (classification.label === "opt_out" || classification.label === "wrong_number") {
      const opted = await this.store.upsertContact({
        ...updated,
        engagementStatus: ENGAGEMENT.OPTED_OUT,
        optOutStatus: true,
        currentSequenceName: "",
        humanEscalationStatus: false
      });
      await this.store.cancelJobsForContact(opted.id, "opted out by llm");
      await this.sendBotMessage(opted, qualificationTemplates.optOutConfirm, {
        bypassQuietHours: true,
        allowAfterOptOut: true
      });
      return opted;
    }

    if (shouldEscalate) {
      await this.escalate(updated, `llm_${classification.label}`, {
        Confidence: String(confidence),
        Reason: classification.reason
      });
      return this.store.getContact(updated.id);
    }

    if (confidence < this.config.llm.minConfidence) {
      await this.sendBotMessage(updated, qualificationTemplates.clarify, { bypassQuietHours: true });
      return this.store.getContact(updated.id);
    }

    return this.applyLlmClassification(updated, classification, inboundText);
  }

  async recentCallTimeCandidate(contact, options = {}) {
    const messages = await this.store.listMessages(contact.id);
    const inbound = messages
      .filter((message) => message.direction === "inbound" && message.body)
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    const cutoff = Date.now() - Number(options.cutoffMinutes || 30) * 60 * 1000;
    let lastCallIntentAt = null;
    let lastCandidate = null;
    for (const message of inbound) {
      const createdAt = new Date(message.createdAt || 0);
      if (createdAt.getTime() < cutoff) continue;
      if (hasCallIntentText(message.body)) lastCallIntentAt = createdAt;
      const parsed = parseCallTime(message.body, contact, this.config);
      if (!parsed || parsed.type !== "scheduled") continue;
      const hasExplicitIntent = hasCallIntentText(message.body);
      const hasNearbyIntent =
        lastCallIntentAt && createdAt.getTime() - lastCallIntentAt.getTime() <= 10 * 60 * 1000;
      if (hasExplicitIntent || hasNearbyIntent) {
        lastCandidate = { message: message.body, parsed, createdAt: createdAt.toISOString() };
      }
    }
    return lastCandidate;
  }

  async applyLlmClassification(contact, classification, inboundText) {
    if (
      contact.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME &&
      !["call_now", "call_later", "prefers_text", "acknowledgement"].includes(classification.label)
    ) {
      await this.escalate(contact, `llm_call_time_${classification.label}`, {
        Confidence: String(classification.confidence || ""),
        Reason: classification.reason || "Reply did not answer the requested call time."
      });
      return this.store.getContact(contact.id);
    }

    if (classification.label === "accident_date") {
      const updated = await this.store.upsertContact({
        ...contact,
        accidentDate: classification.normalized_value || inboundText
      });
      const sent = await this.sendBotMessage(updated, render(qualificationTemplates.fault, updated), {
        bypassQuietHours: true
      });
      return sent || (await this.store.getContact(updated.id));
    }

    if (contact.qualificationProgress === QUALIFICATION.NEEDS_FAULT) {
      const valueByLabel = {
        fault_not_at_fault: "not_at_fault",
        fault_at_fault: "at_fault",
        fault_unclear: "unsure_or_partial"
      };
      if (valueByLabel[classification.label]) {
        return this.advanceQualification(contact, { value: valueByLabel[classification.label] });
      }
    }

    if (contact.qualificationProgress === QUALIFICATION.NEEDS_MEDICAL) {
      if (classification.label === "medical_yes") return this.advanceQualification(contact, { value: "yes" });
      if (classification.label === "medical_no") return this.advanceQualification(contact, { value: "no" });
    }

    if (classification.label === "call_now") {
      return this.handleCallTime(contact, "call me now");
    }

    if (classification.label === "call_later") {
      return this.handleCallTime(contact, classification.normalized_value || inboundText);
    }

    if (classification.label === "prefers_text" || classification.label === "acknowledgement") {
      const template = currentQuestionTemplate(contact, this.config);
      if (template) {
        const sent = await this.sendBotMessage(contact, render(template, contact), { bypassQuietHours: true });
        const latest = sent || (await this.store.getContact(contact.id)) || contact;
        await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
        return latest;
      }
    }

    await this.escalate(contact, `llm_unhandled_${classification.label}`, {
      Confidence: String(classification.confidence || ""),
      Reason: classification.reason || ""
    });
    return this.store.getContact(contact.id);
  }

  async advanceQualification(contact, answer) {
    let nextContact = contact;
    let nextMessage = "";
    if (contact.qualificationProgress === QUALIFICATION.NEEDS_FAULT) {
      nextContact = await this.store.upsertContact({
        ...contact,
        faultAnswer: answer.value,
        qualificationProgress: QUALIFICATION.NEEDS_MEDICAL
      });
      nextMessage = qualificationTemplates.medical;
    } else if (contact.qualificationProgress === QUALIFICATION.NEEDS_MEDICAL) {
      nextContact = await this.store.upsertContact({
        ...contact,
        medicalTreatmentAnswer: answer.value,
        qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
      });
      const recentCallTime = await this.recentCallTimeCandidate(nextContact);
      if (recentCallTime) {
        nextContact = await this.store.upsertContact({
          ...nextContact,
          recoveredCallTimeMessage: recentCallTime.message,
          recoveredCallTimeAt: new Date().toISOString()
        });
        return this.handleCallTime(nextContact, recentCallTime.message);
      }
      nextMessage = callAskTemplateForTime(nextContact, this.config);
    }
    const sent = await this.sendBotMessage(nextContact, render(nextMessage, nextContact), { bypassQuietHours: true });
    const latest = sent || (await this.store.getContact(nextContact.id)) || nextContact;
    await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
    return latest;
  }

  async handleCallTime(contact, text) {
    contact = await this.hydrateContactTags(contact, { force: true });
    const resolvedTimezone = resolveContactTimezone(contact, this.config);
    if (resolvedTimezone && resolvedTimezone !== contact.timezone) {
      contact = await this.store.upsertContact({ ...contact, timezone: resolvedTimezone });
    }
    const parsed = parseCallTime(text, contact, this.config);
    if (!parsed) {
      if (looksLikeInjuryContext(text)) {
        const sent = await this.sendBotMessage(contact, qualificationTemplates.injuryContextCallAsk, { bypassQuietHours: true });
        const latest = sent || (await this.store.getContact(contact.id)) || contact;
        await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
        return latest;
      }
      const llmResult = await this.tryLlmFallback(contact, text);
      if (llmResult) return llmResult;
      await this.escalate(contact, "call_time_unhandled_reply");
      return this.store.getContact(contact.id);
    }
    if (parsed.type === "needs_specific_time") {
      contact = await this.store.upsertContact({ ...contact, awaitingSpecificCallTime: true });
      const normalizedText = normalize(text);
      let question = relativeTimeClarification(parsed, contact, this.config) || "What specific time works best for your call today or tomorrow?";
      if (/\btomorrow\b/.test(normalizedText)) question = "What specific time tomorrow works best?";
      if (/\b(today|later today|tonight)\b/.test(normalizedText)) question = "What specific time later today works best?";
      if (/\b(sick|surgery|bed|not feeling well|recovering|hospital|pain)\b/.test(normalizedText)) {
        question = "No worries, I hope you feel better 🙏 What time tomorrow or the next day would be easiest for a quick Specialist call?";
      }
      const sent = await this.sendBotMessage(contact, question, { bypassQuietHours: true });
      const latest = sent || (await this.store.getContact(contact.id)) || contact;
      await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
      return latest;
    }
    if (parsed.type === "now") {
      const updated = await this.store.upsertContact({
      ...contact,
      engagementStatus: ENGAGEMENT.READY_FOR_CALL,
      humanEscalationStatus: true,
      awaitingSpecificCallTime: false
      });
      await this.sendBotMessage(updated, qualificationTemplates.callNow, { bypassQuietHours: true });
      try {
        await slack.sendUrgentCallNow(this.config, updated);
      } catch (error) {
        await this.notifyBotError("Slack urgent call-now alert failed", {
          Name: updated.name || "unknown",
          Phone: updated.phone || "unknown",
          "GHL contact": updated.ghlContactId || updated.id,
          Error: error.message
        });
      }
      return updated;
    }
    const startsAt = parsed.startsAt;
    const endsAt = addMinutes(new Date(startsAt), 15).toISOString();
    const display = formatForContact(new Date(startsAt), contact, this.config);
    let appointment = null;
    try {
      appointment = await ghl.createAppointment(
        this.config,
        contact,
        startsAt,
        endsAt,
        appointmentNotes({ ...contact, preferredCallTime: display, preferredCallTimeIso: startsAt })
      );
    } catch (error) {
      await this.notifyBotError("GHL appointment booking failed", {
        Name: contact.name || "unknown",
        Phone: contact.phone || "unknown",
        "GHL contact": contact.ghlContactId || contact.id,
        "Requested start": startsAt,
        Error: error.message
      });
      contact = await this.store.upsertContact({
        ...contact,
        lastAppointmentBookingError: error.message,
        lastAppointmentBookingFailedAt: new Date().toISOString(),
        lastAppointmentRequestedStart: startsAt
      });
      return this.escalate(contact, "appointment_booking_failed", {
        "Requested start": startsAt,
        Error: error.message
      });
    }
    const updated = await this.store.upsertContact({
      ...contact,
      engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
      qualificationProgress: QUALIFICATION.CALL_BOOKED,
      preferredCallTime: display,
      preferredCallTimeIso: startsAt,
      appointmentId: appointment.id || appointment.appointment?.id || "",
      awaitingBackupTime: true,
      awaitingSpecificCallTime: false,
      lastAppointmentBookingError: ""
    });
    const afterBackupAsk =
      (await this.sendBotMessage(updated, render(qualificationTemplates.backupAsk, updated, { time: display }), {
      bypassQuietHours: true
      })) || updated;
    const bookingAlertSent = await this.notifyAppointmentBooked(afterBackupAsk, {
      "Primary call time": afterBackupAsk.preferredCallTime,
      "Backup time": "pending",
      Timezone: afterBackupAsk.timezone,
      "GHL appointment": afterBackupAsk.appointmentId || "created"
    });
    const afterAlert = bookingAlertSent
      ? await this.store.upsertContact({ ...afterBackupAsk, bookingAlertSentAt: new Date().toISOString() })
      : afterBackupAsk;
    await this.scheduleAppointmentReminders(afterAlert);
    await this.store.addJob({
      type: "backup_time_timeout",
      contactId: afterAlert.id,
      runAt: addMinutes(new Date(), 15).toISOString(),
      payload: {}
    });
    return afterAlert;
  }

  async handleReschedule(contact, text) {
    const parsed = parseCallTime(text, contact, this.config);
    if (!parsed || parsed.type === "now") {
      const sent = await this.sendBotMessage(contact, qualificationTemplates.rescheduleAsk, { bypassQuietHours: true });
      return sent || (await this.store.getContact(contact.id)) || contact;
    }
    if (parsed.type === "needs_specific_time") {
      const sent = await this.sendBotMessage(contact, qualificationTemplates.rescheduleNeedsSpecificTime, { bypassQuietHours: true });
      return sent || (await this.store.getContact(contact.id)) || contact;
    }

    const startsAt = parsed.startsAt;
    const endsAt = addMinutes(new Date(startsAt), 15).toISOString();
    let appointment = null;
    try {
      appointment = await ghl.updateAppointment(
        this.config,
        contact,
        contact.appointmentId,
        startsAt,
        endsAt,
        "Rescheduled by Accident Support Desk SMS bot"
      );
    } catch (error) {
      await this.notifyBotError("GHL appointment reschedule failed", {
        Name: contact.name || "unknown",
        Phone: contact.phone || "unknown",
        "GHL contact": contact.ghlContactId || contact.id,
        "Appointment ID": contact.appointmentId || "unknown",
        "Requested start": startsAt,
        Error: error.message
      });
      return this.escalate(contact, "appointment_reschedule_failed", {
        "Requested start": startsAt,
        Error: error.message
      });
    }

    const display = formatForContact(new Date(startsAt), contact, this.config);
    const updated = await this.store.upsertContact({
      ...contact,
      engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
      qualificationProgress: QUALIFICATION.CALL_BOOKED,
      preferredCallTime: display,
      preferredCallTimeIso: startsAt,
      appointmentId: appointment.id || appointment.appointment?.id || contact.appointmentId || "",
      awaitingBackupTime: false,
      appointmentConfirmed: false,
      appointmentRescheduledAt: new Date().toISOString()
    });
    await this.store.cancelJobsForContact(updated.id, "appointment rescheduled", (job) =>
      ["appointment_reminder", "backup_time_timeout"].includes(job.type)
    );
    const sent = await this.sendBotMessage(
      updated,
      render(qualificationTemplates.rescheduleConfirmed, updated, { time: display }),
      { bypassQuietHours: true }
    );
    const latest = sent || (await this.store.getContact(updated.id)) || updated;
    await this.notifyAppointmentBooked(latest, {
      "Primary call time": latest.preferredCallTime,
      "Backup time": latest.backupCallTime || "none",
      Timezone: latest.timezone,
      "GHL appointment": latest.appointmentId || "updated",
      Action: "rescheduled"
    });
    await this.scheduleAppointmentReminders(latest);
    return latest;
  }

  async repairPrimaryCallTimeFromLastInbound(contact) {
    contact = await this.hydrateContactTags(contact, { force: true });
    const message = contact.lastInboundMessage || contact.recoveredCallTimeMessage || "";
    const parsed = parseCallTime(message, contact, this.config);
    if (parsed?.type !== "scheduled") {
      return this.store.upsertContact({
        ...contact,
        lastPrimaryCallTimeRepairError: "latest inbound message did not contain a scheduled call time",
        lastPrimaryCallTimeRepairAt: new Date().toISOString()
      });
    }

    const startsAt = parsed.startsAt;
    const endsAt = addMinutes(new Date(startsAt), 15).toISOString();
    let appointment = null;
    try {
      appointment = await ghl.updateAppointment(
        this.config,
        contact,
        contact.appointmentId,
        startsAt,
        endsAt,
        appointmentNotes(
          {
            ...contact,
            preferredCallTime: formatForContact(new Date(startsAt), contact, this.config),
            preferredCallTimeIso: startsAt,
            backupCallTime: ""
          },
          { backupTime: "none", reason: "Primary call time repaired from latest inbound message." }
        )
      );
    } catch (error) {
      await this.notifyBotError("GHL appointment primary time repair failed", {
        Name: contact.name || "unknown",
        Phone: contact.phone || "unknown",
        "GHL contact": contact.ghlContactId || contact.id,
        "Appointment ID": contact.appointmentId || "unknown",
        "Requested start": startsAt,
        Error: error.message
      });
      return this.store.upsertContact({
        ...contact,
        lastPrimaryCallTimeRepairError: error.message,
        lastPrimaryCallTimeRepairAt: new Date().toISOString()
      });
    }

    const display = formatForContact(new Date(startsAt), contact, this.config);
    const updated = await this.store.upsertContact({
      ...contact,
      engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
      qualificationProgress: QUALIFICATION.CALL_BOOKED,
      preferredCallTime: display,
      preferredCallTimeIso: startsAt,
      appointmentId: appointment.id || appointment.appointment?.id || contact.appointmentId || "",
      backupCallTime: "",
      backupCallTimeIso: "",
      backupCallTimeType: "",
      backupWindowStartHour: "",
      backupWindowStartMinute: "",
      backupWindowEndHour: "",
      backupWindowEndMinute: "",
      awaitingBackupTime: false,
      lastPrimaryCallTimeRepairError: "",
      lastPrimaryCallTimeRepairAt: new Date().toISOString(),
      lastPrimaryCallTimeRepairSource: message
    });
    await this.store.cancelJobsForContact(updated.id, "primary call time repaired", (job) =>
      ["appointment_reminder", "backup_time_timeout", "backup_no_show_reminder"].includes(job.type)
    );
    await this.scheduleAppointmentReminders(updated);
    return updated;
  }

  async handleBackupTime(contact, text) {
    const backupWindow = parseBackupWindow(text);
    if (backupWindow) {
      const updated = await this.store.upsertContact({
        ...contact,
        backupCallTime: backupWindow.value,
        backupCallTimeIso: "",
        backupCallTimeType: "window",
        backupWindowStartHour: backupWindow.startHour,
        backupWindowStartMinute: backupWindow.startMinute,
        backupWindowEndHour: backupWindow.endHour,
        backupWindowEndMinute: backupWindow.endMinute,
        awaitingBackupTime: false,
        qualificationProgress: QUALIFICATION.COMPLETE
      });
      await this.sendBotMessage(
        updated,
        render(qualificationTemplates.bookingConfirmedWithBackup, updated, {
          primaryTime: updated.preferredCallTime,
          backupTime: backupWindow.value
        }),
        { bypassQuietHours: true }
      );
      await this.store.cancelJobsForContact(updated.id, "backup time answered", (job) => job.type === "backup_time_timeout");
      await this.syncAppointmentNotes(updated, { backupTime: backupWindow.value, reason: "Backup window supplied by contact." });
      if (!updated.bookingAlertSentAt) {
        const bookingAlertSent = await this.notifyAppointmentBooked(updated, {
          "Primary call time": updated.preferredCallTime,
          "Backup time": updated.backupCallTime || "none",
          Timezone: updated.timezone,
          "GHL appointment": updated.appointmentId || "created"
        });
        if (bookingAlertSent) {
          await this.store.upsertContact({ ...updated, bookingAlertSentAt: new Date().toISOString() });
        }
      }
      await this.scheduleAppointmentReminders(updated);
      return updated;
    }
    let parsed = parseCallTime(text, contact, this.config);
    if (parsed?.type === "scheduled" && !hasExplicitCallDate(text)) {
      parsed = anchorBackupTimeToPrimaryDate(parsed, contact, this.config);
    }
    let updated = contact;
    if (parsed?.type === "scheduled") {
      const backup = formatForContact(new Date(parsed.startsAt), contact, this.config);
      updated = await this.store.upsertContact({
        ...contact,
        backupCallTime: backup,
        backupCallTimeIso: parsed.startsAt,
        backupCallTimeType: "exact",
        backupWindowStartHour: "",
        backupWindowStartMinute: "",
        backupWindowEndHour: "",
        backupWindowEndMinute: "",
        awaitingBackupTime: false,
        qualificationProgress: QUALIFICATION.COMPLETE
      });
      await this.syncAppointmentNotes(updated, { backupTime: backup, reason: "Backup time supplied by contact." });
      await this.sendBotMessage(
        updated,
        render(qualificationTemplates.bookingConfirmedWithBackup, updated, {
          primaryTime: updated.preferredCallTime,
          backupTime: backup
        }),
        { bypassQuietHours: true }
      );
    } else {
      updated = await this.store.upsertContact({
        ...contact,
        awaitingBackupTime: false,
        qualificationProgress: QUALIFICATION.COMPLETE
      });
      await this.sendBotMessage(
        updated,
        render(qualificationTemplates.bookingConfirmedNoBackup, updated, { time: updated.preferredCallTime }),
        { bypassQuietHours: true }
      );
      await this.syncAppointmentNotes(updated, { backupTime: "none", reason: "No backup time supplied." });
    }
    await this.store.cancelJobsForContact(updated.id, "backup time answered", (job) => job.type === "backup_time_timeout");
    if (!updated.bookingAlertSentAt) {
      const bookingAlertSent = await this.notifyAppointmentBooked(updated, {
        "Primary call time": updated.preferredCallTime,
        "Backup time": updated.backupCallTime || "none",
        Timezone: updated.timezone,
        "GHL appointment": updated.appointmentId || "created"
      });
      if (bookingAlertSent) {
        updated = await this.store.upsertContact({ ...updated, bookingAlertSentAt: new Date().toISOString() });
      }
    }
    await this.scheduleAppointmentReminders(updated);
    return updated;
  }

  async notifyAppointmentBooked(contact, extra = {}) {
    try {
      await slack.sendAppointmentBooked(this.config, contact, extra);
      return true;
    } catch (error) {
      await this.notifyBotError("Slack appointment booking alert failed", {
        Name: contact.name || "unknown",
        Phone: contact.phone || "unknown",
        "GHL contact": contact.ghlContactId || contact.id,
        "Appointment ID": contact.appointmentId || "unknown",
        Error: error.message
      });
      return false;
    }
  }

  async scheduleAppointmentReminders(contact) {
    if (!contact.preferredCallTimeIso) return;
    await this.store.cancelJobsForContact(contact.id, "appointment reminders replaced", (job) => job.type === "appointment_reminder");
    const appointment = new Date(contact.preferredCallTimeIso);
    const now = new Date();
    const timeZone = contact.timezone || this.config.texting.defaultTimezone;
    const sameDay = sameLocalDay(now, appointment, timeZone);
    const oneHour = addMinutes(appointment, -60);
    const fiveMinutes = addMinutes(appointment, -5);
    const minimumGapBeforeOneHour = addMinutes(now, 20);
    if (!sameDay) {
      const appointmentLocal = getLocalParts(appointment, timeZone);
      const morningReminderHour = appointmentLocal.hour <= 10 ? 8 : 9;
      const morningReminder = localDateToUtc(
        {
          year: appointmentLocal.year,
          month: appointmentLocal.month,
          day: appointmentLocal.day,
          hour: morningReminderHour,
          minute: 0
        },
        timeZone
      );
      if (morningReminder > now && morningReminder < appointment) {
        await this.store.addJob({
          type: "appointment_reminder",
          contactId: contact.id,
          runAt: morningReminder.toISOString(),
          payload: { templateKey: "nextDayMorning" }
        });
      }
    }
    if (oneHour > minimumGapBeforeOneHour) {
      await this.store.addJob({
        type: "appointment_reminder",
        contactId: contact.id,
        runAt: oneHour.toISOString(),
        payload: { templateKey: sameDay ? "sameDayOneHour" : "nextDayOneHour" }
      });
    }
    if (fiveMinutes > now) {
      await this.store.addJob({
        type: "appointment_reminder",
        contactId: contact.id,
        runAt: fiveMinutes.toISOString(),
        payload: { templateKey: sameDay ? "sameDayFiveMinutes" : "nextDayFiveMinutes" }
      });
    }
    await this.recordDecision(contact, "reminded", "appointment_reminders_scheduled", {
      trigger: "schedule_appointment_reminders",
      meta: { preferredCallTime: contact.preferredCallTime || "", preferredCallTimeIso: contact.preferredCallTimeIso || "" }
    });
  }

  async scheduleBackupNoShowReminders(contact) {
    await this.store.cancelJobsForContact(contact.id, "backup no-show reminders replaced", (job) => job.type === "backup_no_show_reminder");
    if (!contact.backupCallTime) return false;
    const targetIso = backupReminderTargetIso(contact, this.config);
    if (!targetIso) return false;
    const target = new Date(targetIso);
    const now = new Date();
    if (target <= now) return false;

    const addReminder = async (templateKey, runAt) => {
      if (runAt < now) return;
      const scheduledAt = isWithinTextingWindow(contact, this.config, runAt)
        ? runAt
        : nextTextingWindow(contact, this.config, runAt);
      if (scheduledAt >= target) return;
      await this.store.addJob({
        type: "backup_no_show_reminder",
        contactId: contact.id,
        runAt: scheduledAt.toISOString(),
        payload: { templateKey }
      });
    };

    await addReminder("afterPrimaryMissed", now);
    await addReminder("thirtyBefore", addMinutes(target, -30));
    await addReminder("fiveBefore", addMinutes(target, -5));
    return true;
  }

  async scheduleNoShowFollowUps(contact, options = {}) {
    await this.store.cancelJobsForContact(contact.id, "no-show follow-ups replaced", (job) => job.type === "missed_call_followup");
    const now = new Date();
    const sameDayKeys = ["sameDay10", "sameDay45", "sameDay120", "sameDay240", "sameDayLast"];
    for (const [index, minutes] of NO_SHOW_SAME_DAY_MINUTES.entries()) {
      if (options.skipEarlySameDay && index < 2) continue;
      const runAt = addMinutes(now, minutes);
      if (!sameLocalDay(now, runAt, contact.timezone || this.config.texting.defaultTimezone)) continue;
      if (!isWithinTextingWindow(contact, this.config, runAt)) continue;
      await this.store.addJob({
        type: "missed_call_followup",
        contactId: contact.id,
        runAt: runAt.toISOString(),
        payload: { templateGroup: "noShowTemplates", templateKey: sameDayKeys[index], sequence: "appointment_no_show" }
      });
    }
    for (const day of NO_SHOW_DAYS) {
      for (const slot of ["am", "pm"]) {
        const templateKey = `day_${day}_${slot}`;
        if (!noShowTemplates[templateKey]) continue;
        const runAt = localSlotDate(contact, this.config, day - 1, slot);
        if (runAt <= now) continue;
        await this.store.addJob({
          type: "missed_call_followup",
          contactId: contact.id,
          runAt: runAt.toISOString(),
          payload: { templateGroup: "noShowTemplates", templateKey, sequence: "appointment_no_show" }
        });
      }
    }
  }

  async markMissedCall(payload) {
    const normalized = normalizePayload(payload, this.config);
    const contact = await this.store.upsertContact({
      ...normalized,
      engagementStatus: ENGAGEMENT.MISSED_CALL,
      preferredCallTime: normalized.preferredCallTime || payload.preferredCallTime || payload.callTime || payload.scheduledTime || "",
      preferredCallTimeIso: normalized.preferredCallTimeIso || payload.preferredCallTimeIso || payload.callTimeIso || ""
    });
    const attempts = [
      ["after10Minutes", 10],
      ["after3Hours", 180],
      ["nextDay", 24 * 60]
    ];
    for (const [templateKey, minutes] of attempts) {
      await this.store.addJob({
        type: "missed_call_followup",
        contactId: contact.id,
        runAt: addMinutes(new Date(), minutes).toISOString(),
        payload: { templateKey }
      });
    }
    return contact;
  }

  async markNoShow(payload) {
    const normalized = normalizePayload(payload, this.config);
    let contact = await this.store.upsertContact({
      ...normalized,
      engagementStatus: ENGAGEMENT.MISSED_CALL,
      qualificationProgress: QUALIFICATION.CALL_BOOKED,
      appointmentNoShowAt: new Date().toISOString(),
      preferredCallTime: normalized.preferredCallTime || payload.preferredCallTime || payload.callTime || payload.scheduledTime || "",
      preferredCallTimeIso: normalized.preferredCallTimeIso || payload.preferredCallTimeIso || payload.callTimeIso || "",
      currentSequenceName: "appointment_no_show"
    });
    await this.store.cancelJobsForContact(contact.id, "appointment marked no-show", (job) =>
      ["appointment_reminder", "backup_time_timeout", "warm_followup", "enter_reengagement", "send_reengagement_template"].includes(job.type)
    );
    const hasBackupReminderPlan = await this.scheduleBackupNoShowReminders(contact);
    await this.scheduleNoShowFollowUps(contact, { skipEarlySameDay: hasBackupReminderPlan });
    contact = await this.store.upsertContact({
      ...contact,
      currentSequenceDay: 1,
      currentSequenceSlot: "no_show"
    });
    return contact;
  }

  async escalate(contact, reason, extra = {}) {
    const updated = await this.store.upsertContact({
      ...contact,
      engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
      humanEscalationStatus: true,
      humanEscalationStage: "human_review_pending",
      escalatedAt: new Date().toISOString(),
      escalationReason: reason
    });
    await this.store.cancelJobsForContact(
      updated.id,
      "escalated to human",
      (job) => !hasBookedAppointment(updated) || !["appointment_reminder", "backup_no_show_reminder"].includes(job.type)
    );
    await this.store.addEscalation({ contactId: updated.id, reason, lastInboundMessage: updated.lastInboundMessage, extra });
    await this.recordDecision(updated, "escalated", reason, {
      trigger: "bot_escalation",
      beforeStatus: contact.engagementStatus || "",
      afterStatus: updated.engagementStatus || "",
      message: updated.lastInboundMessage || "",
      meta: extra
    });
    try {
      await slack.sendEscalation(this.config, updated, reason, extra);
    } catch (error) {
      await this.notifyBotError("Slack lead escalation alert failed", {
        Name: updated.name || "unknown",
        Phone: updated.phone || "unknown",
        "GHL contact": updated.ghlContactId || updated.id,
        Reason: reason,
        Error: error.message
      });
    }
    await this.scheduleHumanEscalationWatchdog(updated, reason);
    return updated;
  }

  async handleHumanReplyTimeout(job, contact) {
    let fresh = contact || (await this.store.getContact(job.contactId));
    if (!fresh) return null;
    fresh = await this.hydrateContactTags(fresh, { force: true });
    if (
      fresh.optOutStatus ||
      hasSignedTag(fresh) ||
      hasNqTag(fresh) ||
      hasManualHumanHoldTag(fresh) ||
      fresh.engagementStatus === ENGAGEMENT.CALL_SCHEDULED ||
      fresh.qualificationProgress === QUALIFICATION.CALL_BOOKED ||
      fresh.qualificationProgress === QUALIFICATION.COMPLETE ||
      fresh.appointmentId
    ) {
      return fresh;
    }

    const humanAt = new Date(job.payload?.lastHumanOutboundAt || fresh.lastHumanOutboundAt || 0);
    const lastInboundAt = fresh.lastResponseTimestamp ? new Date(fresh.lastResponseTimestamp) : null;
    if (lastInboundAt && humanAt && lastInboundAt > humanAt) return fresh;
    if (!fresh.humanEscalationStatus || !["human_working", "human_replied_waiting"].includes(fresh.humanEscalationStage)) {
      return fresh;
    }

    const resumed = await this.store.upsertContact({
      ...fresh,
      humanEscalationStatus: false,
      humanEscalationStage: "auto_returned_after_human_timeout",
      automationPaused: false,
      automationPauseReason: "",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: fresh.qualificationProgress || QUALIFICATION.NEEDS_FAULT
    });
    const template = humanReturnTemplate(resumed, this.config);
    if (!template) return resumed;
    const sent = await this.sendBotMessage(resumed, render(template, resumed), { bypassQuietHours: true });
    const latest = sent || (await this.store.getContact(resumed.id)) || resumed;
    await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
    return latest;
  }

  async handleHumanEscalationSla(job) {
    let fresh = await this.store.getContact(job.contactId);
    if (!fresh) return null;
    fresh = await this.hydrateContactTags(fresh, { force: true });
    if (!canAutoReturnUnacknowledgedEscalation(fresh, job)) {
      if (fresh?.humanEscalationStage === "human_review_pending" && fresh.humanEscalationStatus) {
        await this.store.upsertContact({
          ...fresh,
          lastHumanEscalationSlaAt: new Date().toISOString(),
          lastHumanEscalationSlaMinutes: job.payload?.minutes || "",
          lastHumanEscalationSlaReason: job.payload?.reason || fresh.escalationReason || "unknown"
        });
      }
      return fresh;
    }

    const resumed = await this.store.upsertContact({
      ...fresh,
      humanEscalationStatus: false,
      humanEscalationStage: "auto_returned_after_unacknowledged_escalation",
      automationPaused: false,
      automationPauseReason: "",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: fresh.qualificationProgress || QUALIFICATION.NEEDS_FAULT,
      lastHumanEscalationSlaAt: new Date().toISOString(),
      lastHumanEscalationSlaMinutes: job.payload?.minutes || "",
      lastHumanEscalationSlaReason: job.payload?.reason || fresh.escalationReason || "unknown"
    });
    const template = humanReturnTemplate(resumed, this.config);
    if (!template) return resumed;
    const sent = await this.sendBotMessage(resumed, render(template, resumed), { bypassQuietHours: true });
    const latest = sent || (await this.store.getContact(resumed.id)) || resumed;
    await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
    return latest;
  }

  async healStuckContacts() {
    if (!this.store.listContacts) return [];
    const contacts = await this.store.listContacts();
    const healed = [];
    for (const raw of contacts) {
      let contact = raw;
      if (
        !contact ||
        contact.optOutStatus ||
        contact.automationPaused ||
        hasSignedTag(contact) ||
        hasNqTag(contact) ||
        hasManualHumanHoldTag(contact) ||
        contact.engagementStatus === ENGAGEMENT.OPTED_OUT ||
        contact.engagementStatus === ENGAGEMENT.CALL_SCHEDULED ||
        contact.qualificationProgress === QUALIFICATION.CALL_BOOKED ||
        contact.qualificationProgress === QUALIFICATION.COMPLETE ||
        contact.appointmentId
      ) {
        continue;
      }

      const jobs = await this.store.listJobs(contact.id);
      const lastInboundAt = contact.lastResponseTimestamp ? new Date(contact.lastResponseTimestamp).getTime() : 0;
      const lastOutboundAt = contact.lastOutboundTimestamp ? new Date(contact.lastOutboundTimestamp).getTime() : 0;
      if (
        needsQualificationReply(contact) &&
        contact.lastInboundMessage &&
        lastInboundAt &&
        (!lastOutboundAt || lastInboundAt > lastOutboundAt) &&
        !hasPendingJob(jobs, ["process_inbound_buffer", "warm_followup", "enter_reengagement", "send_reengagement_template"]) &&
        Date.now() - lastInboundAt >= 2 * 60 * 1000 &&
        isWithinTextingWindow(contact, this.config)
      ) {
        let repaired = null;
        if (contact.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME) {
          repaired = await this.handleCallTime(contact, contact.lastInboundMessage);
        } else {
          const answer = parseExpectedAnswer(contact.qualificationProgress, contact.lastInboundMessage);
          if (answer) repaired = await this.advanceQualification(contact, answer);
          const dateAnswer = !repaired ? parseAccidentDate(contact.lastInboundMessage) : null;
          if (dateAnswer && contact.qualificationProgress === QUALIFICATION.NEEDS_FAULT && !contact.accidentDate) {
            const withDate = await this.store.upsertContact({ ...contact, accidentDate: dateAnswer.value });
            const sent = await this.sendBotMessage(withDate, render(qualificationTemplates.fault, withDate), {
              bypassQuietHours: true
            });
            repaired = sent || (await this.store.getContact(withDate.id)) || withDate;
            await this.scheduleWarmFollowUps(repaired, !isWithinTextingWindow(repaired, this.config));
          }
        }
        if (repaired) {
          healed.push({ contactId: contact.id, action: "processed_stale_inbound" });
          continue;
        }
      }

      if (
        [ENGAGEMENT.ACTIVE_CONVERSATION, ENGAGEMENT.WARM_FOLLOW_UP, ENGAGEMENT.RE_ENGAGEMENT].includes(contact.engagementStatus) &&
        needsQualificationReply(contact) &&
        !hasPendingJob(jobs, ["process_inbound_buffer", "warm_followup", "enter_reengagement", "send_reengagement_template"]) &&
        contact.lastOutboundTimestamp &&
        (!contact.lastResponseTimestamp || new Date(contact.lastOutboundTimestamp) > new Date(contact.lastResponseTimestamp)) &&
        Date.now() - new Date(contact.lastOutboundTimestamp).getTime() >= 5 * 60 * 1000 &&
        isWithinTextingWindow(contact, this.config)
      ) {
        await this.scheduleWarmFollowUps(contact, false);
        healed.push({ contactId: contact.id, action: "scheduled_warm_followups" });
        continue;
      }

      if (
        contact.engagementStatus === ENGAGEMENT.ESCALATED_TO_HUMAN &&
        contact.humanEscalationStatus &&
        contact.humanEscalationStage === "human_review_pending" &&
        !hasPendingJob(jobs, ["human_escalation_sla"]) &&
        contact.escalatedAt &&
        Date.now() - new Date(contact.escalatedAt).getTime() >= 30 * 60 * 1000 &&
        canAutoReturnUnacknowledgedEscalation(contact, { payload: { minutes: 30, reason: contact.escalationReason } })
      ) {
        if (isWithinTextingWindow(contact, this.config)) {
          contact = await this.handleHumanEscalationSla({
            contactId: contact.id,
            payload: { minutes: 30, reason: contact.escalationReason }
          });
          healed.push({ contactId: contact.id, action: "auto_returned_soft_escalation" });
        } else {
          await this.store.addJob({
            type: "human_escalation_sla",
            contactId: contact.id,
            runAt: nextTextingWindow(contact, this.config).toISOString(),
            payload: { minutes: 30, reason: contact.escalationReason, healed: true }
          });
          healed.push({ contactId: contact.id, action: "queued_soft_escalation_return" });
        }
      }
    }
    return healed;
  }

  async runDueJob(job) {
    const outboundJobTypes = [
      "initial_sms",
      "send_message",
      "fresh_lead_followup",
      "send_cold_template",
      "warm_followup",
      "enter_reengagement",
      "send_reengagement_template",
      "appointment_reminder",
      "missed_call_followup",
      "backup_no_show_reminder",
      "backup_time_timeout"
    ];
    let contact = await this.store.getContact(job.contactId);
    let tagLookupStartedAt = null;
    if (contact && outboundJobTypes.includes(job.type)) {
      tagLookupStartedAt = new Date();
      contact = await this.hydrateContactTags(contact, { force: true });
      if (tagLookupFailedAfter(contact, tagLookupStartedAt)) {
        await this.store.updateJob(job.id, {
          status: "pending",
          runAt: addMinutes(new Date(), 5).toISOString(),
          lastError: contact.lastTagLookupError || "GHL contact tag lookup failed",
          retryReason: "tag_lookup_failed"
        });
        await this.recordDecision(contact, "queued", "tag_lookup_failed_deferred", {
          jobId: job.id,
          jobType: job.type,
          meta: { error: contact.lastTagLookupError || "" }
        });
        return;
      }
    }
    if (contact && hasSignedTag(contact)) await this.stopForSignedTag(contact);
    if (contact && hasNqTag(contact)) await this.stopForNqTag(contact);
    if (contact && hasManualHumanHoldTag(contact)) await this.stopForManualHoldTag(contact);
    if (job.type === "process_inbound_buffer") {
      await this.handleInboundBuffer(job, contact);
      await this.store.updateJob(job.id, { status: "done", finishedAt: new Date().toISOString() });
      return;
    }
    if (job.type === "human_reply_timeout") {
      await this.handleHumanReplyTimeout(job, contact);
      await this.store.updateJob(job.id, { status: "done", finishedAt: new Date().toISOString() });
      return;
    }
    if (
      !contact ||
      contact.optOutStatus ||
      contact.automationPaused ||
      contact.engagementStatus === ENGAGEMENT.OPTED_OUT ||
      contact.automationPauseReason === "nq_tag" ||
      contact.automationPauseReason === "signed_tag" ||
      contact.automationPauseReason === "manual_hold_tag" ||
      (outboundJobTypes.includes(job.type) &&
        contact.humanEscalationStatus &&
        contact.engagementStatus === ENGAGEMENT.ESCALATED_TO_HUMAN) ||
      hasSignedTag(contact) ||
      hasNqTag(contact) ||
      hasManualHumanHoldTag(contact)
    ) {
      const skipReason =
        contact?.humanEscalationStatus && contact?.engagementStatus === ENGAGEMENT.ESCALATED_TO_HUMAN
          ? "human_escalation_active"
          : "blocked_by_contact_state";
      await this.store.updateJob(job.id, { status: "skipped", finishedAt: new Date().toISOString(), skipReason });
      if (contact) await this.recordDecision(contact, "skipped", skipReason, { jobId: job.id, jobType: job.type });
      return;
    }
    if (["initial_sms", "fresh_lead_followup", "send_cold_template", "warm_followup", "enter_reengagement", "send_reengagement_template", "appointment_reminder", "missed_call_followup", "backup_no_show_reminder"].includes(job.type)) {
      if (!isWithinTextingWindow(contact, this.config)) {
        await this.store.updateJob(job.id, {
          status: "pending",
          runAt: nextTextingWindow(contact, this.config).toISOString()
        });
        await this.recordDecision(contact, "queued", "job_deferred_quiet_hours", { jobId: job.id, jobType: job.type });
        return;
      }
    }
    if (job.type === "send_message") {
      await this.sendBotMessage(contact, job.payload.message);
    }
    if (job.type === "human_escalation_sla") {
      await this.handleHumanEscalationSla(job);
    }
    if (job.type === "initial_sms") {
      const fresh = await this.store.getContact(job.contactId);
      const rendered = await this.renderManagedTemplate(fresh, "coldOutreachTemplates", job.payload.templateKey, coldOutreachTemplates[job.payload.templateKey]);
      const sent = await this.sendBotMessage(fresh, rendered.message, rendered.meta);
      const updated = await this.store.upsertContact({
        ...(sent || fresh),
        engagementStatus: ENGAGEMENT.INITIAL_SMS_SENT,
        currentSequenceName: "initial_sms",
        currentSequenceDay: 1,
        currentMessageCountForDay: 1,
        sentColdTemplateKeys: Array.from(new Set([...(sent?.sentColdTemplateKeys || fresh.sentColdTemplateKeys || []), "day_1_am"]))
      });
      await this.scheduleColdOutreach(updated);
      if (job.payload?.source !== "backfill") await this.scheduleFreshLeadFollowUps(updated);
      await this.store.addJob({
        type: "cold_entry_check",
        contactId: updated.id,
        runAt: addMinutes(new Date(), 15).toISOString(),
        payload: { lastOutboundTimestamp: updated.lastOutboundTimestamp || new Date().toISOString() }
      });
    }
    if (job.type === "cold_entry_check") {
      const fresh = await this.store.getContact(job.contactId);
      if (fresh.engagementStatus === ENGAGEMENT.INITIAL_SMS_SENT) {
        const updated = await this.store.upsertContact({ ...fresh, engagementStatus: ENGAGEMENT.COLD_OUTREACH });
        await this.scheduleColdOutreach(updated);
      }
    }
    if (job.type === "send_cold_template") {
      const rendered = await this.renderManagedTemplate(contact, "coldOutreachTemplates", job.payload.templateKey, coldOutreachTemplates[job.payload.templateKey]);
      const sent = await this.sendBotMessage(contact, rendered.message, rendered.meta);
      const baseContact = sent || (await this.store.getContact(job.contactId)) || contact;
      const sentKeys = Array.from(new Set([...(baseContact.sentColdTemplateKeys || []), job.payload.templateKey]));
      await this.store.upsertContact({
        ...baseContact,
        engagementStatus: ENGAGEMENT.COLD_OUTREACH,
        currentSequenceName: "cold_outreach",
        currentSequenceDay: job.payload.day,
        currentMessageCountForDay: job.payload.slot === "pm" ? 2 : 1,
        sentColdTemplateKeys: sentKeys
      });
    }
    if (job.type === "fresh_lead_followup") {
      const fresh = await this.store.getContact(job.contactId);
      const step = Number(job.payload.step || 1);
      const template = freshLeadFollowUpTemplates[step];
      if (template) {
        const rendered = await this.renderManagedTemplate(fresh, "freshLeadFollowUpTemplates", String(step), template);
        const sent = await this.sendBotMessage(fresh, rendered.message, rendered.meta);
        await this.store.upsertContact({
          ...(sent || fresh),
          engagementStatus: ENGAGEMENT.COLD_OUTREACH,
          currentSequenceName: "fresh_lead_follow_up",
          currentSequenceDay: 1,
          currentSequenceSlot: `fresh_${step}`,
          currentMessageCountForDay: Number(fresh.currentMessageCountForDay || 1) + 1
        });
      }
    }
    if (job.type === "warm_followup") {
      const fresh = await this.store.getContact(job.contactId);
      const step = Number(job.payload.step || 1);
      const template = warmFollowUpTemplate(fresh, step, this.config);
      const updated = await this.store.upsertContact({
        ...fresh,
        engagementStatus: ENGAGEMENT.WARM_FOLLOW_UP,
        currentSequenceName: "warm_follow_up",
        currentSequenceDay: step
      });
      if (template) {
        const templateProgressKey =
          updated.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME && updated.awaitingSpecificCallTime
            ? "needs_call_time_specific"
            : updated.qualificationProgress;
        const key = `${templateProgressKey}.${step}`;
        const rendered = await this.renderManagedTemplate(updated, "warmFollowUpTemplates", key, template);
        await this.sendBotMessage(updated, rendered.message, {
          bypassQuietHours: job.payload.afterHours,
          ...rendered.meta
        });
      }
    }
    if (job.type === "enter_reengagement") {
      const fresh = await this.store.getContact(job.contactId);
      await this.scheduleReengagement(fresh, { sendFirstNow: true });
    }
    if (job.type === "send_reengagement_template") {
      const template = reengagementTemplate(job.payload.sequence, job.payload);
      const key = `${job.payload.sequence}.${job.payload.templateKey || job.payload.day}`;
      const rendered = await this.renderManagedTemplate(contact, "persistentReengagementTemplates", key, template);
      const sent = await this.sendBotMessage(contact, rendered.message, rendered.meta);
      const baseContact = sent || (await this.store.getContact(job.contactId)) || contact;
      await this.store.upsertContact({
        ...baseContact,
        engagementStatus: ENGAGEMENT.RE_ENGAGEMENT,
        currentSequenceName: job.payload.sequence,
        currentSequenceDay: job.payload.day,
        currentSequenceSlot: job.payload.slot
      });
    }
    if (job.type === "backup_time_timeout") {
      const fresh = await this.store.getContact(job.contactId);
      if (fresh.awaitingBackupTime) {
        const updated = await this.store.upsertContact({
          ...fresh,
          awaitingBackupTime: false,
          qualificationProgress: QUALIFICATION.COMPLETE
        });
        await this.sendBotMessage(
          updated,
          render(qualificationTemplates.bookingConfirmedNoBackup, updated, { time: updated.preferredCallTime }),
          { bypassQuietHours: true }
        );
        await this.syncAppointmentNotes(updated, { backupTime: "none", reason: "No backup time supplied before timeout." });
        if (!updated.bookingAlertSentAt) {
          const bookingAlertSent = await this.notifyAppointmentBooked(updated, {
            "Primary call time": updated.preferredCallTime,
            "Backup time": "none",
            Timezone: updated.timezone,
            "GHL appointment": updated.appointmentId || "created"
          });
          if (bookingAlertSent) {
            await this.store.upsertContact({ ...updated, bookingAlertSentAt: new Date().toISOString() });
          }
        }
        await this.scheduleAppointmentReminders(updated);
      }
    }
    if (job.type === "appointment_reminder") {
      const template = reminderTemplates[job.payload.templateKey];
      if (!template) {
        await this.store.updateJob(job.id, {
          status: "skipped",
          finishedAt: new Date().toISOString(),
          skipReason: "missing_reminder_template"
        });
        await this.recordDecision(contact, "skipped", "missing_reminder_template", {
          jobId: job.id,
          jobType: job.type,
          meta: { templateKey: job.payload.templateKey || "" }
        });
        return;
      }
      const rendered = await this.renderManagedTemplate(contact, "reminderTemplates", job.payload.templateKey, template);
      await this.sendBotMessage(contact, rendered.message, rendered.meta);
    }
    if (job.type === "missed_call_followup") {
      const group = job.payload.templateGroup === "noShowTemplates" ? "noShowTemplates" : "missedCallTemplates";
      const templates = group === "noShowTemplates" ? noShowTemplates : missedCallTemplates;
      const rendered = await this.renderManagedTemplate(
        contact,
        group,
        job.payload.templateKey,
        templates[job.payload.templateKey],
        { time: contact.preferredCallTime || "your scheduled time" }
      );
      await this.sendBotMessage(contact, rendered.message, rendered.meta);
    }
    if (job.type === "backup_no_show_reminder") {
      const rendered = await this.renderManagedTemplate(
        contact,
        "backupReminderTemplates",
        job.payload.templateKey,
        backupReminderTemplates[job.payload.templateKey],
        {
          primaryTime: contact.preferredCallTime || "your first call time",
          backupTime: contact.backupCallTime || "your backup time"
        }
      );
      await this.sendBotMessage(contact, rendered.message, rendered.meta);
    }
    await this.store.updateJob(job.id, { status: "done", finishedAt: new Date().toISOString() });
  }
}

module.exports = { SmsBot, normalizePayload, callAskTemplateForTime };
