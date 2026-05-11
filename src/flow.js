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
  isSpanishContact,
  localizeMessage,
  render
} = require("./templates");
const {
  normalize,
  isOptOut,
  escalationReason,
  classifyHumanContextIntent,
  parseAccidentDate,
  parseCallTime,
  parseExpectedAnswer,
  isCallNow,
  isNotTodayAvailability,
  hasClockTimeSignal
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
const { normalizePhone } = require("./store");

const WARM_FOLLOW_UP_MINUTES = [5, 15, 30, 60, 120, 240];
const REENGAGEMENT_DAYS = [1, 2, 3, 4, 5, 6, 7];
const REENGAGEMENT_SLOTS = ["am", "pm"];
const HUMAN_ESCALATION_SLA_MINUTES = [5, 15, 30];
const HUMAN_REPLY_TIMEOUT_MINUTES = 5;
const HUMAN_CALL_TIMEOUT_MINUTES = 30;
const INBOUND_BUFFER_SECONDS = 30;
const FRESH_LEAD_FOLLOW_UP_MINUTES = [15, 45, 120, 240];
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
const HUMAN_ESCALATION_BLOCKED_JOB_TYPES = [
  "initial_sms",
  "send_message",
  "fresh_lead_followup",
  "send_cold_template",
  "warm_followup",
  "enter_reengagement",
  "send_reengagement_template",
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
  if (isSpanishContact(normalized)) {
    normalized.language = "es";
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
  return hasAnyTag(contact, ["signed", "contract", "contract_set", "contract_sent", "contract_signed"]);
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
  if (normalizedTags.some((tag) => ["signed", "contract", "contract_set", "contract_sent", "contract_signed"].includes(tag))) {
    return "signed";
  }
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
    "follow_up",
    "missed_follow_up",
    "qr"
  ]);
}

function contactIdentitySet(contact) {
  return new Set(
    [
      contact?.id,
      contact?.ghlContactId,
      contact?.contactId,
      ...(Array.isArray(contact?.aliasContactIds) ? contact.aliasContactIds : [])
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

function sameContactIdentity(contact, candidate) {
  const current = contactIdentitySet(contact);
  return [
    candidate?.id,
    candidate?.contactId,
    candidate?.ghlContactId,
    candidate?._id
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .some((value) => current.has(value));
}

function duplicateTerminalReason(candidate) {
  if (hasNqTag(candidate)) return "duplicate_nq_tag";
  if (hasSignedTag(candidate)) return "duplicate_signed_tag";
  if (hasManualHumanHoldTag(candidate)) return "duplicate_manual_hold_tag";
  if (hasAnyTag(candidate, ["dnc", "do_not_contact", "opt_out", "opted_out"])) return "duplicate_do_not_contact_tag";
  return "";
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

function isBriefAcknowledgement(text) {
  return /^(ok|okay|k|sure|yes|yeah|yep|thanks|thank you|thank u|sounds good)$/i.test(normalize(text));
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

function needsColdAccidentDate(contact) {
  return (
    contact.qualificationProgress === QUALIFICATION.NEEDS_FAULT &&
    !contact.accidentDate &&
    !contact.faultAnswer &&
    [
      ENGAGEMENT.CALLED_NO_ANSWER,
      ENGAGEMENT.INITIAL_SMS_SENT,
      ENGAGEMENT.COLD_OUTREACH,
      ENGAGEMENT.ACTIVE_CONVERSATION,
      ENGAGEMENT.WARM_FOLLOW_UP
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
  if (looksLikeAccidentTiming(text) && !hasCallIntentText(text)) return false;
  return (
    /\b(call|talk|speak|schedule|appointment|specialist|available|free|later|tomorrow|today|tonight|morning|afternoon|evening|noon)\b/.test(t) ||
    /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/.test(t)
  );
}

function hasCallIntentText(text) {
  const t = normalize(text);
  return /\b(open|available|free|call|talk|speak|meeting|appointment|schedule|specialist)\b/.test(t);
}

function looksLikeAccidentTiming(text) {
  const t = normalize(text);
  const hasAccidentSubject = /\b(accident|wreck|crash|collision|incident)\b/.test(t);
  const hasTimingVerb = /\b(happened|occurred|took place|was|were|happen|took)\b/.test(t);
  const hasDateOrTime =
    Boolean(parseAccidentDate(t)) ||
    /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/.test(t) ||
    /\b(morning|afternoon|evening|night|noon)\b/.test(t);
  return hasAccidentSubject && hasTimingVerb && hasDateOrTime;
}

function isSoftEscalationReason(reason = "") {
  return [
    "message_after_bot_paused",
    "llm_asks_who_this_is",
    "company_question",
    "low_confidence_answer",
    "llm_needs_escalation",
    "llm_unhandled_needs_escalation",
    "llm_unknown",
    "llm_confused",
    "llm_unhandled_confused"
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
    "llm_confused",
    "llm_unhandled_confused",
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

function softEscalationQualificationAnswer(contact, text) {
  if (contact.engagementStatus !== ENGAGEMENT.ESCALATED_TO_HUMAN) return null;
  if (contact.automationPaused) return null;
  if (!isSoftEscalationReason(contact.escalationReason)) return null;
  if (contact.humanEscalationStage && contact.humanEscalationStage !== "human_review_pending") return null;
  if (![QUALIFICATION.NEEDS_FAULT, QUALIFICATION.NEEDS_MEDICAL].includes(contact.qualificationProgress)) return null;
  return parseExpectedAnswer(contact.qualificationProgress, text);
}

function canAutoResumeHumanScheduling(contact, text, config) {
  if (contact.engagementStatus !== ENGAGEMENT.ESCALATED_TO_HUMAN) return false;
  if (!["human_working", "human_replied_waiting"].includes(contact.humanEscalationStage)) return false;
  if (contact.automationPauseReason && contact.automationPauseReason !== "human_working") return false;
  if (contact.appointmentId || contact.qualificationProgress === QUALIFICATION.CALL_BOOKED) return false;
  const schedulingContact = { ...contact, qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME };
  return Boolean(looksLikeCallScheduling(text) && parseCallTime(text, schedulingContact, config));
}

function canApplyAdminPause(controlMeta = {}) {
  return ["admin_contact_action", "admin_bulk_contact_action", "dashboard_contact_shortcut", "local_tester"].includes(
    controlMeta.source
  );
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

function weekdayLabel(text) {
  const match = normalize(text).match(/\b(sunday|sun|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thurs|friday|fri|saturday|sat)\b/);
  if (!match) return "";
  const labels = {
    sun: "sunday",
    sunday: "sunday",
    mon: "monday",
    monday: "monday",
    tue: "tuesday",
    tues: "tuesday",
    tuesday: "tuesday",
    wed: "wednesday",
    wednesday: "wednesday",
    thu: "thursday",
    thurs: "thursday",
    thursday: "thursday",
    fri: "friday",
    friday: "friday",
    sat: "saturday",
    saturday: "saturday"
  };
  return labels[match[1]] || match[1];
}

function titleCaseWord(value) {
  const text = String(value || "");
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : "";
}

function daypartFromText(text) {
  const t = normalize(text);
  if (/\bmorning\b/.test(t)) return "morning";
  if (/\bafternoon\b/.test(t)) return "afternoon";
  if (/\bevening|tonight\b/.test(t)) return "evening";
  return "";
}

function hasFreshCallTimeClarification(contact) {
  if (!contact?.callTimeClarificationDay) return false;
  if (!contact.callTimeClarificationAskedAt) return true;
  return Date.now() - new Date(contact.callTimeClarificationAskedAt).getTime() <= 36 * 60 * 60 * 1000;
}

function callTimeClarificationPatch(contact, parsed, text, mode) {
  const t = normalize(text);
  const weekday = weekdayLabel(t);
  let day = "";
  let dayLabel = "";
  if (weekday && parsed?.preferredDay === "weekday") {
    day = "weekday";
    dayLabel = weekday;
  } else if (/\btomorrow\b/.test(t) || parsed?.preferredDay === "tomorrow") {
    day = "tomorrow";
  } else if (parsed?.preferredDay === "tomorrow_or_later") {
    day = "tomorrow_or_later";
  } else if (hasFreshCallTimeClarification(contact) && daypartFromText(t)) {
    day = contact.callTimeClarificationDay;
    dayLabel = contact.callTimeClarificationDayLabel || "";
  }
  return {
    callTimeClarificationDay: day,
    callTimeClarificationDayLabel: dayLabel,
    callTimeClarificationMode: mode,
    callTimeClarificationSource: text,
    callTimeClarificationAskedAt: new Date().toISOString()
  };
}

function clearCallTimeClarificationPatch() {
  return {
    callTimeClarificationDay: "",
    callTimeClarificationDayLabel: "",
    callTimeClarificationMode: "",
    callTimeClarificationSource: "",
    callTimeClarificationAskedAt: ""
  };
}

function anchorScheduledTimeToClarifiedDay(parsed, text, contact, config) {
  if (parsed?.type !== "scheduled") return parsed;
  if (hasExplicitCallDate(text) || !hasFreshCallTimeClarification(contact)) return parsed;
  const day = contact.callTimeClarificationDay;
  if (!["tomorrow", "weekday"].includes(day)) return parsed;
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  const clock = getLocalParts(new Date(parsed.startsAt), timeZone);
  const local = getLocalParts(new Date(), timeZone);
  let dayOffset = 1;
  if (day === "weekday") {
    const weekdayMap = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6
    };
    const target = weekdayMap[contact.callTimeClarificationDayLabel];
    const current = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
    dayOffset = Number.isFinite(target) ? (target - current + 7) % 7 || 7 : 1;
  }
  const startsAt = localDateToUtc(
    {
      year: local.year,
      month: local.month,
      day: local.day + dayOffset,
      hour: clock.hour,
      minute: clock.minute
    },
    timeZone
  );
  return { ...parsed, startsAt: startsAt.toISOString(), appliedCallTimeClarificationDay: day };
}

function isRescheduleRequest(text) {
  const t = normalize(text);
  return /\b(reschedule|re-schedule|move it|move the call|change the time|change my time|different time|another time|another day|instead|push it back|push back|can't make it|cant make it|need to move|need a new time)\b/.test(t);
}

function isPrimaryCallCorrectionWhileAwaitingBackup(text, contact, config) {
  if (!contact.preferredCallTimeIso) return false;
  const t = normalize(text);
  const parsed = parseCallTime(text, contact, config);
  if (
    parsed?.type === "needs_specific_time" &&
    /\b(that s today|that is today|thats today|wrong day|i said tomorrow|meant tomorrow|not today|not for today)\b/.test(t)
  ) {
    return true;
  }
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

function looksLikeDetailedLegalOrInsuranceInfo(text) {
  const t = normalize(text);
  return (
    /\b(they|insurance|adjuster|company)\s+(offered|offer|offering|tried to offer)\b/.test(t) ||
    /\b(settlement|settle|settled|claim offer|insurance offer)\b/.test(t) ||
    /\$\s*\d/.test(String(text || "")) ||
    /\b\d{1,3},\d{3,}\b/.test(t)
  );
}

function shouldBypassQuietHoursForInitialJob(job = {}) {
  return job.type === "initial_sms" && ["fresh", "fresh_retry"].includes(job.payload?.source);
}

function shouldTreatNoResponseAsCallNoAnswer(existing = {}) {
  if (!existing || existing.optOutStatus || existing.automationPaused) return false;
  if (existing.engagementStatus === ENGAGEMENT.READY_FOR_CALL) return true;
  if (isCallNow(existing.lastInboundMessage || "")) return true;
  if (existing.humanEscalationStatus && /call_now|ready_for_call/i.test(existing.escalationReason || existing.humanEscalationStage || "")) {
    return true;
  }
  if (/call_now|ready_for_call|call_now_no_answer/i.test(existing.escalationReason || existing.humanEscalationStage || "")) {
    return true;
  }
  if (
    existing.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME &&
    (existing.faultAnswer || existing.medicalTreatmentAnswer || /specialist|call|phone/i.test(existing.lastOutboundMessage || ""))
  ) {
    return true;
  }
  return false;
}

function hasNoResponseMemory(existing = {}) {
  if (!existing) return false;
  return Boolean(
    hasAnyTag(existing, ["nr", "no_response"]) &&
      (existing.lastOutboundMessage ||
        existing.lastOutboundTimestamp ||
        existing.currentSequenceName ||
        (existing.sentColdTemplateKeys || []).length ||
        existing.engagementStatus)
  );
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

function formatTimeOnlyWithZone(date, contact, config) {
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short"
  })
    .format(date)
    .replace(/\bEDT\b/g, "EST")
    .replace(/\bCDT\b/g, "CST")
    .replace(/\bMDT\b/g, "MST")
    .replace(/\bPDT\b/g, "PST");
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

function nestedValue(source, key) {
  if (!source || !key) return "";
  if (source[key] !== undefined && source[key] !== null && source[key] !== "") return source[key];
  if (!key.includes(".")) return "";
  return key.split(".").reduce((value, part) => (value && value[part] !== undefined ? value[part] : ""), source);
}

function appointmentField(payload, keys) {
  const sources = [
    payload?.appointment,
    payload?.event,
    payload?.calendar,
    payload?.calendarEvent,
    payload?.customData,
    payload?.custom_data,
    payload?.triggerData,
    payload?.trigger_data,
    payload
  ].filter(Boolean);
  for (const source of sources) {
    for (const key of keys) {
      const value = nestedValue(source, key);
      if (value !== undefined && value !== null && value !== "") return value;
    }
  }
  return "";
}

function shouldPreferRecentInboundCallTime(rawIso, candidateIso, contact = {}, config = {}) {
  const rawDate = new Date(rawIso || "");
  const candidateDate = new Date(candidateIso || "");
  if (Number.isNaN(rawDate.getTime()) || Number.isNaN(candidateDate.getTime())) return false;
  const now = new Date();
  const timeZone = contact.timezone || config.texting?.defaultTimezone || "America/Chicago";
  const rawLocal = getLocalParts(rawDate, timeZone);
  const candidateLocal = getLocalParts(candidateDate, timeZone);
  const candidateLooksCallable = candidateLocal.hour >= 8 && candidateLocal.hour <= 20;
  if (!candidateLooksCallable) return false;
  const rawIsPastOrTooSoon = rawDate <= addMinutes(now, 10);
  const rawIsOutsideNormalCallingWindow = rawLocal.hour < 8 || rawLocal.hour > 20;
  const veryDifferentFromLeadRequest = Math.abs(rawDate.getTime() - candidateDate.getTime()) > 3 * 60 * 60 * 1000;
  return rawIsPastOrTooSoon || rawIsOutsideNormalCallingWindow || veryDifferentFromLeadRequest;
}

function appointmentContactId(payload = {}) {
  return textValue(
    appointmentField(payload, [
      "contactId",
      "contact_id",
      "ghlContactId",
      "ghl_contact_id",
      "Contact ID",
      "contact.id",
      "contact._id",
      "contact.contactId",
      "contact.contact_id",
      "appointment.contactId",
      "appointment.contact_id",
      "event.contactId",
      "event.contact_id"
    ])
  );
}

function appointmentIdFromPayload(payload = {}) {
  return textValue(
    appointmentField(payload, [
      "appointmentId",
      "appointment_id",
      "calendarEventId",
      "calendar_event_id",
      "eventId",
      "event_id",
      "appointment.id",
      "event.id",
      "calendarEvent.id"
    ])
  );
}

function appointmentStatusFromPayload(payload = {}) {
  return textValue(
    appointmentField(payload, [
      "appointmentStatus",
      "appointment_status",
      "status",
      "eventStatus",
      "event_status",
      "calendarStatus",
      "calendar_status",
      "appointment.status",
      "event.status"
    ])
  ).toLowerCase();
}

function appointmentStartRawFromPayload(payload = {}) {
  return appointmentField(payload, [
    "startTime",
    "start_time",
    "startsAt",
    "starts_at",
    "startAt",
    "start_at",
    "scheduledTime",
    "scheduled_time",
    "appointmentTime",
    "appointment_time",
    "appointmentStartTime",
    "appointment_start_time",
    "calendarStartTime",
    "calendar_start_time",
    "startDate",
    "start_date",
    "start",
    "appointment.startTime",
    "appointment.start_time",
    "appointment.start",
    "event.startTime",
    "event.start_time",
    "event.start"
  ]);
}

function parseLocalAppointmentStart(value, contact = {}, config = {}, timezoneOverride = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const timeZone = timezoneOverride || contact.timezone || config.texting?.defaultTimezone || "America/Chicago";
  const isoNoZone = raw.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/
  );
  if (isoNoZone) {
    const [, year, month, day, hour, minute] = isoNoZone;
    return localDateToUtc(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
        hour: Number(hour),
        minute: Number(minute)
      },
      timeZone
    ).toISOString();
  }
  const usDateTime = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (usDateTime) {
    const [, month, day, rawYear, rawHour, rawMinute, meridiem] = usDateTime;
    let year = Number(rawYear);
    if (year < 100) year += 2000;
    let hour = Number(rawHour);
    if (meridiem?.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (meridiem?.toLowerCase() === "am" && hour === 12) hour = 0;
    return localDateToUtc(
      {
        year,
        month: Number(month),
        day: Number(day),
        hour,
        minute: Number(rawMinute || 0)
      },
      timeZone
    ).toISOString();
  }
  return "";
}

function appointmentStartIsoFromPayload(payload = {}, contact = {}, config = {}) {
  const value = appointmentStartRawFromPayload(payload);
  if (!value) return "";
  if (typeof value === "string") {
    const raw = value.trim();
    const date = new Date(raw);
    const absoluteIso = Number.isNaN(date.getTime()) ? "" : date.toISOString();
    const hasExplicitZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
    if (absoluteIso && hasExplicitZone) {
      for (const knownIso of [contact.preferredCallTimeIso, contact.backupCallTimeIso].filter(Boolean)) {
        const existing = new Date(knownIso);
        if (!Number.isNaN(existing.getTime()) && Math.abs(existing.getTime() - date.getTime()) < 60 * 1000) {
          return knownIso;
        }
      }
    }

    // GHL appointment workflow merge fields can serialize calendar-local wall time
    // with a trailing Z, so parse string values as calendar time unless they match
    // an already-known bot-created appointment instant.
    const calendarTimezone = config.texting?.defaultTimezone || "America/Chicago";
    const calendarLocalIso = parseLocalAppointmentStart(raw, contact, config, calendarTimezone);
    if (calendarLocalIso) return calendarLocalIso;
  }
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function suppressAppointmentAlertFromPayload(payload = {}) {
  const value = textValue(
    appointmentField(payload, ["suppressAlert", "suppress_alert", "silent", "noSlack", "no_slack"])
  );
  return ["true", "1", "yes", "y"].includes(normalize(value));
}

function isNoShowAppointmentStatus(status = "") {
  return /no[\s_-]?show|noshow|missed/.test(String(status || "").toLowerCase());
}

function expectedAppointmentReminderRunAt(contact, templateKey, config) {
  if (!contact?.preferredCallTimeIso || !templateKey) return null;
  const appointment = new Date(contact.preferredCallTimeIso);
  if (Number.isNaN(appointment.getTime())) return null;
  if (/OneHour$/.test(templateKey)) return addMinutes(appointment, -60);
  if (/FiveMinutes$/.test(templateKey)) return addMinutes(appointment, -5);
  if (templateKey === "nextDayMorning") {
    const timeZone = contact.timezone || config.texting.defaultTimezone;
    const appointmentLocal = getLocalParts(appointment, timeZone);
    const morningReminderHour = appointmentLocal.hour <= 10 ? 8 : 9;
    return localDateToUtc(
      {
        year: appointmentLocal.year,
        month: appointmentLocal.month,
        day: appointmentLocal.day,
        hour: morningReminderHour,
        minute: 0
      },
      timeZone
    );
  }
  return null;
}

function isCurrentAppointmentReminderJob(contact, job, config) {
  if (!contact?.preferredCallTimeIso) return false;
  if (job.payload?.appointmentIso) {
    const jobAppointment = new Date(job.payload.appointmentIso);
    const currentAppointment = new Date(contact.preferredCallTimeIso);
    if (Number.isNaN(jobAppointment.getTime()) || Number.isNaN(currentAppointment.getTime())) return false;
    if (jobAppointment.getTime() !== currentAppointment.getTime()) return false;
  }
  const expected = expectedAppointmentReminderRunAt(contact, job.payload?.templateKey, config);
  if (!expected || !job.runAt) return true;
  const runAt = new Date(job.runAt);
  if (Number.isNaN(runAt.getTime())) return false;
  return Math.abs(runAt.getTime() - expected.getTime()) <= 90 * 1000;
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
    this.bookingAlertLocks = new Set();
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

  async stopForDuplicateTerminalContact(contact, duplicate, reason, message) {
    const duplicateId = duplicate?.id || duplicate?.contactId || duplicate?.ghlContactId || "";
    const duplicateTags = normalizeTags(duplicate?.tags);
    const updated = await this.store.upsertContact({
      ...contact,
      automationPaused: true,
      automationPauseReason: reason,
      humanEscalationStatus: true,
      humanEscalationStage: "duplicate_terminal_contact",
      currentSequenceName: "",
      duplicateTerminalContactId: duplicateId,
      duplicateTerminalContactName: duplicate?.contactName || duplicate?.name || duplicate?.fullName || "",
      duplicateTerminalTags: duplicateTags,
      duplicateTerminalReason: reason,
      lastDuplicateTerminalCheckAt: new Date().toISOString()
    });
    await this.store.cancelJobsForContact(updated.id, `duplicate terminal contact: ${reason}`);
    await this.recordDecision(updated, "skipped", reason, {
      message,
      meta: {
        duplicateContactId: duplicateId,
        duplicateContactName: duplicate?.contactName || duplicate?.name || duplicate?.fullName || "",
        duplicateTags: duplicateTags.join(", ")
      }
    });
    await this.notifyBotError("Duplicate terminal contact paused SMS bot", {
      Name: updated.name || "unknown",
      Phone: updated.phone || "unknown",
      "Bot contact": updated.ghlContactId || updated.id,
      "Duplicate contact": duplicateId || "unknown",
      Reason: reason,
      Tags: duplicateTags.join(", ")
    }, { operationalOnly: true, slack: false, level: "warn" });
    return updated;
  }

  async stopIfDuplicateTerminalContact(contact, message) {
    if (this.config.dryRun || !this.config.ghl?.token || !contact?.phone) return null;
    try {
      const primaryLookupPhone = contact.phone;
      const normalized = normalizePhone(primaryLookupPhone);
      const lookupPhones = Array.from(new Set([primaryLookupPhone, normalized ? `+1${normalized}` : ""].filter(Boolean)));
      let contacts = [];
      for (const lookupPhone of lookupPhones) {
        const result = await ghl.searchContactsByPhone(this.config, lookupPhone, { limit: 20 });
        contacts = [...contacts, ...(result.contacts || [])];
        if (contacts.length) break;
      }
      const seen = new Set();
      const uniqueContacts = contacts.filter((candidate) => {
        const id = candidate?.id || candidate?.contactId || candidate?.ghlContactId || `${candidate?.phone}-${candidate?.name}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const duplicate = uniqueContacts.find((candidate) => {
        if (sameContactIdentity(contact, candidate)) return false;
        if (normalizePhone(candidate?.phone || candidate?.phoneNumber || candidate?.phone_number) !== normalizePhone(contact.phone)) {
          return false;
        }
        return Boolean(duplicateTerminalReason(candidate));
      });
      if (!duplicate) return null;
      return this.stopForDuplicateTerminalContact(contact, duplicate, duplicateTerminalReason(duplicate), message);
    } catch (error) {
      const failed = await this.store.upsertContact({
        ...contact,
        lastDuplicateLookupFailedAt: new Date().toISOString(),
        lastDuplicateLookupError: error.message
      });
      await this.recordDecision(failed, "skipped", "duplicate_phone_lookup_failed_no_send", {
        message,
        meta: { error: error.message }
      });
      await this.notifyBotError("GHL duplicate phone lookup failed", {
        Name: failed.name || "unknown",
        Phone: failed.phone || "unknown",
        "GHL contact": failed.ghlContactId || failed.id,
        Error: error.message
      }, { operationalOnly: true, slack: false, level: "warn" });
      return failed;
    }
  }

  async sendBotMessage(contact, message, options = {}) {
    message = localizeMessage(message, contact);
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
      const duplicateTerminalContact = await this.stopIfDuplicateTerminalContact(contact, message);
      if (duplicateTerminalContact) return null;
      message = localizeMessage(message, contact);
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
          timezone: resolveContactTimezone(withTags, this.config),
          language: isSpanishContact(withTags) ? "es" : withTags.language || ""
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
    const guard = {
      expectedProgress: contact.qualificationProgress || "",
      baseOutboundTimestamp: contact.lastOutboundTimestamp || new Date().toISOString()
    };
    if (afterHours) {
      const warmRunAt = addMinutes(new Date(), 15);
      const reengagementRunAt = nextTextingWindow(contact, this.config, addMinutes(new Date(), 16));
      await this.store.addJob({
        type: "warm_followup",
        contactId: contact.id,
        runAt: warmRunAt.toISOString(),
        payload: { step: 1, minutes: 15, afterHours: true, ...guard }
      });
      await this.store.addJob({
        type: "enter_reengagement",
        contactId: contact.id,
        runAt: (reengagementRunAt > warmRunAt ? reengagementRunAt : addMinutes(warmRunAt, 1)).toISOString(),
        payload: { afterHours: true, ...guard }
      });
      return;
    }
    for (const [index, minutes] of WARM_FOLLOW_UP_MINUTES.entries()) {
      await this.store.addJob({
        type: "warm_followup",
        contactId: contact.id,
        runAt: addMinutes(new Date(), minutes).toISOString(),
        payload: { step: index + 1, minutes, ...guard }
      });
    }
    await this.store.addJob({
      type: "enter_reengagement",
      contactId: contact.id,
      runAt: addMinutes(new Date(), 24 * 60).toISOString(),
      payload: { ...guard }
    });
  }

  async scheduleColdOutreach(contact) {
    const sentKeys = new Set(contact.sentColdTemplateKeys || []);
    const existingJobs = await this.store.listJobs(contact.id);
    const pendingFreshTimes = existingJobs
      .filter((job) => job.status === "pending" && job.type === "fresh_lead_followup")
      .map((job) => new Date(job.runAt))
      .filter((date) => !Number.isNaN(date.getTime()));
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
        if (
          key === "day_1_pm" &&
          pendingFreshTimes.some((freshRunAt) => Math.abs(freshRunAt.getTime() - runAt.getTime()) <= 60 * 60 * 1000)
        ) {
          continue;
        }
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
    const localNow = getLocalParts(now, timeZone);
    const startMinutes = localNow.hour * 60 + localNow.minute;
    const pmSlot = localSlotDate(contact, this.config, 0, "pm");
    for (const [index, minutes] of FRESH_LEAD_FOLLOW_UP_MINUTES.entries()) {
      const runAt = addMinutes(now, minutes);
      const localRunAt = getLocalParts(runAt, timeZone);
      const runMinutes = localRunAt.hour * 60 + localRunAt.minute;
      const allowedByStartTime =
        startMinutes < 15 * 60 ||
        (startMinutes < 18 * 60 + 30 && [15, 45].includes(minutes)) ||
        minutes === 15 ||
        (minutes === 45 && runMinutes <= 20 * 60 + 30);
      if (!allowedByStartTime) continue;
      if (!sameLocalDay(now, runAt, timeZone)) continue;
      if (!isWithinTextingWindow(contact, this.config, runAt)) continue;
      if (Math.abs(runAt.getTime() - pmSlot.getTime()) <= 60 * 60 * 1000) continue;
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
    const normalized = normalizePayload(payload, this.config);
    const existing = await this.store.getContact(normalized.id);
    if (shouldTreatNoResponseAsCallNoAnswer(existing)) {
      return this.sendCallNowNoAnswerRecovery(existing, normalized, "no_response_disposition");
    }

    if (hasNoResponseMemory(existing)) {
      let contact = await this.store.upsertContact({
        ...existing,
        ...normalized,
        timezone: chooseContactTimezone(existing, normalized, this.config),
        optOutStatus: existing.optOutStatus || false,
        humanEscalationStatus: existing.humanEscalationStatus || false
      });
      contact = await this.hydrateContactTags(contact);
      if (hasSignedTag(contact)) return this.stopForSignedTag(contact);
      if (hasNqTag(contact)) return this.stopForNqTag(contact);
      if (hasManualHumanHoldTag(contact)) return this.stopForManualHoldTag(contact);
      await this.recordDecision(contact, "skipped", "repeat_no_response_already_enrolled", {
        trigger: "no_response_disposition",
        meta: {
          currentSequenceName: contact.currentSequenceName || "",
          engagementStatus: contact.engagementStatus || "",
          lastOutboundMessage: contact.lastOutboundMessage || ""
        }
      });
      return contact;
    }

    const contact = await this.store.upsertContact({
      ...normalized,
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
    const sent = await this.sendBotMessage(contact, initial, {
      bypassQuietHours: true,
      templateGroup: "coldOutreachTemplates",
      templateKey: "day_1_am"
    });
    if (!sent) {
      const latest = (await this.store.getContact(contact.id)) || contact;
      if (
        latest.optOutStatus ||
        latest.automationPaused ||
        latest.engagementStatus === ENGAGEMENT.OPTED_OUT ||
        hasSignedTag(latest) ||
        hasNqTag(latest) ||
        hasManualHumanHoldTag(latest)
      ) {
        return latest;
      }
      await this.store.addJob({
        type: "initial_sms",
        contactId: latest.id,
        runAt: addMinutes(new Date(), latest.lastTagLookupFailedAt ? 5 : 1).toISOString(),
        payload: { templateKey: "day_1_am", source: "fresh_retry" }
      });
      return this.store.upsertContact({
        ...latest,
        engagementStatus: ENGAGEMENT.CALLED_NO_ANSWER,
        currentSequenceName: "initial_sms_pending",
        currentSequenceDay: 1,
        currentMessageCountForDay: 0,
        sentColdTemplateKeys: Array.from(new Set([...(latest.sentColdTemplateKeys || [])].filter((key) => key !== "day_1_am")))
      });
    }
    const afterInitial = await this.store.upsertContact({
      ...sent,
      engagementStatus: ENGAGEMENT.INITIAL_SMS_SENT,
      currentSequenceName: "initial_sms",
      currentSequenceDay: 1,
      currentMessageCountForDay: 1,
      sentColdTemplateKeys: Array.from(new Set([...(sent?.sentColdTemplateKeys || contact.sentColdTemplateKeys || []), "day_1_am"]))
    });
    await this.scheduleFreshLeadFollowUps(afterInitial);
    await this.scheduleColdOutreach(afterInitial);
    await this.store.addJob({
      type: "cold_entry_check",
      contactId: afterInitial.id,
      runAt: addMinutes(new Date(), 15).toISOString(),
      payload: { lastOutboundTimestamp: afterInitial.lastOutboundTimestamp || new Date().toISOString() }
    });
    return afterInitial;
  }

  async sendCallNowNoAnswerRecovery(existing, normalized = {}, trigger = "manual_repair") {
    let contact = await this.store.upsertContact({
      ...existing,
      ...normalized,
      timezone: chooseContactTimezone(existing, normalized, this.config),
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      humanEscalationStatus: false,
      humanEscalationStage: "call_now_no_answer",
      automationPaused: false,
      automationPauseReason: "",
      awaitingSpecificCallTime: true,
      awaitingBackupTime: false,
      currentSequenceName: "call_now_no_answer"
    });
    await this.store.cancelJobsForContact(contact.id, "call-now no-answer recovery", (job) =>
      BOT_SEQUENCE_JOB_TYPES.includes(job.type) || job.type === "human_escalation_sla" || job.type === "human_reply_timeout"
    );
    contact = await this.hydrateContactTags(contact);
    if (hasSignedTag(contact)) return this.stopForSignedTag(contact);
    if (hasNqTag(contact)) return this.stopForNqTag(contact);
    if (hasManualHumanHoldTag(contact)) return this.stopForManualHoldTag(contact);
    const sent = await this.sendBotMessage(contact, render(qualificationTemplates.callNowNoAnswer, contact), {
      bypassQuietHours: true,
      templateGroup: "qualificationTemplates",
      templateKey: "callNowNoAnswer"
    });
    const latest = sent || (await this.store.getContact(contact.id)) || contact;
    await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
    await this.recordDecision(latest, "sent", "call_now_no_answer_recovery", { trigger });
    return latest;
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
    if (contact.humanEscalationStatus) {
      await this.store.cancelJobsForContact(contact.id, "human escalation active", (job) =>
        HUMAN_ESCALATION_BLOCKED_JOB_TYPES.includes(job.type)
      );
    }

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
    if (isCallNow(inbound.lastInboundMessage)) {
      return this.handleCallTime(contact, "call me now");
    }
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
    const expectedAnswerBeforeFirmIssue = parseExpectedAnswer(contact.qualificationProgress, inbound.lastInboundMessage);
    const currentMedicalAnswerBeatsDocumentSignal =
      contact.qualificationProgress === QUALIFICATION.NEEDS_MEDICAL && Boolean(expectedAnswerBeforeFirmIssue);
    if (
      !answeredColdDateQuestion &&
      !currentMedicalAnswerBeatsDocumentSignal &&
      looksPostSignedOrFirmIssue(inbound.lastInboundMessage)
    ) {
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

    const softEscalationAnswer = softEscalationQualificationAnswer(contact, inbound.lastInboundMessage);
    if (softEscalationAnswer) {
      await this.cancelHumanEscalationWatchdog(contact.id, "auto-resumed from soft escalation answer");
      contact = await this.store.upsertContact({
        ...contact,
        engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
        humanEscalationStatus: false,
        humanEscalationStage: "auto_resumed_from_soft_escalation_answer",
        automationPaused: false,
        automationPauseReason: "",
        escalationReason: ""
      });
      await this.recordDecision(contact, "repaired", "auto_resumed_from_soft_escalation_answer", {
        trigger: "inbound_sms",
        beforeStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
        afterStatus: contact.engagementStatus,
        beforeProgress: contact.qualificationProgress,
        afterProgress: contact.qualificationProgress,
        message: inbound.lastInboundMessage
      });
      return this.advanceQualification(contact, softEscalationAnswer);
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
      return this.escalate(contact, "message_after_bot_paused");
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
      return this.escalate(contact, "appointment_reply_needs_human_review");
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
      return this.escalate(contact, reason);
    }

    if (!contact.qualificationProgress) {
      contact = await this.store.upsertContact({ ...contact, qualificationProgress: QUALIFICATION.NEEDS_FAULT });
    }

    if (contact.qualificationProgress === QUALIFICATION.COMPLETE) {
      return this.escalate(contact, "message_after_completed_flow");
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
      return this.clarifyOrEscalate(contact, inbound.lastInboundMessage, "low_confidence_answer");
    }

    return this.advanceQualification(contact, answer);
  }

  async applyBotControl(payload) {
    const normalized = normalizePayload(payload, this.config);
    const rawAction =
      payload.action ||
        payload.botControl ||
        payload.bot_control ||
        payload.customFieldValue ||
        payload.value ||
        payload.status ||
        payload.control ||
        actionFromTags(payload.tags || payload.contactTags || payload.tag || payload.contact?.tags) ||
        "";
    const action = normalize(rawAction).replace(/\s+/g, "_");
    const controlMeta = {
      source: textValue(payload.controlSource || payload.source || "unknown"),
      actor: textValue(payload.controlActor || payload.actor || payload.user?.name || payload.user || ""),
      note: textValue(payload.controlNote || payload.reason || payload.note || ""),
      rawAction: textValue(rawAction),
      requestPath: textValue(payload.requestPath || ""),
      requestIp: textValue(payload.requestIp || ""),
      userAgent: textValue(payload.userAgent || "")
    };
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
        afterStatus: updated.engagementStatus || "",
        meta: controlMeta
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
        afterStatus: updated.engagementStatus || "",
        meta: controlMeta
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
      if (!canApplyAdminPause(controlMeta)) {
        await this.recordDecision(contact, "skipped", "admin_pause_blocked_from_non_admin_source", {
          trigger: "bot_control",
          beforeStatus: contact.engagementStatus || "",
          afterStatus: contact.engagementStatus || "",
          meta: controlMeta
        });
        return contact;
      }
      const updated = await this.store.upsertContact({
        ...contact,
        automationPaused: true,
        automationPauseReason: "admin_pause",
        humanEscalationStatus: true,
        humanEscalationStage: "admin_paused",
        engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
        lastAutomationPauseAt: new Date().toISOString(),
        lastAutomationPauseReason: "admin_pause",
        lastAutomationPauseSource: controlMeta.source,
        lastAutomationPauseActor: controlMeta.actor,
        lastAutomationPauseNote: controlMeta.note,
        lastAutomationPauseAction: controlMeta.rawAction,
        lastAutomationPauseRequestPath: controlMeta.requestPath,
        lastAutomationPauseUserAgent: controlMeta.userAgent
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
        afterStatus: updated.engagementStatus || "",
        meta: controlMeta
      });
      return updated;
    }

    if (["schedule_warm_followups", "chase_call_time", "resume_hot_followup"].includes(action)) {
      await this.scheduleWarmFollowUps(contact, !isWithinTextingWindow(contact, this.config));
      await this.recordDecision(contact, "repaired", "warm_followups_scheduled", { trigger: "admin_action" });
      return this.store.getContact(contact.id);
    }

    if (["urgent_call_now", "call_now", "ready_for_call_now"].includes(action)) {
      await this.recordDecision(contact, "repaired", "admin_urgent_call_now_requested", {
        trigger: "admin_action",
        message: contact.lastInboundMessage || "",
        meta: controlMeta
      });
      return this.handleCallTime(contact, "call me now");
    }

    if (["call_now_no_answer", "missed_call_now", "call_now_missed", "call_now_no_answer_recovery"].includes(action)) {
      await this.recordDecision(contact, "repaired", "admin_call_now_no_answer_requested", {
        trigger: "admin_action",
        message: contact.lastInboundMessage || "",
        meta: controlMeta
      });
      return this.sendCallNowNoAnswerRecovery(contact, {}, "admin_action");
    }

    if (["silent_appointment_sync", "sync_appointment_silent", "repair_appointment_sync"].includes(action)) {
      const startTime = textValue(
        payload.startTime ||
          payload.start_time ||
          payload.startsAt ||
          payload.starts_at ||
          payload.preferredCallTime ||
          payload.preferred_call_time ||
          payload.time
      );
      if (!startTime) {
        await this.recordDecision(contact, "skipped", "silent_appointment_sync_missing_time", {
          trigger: "admin_action",
          meta: controlMeta
        });
        return contact;
      }
      await this.recordDecision(contact, "repaired", "silent_appointment_sync_requested", {
        trigger: "admin_action",
        message: startTime,
        meta: controlMeta
      });
      return this.syncAppointment({
        contactId: contact.id,
        appointmentId: payload.appointmentId || payload.appointment_id || contact.appointmentId || "",
        startTime,
        status: payload.status || "confirmed",
        suppressAlert: true
      });
    }

    if (["reschedule_to", "move_appointment_to", "admin_reschedule"].includes(action)) {
      const requestedTime = textValue(
        payload.callTime ||
          payload.call_time ||
          payload.preferredCallTime ||
          payload.preferred_call_time ||
          payload.time ||
          payload.message
      );
      if (!requestedTime) {
        await this.recordDecision(contact, "skipped", "admin_reschedule_missing_time", {
          trigger: "admin_action",
          meta: controlMeta
        });
        return contact;
      }
      await this.recordDecision(contact, "repaired", "admin_reschedule_requested", {
        trigger: "admin_action",
        message: requestedTime,
        meta: controlMeta
      });
      return this.handleReschedule(contact, requestedTime);
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

    if (["clear_bad_appointment", "void_bad_appointment", "remove_bad_appointment"].includes(action)) {
      if (contact.appointmentId) {
        try {
          await ghl.deleteAppointment(this.config, contact.appointmentId);
        } catch (error) {
          await this.notifyBotError(
            "GHL bad appointment delete failed",
            {
              Name: contact.name || "unknown",
              Phone: contact.phone || "unknown",
              "GHL contact": contact.ghlContactId || contact.id,
              Appointment: contact.appointmentId,
              Error: error.message
            },
            { operationalOnly: true, slack: false, level: "warn" }
          );
        }
      }
      await this.store.cancelJobsForContact(contact.id, "bad appointment cleared", (job) =>
        ["appointment_reminder", "backup_time_timeout", "backup_no_show_reminder"].includes(job.type)
      );
      const progress = contact.faultAnswer
        ? contact.medicalTreatmentAnswer
          ? QUALIFICATION.NEEDS_CALL_TIME
          : QUALIFICATION.NEEDS_MEDICAL
        : QUALIFICATION.NEEDS_FAULT;
      const updated = await this.store.upsertContact({
        ...contact,
        engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
        qualificationProgress: progress,
        appointmentId: "",
        preferredCallTime: "",
        preferredCallTimeIso: "",
        backupCallTime: "",
        backupCallTimeIso: "",
        backupCallTimeType: "",
        awaitingBackupTime: false,
        awaitingSpecificCallTime: false,
        bookingAlertSentAt: "",
        lastAppointmentBookingError: "",
        humanEscalationStatus: false,
        humanEscalationStage: "bad_appointment_cleared",
        automationPaused: true,
        automationPauseReason: "bad_appointment_review"
      });
      await this.recordDecision(updated, "repaired", "bad_appointment_cleared", {
        trigger: "admin_action",
        beforeStatus: contact.engagementStatus || "",
        afterStatus: updated.engagementStatus || "",
        meta: { previousAppointmentId: contact.appointmentId || "" }
      });
      return updated;
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

    const callStageIntent =
      contact.qualificationProgress === QUALIFICATION.NEEDS_CALL_TIME &&
      ["call_now", "call_later"].includes(classification.label) &&
      confidence >= this.config.llm.clarifyConfidence;

    if (!callStageIntent && confidence < this.config.llm.minConfidence) {
      return this.clarifyOrEscalate(updated, inboundText, "llm_low_confidence_answer");
    }

    return this.applyLlmClassification(updated, classification, inboundText);
  }

  async clarifyOrEscalate(contact, inboundText, reason = "low_confidence_answer") {
    const attempts = { ...(contact.clarificationAttemptsByQuestion || {}) };
    const key = contact.qualificationProgress || "unknown";
    attempts[key] = (attempts[key] || 0) + 1;
    const updated = await this.store.upsertContact({
      ...contact,
      clarificationAttemptsByQuestion: attempts,
      lastClarificationReason: reason,
      lastClarificationMessage: inboundText || contact.lastInboundMessage || ""
    });
    if (attempts[key] > 1) {
      await this.escalate(updated, reason);
      return this.store.getContact(updated.id) || updated;
    }
    await this.sendBotMessage(updated, qualificationTemplates.clarify, { bypassQuietHours: true });
    return this.store.getContact(updated.id) || updated;
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
      return this.escalate(contact, `llm_call_time_${classification.label}`, {
        Confidence: String(classification.confidence || ""),
        Reason: classification.reason || "Reply did not answer the requested call time."
      });
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
      const candidate =
        classification.normalized_value && hasClockTimeSignal(classification.normalized_value)
          ? classification.normalized_value
          : inboundText;
      if (contact.qualificationProgress !== QUALIFICATION.NEEDS_CALL_TIME && !hasClockTimeSignal(candidate)) {
        return this.clarifyOrEscalate(contact, inboundText, "call_time_before_qualification_needs_human");
      }
      return this.handleCallTime(contact, candidate);
    }

    if (classification.label === "prefers_text" || classification.label === "acknowledgement") {
      if (needsColdAccidentDate(contact)) {
        const message =
          "Got it 🙌 I can keep this quick over text. What was the date of the accident?";
        const sent = await this.sendBotMessage(contact, message, { bypassQuietHours: true });
        return sent || (await this.store.getContact(contact.id)) || contact;
      }
      const template = currentQuestionTemplate(contact, this.config);
      if (template) {
        const sent = await this.sendBotMessage(contact, render(template, contact), { bypassQuietHours: true });
        const latest = sent || (await this.store.getContact(contact.id)) || contact;
        await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
        return latest;
      }
    }

    return this.escalate(contact, `llm_unhandled_${classification.label}`, {
      Confidence: String(classification.confidence || ""),
      Reason: classification.reason || ""
    });
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
    if (looksLikeAccidentTiming(text) && !hasCallIntentText(text)) {
      const dateAnswer = parseAccidentDate(text);
      if (dateAnswer && !contact.accidentDate) {
        contact = await this.store.upsertContact({ ...contact, accidentDate: dateAnswer.value });
      }
      const template =
        contact.qualificationProgress === QUALIFICATION.NEEDS_FAULT
          ? qualificationTemplates.fault
          : currentQuestionTemplate(contact, this.config);
      if (template) {
        const sent = await this.sendBotMessage(contact, render(template, contact), { bypassQuietHours: true });
        const latest = sent || (await this.store.getContact(contact.id)) || contact;
        await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
        return latest;
      }
      return this.store.getContact(contact.id) || contact;
    }
    const resolvedTimezone = resolveContactTimezone(contact, this.config);
    if (resolvedTimezone && resolvedTimezone !== contact.timezone) {
      contact = await this.store.upsertContact({ ...contact, timezone: resolvedTimezone });
    }
    let parsed = parseCallTime(text, contact, this.config);
    parsed = anchorScheduledTimeToClarifiedDay(parsed, text, contact, this.config);
    if (!parsed) {
      if (isBriefAcknowledgement(text)) {
        const updated = await this.store.upsertContact({
          ...contact,
          awaitingSpecificCallTime: true,
          lastCallTimeAcknowledgement: text,
          ...callTimeClarificationPatch(contact, { type: "needs_specific_time" }, text, "booking")
        });
        const sent = await this.sendBotMessage(
          updated,
          "Got it 🙌 What time works best for the call? If now works, just reply now. 📞",
          { bypassQuietHours: true }
        );
        const latest = sent || (await this.store.getContact(updated.id)) || updated;
        await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
        return latest;
      }
      if (looksLikeDetailedLegalOrInsuranceInfo(text)) {
        return this.escalate(contact, "detailed_information");
      }
      if (looksLikeInjuryContext(text)) {
        const sent = await this.sendBotMessage(contact, qualificationTemplates.injuryContextCallAsk, { bypassQuietHours: true });
        const latest = sent || (await this.store.getContact(contact.id)) || contact;
        await this.scheduleWarmFollowUps(latest, !isWithinTextingWindow(latest, this.config));
        return latest;
      }
      const llmResult = await this.tryLlmFallback(contact, text);
      if (llmResult) return llmResult;
      return this.escalate(contact, "call_time_unhandled_reply");
    }
    if (parsed.type === "needs_specific_time") {
      const contextPatch = callTimeClarificationPatch(contact, parsed, text, "booking");
      contact = await this.store.upsertContact({ ...contact, awaitingSpecificCallTime: true, ...contextPatch });
      const normalizedText = normalize(text);
      let question = relativeTimeClarification(parsed, contact, this.config) || "What specific time works best for your call today or tomorrow?";
      const inheritedDay = contextPatch.callTimeClarificationDay || contact.callTimeClarificationDay;
      const inheritedDayLabel = contextPatch.callTimeClarificationDayLabel || contact.callTimeClarificationDayLabel;
      const daypart = daypartFromText(normalizedText);
      if (inheritedDay === "tomorrow" && daypart) {
        question = `What exact time tomorrow ${daypart} works best?`;
      } else if (inheritedDay === "weekday" && inheritedDayLabel && daypart) {
        question = `What exact time ${titleCaseWord(inheritedDayLabel)} ${daypart} works best?`;
      } else if (parsed.preferredDay === "tomorrow_or_later" || isNotTodayAvailability(normalizedText)) {
        question = "No problem, we can do tomorrow or another day 🙏 What specific time works best for the Specialist call?";
      } else if (/\btomorrow\b/.test(normalizedText) || parsed.preferredDay === "tomorrow") {
        question = "What specific time tomorrow works best?";
      } else if (parsed.preferredDay === "weekday" && parsed.preferredDayLabel) {
        question = `What specific time ${titleCaseWord(parsed.preferredDayLabel)} works best?`;
      } else if (/\b(today|later today|tonight)\b/.test(normalizedText)) {
        question = "What specific time later today works best?";
      }
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
      awaitingSpecificCallTime: false,
      ...clearCallTimeClarificationPatch()
      });
      const slackPromise = slack.sendUrgentCallNow(this.config, updated).catch((error) =>
        this.notifyBotError("Slack urgent call-now alert failed", {
          Name: updated.name || "unknown",
          Phone: updated.phone || "unknown",
          "GHL contact": updated.ghlContactId || updated.id,
          Error: error.message
        })
      );
      const smsPromise = this.sendBotMessage(updated, qualificationTemplates.callNow, { bypassQuietHours: true });
      const results = await Promise.allSettled([slackPromise, smsPromise]);
      const sentResult = results[1];
      return sentResult.status === "fulfilled" && sentResult.value ? sentResult.value : updated;
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
      ...clearCallTimeClarificationPatch(),
      lastAppointmentBookingError: ""
    });
    const afterBackupAsk =
      (await this.sendBotMessage(updated, render(qualificationTemplates.backupAsk, updated, { time: display }), {
      bypassQuietHours: true
      })) || updated;
    await this.scheduleAppointmentReminders(afterBackupAsk);
    await this.store.addJob({
      type: "backup_time_timeout",
      contactId: afterBackupAsk.id,
      runAt: addMinutes(new Date(), 15).toISOString(),
      payload: {}
    });
    return afterBackupAsk;
  }

  async handleReschedule(contact, text) {
    let parsed = parseCallTime(text, contact, this.config);
    parsed = anchorScheduledTimeToClarifiedDay(parsed, text, contact, this.config);
    if (!parsed || parsed.type === "now") {
      const sent = await this.sendBotMessage(contact, qualificationTemplates.rescheduleAsk, { bypassQuietHours: true });
      return sent || (await this.store.getContact(contact.id)) || contact;
    }
    if (parsed.type === "needs_specific_time") {
      const contextPatch = callTimeClarificationPatch(contact, parsed, text, "reschedule");
      const updated = await this.store.upsertContact({ ...contact, awaitingSpecificCallTime: true, ...contextPatch });
      const inheritedDay = contextPatch.callTimeClarificationDay || contact.callTimeClarificationDay;
      const inheritedDayLabel = contextPatch.callTimeClarificationDayLabel || contact.callTimeClarificationDayLabel;
      const part = daypartFromText(text);
      let question = qualificationTemplates.rescheduleNeedsSpecificTime;
      if (inheritedDay === "tomorrow" && part) {
        question = `No problem 👍 What exact time tomorrow ${part} should I move your call to?`;
      } else if (inheritedDay === "tomorrow") {
        question = "No problem 👍 What exact time tomorrow should I move your call to?";
      } else if (inheritedDay === "weekday" && inheritedDayLabel) {
        question = `No problem 👍 What exact time ${titleCaseWord(inheritedDayLabel)} should I move your call to?`;
      }
      const sent = await this.sendBotMessage(updated, question, { bypassQuietHours: true });
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
      awaitingSpecificCallTime: false,
      ...clearCallTimeClarificationPatch(),
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

  async notifyAppointmentNotice(contact, title, extra = {}) {
    try {
      await slack.sendAppointmentNotice(this.config, contact, title, extra);
      return true;
    } catch (error) {
      await this.notifyBotError("Slack appointment notice failed", {
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
          payload: { templateKey: "nextDayMorning", appointmentIso: contact.preferredCallTimeIso }
        });
      }
    }
    if (oneHour > minimumGapBeforeOneHour) {
      await this.store.addJob({
        type: "appointment_reminder",
        contactId: contact.id,
        runAt: oneHour.toISOString(),
        payload: { templateKey: sameDay ? "sameDayOneHour" : "nextDayOneHour", appointmentIso: contact.preferredCallTimeIso }
      });
    }
    if (fiveMinutes > now) {
      await this.store.addJob({
        type: "appointment_reminder",
        contactId: contact.id,
        runAt: fiveMinutes.toISOString(),
        payload: { templateKey: sameDay ? "sameDayFiveMinutes" : "nextDayFiveMinutes", appointmentIso: contact.preferredCallTimeIso }
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
    const webhookContactId = appointmentContactId(payload);
    const normalized = normalizePayload(webhookContactId ? { ...payload, contactId: webhookContactId } : payload, this.config);
    const existing = await this.store.getContact(normalized.id);
    const base = { ...(existing || {}), ...normalized };
    const appointmentId = appointmentIdFromPayload(payload) || payload.appointmentId || payload.appointment_id || base.appointmentId || "";
    const preferredCallTimeIso =
      appointmentStartIsoFromPayload(payload, base, this.config) ||
      normalized.preferredCallTimeIso ||
      payload.preferredCallTimeIso ||
      payload.callTimeIso ||
      base.preferredCallTimeIso ||
      "";
    const preferredCallTime =
      normalized.preferredCallTime ||
      payload.preferredCallTime ||
      payload.callTime ||
      payload.scheduledTime ||
      base.preferredCallTime ||
      (preferredCallTimeIso ? formatForContact(new Date(preferredCallTimeIso), base, this.config) : "");
    let contact = await this.store.upsertContact({
      ...base,
      engagementStatus: ENGAGEMENT.MISSED_CALL,
      qualificationProgress: QUALIFICATION.CALL_BOOKED,
      appointmentNoShowAt: new Date().toISOString(),
      preferredCallTime,
      preferredCallTimeIso,
      appointmentId,
      currentSequenceName: "appointment_no_show"
    });
    await this.store.cancelJobsForContact(contact.id, "appointment marked no-show", (job) =>
      ["appointment_reminder", "backup_time_timeout", "warm_followup", "enter_reengagement", "send_reengagement_template"].includes(job.type)
    );
    const hasBackupReminderPlan = await this.scheduleBackupNoShowReminders(contact);
    await this.scheduleNoShowFollowUps(contact, { skipEarlySameDay: hasBackupReminderPlan });
    if (hasBackupReminderPlan) {
      const backupAlertKey = `${contact.appointmentId || contact.id}|${contact.backupCallTimeIso || contact.backupCallTime || ""}`;
      if (contact.noShowBackupAlertKey !== backupAlertKey) {
        const alertSent = await this.notifyAppointmentNotice(contact, "No-show: backup time active", {
          Primary: contact.preferredCallTime || "unknown",
          Backup: contact.backupCallTime || "unknown",
          Appointment: contact.appointmentId || "unknown",
          Action: "Primary call was missed. Backup time is now the next attempt. If your team edits the GHL appointment to the backup time, reminders will resync."
        });
        if (alertSent) {
          contact = await this.store.upsertContact({
            ...contact,
            noShowBackupAlertKey: backupAlertKey,
            noShowBackupAlertSentAt: new Date().toISOString()
          });
        }
      }
    }
    contact = await this.store.upsertContact({
      ...contact,
      currentSequenceDay: 1,
      currentSequenceSlot: "no_show"
    });
    await this.recordDecision(contact, "missed", "appointment_no_show", {
      trigger: "appointment_no_show",
      meta: { appointmentId: contact.appointmentId || "", backupCallTime: contact.backupCallTime || "" }
    });
    return contact;
  }

  async syncAppointment(payload) {
    const status = appointmentStatusFromPayload(payload);
    if (isNoShowAppointmentStatus(status)) return this.markNoShow(payload);

    const contactId = appointmentContactId(payload);
    const rawStartsAt = appointmentStartRawFromPayload(payload);
    const appointmentId = appointmentIdFromPayload(payload);
    if (!contactId || !rawStartsAt) {
      if (this.store.setSetting) {
        await this.store.setSetting("last_ignored_appointment_sync", {
          reason: !contactId ? "missing_contact_id" : "missing_start_time",
          payloadKeys: Object.keys(payload || {}).sort(),
          receivedAt: new Date().toISOString()
        });
      }
      return null;
    }

    const normalized = normalizePayload({ ...payload, contactId }, this.config);
    const existing = await this.store.getContact(normalized.id);
    let contact = await this.store.upsertContact({
      ...(existing || {}),
      ...normalized
    });
    contact = await this.hydrateContactTags(contact);
    let startsAt = appointmentStartIsoFromPayload(payload, contact, this.config);
    if (!startsAt) {
      if (this.store.setSetting) {
        await this.store.setSetting("last_ignored_appointment_sync", {
          reason: "invalid_start_time",
          rawStartTime: textValue(rawStartsAt),
          payloadKeys: Object.keys(payload || {}).sort(),
          receivedAt: new Date().toISOString()
        });
      }
      return null;
    }
    let appointmentTimeSource = "ghl_appointment_payload";
    const recentCallTime = await this.recentCallTimeCandidate(contact, { cutoffMinutes: 240 });
    if (
      recentCallTime?.parsed?.type === "scheduled" &&
      shouldPreferRecentInboundCallTime(startsAt, recentCallTime.parsed.startsAt, contact, this.config)
    ) {
      startsAt = recentCallTime.parsed.startsAt;
      appointmentTimeSource = "recent_inbound_call_time";
    }

    if (contact.optOutStatus || contact.engagementStatus === ENGAGEMENT.OPTED_OUT) {
      await this.recordDecision(contact, "skipped", "appointment_sync_opted_out", {
        trigger: "appointment_sync",
        meta: { appointmentId, startsAt, rawStartsAt: textValue(rawStartsAt), appointmentTimeSource }
      });
      return contact;
    }
    if (hasSignedTag(contact)) return this.stopForSignedTag(contact);
    if (hasNqTag(contact)) return this.stopForNqTag(contact);

    const display = formatForContact(new Date(startsAt), contact, this.config);
    const oldAppointmentId = contact.appointmentId || "";
    const oldStartsAt = contact.preferredCallTimeIso || "";
    const shouldAskBackupForManualSync =
      !oldAppointmentId &&
      !contact.awaitingBackupTime &&
      !contact.bookingAlertSentAt &&
      new Date(startsAt) > addMinutes(new Date(), 20);
    const updated = await this.store.upsertContact({
      ...contact,
      engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
      qualificationProgress: QUALIFICATION.COMPLETE,
      preferredCallTime: display,
      preferredCallTimeIso: startsAt,
      appointmentId: appointmentId || contact.appointmentId || "",
      awaitingBackupTime: Boolean(contact.awaitingBackupTime),
      humanEscalationStatus: false,
      humanEscalationStage: "appointment_synced",
      escalationReason: "",
      automationPaused: false,
      automationPauseReason: "",
      currentSequenceName: "appointment_synced",
      appointmentSource: "ghl_manual",
      appointmentSyncedAt: new Date().toISOString(),
      lastAppointmentSyncRawStart: textValue(rawStartsAt),
      lastAppointmentSyncResolvedStart: startsAt,
      lastAppointmentSyncTimeSource: appointmentTimeSource,
      lastAppointmentSyncRecoveredFromInbound: appointmentTimeSource === "recent_inbound_call_time" ? recentCallTime.message : ""
    });

    await this.store.cancelJobsForContact(updated.id, "manual appointment synced", (job) =>
      [
        "initial_sms",
        "cold_entry_check",
        "send_cold_template",
        "fresh_lead_followup",
        "warm_followup",
        "enter_reengagement",
        "send_reengagement_template",
        "appointment_reminder",
        "missed_call_followup",
        "backup_no_show_reminder"
      ].includes(job.type)
    );
    await this.scheduleAppointmentReminders(updated);
    await this.recordDecision(updated, "booked", "manual_appointment_synced", {
      trigger: "appointment_sync",
      beforeStatus: contact.engagementStatus || "",
      afterStatus: ENGAGEMENT.CALL_SCHEDULED,
      beforeProgress: contact.qualificationProgress || "",
      afterProgress: QUALIFICATION.COMPLETE,
      meta: {
        appointmentId: updated.appointmentId || "",
        startsAt,
        oldAppointmentId,
        oldStartsAt,
        rawStartsAt: textValue(rawStartsAt),
        appointmentTimeSource
      }
    });

    if (shouldAskBackupForManualSync) {
      const afterBackupAsk = await this.sendBotMessage(updated, render(qualificationTemplates.backupAsk, updated, { time: display }), {
        bypassQuietHours: true
      });
      if (!afterBackupAsk) return updated;
      const awaitingBackup = await this.store.upsertContact({
        ...afterBackupAsk,
        awaitingBackupTime: true
      });
      await this.store.addJob({
        type: "backup_time_timeout",
        contactId: awaitingBackup.id,
        runAt: addMinutes(new Date(), 15).toISOString(),
        payload: { appointmentIso: startsAt, source: "manual_appointment_sync" }
      });
      return awaitingBackup;
    }

    const suppressAppointmentAlert = suppressAppointmentAlertFromPayload(payload);
    const bookingAlertKey = `manual_appointment_booked:${updated.id}`;
    if (!updated.awaitingBackupTime && !suppressAppointmentAlert && !updated.bookingAlertSentAt && !this.bookingAlertLocks.has(bookingAlertKey)) {
      this.bookingAlertLocks.add(bookingAlertKey);
      try {
        const bookingAlertSent = await this.notifyAppointmentBooked(updated, {
          "Primary call time": updated.preferredCallTime,
          "Backup time": updated.backupCallTime || "none",
          Timezone: updated.timezone,
          "GHL appointment": updated.appointmentId || "manual appointment",
          Source: "GHL manual appointment sync"
        });
        if (bookingAlertSent) {
          return this.store.upsertContact({ ...updated, bookingAlertSentAt: new Date().toISOString() });
        }
      } finally {
        this.bookingAlertLocks.delete(bookingAlertKey);
      }
    }

    return updated;
  }

  async escalate(contact, reason, extra = {}) {
    const now = new Date().toISOString();
    if (contact.humanEscalationStatus && contact.engagementStatus === ENGAGEMENT.ESCALATED_TO_HUMAN) {
      const suppressed = await this.store.upsertContact({
        ...contact,
        lastSuppressedEscalationAt: now,
        lastSuppressedEscalationReason: reason,
        lastSuppressedEscalationMessage: contact.lastInboundMessage || ""
      });
      await this.recordDecision(suppressed, "skipped", "duplicate_human_escalation_suppressed", {
        trigger: "bot_escalation",
        beforeStatus: contact.engagementStatus || "",
        afterStatus: suppressed.engagementStatus || "",
        message: suppressed.lastInboundMessage || "",
        meta: { reason, ...extra }
      });
      return suppressed;
    }
    const updated = await this.store.upsertContact({
      ...contact,
      engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
      humanEscalationStatus: true,
      humanEscalationStage: "human_review_pending",
      escalatedAt: now,
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
        contact.engagementStatus !== ENGAGEMENT.ESCALATED_TO_HUMAN &&
        !contact.humanEscalationStatus &&
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
        !contact.humanEscalationStatus &&
        needsQualificationReply(contact) &&
        !hasPendingJob(jobs, ["process_inbound_buffer", "warm_followup", "enter_reengagement", "send_reengagement_template"]) &&
        contact.lastOutboundTimestamp &&
        (!contact.lastResponseTimestamp || new Date(contact.lastOutboundTimestamp) > new Date(contact.lastResponseTimestamp)) &&
        Date.now() - new Date(contact.lastOutboundTimestamp).getTime() >= 5 * 60 * 1000 &&
        Date.now() - new Date(contact.lastOutboundTimestamp).getTime() <= 6 * 60 * 60 * 1000 &&
        isWithinTextingWindow(contact, this.config)
      ) {
        await this.scheduleWarmFollowUps(contact, false);
        healed.push({ contactId: contact.id, action: "scheduled_warm_followups" });
        continue;
      }

      if (
        contact.engagementStatus === ENGAGEMENT.ESCALATED_TO_HUMAN &&
        contact.humanEscalationStatus &&
        contact.humanEscalationStage === "human_replied_waiting" &&
        contact.lastHumanOutboundAt &&
        !hasPendingJob(jobs, ["human_reply_timeout"]) &&
        Date.now() - new Date(contact.lastHumanOutboundAt).getTime() >= HUMAN_REPLY_TIMEOUT_MINUTES * 60 * 1000
      ) {
        const resumed = await this.handleHumanReplyTimeout(
          {
            contactId: contact.id,
            payload: { lastHumanOutboundAt: contact.lastHumanOutboundAt, timeoutMinutes: HUMAN_REPLY_TIMEOUT_MINUTES, healed: true }
          },
          contact
        );
        if (resumed) healed.push({ contactId: contact.id, action: "auto_returned_after_human_timeout" });
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
      (contact.humanEscalationStatus && HUMAN_ESCALATION_BLOCKED_JOB_TYPES.includes(job.type)) ||
      hasSignedTag(contact) ||
      hasNqTag(contact) ||
      hasManualHumanHoldTag(contact)
    ) {
      const skipReason =
        contact?.humanEscalationStatus && HUMAN_ESCALATION_BLOCKED_JOB_TYPES.includes(job.type)
          ? "human_escalation_active"
          : "blocked_by_contact_state";
      await this.store.updateJob(job.id, { status: "skipped", finishedAt: new Date().toISOString(), skipReason });
      if (contact) await this.recordDecision(contact, "skipped", skipReason, { jobId: job.id, jobType: job.type });
      return;
    }
    if (["initial_sms", "fresh_lead_followup", "send_cold_template", "warm_followup", "enter_reengagement", "send_reengagement_template", "appointment_reminder", "missed_call_followup", "backup_no_show_reminder"].includes(job.type)) {
      if (!shouldBypassQuietHoursForInitialJob(job) && !isWithinTextingWindow(contact, this.config)) {
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
      const sent = await this.sendBotMessage(fresh, rendered.message, {
        ...rendered.meta,
        bypassQuietHours: shouldBypassQuietHoursForInitialJob(job)
      });
      if (!sent) {
        const latest = (await this.store.getContact(job.contactId)) || fresh;
        if (
          latest.optOutStatus ||
          latest.automationPaused ||
          latest.engagementStatus === ENGAGEMENT.OPTED_OUT ||
          hasSignedTag(latest) ||
          hasNqTag(latest) ||
          hasManualHumanHoldTag(latest)
        ) {
          await this.store.updateJob(job.id, { status: "skipped", finishedAt: new Date().toISOString(), skipReason: "initial_sms_blocked" });
          return;
        }
        await this.store.updateJob(job.id, {
          status: "pending",
          runAt: addMinutes(new Date(), latest.lastTagLookupFailedAt ? 5 : 1).toISOString(),
          retryReason: latest.lastTagLookupFailedAt ? "tag_lookup_failed" : "initial_sms_not_sent"
        });
        await this.recordDecision(latest, "queued", "initial_sms_retry_queued", { jobId: job.id, jobType: job.type });
        return;
      }
      const updated = await this.store.upsertContact({
        ...sent,
        engagementStatus: ENGAGEMENT.INITIAL_SMS_SENT,
        currentSequenceName: "initial_sms",
        currentSequenceDay: 1,
        currentMessageCountForDay: 1,
        sentColdTemplateKeys: Array.from(new Set([...(sent?.sentColdTemplateKeys || fresh.sentColdTemplateKeys || []), "day_1_am"]))
      });
      if (job.payload?.source !== "backfill") await this.scheduleFreshLeadFollowUps(updated);
      await this.scheduleColdOutreach(updated);
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
      if (
        job.payload?.expectedProgress &&
        fresh.qualificationProgress &&
        fresh.qualificationProgress !== job.payload.expectedProgress
      ) {
        await this.store.updateJob(job.id, {
          status: "skipped",
          finishedAt: new Date().toISOString(),
          skipReason: "stale_warm_followup_progress_changed"
        });
        await this.recordDecision(fresh, "skipped", "stale_warm_followup_progress_changed", {
          jobId: job.id,
          jobType: job.type,
          meta: {
            expectedProgress: job.payload.expectedProgress,
            currentProgress: fresh.qualificationProgress
          }
        });
        return;
      }
      if (
        job.payload?.baseOutboundTimestamp &&
        fresh.lastResponseTimestamp &&
        new Date(fresh.lastResponseTimestamp) > new Date(job.payload.baseOutboundTimestamp)
      ) {
        await this.store.updateJob(job.id, {
          status: "skipped",
          finishedAt: new Date().toISOString(),
          skipReason: "stale_warm_followup_contact_replied"
        });
        await this.recordDecision(fresh, "skipped", "stale_warm_followup_contact_replied", {
          jobId: job.id,
          jobType: job.type,
          meta: {
            baseOutboundTimestamp: job.payload.baseOutboundTimestamp,
            lastResponseTimestamp: fresh.lastResponseTimestamp
          }
        });
        return;
      }
      if (needsColdAccidentDate(fresh) && isBriefAcknowledgement(fresh.lastInboundMessage)) {
        await this.store.updateJob(job.id, {
          status: "skipped",
          finishedAt: new Date().toISOString(),
          skipReason: "cold_ack_needs_accident_date"
        });
        await this.recordDecision(fresh, "skipped", "cold_ack_needs_accident_date", { jobId: job.id, jobType: job.type });
        return;
      }
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
      if (
        job.payload?.expectedProgress &&
        fresh.qualificationProgress &&
        fresh.qualificationProgress !== job.payload.expectedProgress
      ) {
        await this.store.updateJob(job.id, {
          status: "skipped",
          finishedAt: new Date().toISOString(),
          skipReason: "stale_reengagement_progress_changed"
        });
        await this.recordDecision(fresh, "skipped", "stale_reengagement_progress_changed", {
          jobId: job.id,
          jobType: job.type
        });
        return;
      }
      if (
        job.payload?.baseOutboundTimestamp &&
        fresh.lastResponseTimestamp &&
        new Date(fresh.lastResponseTimestamp) > new Date(job.payload.baseOutboundTimestamp)
      ) {
        await this.store.updateJob(job.id, {
          status: "skipped",
          finishedAt: new Date().toISOString(),
          skipReason: "stale_reengagement_contact_replied"
        });
        await this.recordDecision(fresh, "skipped", "stale_reengagement_contact_replied", {
          jobId: job.id,
          jobType: job.type
        });
        return;
      }
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
      if (!isCurrentAppointmentReminderJob(contact, job, this.config)) {
        await this.store.updateJob(job.id, {
          status: "skipped",
          finishedAt: new Date().toISOString(),
          skipReason: "stale_appointment_reminder_time_changed"
        });
        await this.recordDecision(contact, "skipped", "stale_appointment_reminder_time_changed", {
          jobId: job.id,
          jobType: job.type,
          meta: {
            templateKey: job.payload.templateKey || "",
            jobAppointmentIso: job.payload.appointmentIso || "",
            currentAppointmentIso: contact.preferredCallTimeIso || "",
            jobRunAt: job.runAt || ""
          }
        });
        return;
      }
      const rendered = await this.renderManagedTemplate(contact, "reminderTemplates", job.payload.templateKey, template, {
        time: contact.preferredCallTimeIso
          ? formatTimeOnlyWithZone(new Date(contact.preferredCallTimeIso), contact, this.config)
          : contact.preferredCallTime || "your scheduled time"
      });
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
