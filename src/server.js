const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { loadConfig } = require("./config");
const { createStore } = require("./storeFactory");
const { SmsBot } = require("./flow");
const { isNoResponseSignal } = require("./disposition");
const { formatForContact } = require("./time");
const { addMinutes, isWithinTextingWindow, localSlotDate, nextTextingWindow } = require("./time");
const {
  editableTemplates,
  loadTemplateExperiments,
  loadTemplateOverrides,
  resetTemplateOverrides,
  saveTemplateExperiments,
  saveTemplateOverrides
} = require("./templateManager");
const ghl = require("./adapters/ghl");
const slack = require("./adapters/slack");
const { listBotErrors, recordBotError } = require("./opsLog");

const config = loadConfig();
let store = null;
let bot = null;
const publicDir = path.join(__dirname, "..", "public");
const rootDir = path.join(__dirname, "..");
const reportDir = config.reportDir;
const trainingDbPath = process.env.TRAINING_DB_PATH || path.join(config.dataDir, "training.sqlite");
let lastAutoAppliedBatchId = "";
const JOB_RETRY_MINUTES = [5, 15, 60];
const BACKFILL_DEFAULT_SPACING_MINUTES = 3;
const BACKFILL_MAX_BATCH = 250;

function isPermanentSmsBlock(error) {
  return /DND is active for SMS|do not disturb|opted out|unsubscribed/i.test(error?.message || "");
}

async function notifyBotError(title, details = {}) {
  try {
    const recorded = await recordBotError(store, title, details);
    if (!recorded.shouldNotifySlack) return;
    await slack.sendBotError(config, title, details);
  } catch (error) {
    console.error("bot error notification failed", title, error.message);
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function requireWebhookSecret(req, payload = {}) {
  if (!config.webhookSecret) return { ok: true };
  const provided =
    req.headers["x-webhook-secret"] ||
    req.headers["x-asdleads-secret"] ||
    payload.webhookSecret ||
    payload.webhook_secret ||
    payload["x-webhook-secret"] ||
    payload["x-asdleads-secret"] ||
    payload.customData?.webhookSecret ||
    payload.customData?.webhook_secret ||
    payload.customData?.["x-webhook-secret"] ||
    payload.customData?.["x-asdleads-secret"];
  if (provided === config.webhookSecret) return { ok: true };
  return { ok: false, reason: "invalid webhook secret" };
}

function requireAdmin(req) {
  if (!config.adminPassword) return { ok: true };
  const provided = req.headers["x-admin-password"];
  if (provided === config.adminPassword) return { ok: true };
  return { ok: false, reason: "invalid admin password" };
}

function safeText(value, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => safeText(item)).filter(Boolean).join(", ") || fallback;
  if (typeof value === "object") {
    const direct =
      value.label ||
      value.name ||
      value.source ||
      value.utm_source ||
      value.utmSource ||
      value.sessionSource ||
      value.medium;
    if (direct) return safeText(direct, fallback);
    return Object.entries(value)
      .filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
      .map(([key, entry]) => `${key}: ${safeText(entry)}`)
      .join(", ") || fallback;
  }
  return fallback;
}

function requestControlMeta(req, payload = {}, source = "unknown") {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return {
    controlSource: source,
    controlActor: safeText(payload.actor || payload.admin || payload.user || payload.userName || payload.user?.name, "dashboard_admin"),
    controlNote: safeText(payload.reason || payload.note || payload.pauseReason || payload.controlNote, ""),
    requestPath: req.url,
    requestIp: forwardedFor || req.socket?.remoteAddress || "",
    userAgent: String(req.headers["user-agent"] || "").slice(0, 200)
  };
}

function leadSourceInfo(contact = {}) {
  const raw =
    contact.leadSource ||
    contact.source ||
    contact.attributionSource ||
    contact.utmSource ||
    contact["UTM Source"] ||
    contact.customData?.leadSource ||
    contact.customData?.["UTM Source"] ||
    "";
  const label = safeText(raw, "unknown");
  return {
    leadSourceLabel: label,
    leadSourceRaw: raw,
    leadSourceType: raw && typeof raw === "object" ? "object" : raw ? "string" : "missing"
  };
}

function nextPendingJob(jobs = []) {
  return jobs
    .filter((job) => job.status === "pending" && job.runAt)
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt))[0] || null;
}

function timezoneSource(contact = {}) {
  if (contact.timezoneSource) return contact.timezoneSource;
  const tags = Array.isArray(contact.tags) ? contact.tags.join(", ") : safeText(contact.tags);
  if (/(^|[, _-])(CA|TX|CO|WA|NV|ND|KY)($|[, _-])/i.test(tags)) return "firm_tag";
  if (contact.ownerState || contact.state) return "owner_or_state";
  if (contact.timezone) return contact.timezone === config.texting.defaultTimezone ? "default_or_account" : "stored";
  return "missing";
}

function webhookEventId(req, payload, fallbackPrefix = "") {
  const explicitId =
    req.headers["x-ghl-event-id"] ||
    req.headers["x-event-id"] ||
    payload.eventId ||
    payload.messageId ||
    payload.idempotencyKey ||
    "";
  if (explicitId) return `${fallbackPrefix}:${explicitId}`;
  if (fallbackPrefix === "disposition") return "";
  return (
    payload.id ||
    ""
  );
}

async function dedupeWebhook(req, payload, fallbackPrefix) {
  const id = webhookEventId(req, payload, fallbackPrefix);
  if (!id) return { id: "", duplicate: false, skipped: true };
  const result = await store.recordWebhookEvent(id, payload);
  return { id, duplicate: !result.inserted };
}

function normalizeTagList(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).toLowerCase().trim());
  return String(tags)
    .split(/[,\s]+/)
    .map((tag) => tag.toLowerCase().trim())
    .filter(Boolean);
}

function hasTag(tags, tag) {
  const wanted = String(tag || "").toLowerCase().replace(/^#/, "").replace(/[-\s]+/g, "_");
  return normalizeTagList(tags).some((item) => item.replace(/^#/, "").replace(/[-\s]+/g, "_") === wanted);
}

function firstValue(source, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), source);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function webhookField(payload, keys) {
  return firstValue(payload, keys) || firstValue(payload.customData || {}, keys);
}

function normalizeBackfillContact(raw = {}) {
  const contact = raw.contact || raw;
  const firstName = firstValue(contact, ["firstName", "first_name"]);
  const lastName = firstValue(contact, ["lastName", "last_name"]);
  const fullName = firstValue(contact, ["name", "fullName", "contactName"]) || [firstName, lastName].filter(Boolean).join(" ");
  return {
    contactId: firstValue(contact, ["id", "contactId", "ghlContactId", "_id"]),
    ghlContactId: firstValue(contact, ["id", "contactId", "ghlContactId", "_id"]),
    name: fullName,
    phone: firstValue(contact, ["phone", "phoneNumber", "mobile", "number"]),
    timezone: firstValue(contact, ["timezone", "timeZone"]),
    state: firstValue(contact, ["state", "locationState", "address.state"]),
    leadSource: firstValue(contact, ["source", "leadSource", "attributionSource"]) || "GHL backfill",
    tags: contact.tags || contact.contactTags || [],
    ghlContactLink: firstValue(contact, ["ghlContactLink", "contactLink"])
  };
}

function backfillEligibility(contact, tag = "NR") {
  if (!contact.contactId && !contact.phone) return { eligible: false, reason: "missing contact id and phone" };
  if (!contact.phone) return { eligible: false, reason: "missing phone" };
  if (tag && !hasTag(contact.tags, tag)) return { eligible: false, reason: `missing ${tag} tag` };
  if (hasTag(contact.tags, "NQ") || hasTag(contact.tags, "not_qualified")) return { eligible: false, reason: "NQ tag" };
  if (
    hasTag(contact.tags, "signed") ||
    hasTag(contact.tags, "contract") ||
    hasTag(contact.tags, "contract_set") ||
    hasTag(contact.tags, "contract_sent") ||
    hasTag(contact.tags, "contract_signed")
  ) {
    return { eligible: false, reason: "signed/contract tag" };
  }
  if (hasTag(contact.tags, "follow_up") || hasTag(contact.tags, "missed_follow_up")) {
    return { eligible: false, reason: "manual follow-up tag" };
  }
  if (hasTag(contact.tags, "DNC") || hasTag(contact.tags, "do_not_contact") || hasTag(contact.tags, "opt_out")) {
    return { eligible: false, reason: "DNC/opt-out tag" };
  }
  return { eligible: true, reason: "" };
}

function dedupeContacts(contacts) {
  const seen = new Set();
  const deduped = [];
  for (const contact of contacts) {
    const key = contact.contactId || String(contact.phone || "").replace(/\D/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(contact);
  }
  return deduped;
}

async function loadBackfillCandidates(payload = {}) {
  if (Array.isArray(payload.contacts) && payload.contacts.length) {
    return payload.contacts.map(normalizeBackfillContact);
  }
  const tag = payload.tag || "NR";
  const limit = Math.max(1, Math.min(Number(payload.limit || 100), BACKFILL_MAX_BATCH));
  const page = Math.max(1, Number(payload.page || 1));
  const result = await ghl.searchContactsByTag(config, tag, { limit, page });
  return result.contacts.map(normalizeBackfillContact);
}

function summarizeBackfillCandidates(candidates, tag = "NR") {
  const normalized = dedupeContacts(candidates);
  const eligible = [];
  const skipped = [];
  for (const contact of normalized) {
    const check = backfillEligibility(contact, tag);
    if (check.eligible) eligible.push(contact);
    else skipped.push({ contact, reason: check.reason });
  }
  return {
    tag,
    totalSeen: candidates.length,
    unique: normalized.length,
    eligible,
    skipped
  };
}

function nextBackfillRunAt(contact, index, spacingMinutes, startOffsetMinutes = 0) {
  let runAt = addMinutes(new Date(), startOffsetMinutes + index * spacingMinutes);
  let guard = 0;
  while (!isWithinTextingWindow(contact, config, runAt) && guard < 10) {
    runAt = nextTextingWindow(contact, config, runAt);
    guard += 1;
  }
  return runAt;
}

function increment(map, key) {
  const safeKey = key || "unknown";
  map[safeKey] = (map[safeKey] || 0) + 1;
}

function minutesBetween(start, end) {
  if (!start || !end) return null;
  const value = (new Date(end) - new Date(start)) / 60000;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function lastActivityAt(contact, messagesByContact) {
  const messages = messagesByContact.get(contact.id) || [];
  const messageTimes = messages.map((message) => message.createdAt).filter(Boolean);
  return (
    contact.lastResponseTimestamp ||
    contact.lastOutboundTimestamp ||
    contact.humanAcknowledgedAt ||
    contact.escalatedAt ||
    messageTimes[messageTimes.length - 1] ||
    contact.backfilledAt ||
    ""
  );
}

function stuckStateReasons(contact, jobs = [], messages = [], escalations = []) {
  const reasons = [];
  const pendingJobs = jobs.filter((job) => job.status === "pending");
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const smsBlockedJobs = jobs.filter((job) => job.status === "skipped" && job.skipReason === "permanent_sms_block");
  const dueJobs = pendingJobs.filter((job) => job.runAt && new Date(job.runAt) <= new Date());
  const needsFutureAutomation = [
    "initial_sms_sent",
    "cold_outreach",
    "active_conversation",
    "warm_follow_up",
    "re_engagement",
    "missed_call",
    "call_scheduled"
  ].includes(contact.engagementStatus);

  if (contact.humanEscalationStatus && contact.humanEscalationStage === "human_review_pending") {
    reasons.push({ type: "urgent", code: "unacknowledged_escalation", label: "Human escalation not acknowledged", recommendedAction: "Acknowledge in dashboard or return to bot after review." });
  }
  if (failedJobs.length) {
    reasons.push({ type: "urgent", code: "failed_jobs", label: `${failedJobs.length} failed job(s)`, recommendedAction: "Open contact, inspect failed job, then retry/repair from controls." });
  }
  if (smsBlockedJobs.length) {
    reasons.push({ type: "info", code: "sms_dnd_blocked", label: "SMS blocked by GHL DND", recommendedAction: "No Slack action needed. Check GHL DND/subscription state." });
  }
  if (dueJobs.length) {
    reasons.push({ type: "warn", code: "due_jobs", label: `${dueJobs.length} due job(s)`, recommendedAction: "Run/poll job tick or inspect worker health." });
  }
  if (contact.automationPauseReason === "duplicate_phone_conflict") {
    reasons.push({ type: "warn", code: "duplicate_phone_conflict", label: "Duplicate phone conflict", recommendedAction: "Human should choose the active GHL contact before returning to bot." });
  }
  if (!contact.timezone) {
    reasons.push({ type: "warn", code: "missing_timezone", label: "Missing timezone", recommendedAction: "Refresh timezone from GHL tags/owner/state." });
  }
  if (contact.automationPaused) {
    reasons.push({ type: "info", code: "automation_paused", label: `Paused: ${contact.automationPauseReason || "unknown"}`, recommendedAction: "Return to bot only after the human-owned work is complete." });
  }
  if (needsFutureAutomation && !pendingJobs.length && !contact.automationPaused && !contact.optOutStatus) {
    reasons.push({ type: "warn", code: "no_pending_automation", label: "Active status but no pending automation", recommendedAction: "Restart chase or ensure reminders depending on status." });
  }
  if (contact.lastLlmClassification?.error || contact.lastLlmError) {
    reasons.push({ type: "warn", code: "llm_issue", label: "LLM fallback issue", recommendedAction: "Review message and return to bot if the intent is clear." });
  }
  if (escalations.some((item) => String(item.reason || "").includes("low_confidence"))) {
    reasons.push({ type: "warn", code: "low_confidence", label: "Low confidence classification", recommendedAction: "Review classification and add rule/test if recurring." });
  }
  if (!messages.length && contact.engagementStatus && contact.engagementStatus !== "new_lead") {
    reasons.push({ type: "warn", code: "no_messages", label: "No stored conversation messages", recommendedAction: "Verify GHL webhook/message export for this contact." });
  }
  if ((contact.appointmentId || contact.engagementStatus === "call_scheduled") && !pendingJobs.some((job) => job.type === "appointment_reminder")) {
    reasons.push({ type: "warn", code: "scheduled_without_reminders", label: "Scheduled call has no pending reminders", recommendedAction: "Click Ensure reminders." });
  }
  if (contact.awaitingBackupTime && !pendingJobs.some((job) => job.type === "backup_time_timeout")) {
    reasons.push({ type: "warn", code: "awaiting_backup_without_timeout", label: "Awaiting backup time with no timeout job", recommendedAction: "Return to bot or ensure appointment reminders." });
  }
  return reasons;
}

function contactIssueFlags(contact, jobs = [], messages = [], escalations = []) {
  const flags = stuckStateReasons(contact, jobs, messages, escalations);
  return flags;
}

function groupByContactId(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.contactId)) map.set(item.contactId, []);
    map.get(item.contactId).push(item);
  }
  return map;
}

function summarizeContact(contact, jobsByContact, messagesByContact, escalationsByContact, decisionLogsByContact = new Map()) {
  const jobs = jobsByContact.get(contact.id) || [];
  const messages = messagesByContact.get(contact.id) || [];
  const escalations = escalationsByContact.get(contact.id) || [];
  const decisionLogs = decisionLogsByContact.get(contact.id) || [];
  const lastDecision = [...decisionLogs].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
  const source = leadSourceInfo(contact);
  const nextJob = nextPendingJob(jobs);
  const issues = contactIssueFlags(contact, jobs, messages, escalations);
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    leadSource: contact.leadSource,
    ...source,
    timezone: contact.timezone,
    timezoneSource: timezoneSource(contact),
    engagementStatus: contact.engagementStatus,
    qualificationProgress: contact.qualificationProgress,
    currentSequenceName: contact.currentSequenceName,
    currentSequenceDay: contact.currentSequenceDay,
    automationPaused: contact.automationPaused,
    automationPauseReason: contact.automationPauseReason,
    lastAutomationPauseAt: contact.lastAutomationPauseAt,
    lastAutomationPauseSource: contact.lastAutomationPauseSource,
    lastAutomationPauseActor: contact.lastAutomationPauseActor,
    lastAutomationPauseNote: contact.lastAutomationPauseNote,
    lastAutomationPauseAction: contact.lastAutomationPauseAction,
    lastAutomationPauseRequestPath: contact.lastAutomationPauseRequestPath,
    humanEscalationStatus: contact.humanEscalationStatus,
    humanEscalationStage: contact.humanEscalationStage,
    escalationReason: contact.escalationReason,
    lastInboundMessage: contact.lastInboundMessage,
    lastOutboundMessage: contact.lastOutboundMessage,
    lastActivityAt: lastActivityAt(contact, messagesByContact),
    pendingJobs: jobs.filter((job) => job.status === "pending").length,
    failedJobs: jobs.filter((job) => job.status === "failed").length,
    skippedJobs: jobs.filter((job) => job.status === "skipped").length,
    messages: messages.length,
    escalations: escalations.length,
    riskScore: leadRiskScore(contact, jobs, messages, escalations),
    issueFlags: issues,
    stuckStateReasons: issues,
    recommendedAction: issues[0]?.recommendedAction || "",
    nextScheduledJob: nextJob ? { id: nextJob.id, type: nextJob.type, runAt: nextJob.runAt, payload: nextJob.payload } : null,
    lastBotDecision: lastDecision || contact.lastBotDecision || null,
    ghlContactLink: contact.ghlContactLink
  };
}

function leadRiskScore(contact, jobs = [], messages = [], escalations = []) {
  let score = 0;
  if (contact.engagementStatus === "ready_for_call") score += 50;
  if (contact.engagementStatus === "active_conversation") score += 30;
  if (contact.engagementStatus === "warm_follow_up") score += 24;
  if (contact.engagementStatus === "call_scheduled") score += 35;
  if (contact.faultAnswer) score += 10;
  if (contact.medicalTreatmentAnswer) score += 15;
  if (messages.some((message) => message.direction === "inbound")) score += 10;
  if (escalations.length) score += 12;
  if (jobs.some((job) => job.status === "failed")) score += 15;
  if (contact.automationPaused || contact.optOutStatus) score -= 50;
  return Math.max(0, Math.min(100, score));
}

function contactTimeline(contact, messages = [], jobs = [], escalations = [], decisionLogs = []) {
  const events = [];
  for (const message of messages) {
    events.push({
      at: message.createdAt,
      type: message.direction === "inbound" ? "inbound_sms" : "outbound_sms",
      title: message.direction === "inbound" ? "PC replied" : "Bot sent SMS",
      detail: message.body || "",
      template: [message.templateGroup, message.templateKey].filter(Boolean).join(":")
    });
  }
  for (const job of jobs) {
    events.push({
      at: job.finishedAt || job.runAt || job.createdAt,
      type: `job_${job.status || "unknown"}`,
      title: `${job.type || "job"} ${job.status || ""}`.trim(),
      detail: job.error || job.lastError || job.cancelReason || "",
      template: job.payload?.templateKey || ""
    });
  }
  for (const escalation of escalations) {
    events.push({
      at: escalation.createdAt,
      type: "escalation",
      title: `Escalated: ${escalation.reason || "unknown"}`,
      detail: escalation.lastInboundMessage || "",
      template: ""
    });
  }
  for (const log of decisionLogs) {
    events.push({
      at: log.createdAt,
      type: `decision_${log.action || "unknown"}`,
      title: `Decision: ${safeText(log.action, "unknown")}`,
      detail: [log.reason, log.message].filter(Boolean).join(" | "),
      template: log.jobType || log.meta?.templateKey || ""
    });
  }
  if (contact.escalatedAt) {
    events.push({ at: contact.escalatedAt, type: "human_escalation", title: "Human escalation started", detail: contact.escalationReason || "", template: "" });
  }
  if (contact.humanAcknowledgedAt) {
    events.push({ at: contact.humanAcknowledgedAt, type: "human_ack", title: "Human acknowledged", detail: contact.humanEscalationStage || "", template: "" });
  }
  if (contact.appointmentRescheduledAt) {
    events.push({ at: contact.appointmentRescheduledAt, type: "appointment", title: "Appointment rescheduled", detail: contact.preferredCallTime || "", template: "" });
  }
  return events.filter((event) => event.at).sort((a, b) => new Date(a.at) - new Date(b.at));
}

function contactQualification(contact = {}) {
  const answered = [
    contact.accidentDate ? "accident_date" : "",
    contact.faultAnswer ? "fault" : "",
    contact.medicalTreatmentAnswer ? "medical" : "",
    contact.preferredCallTime || contact.appointmentId ? "call_time" : ""
  ].filter(Boolean);
  const summary = [
    contact.accidentDate ? `Accident: ${contact.accidentDate}` : "",
    contact.faultAnswer ? `Fault: ${contact.faultAnswer}` : "",
    contact.medicalTreatmentAnswer ? `Medical: ${contact.medicalTreatmentAnswer}` : "",
    contact.preferredCallTime ? `Call: ${contact.preferredCallTime}` : ""
  ].filter(Boolean);

  return {
    contactId: contact.id || "",
    progress: contact.qualificationProgress || "",
    answered,
    fault: contact.faultAnswer || "",
    medical: contact.medicalTreatmentAnswer || "",
    callTime: contact.preferredCallTime || "",
    callTimeIso: contact.preferredCallTimeIso || "",
    accidentDate: contact.accidentDate || "",
    appointmentId: contact.appointmentId || "",
    summary: summary.length ? summary.join(" | ") : "No qualification answers collected yet."
  };
}

async function contactDataSets() {
  const [contacts, messages, jobs, escalations, decisionLogs] = await Promise.all([
    store.listContacts ? store.listContacts() : [],
    store.listMessages(),
    store.listJobs(),
    store.listEscalations(),
    store.listDecisionLogs ? store.listDecisionLogs() : []
  ]);
  return {
    contacts,
    messages,
    jobs,
    escalations,
    decisionLogs,
    messagesByContact: groupByContactId(messages),
    jobsByContact: groupByContactId(jobs),
    escalationsByContact: groupByContactId(escalations),
    decisionLogsByContact: groupByContactId(decisionLogs)
  };
}

function filterContactQueue(contacts, queue = "all") {
  if (queue === "hot") {
    return contacts.filter((contact) => contact.riskScore >= 35 && !contact.automationPaused && contact.engagementStatus !== "opted_out");
  }
  if (queue === "waiting") {
    return contacts.filter(
      (contact) =>
        (contact.humanEscalationStatus && contact.humanEscalationStage === "human_review_pending") ||
        ["ready_for_call", "active_conversation", "warm_follow_up", "re_engagement"].includes(contact.engagementStatus)
    );
  }
  if (queue === "paused") {
    return contacts.filter((contact) => contact.automationPaused || contact.optOutStatus || contact.engagementStatus === "opted_out");
  }
  return contacts;
}

function sortContacts(contacts, sort = "sla") {
  const priority = (contact) => {
    if (contact.issueFlags?.some((flag) => flag.code === "unacknowledged_escalation")) return 4;
    if (contact.engagementStatus === "ready_for_call") return 3;
    if (contact.issueFlags?.some((flag) => flag.type === "warn")) return 2;
    if (contact.issueFlags?.some((flag) => flag.type === "info")) return 1;
    return 0;
  };
  return [...contacts].sort((a, b) => {
    if (sort === "recent") return new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0);
    return priority(b) - priority(a) || b.riskScore - a.riskScore || new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0);
  });
}

async function dashboardContactsList(url) {
  const queue = url.searchParams.get("queue") || "all";
  const sort = url.searchParams.get("sort") || "sla";
  const data = await contactDataSets();
  const summaries = data.contacts.map((contact) =>
    summarizeContact(contact, data.jobsByContact, data.messagesByContact, data.escalationsByContact, data.decisionLogsByContact)
  );
  const contacts = sortContacts(filterContactQueue(summaries, queue), sort);
  return {
    ok: true,
    queue,
    sort,
    count: contacts.length,
    contacts
  };
}

function lifecycleFunnel(contacts) {
  const count = (predicate) => contacts.filter(predicate).length;
  return [
    { key: "started", label: "Bot Started", count: contacts.length },
    { key: "replied", label: "Replied", count: count((contact) => contact.lastResponseTimestamp || contact.lastInboundMessage) },
    { key: "fault", label: "Fault Answer", count: count((contact) => contact.faultAnswer) },
    { key: "medical", label: "Medical Answer", count: count((contact) => contact.medicalTreatmentAnswer) },
    { key: "ready", label: "Ready / Requested Call", count: count((contact) => ["ready_for_call", "call_scheduled"].includes(contact.engagementStatus)) },
    { key: "booked", label: "Booked", count: count((contact) => contact.engagementStatus === "call_scheduled" || contact.appointmentId) },
    { key: "missed", label: "Missed Call", count: count((contact) => contact.engagementStatus === "missed_call") },
    { key: "opted_out", label: "Opted Out", count: count((contact) => contact.optOutStatus || contact.engagementStatus === "opted_out") }
  ];
}

function sourcePerformance(contacts) {
  const map = new Map();
  for (const contact of contacts) {
    const source = leadSourceInfo(contact).leadSourceLabel || "unknown";
    const item = map.get(source) || { source, contacts: 0, replied: 0, escalated: 0, booked: 0, optedOut: 0 };
    item.contacts += 1;
    if (contact.lastInboundMessage || contact.lastResponseTimestamp) item.replied += 1;
    if (contact.humanEscalationStatus || contact.engagementStatus === "escalated_to_human") item.escalated += 1;
    if (contact.appointmentId || contact.engagementStatus === "call_scheduled") item.booked += 1;
    if (contact.optOutStatus || contact.engagementStatus === "opted_out") item.optedOut += 1;
    map.set(source, item);
  }
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      replyRate: item.contacts ? item.replied / item.contacts : 0,
      bookingRate: item.contacts ? item.booked / item.contacts : 0
    }))
    .sort((a, b) => b.contacts - a.contacts)
    .slice(0, 20);
}

function scannerOutput(contactSummaries = [], jobs = []) {
  const buckets = {
    humanWaiting: [],
    stuckBotState: [],
    appointmentIssues: [],
    timezoneIssues: [],
    systemIssues: [],
    smsBlocked: [],
    duplicateConflicts: [],
    recoverable: []
  };

  const push = (bucket, contact, reason) => {
    buckets[bucket].push({
      contactId: contact.id,
      name: contact.name,
      phone: contact.phone,
      engagementStatus: contact.engagementStatus,
      qualificationProgress: contact.qualificationProgress,
      lastActivityAt: contact.lastActivityAt,
      reason,
      recommendedAction: reason.recommendedAction || contact.recommendedAction || "",
      ghlContactLink: contact.ghlContactLink
    });
  };

  for (const contact of contactSummaries) {
    for (const reason of contact.stuckStateReasons || contact.issueFlags || []) {
      if (reason.code === "unacknowledged_escalation") push("humanWaiting", contact, reason);
      else if (["scheduled_without_reminders", "awaiting_backup_without_timeout"].includes(reason.code)) push("appointmentIssues", contact, reason);
      else if (["missing_timezone"].includes(reason.code)) push("timezoneIssues", contact, reason);
      else if (["failed_jobs", "due_jobs", "llm_issue", "low_confidence"].includes(reason.code)) push("systemIssues", contact, reason);
      else if (reason.code === "sms_dnd_blocked") push("smsBlocked", contact, reason);
      else if (reason.code === "duplicate_phone_conflict") push("duplicateConflicts", contact, reason);
      else if (["no_pending_automation", "automation_paused", "no_messages"].includes(reason.code)) push("stuckBotState", contact, reason);
    }
    if (contact.recommendedAction && !contact.optOutStatus) {
      buckets.recoverable.push({
        contactId: contact.id,
        name: contact.name,
        phone: contact.phone,
        engagementStatus: contact.engagementStatus,
        recommendedAction: contact.recommendedAction,
        lastBotDecision: contact.lastBotDecision,
        nextScheduledJob: contact.nextScheduledJob
      });
    }
  }

  const failedJobs = jobs.filter((job) => job.status === "failed").map((job) => ({
    id: job.id,
    contactId: job.contactId,
    type: job.type,
    runAt: job.runAt,
    error: job.error || job.lastError || ""
  }));

  return {
    generatedAt: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(buckets).map(([key, value]) => [key, value.length])),
    buckets,
    failedJobs
  };
}

function timezoneHeatmap(messages, contactsById) {
  const buckets = {};
  for (const message of messages) {
    if (message.direction !== "inbound" || !message.createdAt) continue;
    const contact = contactsById.get(message.contactId) || {};
    const timezone = contact.timezone || "unknown";
    const hour = new Date(message.createdAt).getHours();
    const key = `${timezone}|${hour}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }
  return Object.entries(buckets)
    .map(([key, count]) => {
      const [timezone, hour] = key.split("|");
      return { timezone, hour: Number(hour), count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 36);
}

function appointmentPipeline(contacts, jobsByContact) {
  return contacts
    .filter((contact) => contact.appointmentId || contact.engagementStatus === "call_scheduled" || contact.engagementStatus === "ready_for_call" || contact.engagementStatus === "missed_call")
    .map((contact) => {
      const jobs = jobsByContact.get(contact.id) || [];
      return {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        status: contact.engagementStatus,
        preferredCallTime: contact.preferredCallTime,
        preferredCallTimeIso: contact.preferredCallTimeIso,
        appointmentId: contact.appointmentId,
        confirmed: Boolean(contact.appointmentConfirmed),
        reminderJobs: jobs.filter((job) => job.type === "appointment_reminder" && job.status === "pending").length,
        missedFollowups: jobs.filter((job) => job.type === "missed_call_followup").length
      };
    })
    .sort((a, b) => new Date(a.preferredCallTimeIso || 0) - new Date(b.preferredCallTimeIso || 0))
    .slice(0, 80);
}

function abTestingPerformance(messages, experiments = []) {
  const inboundByContact = groupByContactId(messages.filter((message) => message.direction === "inbound"));
  return experiments.map((experiment) => {
    const variants = experiment.variants.map((variant) => {
      const sends = messages.filter(
        (message) =>
          message.direction === "outbound" &&
          message.templateExperimentId === experiment.id &&
          message.templateVariantId === variant.id
      );
      const repliedContacts = new Set();
      for (const send of sends) {
        const laterInbound = (inboundByContact.get(send.contactId) || []).some(
          (message) => new Date(message.createdAt) > new Date(send.createdAt)
        );
        if (laterInbound) repliedContacts.add(send.contactId);
      }
      return {
        id: variant.id,
        name: variant.name,
        weight: variant.weight,
        sends: sends.length,
        replies: repliedContacts.size,
        responseRate: sends.length ? repliedContacts.size / sends.length : 0
      };
    });
    return { ...experiment, variants };
  });
}

function templatePerformance(messages, templates = []) {
  const inboundByContact = groupByContactId(messages.filter((message) => message.direction === "inbound"));
  const rows = [];
  for (const group of templates) {
    for (const template of group.templates || []) {
      const sends = messages.filter(
        (message) =>
          message.direction === "outbound" &&
          message.templateGroup === group.group &&
          message.templateKey === template.key
      );
      const repliedContacts = new Set();
      for (const send of sends) {
        const laterInbound = (inboundByContact.get(send.contactId) || []).some(
          (message) => new Date(message.createdAt) > new Date(send.createdAt)
        );
        if (laterInbound) repliedContacts.add(send.contactId);
      }
      rows.push({
        group: group.group,
        groupLabel: group.label,
        key: template.key,
        body: template.value,
        sends: sends.length,
        replies: repliedContacts.size,
        responseRate: sends.length ? repliedContacts.size / sends.length : 0
      });
    }
  }
  return rows.sort((a, b) => b.sends - a.sends || a.groupLabel.localeCompare(b.groupLabel)).slice(0, 200);
}

function activityHistory(messages, escalations, contacts) {
  const days = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 364);
  for (let index = 0; index < 365; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = date.toISOString().slice(0, 10);
    days.push({ key, label: `${date.getMonth() + 1}/${date.getDate()}`, inbound: 0, outbound: 0, escalations: 0, bookings: 0 });
  }
  const byKey = new Map(days.map((item) => [item.key, item]));
  for (const message of messages) {
    if (!message.createdAt) continue;
    const key = new Date(message.createdAt).toISOString().slice(0, 10);
    const item = byKey.get(key);
    if (!item) continue;
    if (message.direction === "inbound") item.inbound += 1;
    if (message.direction === "outbound") item.outbound += 1;
  }
  for (const escalation of escalations) {
    if (!escalation.createdAt) continue;
    const item = byKey.get(new Date(escalation.createdAt).toISOString().slice(0, 10));
    if (item) item.escalations += 1;
  }
  for (const contact of contacts) {
    const bookingAt = contact.appointmentRescheduledAt || contact.appointmentBookedAt || (contact.appointmentId ? contact.lastOutboundTimestamp : "");
    if (!bookingAt) continue;
    const item = byKey.get(new Date(bookingAt).toISOString().slice(0, 10));
    if (item) item.bookings += 1;
  }
  return days;
}

async function dashboardMetrics() {
  const [contacts, messages, jobs, escalations, decisionLogs, health, experiments, botErrors] = await Promise.all([
    store.listContacts ? store.listContacts() : [],
    store.listMessages(),
    store.listJobs(),
    store.listEscalations(),
    store.listDecisionLogs ? store.listDecisionLogs() : [],
    store.health(),
    loadTemplateExperiments(store),
    listBotErrors(store, 100)
  ]);
  const since24h = Date.now() - 24 * 60 * 60 * 1000;
  const templates = editableTemplates();
  const engagement = {};
  const qualification = {};
  const sequences = {};
  const messagesByContact = groupByContactId(messages);
  const jobsByContact = groupByContactId(jobs);
  const escalationsByContact = groupByContactId(escalations);
  const decisionLogsByContact = groupByContactId(decisionLogs);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  for (const contact of contacts) {
    increment(engagement, contact.engagementStatus);
    increment(qualification, contact.qualificationProgress);
    increment(sequences, contact.currentSequenceName || "none");
  }
  const outboundMessages = messages.filter((message) => message.direction === "outbound");
  const inboundMessages = messages.filter((message) => message.direction === "inbound");
  const escalations24h = escalations.filter((item) => new Date(item.createdAt).getTime() >= since24h);
  const outbound24h = outboundMessages.filter((message) => new Date(message.createdAt).getTime() >= since24h);
  const inbound24h = inboundMessages.filter((message) => new Date(message.createdAt).getTime() >= since24h);
  const pendingJobs = jobs.filter((job) => job.status === "pending");
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const smsBlockedJobs = jobs.filter((job) => job.status === "skipped" && job.skipReason === "permanent_sms_block");
  const dueJobs = pendingJobs.filter((job) => job.runAt && new Date(job.runAt) <= new Date());
  const unacknowledged = contacts.filter(
    (contact) => contact.humanEscalationStatus && contact.humanEscalationStage === "human_review_pending"
  );
  const ackSpeeds = contacts
    .map((contact) => minutesBetween(contact.escalatedAt, contact.humanAcknowledgedAt))
    .filter((value) => value !== null);
  const duplicateConflicts = contacts.filter((contact) => contact.automationPauseReason === "duplicate_phone_conflict");
  const missingTimezone = contacts.filter((contact) => !contact.timezone);
  const paused = contacts.filter((contact) => contact.automationPaused);
  const contactSummaries = contacts.map((contact) => summarizeContact(contact, jobsByContact, messagesByContact, escalationsByContact, decisionLogsByContact));
  const pausedContacts = contactSummaries
    .filter((contact) => contact.automationPaused)
    .sort((a, b) => new Date(b.lastAutomationPauseAt || b.lastActivityAt || 0) - new Date(a.lastAutomationPauseAt || a.lastActivityAt || 0));
  const pauseAudit = decisionLogs
    .filter((log) => log.action === "paused" || /pause|human_acknowledged|human_outbound|human_call/i.test(log.reason || ""))
    .map((log) => {
      const contact = contactsById.get(log.contactId) || {};
      const meta = log.meta || {};
      return {
        ...log,
        name: contact.name || "",
        phone: contact.phone || "",
        contactId: log.contactId,
        ghlContactLink: contact.ghlContactLink || "",
        source: meta.source || contact.lastAutomationPauseSource || "unknown",
        actor: meta.actor || contact.lastAutomationPauseActor || "",
        note: meta.note || contact.lastAutomationPauseNote || "",
        rawAction: meta.rawAction || contact.lastAutomationPauseAction || "",
        requestPath: meta.requestPath || contact.lastAutomationPauseRequestPath || ""
      };
    })
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 150);
  const hotLeads = contactSummaries
    .filter((contact) => contact.riskScore >= 35 && !contact.automationPaused && contact.engagementStatus !== "opted_out")
    .sort((a, b) => b.riskScore - a.riskScore || new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0))
    .slice(0, 50);
  const allIssueContacts = contactSummaries
    .filter((contact) => contact.issueFlags.length)
    .sort((a, b) => {
      const priority = (item) => (item.issueFlags.some((flag) => flag.type === "urgent") ? 2 : item.issueFlags.some((flag) => flag.type === "warn") ? 1 : 0);
      return priority(b) - priority(a) || new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0);
    });
  const issueContacts = allIssueContacts.slice(0, 75);
  const recentContacts = contactSummaries
    .sort((a, b) => new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0))
    .slice(0, 50);
  const escalationSla = contacts
    .filter((contact) => contact.humanEscalationStatus)
    .map((contact) => {
      const waitingMinutes = minutesBetween(contact.escalatedAt, contact.humanAcknowledgedAt || new Date().toISOString());
      return {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        stage: contact.humanEscalationStage,
        reason: contact.escalationReason,
        escalatedAt: contact.escalatedAt,
        acknowledgedAt: contact.humanAcknowledgedAt,
        waitingMinutes,
        bucket: waitingMinutes === null ? "unknown" : waitingMinutes <= 5 ? "0-5" : waitingMinutes <= 15 ? "5-15" : "15+"
      };
    })
    .sort((a, b) => (b.waitingMinutes || 0) - (a.waitingMinutes || 0))
    .slice(0, 75);
  const botConfusion = contactSummaries
    .filter((contact) =>
      contact.issueFlags.some((flag) => ["low_confidence", "llm_issue"].includes(flag.code)) ||
      String(contact.escalationReason || "").includes("low_confidence") ||
      String(contact.escalationReason || "").includes("llm")
    )
    .slice(0, 60);
  const templateUsage = messages
    .filter((message) => message.direction === "outbound" && (message.templateGroup || message.templateKey))
    .reduce((map, message) => {
      increment(map, [message.templateGroup || "unknown", message.templateKey || "unknown"].join(":"));
      return map;
    }, {});
  const llmContacts = contacts.filter((contact) => contact.lastLlmClassification || contact.lastLlmError);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const bookedToday = contacts.filter((contact) => contact.appointmentId && new Date(contact.appointmentRescheduledAt || contact.lastOutboundTimestamp || contact.escalatedAt || 0) >= todayStart);
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    dryRun: config.dryRun,
    health,
    totals: {
      contacts: contacts.length,
      messages: messages.length,
      outboundMessages: outboundMessages.length,
      inboundMessages: inboundMessages.length,
      outbound24h: outbound24h.length,
      inbound24h: inbound24h.length,
      escalations: escalations.length,
      escalations24h: escalations24h.length,
      pendingJobs: pendingJobs.length,
      dueJobs: dueJobs.length,
      failedJobs: failedJobs.length,
      smsBlocked: smsBlockedJobs.length,
      botErrors: botErrors.length,
      unacknowledgedEscalations: unacknowledged.length,
      callScheduled: contacts.filter((contact) => contact.engagementStatus === "call_scheduled").length,
      readyForCall: contacts.filter((contact) => contact.engagementStatus === "ready_for_call").length,
      optedOut: contacts.filter((contact) => contact.optOutStatus || contact.engagementStatus === "opted_out").length,
      issueContacts: allIssueContacts.length
    },
    speedToLead: {
      acknowledgedCount: ackSpeeds.length,
      averageMinutes: average(ackSpeeds),
      fastestMinutes: ackSpeeds.length ? Math.min(...ackSpeeds) : null,
      slowestMinutes: ackSpeeds.length ? Math.max(...ackSpeeds) : null
    },
    dailySummary: {
      date: todayStart.toISOString(),
      started: contacts.filter((contact) => new Date(contact.backfilledAt || contact.lastOutboundTimestamp || 0) >= todayStart).length,
      inbound: inboundMessages.filter((message) => new Date(message.createdAt).getTime() >= todayStart.getTime()).length,
      outbound: outboundMessages.filter((message) => new Date(message.createdAt).getTime() >= todayStart.getTime()).length,
      escalations: escalations.filter((item) => new Date(item.createdAt).getTime() >= todayStart.getTime()).length,
      booked: bookedToday.length,
      failedJobs: failedJobs.length,
      smsBlocked: smsBlockedJobs.length,
      issueContacts: allIssueContacts.length
    },
    breakdowns: {
      engagement,
      qualification,
      sequences,
      templateUsage,
      jobsByType: jobs.reduce((map, job) => {
        increment(map, `${job.type}:${job.status}`);
        return map;
      }, {}),
      escalationsByReason: escalations.reduce((map, item) => {
        increment(map, item.reason);
        return map;
      }, {})
    },
    alerts: {
      unacknowledgedEscalations: unacknowledged.map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        reason: contact.escalationReason,
        escalatedAt: contact.escalatedAt,
        lastInboundMessage: contact.lastInboundMessage
      })),
      failedJobs: failedJobs.slice(0, 25),
      botErrors: botErrors.slice(0, 50),
      smsBlocked: smsBlockedJobs.slice(0, 50).map((job) => ({
        id: job.id,
        contactId: job.contactId,
        type: job.type,
        runAt: job.runAt,
        finishedAt: job.finishedAt,
        error: job.error
      })),
      dueJobs: dueJobs.slice(0, 25),
      duplicateConflicts: duplicateConflicts.map((contact) => ({
        id: contact.id,
        phone: contact.phone,
        duplicateActiveContactIds: contact.duplicateActiveContactIds
      })),
      missingTimezone: missingTimezone.slice(0, 25).map((contact) => ({ id: contact.id, name: contact.name, phone: contact.phone })),
      paused: paused.slice(0, 25).map((contact) => ({
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        reason: contact.automationPauseReason,
        source: contact.lastAutomationPauseSource || "unknown",
        actor: contact.lastAutomationPauseActor || "",
        pausedAt: contact.lastAutomationPauseAt || "",
        note: contact.lastAutomationPauseNote || ""
      }))
    },
    funnel: lifecycleFunnel(contacts),
    activityHistory: activityHistory(messages, escalations, contacts),
    hotLeads,
    escalationSla,
    botConfusion,
    appointmentPipeline: appointmentPipeline(contacts, jobsByContact),
    sourcePerformance: sourcePerformance(contacts),
    timezoneHeatmap: timezoneHeatmap(messages, contactsById),
    scanner: scannerOutput(contactSummaries, jobs),
    pausedContacts,
    pauseAudit,
    recentDecisionLogs: decisionLogs
      .slice()
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 100),
    llmUsage: {
      contactsClassified: llmContacts.length,
      fallbackEnabled: config.llm.fallbackEnabled,
      estimatedCostLow: llmContacts.length ? llmContacts.length * 0.001 : 0,
      failures: contacts.filter((contact) => contact.lastLlmError || contact.lastLlmClassification?.error).length
    },
    abTesting: abTestingPerformance(messages, experiments),
    templatePerformance: templatePerformance(messages, templates),
    issueContacts,
    recentContacts,
    recentMessages: messages.slice(-50).reverse()
  };
}

async function dashboardContactDetail(contactId) {
  const [contact, messages, jobs, escalations, decisionLogs] = await Promise.all([
    store.getContact(contactId),
    store.listMessages(contactId),
    store.listJobs(contactId),
    store.listEscalations(contactId),
    store.listDecisionLogs ? store.listDecisionLogs(contactId) : []
  ]);
  if (!contact) return null;
  const messagesByContact = groupByContactId(messages);
  const jobsByContact = groupByContactId(jobs);
  const escalationsByContact = groupByContactId(escalations);
  const decisionLogsByContact = groupByContactId(decisionLogs);
  const summary = summarizeContact(contact, jobsByContact, messagesByContact, escalationsByContact, decisionLogsByContact);
  return {
    ok: true,
    contact: { ...contact, ...summary },
    messages,
    jobs,
    escalations,
    decisionLogs,
    issueFlags: contactIssueFlags(contact, jobs, messages, escalations),
    timeline: contactTimeline(contact, messages, jobs, escalations, decisionLogs)
  };
}

function parseAuditDate(value, fallback) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function betweenDates(value, since, until) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= since.getTime() && time <= until.getTime();
}

function countBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = safeText(getKey(item), "unknown");
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function sampleRows(items, limit = 25) {
  return items.slice(0, limit);
}

async function dashboardAudit(url) {
  const now = new Date();
  const defaultSince = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since = parseAuditDate(url.searchParams.get("since"), defaultSince);
  const until = parseAuditDate(url.searchParams.get("until"), now);
  const [contacts, messages, jobs, escalations, decisionLogs, botErrors] = await Promise.all([
    store.listContacts ? store.listContacts() : [],
    store.listMessages(),
    store.listJobs(),
    store.listEscalations(),
    store.listDecisionLogs ? store.listDecisionLogs() : [],
    listBotErrors(store, 250)
  ]);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const messagesInWindow = messages.filter((message) => betweenDates(message.createdAt, since, until));
  const inbound = messagesInWindow.filter((message) => message.direction === "inbound");
  const outbound = messagesInWindow.filter((message) => message.direction === "outbound");
  const jobsTouched = jobs.filter((job) => betweenDates(job.finishedAt || job.updatedAt || job.runningAt || job.runAt || job.createdAt, since, until));
  const failedJobs = jobsTouched.filter((job) => job.status === "failed");
  const skippedJobs = jobsTouched.filter((job) => job.status === "skipped");
  const cancelledJobs = jobsTouched.filter((job) => job.status === "cancelled");
  const pendingDue = jobs.filter((job) => job.status === "pending" && job.runAt && new Date(job.runAt) <= until);
  const escalationsInWindow = escalations.filter((item) => betweenDates(item.createdAt, since, until));
  const decisionsInWindow = decisionLogs.filter((item) => betweenDates(item.createdAt, since, until));
  const errorsInWindow = botErrors.filter((item) => betweenDates(item.at, since, until));

  const contactIds = new Set(messagesInWindow.map((item) => item.contactId).filter(Boolean));
  const contactSummaries = Array.from(contactIds).map((id) => {
    const contact = contactsById.get(id) || { id };
    return {
      id,
      name: contact.name || "",
      phone: contact.phone || "",
      status: contact.engagementStatus || "",
      progress: contact.qualificationProgress || "",
      leadSourceLabel: leadSourceInfo(contact).leadSourceLabel,
      timezone: contact.timezone || "",
      timezoneSource: timezoneSource(contact)
    };
  });

  const enrichMessage = (message) => {
    const contact = contactsById.get(message.contactId) || {};
    return {
      at: message.createdAt,
      contactId: message.contactId,
      name: contact.name || "",
      phone: contact.phone || "",
      direction: message.direction,
      body: message.body || "",
      templateGroup: message.templateGroup || "",
      templateKey: message.templateKey || "",
      status: contact.engagementStatus || "",
      progress: contact.qualificationProgress || ""
    };
  };

  const enrichJob = (job) => {
    const contact = contactsById.get(job.contactId) || {};
    return {
      id: job.id,
      contactId: job.contactId,
      name: contact.name || "",
      phone: contact.phone || "",
      type: job.type,
      status: job.status,
      runAt: job.runAt,
      finishedAt: job.finishedAt || "",
      error: job.error || job.lastError || "",
      skipReason: job.skipReason || "",
      cancelReason: job.cancelReason || "",
      payload: job.payload || {}
    };
  };

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    window: { since: since.toISOString(), until: until.toISOString() },
    totals: {
      contactsTouched: contactIds.size,
      messages: messagesInWindow.length,
      inbound: inbound.length,
      outbound: outbound.length,
      escalations: escalationsInWindow.length,
      decisionLogs: decisionsInWindow.length,
      errors: errorsInWindow.length,
      jobsTouched: jobsTouched.length,
      failedJobs: failedJobs.length,
      skippedJobs: skippedJobs.length,
      cancelledJobs: cancelledJobs.length,
      pendingDue: pendingDue.length
    },
    breakdowns: {
      outboundTemplates: countBy(outbound, (message) => [message.templateGroup || "unknown", message.templateKey || "unknown"].join(":")),
      inboundByStatus: countBy(inbound, (message) => contactsById.get(message.contactId)?.engagementStatus || "unknown"),
      escalationReasons: countBy(escalationsInWindow, (item) => item.reason || "unknown"),
      failedJobTypes: countBy(failedJobs, (job) => job.type || "unknown"),
      skippedReasons: countBy(skippedJobs, (job) => job.skipReason || job.cancelReason || "unknown"),
      errorTitles: countBy(errorsInWindow, (item) => item.title || "unknown"),
      errorSignatures: countBy(errorsInWindow, (item) => item.signature || item.title || "unknown"),
      decisions: countBy(decisionsInWindow, (item) => [item.action || "unknown", item.reason || "unknown"].join(":"))
    },
    samples: {
      outbound: sampleRows(outbound.slice().reverse().map(enrichMessage), 200),
      inbound: sampleRows(inbound.slice().reverse().map(enrichMessage), 200),
      escalations: sampleRows(escalationsInWindow.slice().reverse(), 200),
      failedJobs: sampleRows(failedJobs.slice().reverse().map(enrichJob), 200),
      skippedJobs: sampleRows(skippedJobs.slice().reverse().map(enrichJob), 200),
      pendingDue: sampleRows(pendingDue.map(enrichJob), 200),
      errors: sampleRows(errorsInWindow, 200),
      decisions: sampleRows(decisionsInWindow.slice().reverse(), 200),
      contactsTouched: sampleRows(contactSummaries, 500)
    }
  };
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function sendFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    send(res, 404, { ok: false, error: "file not found" });
    return;
  }
  res.writeHead(200, { "Content-Type": contentType });
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) send(res, 404, { ok: false, error: "file not found" });
    else res.end();
  });
  stream.pipe(res);
}

function staticContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".map": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".woff": "font/woff",
      ".woff2": "font/woff2"
    }[ext] || "application/octet-stream"
  );
}

function sendDashboardSpa(res) {
  const builtIndex = path.join(publicDir, "dashboard-app", "index.html");
  const fallbackIndex = path.join(publicDir, "dashboard.html");
  sendFile(res, fs.existsSync(builtIndex) ? builtIndex : fallbackIndex, "text/html; charset=utf-8");
}

function sendDashboardAsset(req, res) {
  const assetRoot = path.join(publicDir, "dashboard-app");
  const rawPath = decodeURIComponent(req.url.replace(/^\/dashboard-app\/?/, ""));
  const filePath = path.normalize(path.join(assetRoot, rawPath));
  if (!filePath.startsWith(assetRoot)) {
    send(res, 403, { ok: false, error: "forbidden" });
    return;
  }
  sendFile(res, filePath, staticContentType(filePath));
}

function runPythonJson(scriptName, args, timeout = 120_000) {
  return new Promise((resolve, reject) => {
    execFile("python3", [path.join(rootDir, "scripts", scriptName), ...args], {
      cwd: rootDir,
      timeout,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        reject(new Error(`Could not parse training DB output: ${parseError.message}`));
      }
    });
  });
}

function runPythonText(scriptName, args = [], timeout = 120_000) {
  return new Promise((resolve, reject) => {
    execFile("python3", [path.join(rootDir, "scripts", scriptName), ...args], {
      cwd: rootDir,
      timeout,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function runTrainingDb(args) {
  return runPythonJson("ghl_training_db.py", args);
}

async function safeJson(label, task) {
  try {
    return { ok: true, value: await task() };
  } catch (error) {
    return { ok: false, label, error: error.message };
  }
}

function fileInfo(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  const stats = fs.statSync(filePath);
  return {
    exists: true,
    path: filePath,
    bytes: stats.size,
    updatedAt: stats.mtime.toISOString()
  };
}

async function trainingStatus() {
  const [dbSummary, llmSummary, batchStatus] = await Promise.all([
    safeJson("database summary", () => runTrainingDb(["summary"])),
    safeJson("LLM label summary", () => runPythonJson("llm_label_examples.py", ["summary"])),
    safeJson("OpenAI batch status", () => runPythonJson("llm_batch_examples.py", ["status"]))
  ]);
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    database: dbSummary,
    llm: llmSummary,
    batch: batchStatus,
    files: {
      database: fileInfo(trainingDbPath),
      report: fileInfo(path.join(reportDir, "training_report.md")),
      ruleCandidates: fileInfo(path.join(reportDir, "rule_candidates.json"))
    }
  };
}

async function applyBatchAndRefreshReports() {
  const applyResult = await runPythonJson("llm_batch_examples.py", ["apply"], 600_000);
  let reportResult = null;
  let ruleCandidateResult = null;
  if (applyResult.ok) {
    reportResult = await runPythonText("build_training_report.py", [], 120_000);
    ruleCandidateResult = await runPythonJson("generate_rule_candidates.py", [], 120_000);
  }
  return {
    ok: applyResult.ok,
    apply: applyResult,
    report: reportResult,
    ruleCandidates: ruleCandidateResult,
    status: await trainingStatus()
  };
}

async function slackAuthStatus() {
  if (!config.slack.token) {
    return { ok: false, configured: false, reason: "SLACK_BOT_TOKEN is missing" };
  }
  const response = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slack.token}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    return { ok: false, configured: true, status: response.status, error: data.error || "Slack auth failed" };
  }
  return {
    ok: true,
    configured: true,
    team: data.team,
    user: data.user,
    botId: data.bot_id || "",
    channelConfigured: config.slack.channel
  };
}

async function integrationStatus() {
  const [ghl, openaiBatch, slack] = await Promise.all([
    safeJson("GHL API check", () => runTrainingDb(["api-check"])),
    safeJson("OpenAI batch status", () => runPythonJson("llm_batch_examples.py", ["status"])),
    safeJson("Slack auth", () => slackAuthStatus())
  ]);
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    dryRun: config.dryRun,
    configured: {
      ghlToken: Boolean(config.ghl.token),
      ghlLocationId: Boolean(config.ghl.locationId),
      ghlCalendarId: Boolean(config.ghl.calendarId),
      openaiKey: Boolean(config.llm.apiKey),
      slackToken: Boolean(config.slack.token),
      slackChannel: config.slack.channel,
      slackBotErrorsChannel: config.slack.botErrorsChannel,
      slackBookingChannel: config.slack.bookingChannel,
      slackSendInDryRun: config.slack.sendInDryRun,
      llmFallbackEnabled: config.llm.fallbackEnabled
    },
    checks: {
      ghl,
      openaiBatch,
      slack
    }
  };
}

async function autoApplyCompletedBatch() {
  const status = await runPythonJson("llm_batch_examples.py", ["status"]);
  const batch = status.batch;
  if (!batch || batch.status !== "completed" || batch.id === lastAutoAppliedBatchId) return;
  const result = await applyBatchAndRefreshReports();
  if (result.ok || result.apply?.alreadyApplied) {
    lastAutoAppliedBatchId = batch.id;
  }
}

async function runDueJobs() {
  const jobs = await store.dueJobs();
  const results = [];
  for (const job of jobs) {
    const claimedJob = store.claimJob ? await store.claimJob(job.id) : job;
    if (!claimedJob) {
      results.push({ id: job.id, type: job.type, ok: true, skipped: true, reason: "job already claimed" });
      continue;
    }
    try {
      await bot.runDueJob(claimedJob);
      results.push({ id: claimedJob.id, type: claimedJob.type, ok: true });
    } catch (error) {
      if (isPermanentSmsBlock(error)) {
        await store.updateJob(claimedJob.id, {
          status: "skipped",
          finishedAt: new Date().toISOString(),
          error: error.message,
          skipReason: "permanent_sms_block"
        });
        results.push({ id: claimedJob.id, type: claimedJob.type, ok: false, skipped: true, error: error.message });
        continue;
      }
      const attempts = Number(claimedJob.attempts || 0) + 1;
      const retryDelay = JOB_RETRY_MINUTES[attempts - 1];
      if (retryDelay) {
        await store.updateJob(claimedJob.id, {
          status: "pending",
          attempts,
          runAt: new Date(Date.now() + retryDelay * 60 * 1000).toISOString(),
          lastError: error.message
        });
      } else {
        await store.updateJob(claimedJob.id, {
          status: "failed",
          attempts,
          finishedAt: new Date().toISOString(),
          error: error.message
        });
      }
      await notifyBotError("Scheduled job failed", {
        "Job ID": claimedJob.id,
        Type: claimedJob.type,
        "Contact ID": claimedJob.contactId,
        Attempt: String(attempts),
        Retry: retryDelay ? `${retryDelay} minutes` : "no retries left",
        Error: error.message
      });
      results.push({ id: claimedJob.id, type: claimedJob.type, ok: false, retryInMinutes: retryDelay || 0, error: error.message });
    }
  }
  const healed = bot.healStuckContacts ? await bot.healStuckContacts() : [];
  for (const item of healed) {
    results.push({ ok: true, type: "stuck_state_heal", ...item });
  }
  return results;
}

async function advancePendingJobs(steps = 1) {
  const results = [];
  for (let index = 0; index < steps; index += 1) {
    const pending = (await store.listJobs())
      .filter((job) => job.status === "pending")
      .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
    if (!pending.length) break;
    const nextJob = pending[0];
    await store.updateJob(nextJob.id, { runAt: new Date().toISOString() });
    results.push(...(await runDueJobs()));
  }
  return results;
}

async function releaseBackfillInitialJobs(limit = 250) {
  const now = new Date().toISOString();
  const pending = (await store.listJobs())
    .filter((job) => job.status === "pending")
    .filter((job) => job.type === "initial_sms")
    .filter((job) => (job.payload?.source || "") === "backfill")
    .sort((a, b) => new Date(a.runAt || 0) - new Date(b.runAt || 0))
    .slice(0, Math.max(1, Math.min(Number(limit || 250), BACKFILL_MAX_BATCH)));

  for (const job of pending) {
    await store.updateJob(job.id, { runAt: now, releasedAt: now });
  }

  return {
    releasedCount: pending.length,
    releasedJobIds: pending.map((job) => job.id),
    results: pending.length ? await runDueJobs() : []
  };
}

async function backfillInitialJobStatus() {
  const jobs = (await store.listJobs())
    .filter((job) => job.type === "initial_sms")
    .filter((job) => (job.payload?.source || "") === "backfill")
    .sort((a, b) => new Date(a.runAt || 0) - new Date(b.runAt || 0));
  const pending = jobs.filter((job) => job.status === "pending");
  const sentOrDone = jobs.filter((job) => ["done", "completed", "sent"].includes(job.status));
  const cancelled = jobs.filter((job) => job.status === "cancelled");
  const failed = jobs.filter((job) => job.status === "failed");
  const skipped = jobs.filter((job) => job.status === "skipped");
  return {
    total: jobs.length,
    pendingCount: pending.length,
    sentOrDoneCount: sentOrDone.length,
    cancelledCount: cancelled.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    nextPending: pending.slice(0, 20).map((job) => ({
      id: job.id,
      contactId: job.contactId,
      runAt: job.runAt,
      status: job.status
    }))
  };
}

async function cancelPendingBackfillInitialJobs() {
  const pending = (await store.listJobs())
    .filter((job) => job.status === "pending")
    .filter((job) => job.type === "initial_sms")
    .filter((job) => (job.payload?.source || "") === "backfill");
  const now = new Date().toISOString();
  for (const job of pending) {
    await store.updateJob(job.id, {
      status: "cancelled",
      cancelReason: "admin cancelled pending NR backfill",
      finishedAt: now
    });
  }
  return {
    cancelledCount: pending.length,
    cancelledJobIds: pending.map((job) => job.id)
  };
}

async function rescheduleColdPmJobs() {
  const now = new Date();
  const jobs = (await store.listJobs())
    .filter((job) => job.status === "pending")
    .filter((job) => job.type === "send_cold_template")
    .filter((job) => job.payload?.slot === "pm");
  const updated = [];
  const skipped = [];
  for (const job of jobs) {
    const contact = await store.getContact(job.contactId);
    if (!contact) {
      skipped.push({ jobId: job.id, reason: "contact not found" });
      continue;
    }
    const day = Math.max(1, Number(job.payload?.day || 1));
    const runAt = localSlotDate(contact, config, day - 1, "pm");
    if (runAt <= now) {
      skipped.push({ jobId: job.id, contactId: job.contactId, reason: "new runAt is already past", runAt: runAt.toISOString() });
      continue;
    }
    await store.updateJob(job.id, { runAt: runAt.toISOString(), rescheduledReason: "pm_slot_6pm_local" });
    updated.push({ jobId: job.id, contactId: job.contactId, runAt: runAt.toISOString() });
  }
  return { updatedCount: updated.length, skippedCount: skipped.length, updated: updated.slice(0, 25), skipped: skipped.slice(0, 25) };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      const storage = store ? await store.health() : { ok: false, type: "not_initialized" };
      send(res, storage.ok ? 200 : 503, {
        ok: storage.ok,
        time: new Date().toISOString(),
        storage,
        dryRun: config.dryRun,
        llmFallbackEnabled: config.llm.fallbackEnabled
      });
      return;
    }

    if (req.method === "GET" && (req.url === "/" || req.url === "/tester")) {
      sendFile(res, path.join(publicDir, "tester.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/review") {
      sendFile(res, path.join(publicDir, "review.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/training-status") {
      sendFile(res, path.join(publicDir, "training-status.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/integrations") {
      sendFile(res, path.join(publicDir, "integrations.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/backfill") {
      sendFile(res, path.join(publicDir, "backfill.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && (req.url === "/dashboard-legacy" || req.url.startsWith("/dashboard-legacy/"))) {
      sendFile(res, path.join(publicDir, "dashboard.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/dashboard-app/")) {
      sendDashboardAsset(req, res);
      return;
    }

    if (req.method === "GET" && (req.url === "/dashboard" || req.url.startsWith("/dashboard/"))) {
      sendDashboardSpa(res);
      return;
    }

    if (req.method === "GET" && (req.url === "/tester.css" || req.url === "/review.css")) {
      sendFile(res, path.join(publicDir, "tester.css"), "text/css; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/training-status.css") {
      sendFile(res, path.join(publicDir, "training-status.css"), "text/css; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/integrations.css") {
      sendFile(res, path.join(publicDir, "integrations.css"), "text/css; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/backfill.css") {
      sendFile(res, path.join(publicDir, "backfill.css"), "text/css; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/dashboard.css") {
      sendFile(res, path.join(publicDir, "dashboard.css"), "text/css; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/reports/training_report.md") {
      sendFile(res, path.join(reportDir, "training_report.md"), "text/markdown; charset=utf-8");
      return;
    }

    if (req.method === "GET" && req.url === "/reports/rule_candidates.json") {
      sendFile(res, path.join(reportDir, "rule_candidates.json"), "application/json; charset=utf-8");
      return;
    }

    if (req.method === "POST" && req.url === "/webhooks/ghl/ping") {
      const payload = await readJson(req);
      const auth = requireWebhookSecret(req, payload);
      const diagnostic = {
        receivedAt: new Date().toISOString(),
        authorized: auth.ok,
        error: auth.ok ? "" : auth.reason,
        dryRun: config.dryRun,
        payloadKeys: Object.keys(payload || {}).sort(),
        hasContactId: Boolean(payload.contactId || payload.contact_id || payload["Contact ID"] || payload.contact?.id),
        hasDisposition: Boolean(webhookField(payload, ["disposition", "customDisposition"])),
        hasMessage: Boolean(webhookField(payload, ["message", "body", "text", "messageBody", "message_body", "message.body"]))
      };
      if (store?.setSetting) await store.setSetting("last_webhook_ping", diagnostic);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason, received: true });
        return;
      }
      send(res, 200, { ok: true, received: true, ...diagnostic });
      return;
    }

    if (req.method === "GET" && req.url === "/webhooks/ghl/ping-status") {
      const setting = store?.getSetting ? await store.getSetting("last_webhook_ping") : null;
      send(res, 200, {
        ok: true,
        lastPing: setting?.value || null
      });
      return;
    }

    if (req.method === "POST" && ["/webhooks/ghl/disposition", "/webhooks/ghl/tag", "/webhooks/ghl/nr-tag"].includes(req.url)) {
      const payload = await readJson(req);
      const auth = requireWebhookSecret(req, payload);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const dedupe = await dedupeWebhook(req, payload, "disposition");
      if (dedupe.duplicate) {
        send(res, 200, { ok: true, duplicate: true, eventId: dedupe.id });
        return;
      }
      if (!isNoResponseSignal(payload)) {
        send(res, 202, { ok: true, ignored: true, reason: "payload did not include no response disposition or NR tag" });
        return;
      }
      const contact = await bot.startFromNoResponseDisposition(payload);
      send(res, 200, { ok: true, contact });
      return;
    }

    if (req.method === "POST" && req.url === "/webhooks/ghl/inbound-sms") {
      const payload = await readJson(req);
      const auth = requireWebhookSecret(req, payload);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const dedupe = await dedupeWebhook(req, payload, "inbound");
      if (dedupe.duplicate) {
        send(res, 200, { ok: true, duplicate: true, eventId: dedupe.id });
        return;
      }
      const contact = await bot.queueInboundSms(payload);
      send(res, 200, { ok: true, contact });
      return;
    }

    if (req.method === "POST" && req.url === "/webhooks/ghl/missed-call") {
      const payload = await readJson(req);
      const auth = requireWebhookSecret(req, payload);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const dedupe = await dedupeWebhook(req, payload, "missed-call");
      if (dedupe.duplicate) {
        send(res, 200, { ok: true, duplicate: true, eventId: dedupe.id });
        return;
      }
      const contact = await bot.markMissedCall(payload);
      send(res, 200, { ok: true, contact });
      return;
    }

    if (req.method === "POST" && ["/webhooks/ghl/no-show", "/webhooks/ghl/appointment-no-show"].includes(req.url)) {
      const payload = await readJson(req);
      const auth = requireWebhookSecret(req, payload);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      await bot.recordNoShowWebhook(payload, { result: "route_received" });
      const dedupe = await dedupeWebhook(req, payload, "appointment-no-show");
      if (dedupe.duplicate) {
        await bot.recordNoShowWebhook(payload, { result: "duplicate_ignored" });
        send(res, 200, { ok: true, duplicate: true, eventId: dedupe.id });
        return;
      }
      const contact = await bot.markNoShow(payload);
      send(res, 200, { ok: true, contact });
      return;
    }

    if (
      req.method === "POST" &&
      [
        "/webhooks/ghl/appointment",
        "/webhooks/ghl/appointment-sync",
        "/webhooks/ghl/appointment-created",
        "/webhooks/ghl/appointment-updated",
        "/webhooks/ghl/calendar-appointment"
      ].includes(req.url)
    ) {
      const payload = await readJson(req);
      const auth = requireWebhookSecret(req, payload);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const dedupe = await dedupeWebhook(req, payload, "appointment-sync");
      if (dedupe.duplicate) {
        send(res, 200, { ok: true, duplicate: true, eventId: dedupe.id });
        return;
      }
      const contact = await bot.syncAppointment(payload);
      if (!contact) {
        send(res, 202, { ok: true, ignored: true, reason: "appointment sync missing contact id or start time" });
        return;
      }
      send(res, 200, { ok: true, contact });
      return;
    }

    if (req.method === "POST" && req.url === "/webhooks/ghl/bot-control") {
      const payload = await readJson(req);
      const auth = requireWebhookSecret(req, payload);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const dedupe = await dedupeWebhook(req, payload, "bot-control");
      if (dedupe.duplicate) {
        send(res, 200, { ok: true, duplicate: true, eventId: dedupe.id });
        return;
      }
      const contact = await bot.applyBotControl({
        ...payload,
        ...requestControlMeta(req, payload, "ghl_bot_control_webhook")
      });
      send(res, contact ? 200 : 404, { ok: Boolean(contact), contact });
      return;
    }

    if (req.method === "POST" && req.url === "/webhooks/ghl/human-outbound") {
      const payload = await readJson(req);
      const auth = requireWebhookSecret(req, payload);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const dedupe = await dedupeWebhook(req, payload, "human-outbound");
      if (dedupe.duplicate) {
        send(res, 200, { ok: true, duplicate: true, eventId: dedupe.id });
        return;
      }
      const contact = await bot.handleHumanOutbound(payload);
      send(res, contact ? 200 : 404, { ok: Boolean(contact), contact });
      return;
    }

    if (req.method === "POST" && req.url === "/webhooks/ghl/human-active") {
      const payload = await readJson(req);
      const auth = requireWebhookSecret(req, payload);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const dedupe = await dedupeWebhook(req, payload, "human-active");
      if (dedupe.duplicate) {
        send(res, 200, { ok: true, duplicate: true, eventId: dedupe.id });
        return;
      }
      const contact = await bot.applyBotControl({
        ...payload,
        action: payload.action || "call_started",
        ...requestControlMeta(req, payload, "ghl_human_active_webhook")
      });
      send(res, contact ? 200 : 404, { ok: Boolean(contact), contact });
      return;
    }

    if (req.method === "POST" && req.url === "/jobs/tick") {
      send(res, 200, { ok: true, results: await runDueJobs() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/jobs/release-backfill") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const payload = await readJson(req);
      send(res, 200, { ok: true, ...(await releaseBackfillInitialJobs(payload.limit || 250)) });
      return;
    }

    if (req.method === "GET" && req.url === "/api/admin/jobs/backfill-status") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      send(res, 200, { ok: true, ...(await backfillInitialJobStatus()) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/jobs/cancel-backfill") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      send(res, 200, { ok: true, ...(await cancelPendingBackfillInitialJobs()) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/jobs/reschedule-cold-pm") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      send(res, 200, { ok: true, ...(await rescheduleColdPmJobs()) });
      return;
    }

    if (req.url.startsWith("/api/contacts")) {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && parts.length === 2) {
        send(res, 200, await dashboardContactsList(url));
        return;
      }

      const contactId = parts[2] ? decodeURIComponent(parts[2]) : "";
      const section = parts[3] || "";
      if (!contactId) {
        send(res, 404, { ok: false, error: "contact not found" });
        return;
      }

      if (req.method === "GET" && parts.length === 3) {
        const detail = await dashboardContactDetail(contactId);
        send(res, detail ? 200 : 404, detail || { ok: false, error: "contact not found" });
        return;
      }

      if (req.method === "GET" && section === "messages") {
        const contact = await store.getContact(contactId);
        if (!contact) {
          send(res, 404, { ok: false, error: "contact not found" });
          return;
        }
        send(res, 200, { ok: true, contactId, messages: await store.listMessages(contactId) });
        return;
      }

      if (req.method === "GET" && section === "timeline") {
        const detail = await dashboardContactDetail(contactId);
        send(res, detail ? 200 : 404, detail ? { ok: true, contactId, timeline: detail.timeline } : { ok: false, error: "contact not found" });
        return;
      }

      if (req.method === "GET" && section === "qualification") {
        const contact = await store.getContact(contactId);
        send(res, contact ? 200 : 404, contact ? { ok: true, ...contactQualification(contact) } : { ok: false, error: "contact not found" });
        return;
      }

      if (req.method === "POST" && ["ack", "return-to-bot", "pause-bot"].includes(section)) {
        const action = {
          ack: "human_acknowledged",
          "return-to-bot": "return_to_bot",
          "pause-bot": "pause_bot"
        }[section];
        const contact = await bot.applyBotControl({
          contactId,
          action,
          ...requestControlMeta(req, {}, "dashboard_contact_shortcut")
        });
        if (!contact) {
          send(res, 404, { ok: false, error: "contact not found" });
          return;
        }
        send(res, 200, await dashboardContactDetail(contact.id));
        return;
      }

      if (req.method === "POST" && section === "note") {
        const payload = await readJson(req);
        const body = String(payload.body || payload.note || "").trim();
        if (!body) {
          send(res, 400, { ok: false, error: "note body is required" });
          return;
        }
        const contact = await store.getContact(contactId);
        if (!contact) {
          send(res, 404, { ok: false, error: "contact not found" });
          return;
        }
        const notes = [...(contact.adminNotes || []), { note: body, body, createdAt: new Date().toISOString() }];
        const updated = await store.upsertContact({ ...contact, adminNotes: notes });
        send(res, 200, await dashboardContactDetail(updated.id));
        return;
      }

      send(res, 404, { ok: false, error: "not found" });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/test/state")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const contactId = url.searchParams.get("contactId");
      send(res, 200, {
        ok: true,
        dryRun: config.dryRun,
        llmFallbackEnabled: config.llm.fallbackEnabled,
        contact: contactId ? await store.getContact(contactId) : null,
        jobs: await store.listJobs(contactId || ""),
        messages: await store.listMessages(contactId || ""),
        escalations: await store.listEscalations(contactId || "")
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/test/reset") {
      await store.reset();
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && req.url === "/api/backfill/preview") {
      const payload = await readJson(req);
      const tag = payload.tag || "NR";
      const candidates = await loadBackfillCandidates(payload);
      const summary = summarizeBackfillCandidates(candidates, tag);
      send(res, 200, {
        ok: true,
        dryRun: config.dryRun,
        tag,
        totalSeen: summary.totalSeen,
        unique: summary.unique,
        eligibleCount: summary.eligible.length,
        skippedCount: summary.skipped.length,
        eligible: summary.eligible.slice(0, 25),
        skipped: summary.skipped.slice(0, 25)
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/backfill/start") {
      const payload = await readJson(req);
      const tag = payload.tag || "NR";
      const maxContacts = Math.max(1, Math.min(Number(payload.maxContacts || 25), BACKFILL_MAX_BATCH));
      const spacingMinutes = Math.max(
        0,
        Math.min(
          payload.spacingMinutes === undefined ? BACKFILL_DEFAULT_SPACING_MINUTES : Number(payload.spacingMinutes),
          60
        )
      );
      const startOffsetMinutes = Math.max(0, Math.min(Number(payload.startOffsetMinutes || 0), 24 * 60));
      const previewOnly = Boolean(payload.previewOnly);
      const candidates = await loadBackfillCandidates({ ...payload, limit: Math.max(Number(payload.limit || maxContacts), maxContacts) });
      const summary = summarizeBackfillCandidates(candidates, tag);
      const selected = summary.eligible.slice(0, maxContacts);
      const queued = [];
      const failed = [];
      if (!previewOnly) {
        for (const [index, contact] of selected.entries()) {
          try {
            const runAt = nextBackfillRunAt(contact, index, spacingMinutes, startOffsetMinutes);
            queued.push(await bot.queueNoResponseBackfill({ ...contact, disposition: "NR" }, runAt));
          } catch (error) {
            failed.push({ contact, error: error.message });
          }
        }
      }
      send(res, 200, {
        ok: true,
        previewOnly,
        dryRun: config.dryRun,
        tag,
        spacingMinutes,
        startOffsetMinutes,
        selectedCount: selected.length,
        queuedCount: queued.filter((item) => item.status === "queued").length,
        skippedDuringQueueCount: queued.filter((item) => item.status === "skipped").length,
        failedCount: failed.length,
        queued,
        failed,
        skipped: summary.skipped.slice(0, 25)
      });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/admin/dashboard")) {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      send(res, 200, await dashboardMetrics());
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/admin/scanner")) {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const data = await contactDataSets();
      const summaries = data.contacts.map((contact) =>
        summarizeContact(contact, data.jobsByContact, data.messagesByContact, data.escalationsByContact, data.decisionLogsByContact)
      );
      send(res, 200, { ok: true, scanner: scannerOutput(summaries, data.jobs), contacts: summaries.filter((item) => item.issueFlags?.length) });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/admin/audit")) {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      send(res, 200, await dashboardAudit(url));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/admin/contact")) {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const url = new URL(req.url, `http://${req.headers.host}`);
      const contactId = url.searchParams.get("contactId") || "";
      const detail = contactId ? await dashboardContactDetail(contactId) : null;
      send(res, detail ? 200 : 404, detail || { ok: false, error: "contact not found" });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/contact/action") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const payload = await readJson(req);
      const contact = await bot.applyBotControl({
        ...payload,
        contactId: payload.contactId,
        action: payload.action,
        ...requestControlMeta(req, payload, "admin_contact_action")
      });
      if (!contact) {
        send(res, 404, { ok: false, error: "contact not found" });
        return;
      }
      send(res, 200, await dashboardContactDetail(contact.id));
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/contact/note") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const payload = await readJson(req);
      const contact = await store.getContact(payload.contactId);
      if (!contact) {
        send(res, 404, { ok: false, error: "contact not found" });
        return;
      }
      const notes = [...(contact.adminNotes || []), {
        note: String(payload.note || "").trim(),
        createdAt: new Date().toISOString()
      }].filter((item) => item.note);
      const updated = await store.upsertContact({ ...contact, adminNotes: notes });
      send(res, 200, await dashboardContactDetail(updated.id));
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/contact/bulk-action") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const payload = await readJson(req);
      const contactIds = Array.isArray(payload.contactIds) ? payload.contactIds.slice(0, 100) : [];
      const results = [];
      for (const contactId of contactIds) {
        const contact = await bot.applyBotControl({
          ...payload,
          contactId,
          action: payload.action,
          ...requestControlMeta(req, payload, "admin_bulk_contact_action")
        });
        results.push({ contactId, ok: Boolean(contact), status: contact?.engagementStatus || "" });
      }
      send(res, 200, { ok: true, results });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/admin/templates")) {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      send(res, 200, { ok: true, groups: editableTemplates() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/templates/save") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const payload = await readJson(req);
      const overrides = await saveTemplateOverrides(store, payload.overrides || {});
      send(res, 200, { ok: true, overrides, groups: editableTemplates() });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/templates/reset") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      await resetTemplateOverrides(store);
      send(res, 200, { ok: true, groups: editableTemplates() });
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/admin/ab-tests")) {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const [experiments, messages] = await Promise.all([loadTemplateExperiments(store), store.listMessages()]);
      const templates = editableTemplates();
      send(res, 200, {
        ok: true,
        experiments: abTestingPerformance(messages, experiments),
        templates,
        templatePerformance: templatePerformance(messages, templates)
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/ab-tests/save") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const payload = await readJson(req);
      const experiments = await saveTemplateExperiments(store, payload.experiments || []);
      const messages = await store.listMessages();
      const templates = editableTemplates();
      send(res, 200, {
        ok: true,
        experiments: abTestingPerformance(messages, experiments),
        templates,
        templatePerformance: templatePerformance(messages, templates)
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/admin/ab-tests/push-live") {
      const auth = requireAdmin(req);
      if (!auth.ok) {
        send(res, 401, { ok: false, error: auth.reason });
        return;
      }
      const payload = await readJson(req);
      const experiments = await loadTemplateExperiments(store);
      const experiment = experiments.find((item) => item.id === payload.experimentId);
      const variant = experiment?.variants?.find((item) => item.id === payload.variantId);
      if (!experiment || !variant) {
        send(res, 404, { ok: false, error: "experiment or variant not found" });
        return;
      }
      const current = store.getSetting ? await store.getSetting("template_overrides") : null;
      const overrides = current?.value || {};
      overrides[experiment.group] = overrides[experiment.group] || {};
      overrides[experiment.group][experiment.key] = variant.body;
      await saveTemplateOverrides(store, overrides);
      const updatedExperiments = experiments.map((item) =>
        item.id === experiment.id ? { ...item, status: "winner", winnerVariantId: variant.id } : item
      );
      await saveTemplateExperiments(store, updatedExperiments);
      const messages = await store.listMessages();
      const templates = editableTemplates();
      send(res, 200, {
        ok: true,
        pushed: { group: experiment.group, key: experiment.key, variantId: variant.id },
        experiments: abTestingPerformance(messages, updatedExperiments),
        templates,
        templatePerformance: templatePerformance(messages, templates)
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/test/llm-fallback") {
      const payload = await readJson(req);
      config.llm.fallbackEnabled = Boolean(payload.enabled);
      send(res, 200, { ok: true, enabled: config.llm.fallbackEnabled });
      return;
    }

    if (req.method === "POST" && req.url === "/api/test/seed-no-response") {
      const payload = await readJson(req);
      const contact = await bot.startFromNoResponseDisposition({
        contactId: payload.contactId || "test-contact",
        name: payload.name || "Test Lead",
        phone: payload.phone || "+15550001111",
        timezone: payload.timezone || config.texting.defaultTimezone,
        leadSource: payload.leadSource || "tester",
        disposition: "no response"
      });
      send(res, 200, { ok: true, contact });
      return;
    }

    if (req.method === "POST" && req.url === "/api/test/seed-scheduled-call") {
      const payload = await readJson(req);
      const startsAt = payload.startsAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const contact = await store.upsertContact({
        contactId: payload.contactId || "test-contact",
        id: payload.contactId || "test-contact",
        ghlContactId: payload.contactId || "test-contact",
        name: payload.name || "Test Lead",
        phone: payload.phone || "+15550001111",
        timezone: payload.timezone || config.texting.defaultTimezone,
        leadSource: payload.leadSource || "tester",
        engagementStatus: "call_scheduled",
        qualificationProgress: "call_booked",
        preferredCallTime: formatForContact(
          new Date(startsAt),
          { timezone: payload.timezone || config.texting.defaultTimezone },
          config
        ),
        preferredCallTimeIso: startsAt,
        appointmentId: payload.appointmentId || "test-appointment"
      });
      await store.cancelJobsForContact(contact.id, "tester scheduled call reset");
      await bot.scheduleAppointmentReminders(contact);
      await store.addMessage({
        contactId: contact.id,
        direction: "outbound",
        body: `Tester scheduled call at ${contact.preferredCallTime}`
      });
      send(res, 200, { ok: true, contact });
      return;
    }

    if (req.method === "POST" && req.url === "/api/test/missed-call") {
      const payload = await readJson(req);
      const contact = await bot.markMissedCall({
        contactId: payload.contactId || "test-contact",
        name: payload.name || "Test Lead",
        phone: payload.phone || "+15550001111",
        timezone: payload.timezone || config.texting.defaultTimezone,
        leadSource: payload.leadSource || "tester",
        preferredCallTime: payload.preferredCallTime,
        preferredCallTimeIso: payload.preferredCallTimeIso
      });
      send(res, 200, { ok: true, contact });
      return;
    }

    if (req.method === "POST" && req.url === "/api/test/bot-control") {
      const payload = await readJson(req);
      const contact = await bot.applyBotControl({
        contactId: payload.contactId || "test-contact",
        action: payload.action,
        name: payload.name,
        phone: payload.phone,
        timezone: payload.timezone,
        leadSource: payload.leadSource,
        ...requestControlMeta(req, payload, "local_tester")
      });
      send(res, contact ? 200 : 404, { ok: Boolean(contact), contact });
      return;
    }

    if (req.method === "POST" && req.url === "/api/test/reply") {
      const payload = await readJson(req);
      const contact = await bot.handleInboundSms({
        contactId: payload.contactId || "test-contact",
        message: payload.message || "",
        name: payload.name,
        phone: payload.phone,
        timezone: payload.timezone,
        leadSource: payload.leadSource
      });
      send(res, 200, { ok: true, contact });
      return;
    }

    if (req.method === "POST" && req.url === "/api/test/advance") {
      const payload = await readJson(req);
      const steps = Math.max(1, Math.min(Number(payload.steps || 1), 25));
      send(res, 200, { ok: true, results: await advancePendingJobs(steps) });
      return;
    }

    if (req.method === "POST" && req.url === "/api/training/init") {
      send(res, 200, await runTrainingDb(["init"]));
      return;
    }

    if (req.method === "POST" && req.url === "/api/training/import") {
      const payload = await readJson(req);
      const maxPages = String(Math.max(1, Math.min(Number(payload.maxPages || 1), 500)));
      const pageSize = String(Math.max(10, Math.min(Number(payload.pageSize || 100), 500)));
      send(res, 200, await runTrainingDb(["import", "--max-pages", maxPages, "--page-size", pageSize]));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/training/summary")) {
      send(res, 200, await runTrainingDb(["summary"]));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/training/status")) {
      send(res, 200, await trainingStatus());
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/integrations/status")) {
      send(res, 200, await integrationStatus());
      return;
    }

    if (req.method === "POST" && req.url === "/api/training/apply-batch") {
      send(res, 200, await applyBatchAndRefreshReports());
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/training/examples")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = url.searchParams.get("limit") || "25";
      const offset = url.searchParams.get("offset") || "0";
      const mode = url.searchParams.get("mode") || "unlabeled";
      send(res, 200, await runTrainingDb(["examples", "--limit", limit, "--offset", offset, "--mode", mode]));
      return;
    }

    if (req.method === "POST" && req.url === "/api/training/label") {
      const payload = await readJson(req);
      send(res, 200, await runTrainingDb([
        "label",
        "--id",
        String(payload.id),
        "--label",
        String(payload.label || ""),
        "--notes",
        String(payload.notes || "")
      ]));
      return;
    }

    if (req.method === "GET" && req.url.startsWith("/api/training/phrases")) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = url.searchParams.get("limit") || "100";
      send(res, 200, await runTrainingDb(["phrases", "--limit", limit]));
      return;
    }

    send(res, 404, { ok: false, error: "not found" });
  } catch (error) {
    if (isPermanentSmsBlock(error)) {
      send(res, 202, { ok: true, skipped: true, reason: "permanent_sms_block", error: error.message });
      return;
    }
    if (req.method !== "GET" || !["/health", "/tester.css", "/training-status.css", "/integrations.css", "/backfill.css", "/dashboard.css"].includes(req.url)) {
      await notifyBotError("HTTP request failed", {
        Method: req.method,
        Path: req.url,
        Error: error.message
      });
    }
    send(res, 500, { ok: false, error: error.message });
  }
});

async function initApp() {
  if (store && bot) return { store, bot };
  store = await createStore(config);
  await loadTemplateOverrides(store);
  bot = new SmsBot(store, config);
  return { store, bot };
}

if (require.main === module) {
  initApp().then(() => {
    server.listen(config.port, config.host, () => {
      console.log(`Accident Support Desk SMS bot listening on http://${config.host}:${config.port}`);
    });
    setInterval(() => {
      runDueJobs().catch(async (error) => {
        console.error("job tick failed", error);
        await notifyBotError("Job tick failed", { Error: error.message });
      });
    }, 60_000);
    if (String(process.env.AUTO_APPLY_LLM_BATCH || "false").toLowerCase() === "true") {
      const batchPollMs = Number(process.env.BATCH_POLL_INTERVAL_MS || 30 * 60 * 1000);
      setInterval(() => {
        autoApplyCompletedBatch().catch(async (error) => {
          console.error("batch auto-apply failed", error);
          await notifyBotError("Batch auto-apply failed", { Error: error.message });
        });
      }, batchPollMs);
      autoApplyCompletedBatch().catch(async (error) => {
        console.error("batch auto-apply failed", error);
        await notifyBotError("Batch auto-apply failed", { Error: error.message });
      });
    }
  }).catch((error) => {
    console.error("failed to initialize app", error);
    process.exit(1);
  });
}

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error("unhandled rejection", error);
  notifyBotError("Unhandled promise rejection", { Error: error.message }).catch(() => {});
});

process.on("uncaughtException", (error) => {
  console.error("uncaught exception", error);
  notifyBotError("Uncaught exception", { Error: error.message }).finally(() => {
    process.exit(1);
  });
});

module.exports = {
  server,
  runDueJobs,
  initApp,
  notifyBotError,
  requireWebhookSecret,
  isPermanentSmsBlock,
  contactIssueFlags,
  safeText,
  leadSourceInfo,
  scannerOutput
};
