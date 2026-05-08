const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store } = require("../src/store");
const { SmsBot, normalizePayload, callAskTemplateForTime } = require("../src/flow");
const { ENGAGEMENT, QUALIFICATION } = require("../src/constants");
const { hasNoResponseTag, isNoResponseDisposition, isNoResponseSignal } = require("../src/disposition");
const { render } = require("../src/templates");
const { getLocalParts, localDateToUtc } = require("../src/time");
const ghl = require("../src/adapters/ghl");
const slack = require("../src/adapters/slack");

function testConfig(dataFile) {
  return {
    dataFile,
    publicBaseUrl: "https://app.gohighlevel.com",
    ghl: { apiBase: "https://services.leadconnectorhq.com", token: "", locationId: "", calendarId: "" },
    slack: { token: "", channel: "#sms-esiliation", botErrorsChannel: "#bot-errors", bookingChannel: "#booking" },
    texting: {
      defaultTimezone: "America/Chicago",
      defaultStart: "00:00",
      defaultEnd: "23:59",
      stateWindows: {}
    }
  };
}

function makeBot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asdleads-test-"));
  const dataFile = path.join(dir, "store.json");
  const store = new Store(dataFile);
  const bot = new SmsBot(store, testConfig(dataFile));
  return { bot, store };
}

test("opt-out marks contact, cancels jobs, and sends one confirmation", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "c1",
    ghlContactId: "c1",
    name: "Jane",
    phone: "+15550000000",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });
  store.addJob({ type: "send_cold_template", contactId: "c1", runAt: new Date().toISOString(), payload: {} });

  const contact = await bot.handleInboundSms({ contactId: "c1", message: "don't text me" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.OPTED_OUT);
  assert.equal(contact.optOutStatus, true);
  assert.equal(Object.values(store.data.jobs).every((job) => job.status === "cancelled"), true);
  assert.match(store.getContact("c1").lastOutboundMessage, /won't text you again/i);
});

test("GHL unsubscribe block during opt-out confirmation is not treated as a bot error", async () => {
  const { bot, store } = makeBot();
  const originalSendSms = ghl.sendSms;
  ghl.sendSms = async () => {
    throw new Error('GHL /conversations/messages failed: 400 {"message":"Cannot send message as +15550000000 has unsubscribed"}');
  };
  try {
    store.upsertContact({
      id: "stop-block",
      ghlContactId: "stop-block",
      name: "Stop Block",
      phone: "+15550000000",
      engagementStatus: ENGAGEMENT.COLD_OUTREACH,
      qualificationProgress: QUALIFICATION.NEEDS_FAULT
    });

    const contact = await bot.handleInboundSms({ contactId: "stop-block", message: "STOP" });

    assert.equal(contact.engagementStatus, ENGAGEMENT.OPTED_OUT);
    assert.equal(store.getContact("stop-block").lastSmsBlockedReason.includes("unsubscribed"), true);
  } finally {
    ghl.sendSms = originalSendSms;
  }
});

test("template name personalization uses first name only", () => {
  assert.equal(render("Hi [NAME]", { name: "eric johnson" }), "Hi Eric");
  assert.equal(render("Hi [NAME]", { firstName: "SARAH", name: "Sarah Johnson" }), "Hi Sarah");
});

test("GHL contact links point to GoHighLevel instead of the public bot URL", () => {
  const config = testConfig("");
  config.publicBaseUrl = "https://asdleads-sms-bot.onrender.com";
  config.ghl.locationId = "loc123";

  assert.equal(
    ghl.contactLink(config, { ghlContactId: "contact123" }),
    "https://app.gohighlevel.com/v2/location/loc123/contacts/detail/contact123"
  );
});

test("qualification resumes from saved progress instead of restarting", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "c2",
    ghlContactId: "c2",
    name: "Sam",
    phone: "+15550000001",
    engagementStatus: ENGAGEMENT.RE_ENGAGEMENT,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });

  const contact = await bot.handleInboundSms({ contactId: "c2", message: "yes I went to the hospital" });

  assert.equal(contact.faultAnswer, "not_at_fault");
  assert.equal(store.getContact("c2").qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.match(store.getContact("c2").lastOutboundMessage, /Specialist/i);
});

test("busy context does not count yes as a medical answer", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "busy-1",
    ghlContactId: "busy-1",
    name: "Busy Lead",
    phone: "+15550000051",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });

  const contact = await bot.handleInboundSms({ contactId: "busy-1", message: "I'm sorry yes I'm currently busy" });

  assert.equal(contact.medicalTreatmentAnswer, undefined);
  assert.equal(store.getContact("busy-1").qualificationProgress, QUALIFICATION.NEEDS_MEDICAL);
  assert.equal(store.getContact("busy-1").lastHumanContextIntent, "busy_now");
  assert.match(store.getContact("busy-1").lastOutboundMessage, /No worries/i);
  assert.match(store.getContact("busy-1").lastOutboundMessage, /medical treatment/i);
});

test("scheduled call confirmation does not restart qualification", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "c3",
    ghlContactId: "c3",
    name: "Taylor",
    phone: "+15550000002",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Thu, May 7, 3:00 PM CDT"
  });

  const contact = await bot.handleInboundSms({ contactId: "c3", message: "YES" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.equal(store.getContact("c3").qualificationProgress, QUALIFICATION.COMPLETE);
  assert.equal(store.getContact("c3").appointmentConfirmed, true);
});

test("scheduled call thank-you is treated as acknowledgement instead of escalation", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "thanks-booked",
    ghlContactId: "thanks-booked",
    name: "Leslie",
    phone: "+15550000064",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Thu, May 7, 3:00 PM CDT"
  });

  const contact = await bot.handleInboundSms({ contactId: "thanks-booked", message: "thank you" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.equal(store.getContact("thanks-booked").appointmentConfirmed, true);
  assert.equal(store.getContact("thanks-booked").humanEscalationStatus, undefined);
  assert.equal(store.data.escalations.length, 0);
});

test("backup time reply finalizes scheduled call instead of escalating", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "c3b",
    ghlContactId: "c3b",
    name: "Taylor",
    phone: "+15550000022",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Fri, May 8, 3:00 PM CDT",
    preferredCallTimeIso: "2026-05-08T20:00:00.000Z",
    appointmentId: "appt-1",
    awaitingBackupTime: true
  });

  const contact = await bot.handleInboundSms({ contactId: "c3b", message: "4pm works too" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.equal(store.getContact("c3b").humanEscalationStatus, undefined);
  assert.equal(store.getContact("c3b").awaitingBackupTime, false);
  assert.equal(store.getContact("c3b").qualificationProgress, QUALIFICATION.COMPLETE);
  assert.match(store.getContact("c3b").backupCallTime, /Fri, May 8, 4:00 PM/);
  assert.match(store.getContact("c3b").lastOutboundMessage, /backup/i);
});

test("backup time window is saved as a window instead of duplicating primary time", async () => {
  const { bot, store } = makeBot();
  const originalUpdateAppointment = ghl.updateAppointment;
  const noteUpdates = [];
  ghl.updateAppointment = async (_config, _contact, appointmentId, startsAt, endsAt, notes) => {
    noteUpdates.push({ appointmentId, startsAt, endsAt, notes });
    return { id: appointmentId };
  };
  store.upsertContact({
    id: "backup-window",
    ghlContactId: "backup-window",
    name: "Francisco",
    phone: "+15550000064",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Fri, May 8, 2:00 PM CDT",
    preferredCallTimeIso: "2026-05-08T19:00:00.000Z",
    appointmentId: "appt-window",
    awaitingBackupTime: true
  });

  try {
    const contact = await bot.handleInboundSms({ contactId: "backup-window", message: "2-4pm" });

    assert.equal(contact.awaitingBackupTime, false);
    assert.equal(store.getContact("backup-window").backupCallTime, "2-4 PM");
    assert.equal(store.getContact("backup-window").backupCallTimeType, "window");
    assert.match(store.getContact("backup-window").lastOutboundMessage, /2-4 PM as a backup/i);
    assert.equal(store.getContact("backup-window").backupCallTimeIso, "");
    assert.match(noteUpdates[0].notes, /Backup time: 2-4 PM/);
  } finally {
    ghl.updateAppointment = originalUpdateAppointment;
  }
});

test("backup time reply cancels backup timeout and schedules reminders", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "c3c",
    ghlContactId: "c3c",
    name: "Taylor",
    phone: "+15550000034",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Fri, May 8, 3:00 PM CDT",
    preferredCallTimeIso: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
    appointmentId: "appt-2",
    awaitingBackupTime: true
  });
  store.addJob({ type: "backup_time_timeout", contactId: "c3c", runAt: new Date().toISOString(), payload: {} });

  await bot.handleInboundSms({ contactId: "c3c", message: "4pm works too" });

  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "c3c" && job.type === "backup_time_timeout" && job.status === "pending"),
    false
  );
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "c3c" && job.type === "appointment_reminder" && job.status === "pending"),
    true
  );
});

test("backup timeout confirms appointment while acknowledging no backup response", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "backup-timeout-copy",
    ghlContactId: "backup-timeout-copy",
    name: "George",
    phone: "+15550000059",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Sat, May 9, 1:00 PM CDT",
    preferredCallTimeIso: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
    appointmentId: "appt-copy",
    awaitingBackupTime: true
  });
  const job = store.addJob({ type: "backup_time_timeout", contactId: "backup-timeout-copy", runAt: new Date().toISOString(), payload: {} });

  await bot.runDueJob(job);

  assert.equal(store.getContact("backup-timeout-copy").awaitingBackupTime, false);
  assert.match(store.getContact("backup-timeout-copy").lastOutboundMessage, /did not get a backup time/i);
  assert.match(store.getContact("backup-timeout-copy").lastOutboundMessage, /reschedule/i);
});

test("appointment reminders use cadence based on time until appointment", async () => {
  const { bot, store } = makeBot();
  const soon = new Date(Date.now() + 45 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "reminder-soon",
    ghlContactId: "reminder-soon",
    name: "Soon",
    phone: "+15550000061",
    timezone: "America/Chicago",
    preferredCallTimeIso: soon
  });
  await bot.scheduleAppointmentReminders(store.getContact("reminder-soon"));
  assert.deepEqual(
    Object.values(store.data.jobs)
      .filter((job) => job.contactId === "reminder-soon" && job.type === "appointment_reminder")
      .map((job) => job.payload.templateKey),
    ["sameDayFiveMinutes"]
  );

  const later = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "reminder-later",
    ghlContactId: "reminder-later",
    name: "Later",
    phone: "+15550000062",
    timezone: "America/Chicago",
    preferredCallTimeIso: later
  });
  await bot.scheduleAppointmentReminders(store.getContact("reminder-later"));
  assert.deepEqual(
    Object.values(store.data.jobs)
      .filter((job) => job.contactId === "reminder-later" && job.type === "appointment_reminder")
      .map((job) => job.payload.templateKey),
    ["sameDayOneHour", "sameDayFiveMinutes"]
  );

  const localNow = getLocalParts(new Date(), "America/Chicago");
  const tomorrow = localDateToUtc(
    { year: localNow.year, month: localNow.month, day: localNow.day + 1, hour: 15, minute: 0 },
    "America/Chicago"
  ).toISOString();
  store.upsertContact({
    id: "reminder-tomorrow",
    ghlContactId: "reminder-tomorrow",
    name: "Tomorrow",
    phone: "+15550000063",
    timezone: "America/Chicago",
    preferredCallTimeIso: tomorrow
  });
  await bot.scheduleAppointmentReminders(store.getContact("reminder-tomorrow"));
  assert.deepEqual(
    Object.values(store.data.jobs)
      .filter((job) => job.contactId === "reminder-tomorrow" && job.type === "appointment_reminder")
      .map((job) => job.payload.templateKey),
    ["nextDayMorning", "nextDayOneHour", "nextDayFiveMinutes"]
  );
});

test("scheduled call can be rescheduled and old reminders are replaced", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "reschedule-1",
    ghlContactId: "reschedule-1",
    name: "Reschedule",
    phone: "+15550000035",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "old time",
    preferredCallTimeIso: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
    appointmentId: "appt-reschedule"
  });
  await bot.scheduleAppointmentReminders(store.getContact("reschedule-1"));
  const oldReminderIds = Object.values(store.data.jobs)
    .filter((job) => job.contactId === "reschedule-1" && job.type === "appointment_reminder" && job.status === "pending")
    .map((job) => job.id);

  const contact = await bot.handleInboundSms({ contactId: "reschedule-1", message: "I need to reschedule to tomorrow at 4pm" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.match(store.getContact("reschedule-1").preferredCallTime, /4:00 PM/);
  assert.match(store.getContact("reschedule-1").lastOutboundMessage, /moved your Specialist call/i);
  assert.equal(oldReminderIds.every((id) => store.data.jobs[id].status === "cancelled"), true);
  assert.equal(
    Object.values(store.data.jobs).some(
      (job) => job.contactId === "reschedule-1" && job.type === "appointment_reminder" && job.status === "pending"
    ),
    true
  );
});

test("scheduled call time reply without reschedule keyword still updates appointment", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "reschedule-2",
    ghlContactId: "reschedule-2",
    name: "Reschedule",
    phone: "+15550000036",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "old time",
    preferredCallTimeIso: new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString(),
    appointmentId: "appt-reschedule-2"
  });

  await bot.handleInboundSms({ contactId: "reschedule-2", message: "tomorrow at 5pm" });

  assert.equal(store.getContact("reschedule-2").humanEscalationStatus, undefined);
  assert.match(store.getContact("reschedule-2").preferredCallTime, /5:00 PM/);
});

test("inbound message does not blank existing contact fields", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "c4",
    ghlContactId: "c4",
    name: "Morgan",
    phone: "+15550000003",
    timezone: "America/New_York",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  await bot.handleInboundSms({ contactId: "c4", message: "no the other driver was" });

  assert.equal(store.getContact("c4").name, "Morgan");
  assert.equal(store.getContact("c4").phone, "+15550000003");
  assert.equal(store.getContact("c4").timezone, "America/New_York");
});

test("new inbound reply is ignored until contact is enrolled in bot", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.handleInboundSms({
    contactId: "c5",
    name: "Riley",
    phone: "+15550000004",
    message: "No the other driver was at fault"
  });

  assert.equal(contact.engagementStatus, undefined);
  assert.equal(store.getContact("c5"), null);
  assert.equal(store.data.messages.length, 0);
  assert.equal(store.getSetting("last_ignored_inbound_sms").value.reason, "contact_not_enrolled_in_bot");
});

test("call ask avoids today language late at night", () => {
  const contact = { timezone: "America/Chicago" };
  const message = callAskTemplateForTime(contact, testConfig("unused"), new Date("2026-05-08T04:36:00.000Z"));

  assert.match(message, /tomorrow or the next day/i);
  assert.doesNotMatch(message, /later today/i);
});

test("call ask can use today language during business-friendly hours", () => {
  const contact = { timezone: "America/Chicago" };
  const message = callAskTemplateForTime(contact, testConfig("unused"), new Date("2026-05-07T19:00:00.000Z"));

  assert.match(message, /now or later today/i);
});

test("signed contacts are escalated instead of continuing bot automation", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "signed-1",
    ghlContactId: "signed-1",
    name: "Signed",
    phone: "+15550000007",
    tags: ["#signed"],
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  const contact = await bot.handleInboundSms({ contactId: "signed-1", message: "Can someone call me about my case?" });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "signed_tag");
  assert.equal(store.getContact("signed-1").humanEscalationStatus, undefined);
});

test("signed tag prevents no-response outreach from starting", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "signed-2",
    name: "Signed",
    phone: "+15550000011",
    tags: ["signed"],
    disposition: "no response"
  });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "signed_tag");
  assert.equal(store.data.messages.length, 0);
});

test("post-intake firm issues are escalated instead of qualified", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "support-1",
    ghlContactId: "support-1",
    name: "Support",
    phone: "+15550000008",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  const contact = await bot.handleInboundSms({ contactId: "support-1", message: "I called your office and nobody helped my case" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(store.getContact("support-1").humanEscalationStatus, true);
});

test("existing representation gets a polite response and pauses automation", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "represented-1",
    ghlContactId: "represented-1",
    name: "Represented",
    phone: "+15550000067",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });
  store.addJob({ type: "send_cold_template", contactId: "represented-1", runAt: new Date().toISOString(), payload: {} });

  const contact = await bot.handleInboundSms({ contactId: "represented-1", message: "I already have a lawyer" });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "existing_representation");
  assert.equal(contact.qualificationProgress, QUALIFICATION.COMPLETE);
  assert.match(contact.lastOutboundMessage, /second opinion/i);
  assert.equal(store.data.escalations.length, 0);
  assert.equal(Object.values(store.data.jobs).every((job) => job.status === "cancelled"), true);
});

test("human escalation schedules SLA watchdog jobs", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-sla",
    ghlContactId: "human-sla",
    name: "Human",
    phone: "+15550000037",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    lastInboundMessage: "Can I speak to a human?"
  });

  await bot.escalate(store.getContact("human-sla"), "human_request");

  assert.equal(store.getContact("human-sla").humanEscalationStage, "human_review_pending");
  assert.deepEqual(
    Object.values(store.data.jobs)
      .filter((job) => job.contactId === "human-sla" && job.type === "human_escalation_sla" && job.status === "pending")
      .map((job) => job.payload.minutes),
    [5, 15, 30]
  );
});

test("SMS escalation Slack copy stays compact without unknown qualification fields", async () => {
  const result = await slack.sendEscalation(
    { ...testConfig(""), dryRun: true, slack: { token: "", channel: "#sms", botErrorsChannel: "#bot-errors", bookingChannel: "#booking" } },
    {
      id: "slack-copy",
      ghlContactId: "slack-copy",
      name: "Slack Copy",
      phone: "+15550000061",
      lastInboundMessage: "Can you help?"
    },
    "low_confidence_answer",
    { Confidence: "0.9", "Accident date": "unknown", Fault: "unknown", Medical: "unknown" }
  );

  assert.equal(result.skipped, true);
  assert.doesNotMatch(result.text, /Confidence:/);
  assert.doesNotMatch(result.text, /Accident date:/);
  assert.doesNotMatch(result.text, /Fault:/);
  assert.doesNotMatch(result.text, /Medical:/);
});

test("booking Slack copy does not include qualification answer noise", async () => {
  const result = await slack.sendAppointmentBooked(
    { ...testConfig(""), dryRun: true, slack: { token: "", channel: "#sms", botErrorsChannel: "#bot-errors", bookingChannel: "#booking" } },
    {
      id: "booking-slack",
      ghlContactId: "booking-slack",
      name: "Booking Slack",
      phone: "+15550000069",
      preferredCallTime: "Fri, May 8, 2:00 PM CDT",
      timezone: "America/Chicago"
    }
  );

  assert.equal(result.skipped, true);
  assert.doesNotMatch(result.text, /Accident date:/);
  assert.doesNotMatch(result.text, /Fault:/);
  assert.doesNotMatch(result.text, /Medical:/);
});

test("human acknowledgement cancels escalation watchdog jobs", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-ack",
    ghlContactId: "human-ack",
    name: "Human",
    phone: "+15550000038",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending"
  });
  store.addJob({ type: "human_escalation_sla", contactId: "human-ack", runAt: new Date().toISOString(), payload: { minutes: 5 } });

  const contact = await bot.applyBotControl({ contactId: "human-ack", action: "human_acknowledged" });

  assert.equal(contact.humanEscalationStage, "human_working");
  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "human_working");
  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "human-ack" && job.status === "pending"),
    false
  );
});

test("manual human SMS returns lead to bot after timeout if lead stays quiet", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-return-timeout",
    ghlContactId: "human-return-timeout",
    name: "Human Return",
    phone: "+15550000056",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault",
    humanEscalationStatus: true,
    humanEscalationStage: "human_working",
    automationPaused: true,
    automationPauseReason: "human_working"
  });

  const acknowledged = await bot.handleHumanOutbound({
    contactId: "human-return-timeout",
    message: "This is Sarah from Accident Support Desk, I can help."
  });
  const timeout = Object.values(store.data.jobs).find(
    (job) => job.contactId === "human-return-timeout" && job.type === "human_reply_timeout" && job.status === "pending"
  );

  assert.equal(acknowledged.humanEscalationStage, "human_replied_waiting");
  assert.ok(timeout);

  await bot.runDueJob(timeout);

  const contact = store.getContact("human-return-timeout");
  assert.equal(contact.humanEscalationStatus, false);
  assert.equal(contact.automationPaused, false);
  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(contact.humanEscalationStage, "auto_returned_after_human_timeout");
  assert.match(contact.lastOutboundMessage, /medical treatment/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "human-return-timeout" && job.type === "warm_followup" && job.status === "pending"),
    true
  );
});

test("human timeout uses a softer re-engagement message", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-soft-return",
    ghlContactId: "human-soft-return",
    name: "Soft Return",
    phone: "+15550000070",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    humanEscalationStatus: true,
    humanEscalationStage: "human_working",
    automationPaused: true,
    automationPauseReason: "human_working"
  });

  await bot.handleHumanOutbound({ contactId: "human-soft-return", message: "This is Sarah from Accident Support Desk." });
  const timeout = Object.values(store.data.jobs).find(
    (job) => job.contactId === "human-soft-return" && job.type === "human_reply_timeout" && job.status === "pending"
  );
  await bot.runDueJob(timeout);

  assert.match(store.getContact("human-soft-return").lastOutboundMessage, /still here with me/i);
  assert.match(store.getContact("human-soft-return").lastOutboundMessage, /do not lose momentum/i);
});

test("lead replies while human is working do not trigger another Slack escalation", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-managed-inbound",
    ghlContactId: "human-managed-inbound",
    name: "Human Managed",
    phone: "+15550000071",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    humanEscalationStatus: true,
    humanEscalationStage: "human_replied_waiting",
    automationPaused: true,
    automationPauseReason: "human_working"
  });

  const contact = await bot.handleInboundSms({ contactId: "human-managed-inbound", message: "yes I am here" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(store.data.escalations.length, 0);
  assert.equal(store.getContact("human-managed-inbound").lastHumanManagedInboundMessage, "yes I am here");
});

test("manual call activity waits 30 minutes before returning to bot", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-call-timeout",
    ghlContactId: "human-call-timeout",
    name: "Human Call",
    phone: "+15550000062",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });
  store.addJob({ type: "warm_followup", contactId: "human-call-timeout", runAt: new Date().toISOString(), payload: { step: 1 } });

  const contact = await bot.applyBotControl({ contactId: "human-call-timeout", action: "call_started" });
  const timeout = Object.values(store.data.jobs).find(
    (job) => job.contactId === "human-call-timeout" && job.type === "human_reply_timeout" && job.status === "pending"
  );

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.humanEscalationStage, "human_replied_waiting");
  assert.equal(timeout.payload.timeoutMinutes, 30);
  const minutesAway = Math.round((new Date(timeout.runAt).getTime() - Date.now()) / 60000);
  assert.ok(minutesAway >= 29 && minutesAway <= 30);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "human-call-timeout" && job.type === "warm_followup" && job.status === "pending"),
    false
  );
});

test("GHL human-active webhook action can pause bot for an active call", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-active-call",
    ghlContactId: "human-active-call",
    name: "Human Active",
    phone: "+15550000063",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  const contact = await bot.applyBotControl({ contactId: "human-active-call", action: "manual_call" });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "human_working");
  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
});

test("manual human SMS timeout stays paused when a human hold tag is present", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-hold-timeout",
    ghlContactId: "human-hold-timeout",
    name: "Human Hold",
    phone: "+15550000057",
    tags: ["human_hold"],
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    humanEscalationStatus: true,
    humanEscalationStage: "human_working",
    automationPaused: true,
    automationPauseReason: "human_working"
  });

  await bot.handleHumanOutbound({ contactId: "human-hold-timeout", message: "We are keeping this one manual." });
  const timeout = Object.values(store.data.jobs).find(
    (job) => job.contactId === "human-hold-timeout" && job.type === "human_reply_timeout" && job.status === "pending"
  );
  await bot.runDueJob(timeout);

  const contact = store.getContact("human-hold-timeout");
  assert.equal(contact.humanEscalationStatus, true);
  assert.equal(contact.automationPaused, true);
  assert.equal(contact.lastOutboundMessage, undefined);
});

test("admin pause stops bot automation without marking opt-out", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "admin-pause",
    ghlContactId: "admin-pause",
    name: "Pause",
    phone: "+15550000041",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    humanEscalationStatus: false
  });
  store.addJob({ type: "warm_followup", contactId: "admin-pause", runAt: new Date().toISOString(), payload: { step: 1 } });

  const contact = await bot.applyBotControl({ contactId: "admin-pause", action: "pause_bot" });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "admin_pause");
  assert.equal(contact.optOutStatus, undefined);
  assert.equal(contact.humanEscalationStage, "admin_paused");
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "admin-pause" && job.status === "pending"),
    false
  );
});

test("return to bot resumes saved qualification progress", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "return-bot",
    ghlContactId: "return-bot",
    name: "Human",
    phone: "+15550000039",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault",
    humanEscalationStatus: true,
    humanEscalationStage: "human_working"
  });

  const contact = await bot.applyBotControl({ contactId: "return-bot", action: "return_to_bot" });

  assert.equal(contact.humanEscalationStatus, false);
  assert.equal(store.getContact("return-bot").engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.match(store.getContact("return-bot").lastOutboundMessage, /medical treatment/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "return-bot" && job.type === "warm_followup" && job.status === "pending"),
    true
  );
});

test("return to bot can be triggered from a GHL tag", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "return-tag",
    ghlContactId: "return-tag",
    name: "Human",
    phone: "+15550000040",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes",
    humanEscalationStatus: true,
    humanEscalationStage: "human_working"
  });

  await bot.applyBotControl({ contactId: "return-tag", tags: ["return_to_bot"] });

  assert.equal(store.getContact("return-tag").humanEscalationStatus, false);
  assert.equal(store.getContact("return-tag").humanEscalationStage, "returned_to_bot");
  assert.match(store.getContact("return-tag").lastOutboundMessage, /Specialist/i);
});

test("NQ tag pauses automation without lead escalation", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "nq-1",
    ghlContactId: "nq-1",
    name: "Not Qualified",
    phone: "+15550000009",
    tags: ["NQ"],
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });
  store.addJob({ type: "send_cold_template", contactId: "nq-1", runAt: new Date().toISOString(), payload: {} });

  const contact = await bot.handleInboundSms({ contactId: "nq-1", message: "hello" });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "nq_tag");
  assert.equal(contact.humanEscalationStatus, undefined);
  assert.equal(Object.values(store.data.jobs).every((job) => job.status === "cancelled"), true);
});

test("NQ tag prevents no-response outreach from starting", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "nq-2",
    name: "Not Qualified",
    phone: "+15550000010",
    tags: ["#NQ"],
    disposition: "no response"
  });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "nq_tag");
  assert.equal(store.data.messages.length, 0);
});

test("manual hold tags stop no-response outreach from starting", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "hold-start",
    name: "Hold Start",
    phone: "+15550000065",
    tags: ["follow up"],
    disposition: "no response"
  });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "manual_hold_tag");
  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(store.data.messages.length, 0);
  assert.equal(Object.values(store.data.jobs).some((job) => job.contactId === "hold-start" && job.status === "pending"), false);
});

test("manual hold tag cancels queued cadence before sending", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "hold-queued",
    ghlContactId: "hold-queued",
    name: "Hold Queued",
    phone: "+15550000066",
    tags: ["human_hold"],
    engagementStatus: ENGAGEMENT.WARM_FOLLOW_UP,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });
  const job = store.addJob({
    type: "warm_followup",
    contactId: "hold-queued",
    runAt: new Date().toISOString(),
    payload: { step: 1 }
  });

  await bot.runDueJob(job);

  const contact = store.getContact("hold-queued");
  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "manual_hold_tag");
  assert.equal(contact.lastOutboundMessage, undefined);
  assert.equal(store.data.jobs[job.id].status, "skipped");
});

test("queued outbound refreshes GHL tags before sending and skips newly NQ contacts", async () => {
  const { bot, store } = makeBot();
  const originalGetContact = ghl.getContact;
  ghl.getContact = async () => ({ contact: { tags: ["moudgl_tx", "NQ"] } });
  try {
    store.upsertContact({
      id: "nq-late",
      ghlContactId: "nq-late",
      name: "Late NQ",
      phone: "+15550000054",
      tags: ["moudgl_tx", "nr"],
      engagementStatus: ENGAGEMENT.COLD_OUTREACH,
      qualificationProgress: QUALIFICATION.NEEDS_FAULT
    });
    const job = store.addJob({
      type: "send_cold_template",
      contactId: "nq-late",
      runAt: new Date().toISOString(),
      payload: { templateKey: "day_1_pm", day: 1, slot: "pm" }
    });

    await bot.runDueJob(job);

    const contact = store.getContact("nq-late");
    assert.equal(contact.automationPaused, true);
    assert.equal(contact.automationPauseReason, "nq_tag");
    assert.equal(contact.lastOutboundMessage, undefined);
    assert.equal(store.data.messages.filter((message) => message.contactId === "nq-late" && message.direction === "outbound").length, 0);
    assert.equal(store.data.jobs[job.id].status, "skipped");
  } finally {
    ghl.getContact = originalGetContact;
  }
});

test("date reply to initial outreach is accepted and advances to fault question", async () => {
  const { bot, store } = makeBot();
  await bot.startFromNoResponseDisposition({
    contactId: "c6",
    name: "Alex",
    phone: "+15550000005",
    timezone: "America/Chicago"
  });

  const contact = await bot.handleInboundSms({ contactId: "c6", message: "yeserday" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("c6").accidentDate, "yeserday");
  assert.equal(store.getContact("c6").qualificationProgress, QUALIFICATION.NEEDS_FAULT);
  assert.equal(store.getContact("c6").humanEscalationStatus, false);
  assert.match(store.getContact("c6").lastOutboundMessage, /were you at fault/i);
});

test("natural accident date sentence is accepted and advances to fault question", async () => {
  const { bot, store } = makeBot();
  await bot.startFromNoResponseDisposition({
    contactId: "c6b",
    name: "Alex",
    phone: "+15550000015",
    timezone: "America/Chicago"
  });

  const contact = await bot.handleInboundSms({ contactId: "c6b", message: "I was in an accident yesterday" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("c6b").accidentDate, "yesterday");
  assert.equal(store.getContact("c6b").qualificationProgress, QUALIFICATION.NEEDS_FAULT);
  assert.equal(store.getContact("c6b").humanEscalationStatus, false);
  assert.match(store.getContact("c6b").lastOutboundMessage, /were you at fault/i);
});

test("repeated date replies do not escalate while fault is still needed", async () => {
  const { bot, store } = makeBot();
  await bot.startFromNoResponseDisposition({
    contactId: "c7",
    name: "Alex",
    phone: "+15550000006",
    timezone: "America/Chicago"
  });

  await bot.handleInboundSms({ contactId: "c7", message: "yesterday" });
  const contact = await bot.handleInboundSms({ contactId: "c7", message: "a week ago" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("c7").humanEscalationStatus, false);
  assert.match(store.getContact("c7").lastOutboundMessage, /were you at fault/i);
});

test("inbound duplicate phone resumes the single active bot thread", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "primary",
    ghlContactId: "primary",
    name: "Collins Test",
    phone: "952-994-1286",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  const contact = await bot.handleInboundSms({
    contactId: "duplicate",
    name: "Other Duplicate",
    phone: "+1 (952) 994-1286",
    message: "No the other driver was at fault"
  });

  assert.equal(contact.id, "primary");
  assert.equal(store.getContact("primary").ghlContactId, "primary");
  assert.equal(store.getContact("primary").inboundGhlContactId, "duplicate");
  assert.deepEqual(store.getContact("primary").aliasContactIds, ["duplicate"]);
  assert.equal(store.getContact("primary").faultAnswer, "not_at_fault");
  assert.equal(store.getContact("duplicate"), null);
});

test("inbound duplicate phone pauses when multiple active bot threads match", async () => {
  const { bot, store } = makeBot();
  for (const id of ["active-1", "active-2"]) {
    store.upsertContact({
      id,
      ghlContactId: id,
      name: id,
      phone: "+19529941286",
      engagementStatus: ENGAGEMENT.COLD_OUTREACH,
      qualificationProgress: QUALIFICATION.NEEDS_FAULT
    });
  }

  const contact = await bot.handleInboundSms({
    contactId: "duplicate",
    phone: "9529941286",
    message: "TEST"
  });

  assert.equal(contact.id, "duplicate");
  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "duplicate_phone_conflict");
  assert.deepEqual(contact.duplicateActiveContactIds, ["active-1", "active-2"]);
  assert.equal(contact.humanEscalationStatus, undefined);
});

test("missed call follow-up includes scheduled call time", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.markMissedCall({
    contactId: "missed-1",
    name: "Missed",
    phone: "+15550000012",
    timezone: "America/Chicago",
    preferredCallTime: "Fri, May 8, 3:00 PM CDT"
  });
  const firstJob = Object.values(store.data.jobs)
    .filter((job) => job.contactId === contact.id && job.type === "missed_call_followup")
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt))[0];
  store.updateJob(firstJob.id, { runAt: new Date().toISOString() });
  await bot.runDueJob(store.data.jobs[firstJob.id]);

  assert.match(store.getContact("missed-1").lastOutboundMessage, /Fri, May 8, 3:00 PM CDT/);
});

test("appointment no-show schedules reschedule recovery without restarting qualification", async () => {
  const { bot, store } = makeBot();
  const contact = await bot.markNoShow({
    contactId: "no-show-1",
    name: "No Show",
    phone: "+15550000072",
    timezone: "America/Chicago",
    preferredCallTime: "Fri, May 8, 1:00 PM CDT",
    preferredCallTimeIso: "2026-05-08T18:00:00.000Z"
  });
  const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === contact.id && job.type === "missed_call_followup");

  assert.equal(contact.engagementStatus, ENGAGEMENT.MISSED_CALL);
  assert.equal(contact.qualificationProgress, QUALIFICATION.CALL_BOOKED);
  assert.equal(contact.currentSequenceName, "appointment_no_show");
  assert.equal(jobs.some((job) => job.payload.templateGroup === "noShowTemplates"), true);
  assert.equal(jobs.some((job) => job.payload.templateKey === "day_2_am"), true);

  const firstJob = jobs.find((job) => job.payload.templateKey === "sameDay10") || jobs[0];
  store.updateJob(firstJob.id, { runAt: new Date().toISOString() });
  await bot.runDueJob(store.data.jobs[firstJob.id]);

  assert.match(store.getContact("no-show-1").lastOutboundMessage, /missed you|missed the call|rescheduled|calendar/i);
  assert.doesNotMatch(store.getContact("no-show-1").lastOutboundMessage, /date of the accident/i);
});

test("appointment no-show schedules backup time reminders when backup exists", async () => {
  const { bot, store } = makeBot();
  const primary = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const backup = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "no-show-backup",
    ghlContactId: "no-show-backup",
    name: "Backup",
    phone: "+15550000073",
    timezone: "America/Chicago",
    preferredCallTime: "the first call time",
    preferredCallTimeIso: primary,
    backupCallTime: "4:00 PM",
    backupCallTimeIso: backup,
    backupCallTimeType: "exact"
  });

  await bot.markNoShow({ contactId: "no-show-backup" });
  const backupJobs = Object.values(store.data.jobs)
    .filter((job) => job.contactId === "no-show-backup" && job.type === "backup_no_show_reminder" && job.status === "pending")
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));

  assert.equal(backupJobs.length >= 2, true);
  assert.equal(backupJobs.some((job) => job.payload.templateKey === "afterPrimaryMissed"), true);

  const firstJob = backupJobs.find((job) => job.payload.templateKey === "afterPrimaryMissed");
  store.updateJob(firstJob.id, { runAt: new Date().toISOString() });
  await bot.runDueJob(store.data.jobs[firstJob.id]);

  assert.match(store.getContact("no-show-backup").lastOutboundMessage, /backup time/i);
  assert.match(store.getContact("no-show-backup").lastOutboundMessage, /4:00 PM/i);
});

test("warm follow-ups aggressively chase before entering re-engagement", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "warm-1",
    ghlContactId: "warm-1",
    name: "Warm",
    phone: "+15550000013",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });

  await bot.scheduleWarmFollowUps(store.getContact("warm-1"));

  const jobs = Object.values(store.data.jobs)
    .filter((job) => job.contactId === "warm-1" && job.status === "pending")
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
  assert.deepEqual(jobs.map((job) => job.type), [
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "enter_reengagement"
  ]);
  assert.deepEqual(jobs.filter((job) => job.type === "warm_followup").map((job) => job.payload.minutes), [
    5,
    15,
    30,
    60,
    120,
    240
  ]);
});

test("vague call time reply schedules hot lead warm follow-ups", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "later-call",
    ghlContactId: "later-call",
    name: "Later Call",
    phone: "+15550000052",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "no"
  });

  const contact = await bot.handleInboundSms({ contactId: "later-call", message: "Later" });

  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.equal(store.getContact("later-call").awaitingSpecificCallTime, true);
  assert.match(store.getContact("later-call").lastOutboundMessage, /specific time/i);
  const jobs = Object.values(store.data.jobs)
    .filter((job) => job.contactId === "later-call" && job.status === "pending")
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
  assert.deepEqual(jobs.map((job) => job.type), [
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "enter_reengagement"
  ]);
  assert.deepEqual(jobs.filter((job) => job.type === "warm_followup").map((job) => job.payload.minutes), [
    5,
    15,
    30,
    60,
    120,
    240
  ]);
});

test("vague tomorrow daypart asks for exact time instead of booking", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "tomorrow-afternoon",
    ghlContactId: "tomorrow-afternoon",
    name: "Tomorrow Afternoon",
    phone: "+15550000057",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });

  const contact = await bot.handleInboundSms({
    contactId: "tomorrow-afternoon",
    message: "I'm in Texas now staying with my sister but tomorrow is better late afternoon"
  });

  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.equal(store.getContact("tomorrow-afternoon").awaitingSpecificCallTime, true);
  assert.equal(store.getContact("tomorrow-afternoon").appointmentId, undefined);
  assert.match(store.getContact("tomorrow-afternoon").lastOutboundMessage, /specific time tomorrow/i);
});

test("early call time before qualification moves into scheduling without LLM", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "early-call-time",
    ghlContactId: "early-call-time",
    name: "Early Time",
    phone: "+15550000059",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });

  const contact = await bot.handleInboundSms({
    contactId: "early-call-time",
    message: "tomorrow late afternoon"
  });

  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.equal(contact.earlyCallTimeBeforeQualification, true);
  assert.match(contact.lastOutboundMessage, /specific time tomorrow/i);
});

test("relative call time asks for exact time options instead of booking", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "relative-call-time",
    ghlContactId: "relative-call-time",
    name: "Relative Time",
    phone: "+15550000060",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });

  const contact = await bot.handleInboundSms({
    contactId: "relative-call-time",
    message: "Ok I will get with you in a hour"
  });

  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.equal(contact.appointmentId, undefined);
  assert.match(contact.lastOutboundMessage, /do you mean around/i);
  assert.match(contact.lastOutboundMessage, /exact time/i);
});

test("off-flow call-time replies escalate when they do not answer scheduling", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "call-time-off-flow",
    ghlContactId: "call-time-off-flow",
    name: "Off Flow",
    phone: "+15550000058",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });

  const contact = await bot.handleInboundSms({
    contactId: "call-time-off-flow",
    message: "This wreck took place in Colorado"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(store.getContact("call-time-off-flow").humanEscalationStatus, true);
  assert.equal(store.getContact("call-time-off-flow").escalationReason, "call_time_unhandled_reply");
  assert.equal(store.data.messages.some((message) => /what time works/i.test(message.body)), false);
});

test("queued inbound SMS buffers quick consecutive messages before responding", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "buffered-inbound",
    ghlContactId: "buffered-inbound",
    name: "Buffered",
    phone: "+15550000066",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });

  await bot.queueInboundSms({ contactId: "buffered-inbound", message: "No I did not" });
  await bot.queueInboundSms({ contactId: "buffered-inbound", message: "But I have injuries" });
  const pendingJobs = Object.values(store.data.jobs).filter(
    (job) => job.contactId === "buffered-inbound" && job.type === "process_inbound_buffer" && job.status === "pending"
  );

  assert.equal(pendingJobs.length, 1);
  await bot.runDueJob(pendingJobs[0]);

  const contact = store.getContact("buffered-inbound");
  assert.equal(contact.pendingInboundMessages.length, 0);
  assert.equal(contact.medicalTreatmentAnswer, "no");
  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.match(contact.lastOutboundMessage, /Specialist/i);
  assert.equal(store.data.messages.filter((message) => message.contactId === "buffered-inbound" && message.direction === "inbound").length, 2);
});

test("injury context during call scheduling asks for a call time instead of escalating", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "injury-call-time",
    ghlContactId: "injury-call-time",
    name: "Yohana",
    phone: "+15550000065",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "unsure_or_partial",
    medicalTreatmentAnswer: "no"
  });

  const contact = await bot.handleInboundSms({
    contactId: "injury-call-time",
    message: "But I have injuries"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("injury-call-time").humanEscalationStatus, undefined);
  assert.match(store.getContact("injury-call-time").lastOutboundMessage, /injuries are important/i);
  assert.match(store.getContact("injury-call-time").lastOutboundMessage, /What time works/i);
});

test("after vague later reply, warm follow-up asks for exact time", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "later-specific",
    ghlContactId: "later-specific",
    name: "Later Specific",
    phone: "+15550000055",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    awaitingSpecificCallTime: true,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });
  const job = store.addJob({
    type: "warm_followup",
    contactId: "later-specific",
    runAt: new Date().toISOString(),
    payload: { step: 1, minutes: 5 }
  });

  await bot.runDueJob(job);

  assert.match(store.getContact("later-specific").lastOutboundMessage, /exact time|specific time/i);
  assert.doesNotMatch(store.getContact("later-specific").lastOutboundMessage, /now or later/i);
  const message = store.data.messages.find((item) => item.contactId === "later-specific" && item.direction === "outbound");
  assert.equal(message.templateKey, "needs_call_time_specific.1");
});

test("admin can restart hot call-time chase without sending a duplicate question", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "stuck-call-time",
    ghlContactId: "stuck-call-time",
    name: "Stuck Call Time",
    phone: "+15550000053",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes",
    lastOutboundMessage: "What specific time later today works best?"
  });

  const contact = await bot.applyBotControl({ contactId: "stuck-call-time", action: "chase_call_time" });

  assert.equal(contact.lastOutboundMessage, "What specific time later today works best?");
  const jobs = Object.values(store.data.jobs)
    .filter((job) => job.contactId === "stuck-call-time" && job.status === "pending")
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
  assert.deepEqual(jobs.map((job) => job.type), [
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "warm_followup",
    "enter_reengagement"
  ]);
});

test("after-hours warm follow-up sends once then waits for texting window", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "warm-after-hours",
    ghlContactId: "warm-after-hours",
    name: "Warm After Hours",
    phone: "+15550000024",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });

  await bot.scheduleWarmFollowUps(store.getContact("warm-after-hours"), true);

  const jobs = Object.values(store.data.jobs)
    .filter((job) => job.contactId === "warm-after-hours" && job.status === "pending")
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
  assert.deepEqual(jobs.map((job) => job.type), ["warm_followup", "enter_reengagement"]);
  assert.equal(jobs[0].payload.afterHours, true);
  assert.equal(jobs[0].payload.minutes, 15);
  assert.equal(jobs[1].payload.afterHours, true);
});

test("warm follow-up job marks contact as warm follow-up", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "warm-status",
    ghlContactId: "warm-status",
    name: "Warm",
    phone: "+15550000021",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });
  const job = store.addJob({
    type: "warm_followup",
    contactId: "warm-status",
    runAt: new Date().toISOString(),
    payload: { step: 3, minutes: 30 }
  });

  await bot.runDueJob(job);

  assert.equal(store.getContact("warm-status").engagementStatus, ENGAGEMENT.WARM_FOLLOW_UP);
  assert.equal(store.getContact("warm-status").currentSequenceName, "warm_follow_up");
  assert.equal(store.getContact("warm-status").currentSequenceDay, 3);
  assert.match(store.getContact("warm-status").lastOutboundMessage, /urgent care|chiro|doctor/i);
});

test("warm follow-up copy changes by step instead of repeating the same question", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "warm-copy",
    ghlContactId: "warm-copy",
    name: "Warm",
    phone: "+15550000031",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });

  const firstJob = store.addJob({
    type: "warm_followup",
    contactId: "warm-copy",
    runAt: new Date().toISOString(),
    payload: { step: 1, minutes: 5 }
  });
  await bot.runDueJob(firstJob);
  const firstMessage = store.getContact("warm-copy").lastOutboundMessage;

  const secondJob = store.addJob({
    type: "warm_followup",
    contactId: "warm-copy",
    runAt: new Date().toISOString(),
    payload: { step: 2, minutes: 15 }
  });
  await bot.runDueJob(secondJob);

  assert.notEqual(store.getContact("warm-copy").lastOutboundMessage, firstMessage);
  assert.match(store.getContact("warm-copy").lastOutboundMessage, /Specialist call|time today/i);
});

test("enter re-engagement job schedules the correct saved-progress sequence", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "warm-2",
    ghlContactId: "warm-2",
    name: "Warm",
    phone: "+15550000014",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });
  const job = store.addJob({
    type: "enter_reengagement",
    contactId: "warm-2",
    runAt: new Date().toISOString(),
    payload: {}
  });

  await bot.runDueJob(job);

  assert.equal(store.getContact("warm-2").engagementStatus, ENGAGEMENT.RE_ENGAGEMENT);
  assert.equal(store.getContact("warm-2").currentSequenceName, "after_q1");
  assert.match(store.getContact("warm-2").lastOutboundMessage, /looks like we got cut off/i);
  assert.equal(
    Object.values(store.data.jobs).some(
      (item) =>
        item.type === "send_reengagement_template" &&
        item.payload.sequence === "after_q1" &&
        item.payload.templateKey === "day_2_am"
    ),
    true
  );
  assert.equal(
    Object.values(store.data.jobs).some(
      (item) =>
        item.type === "send_reengagement_template" &&
        item.payload.sequence === "after_q1" &&
        item.payload.templateKey === "day_2_pm"
    ),
    true
  );
});

test("lead that stops before fault enters date-based re-engagement", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "warm-fault",
    ghlContactId: "warm-fault",
    name: "Warm",
    phone: "+15550000033",
    engagementStatus: ENGAGEMENT.WARM_FOLLOW_UP,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    accidentDate: "yesterday"
  });
  const job = store.addJob({
    type: "enter_reengagement",
    contactId: "warm-fault",
    runAt: new Date().toISOString(),
    payload: {}
  });

  await bot.runDueJob(job);

  assert.equal(store.getContact("warm-fault").engagementStatus, ENGAGEMENT.RE_ENGAGEMENT);
  assert.equal(store.getContact("warm-fault").currentSequenceName, "after_date");
  assert.match(store.getContact("warm-fault").lastOutboundMessage, /were you at fault/i);
  assert.equal(
    Object.values(store.data.jobs).some((item) => item.payload.templateKey === "day_2_pm" && item.payload.sequence === "after_date"),
    true
  );
});

test("re-engagement job keeps the sent message on contact summary", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "reengage-message",
    ghlContactId: "reengage-message",
    name: "Warm",
    phone: "+15550000032",
    engagementStatus: ENGAGEMENT.RE_ENGAGEMENT,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault"
  });
  const job = store.addJob({
    type: "send_reengagement_template",
    contactId: "reengage-message",
    runAt: new Date().toISOString(),
    payload: { sequence: "after_q1", day: 1 }
  });

  await bot.runDueJob(job);

  assert.match(store.getContact("reengage-message").lastOutboundMessage, /looks like we got cut off/i);
  assert.equal(store.getContact("reengage-message").currentSequenceName, "after_q1");
  assert.equal(store.getContact("reengage-message").currentSequenceDay, 1);
});

test("initial no-response SMS records day 1 AM as already sent", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "cold-1",
    name: "Cold",
    phone: "+15550000015",
    timezone: "America/Chicago"
  });

  assert.deepEqual(contact.sentColdTemplateKeys, ["day_1_am"]);
});

test("immediate no-response enrollment queues cold outreach without duplicates", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "cold-immediate-1",
    name: "Cold Immediate",
    phone: "+15550000052",
    timezone: "America/Chicago",
    tags: ["NR"]
  });
  const firstScheduled = Object.values(store.data.jobs).filter(
    (job) => job.contactId === contact.id && job.type === "send_cold_template" && job.status === "pending"
  );

  await bot.scheduleColdOutreach(store.getContact(contact.id));
  const afterReschedule = Object.values(store.data.jobs).filter(
    (job) => job.contactId === contact.id && job.type === "send_cold_template" && job.status === "pending"
  );

  assert.equal(firstScheduled.length > 0, true);
  assert.equal(afterReschedule.length, firstScheduled.length);
});

test("fresh no-response enrollment cancels stale qualification follow-up jobs", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "stale-warm-nr",
    ghlContactId: "stale-warm-nr",
    name: "McKinley",
    phone: "+15550000070",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });
  store.addJob({
    type: "warm_followup",
    contactId: "stale-warm-nr",
    runAt: new Date().toISOString(),
    payload: { step: 1 }
  });

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "stale-warm-nr",
    name: "McKinley",
    phone: "+15550000070",
    timezone: "America/Chicago",
    tags: ["NR"]
  });

  assert.equal(contact.currentSequenceName, "initial_sms");
  assert.match(store.getContact("stale-warm-nr").lastOutboundMessage, /date of the accident/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "stale-warm-nr" && job.type === "warm_followup" && job.status === "pending"),
    false
  );
});

test("fresh no-response enrollment schedules aggressive same-day follow-ups", async () => {
  const { bot, store } = makeBot();
  const cadenceTimezone = ["America/Chicago", "America/Los_Angeles", "Pacific/Honolulu", "Pacific/Kiritimati"].find((timeZone) => {
    const local = getLocalParts(new Date(), timeZone);
    return local.hour >= 8 && local.hour <= 17;
  }) || "America/Chicago";

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "fresh-cadence-1",
    name: "Fresh Cadence",
    phone: "+15550000068",
    timezone: cadenceTimezone,
    tags: ["NR"]
  });

  const freshJobs = Object.values(store.data.jobs)
    .filter((job) => job.contactId === contact.id && job.type === "fresh_lead_followup" && job.status === "pending")
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));

  assert.equal(freshJobs.length > 0, true);
  assert.deepEqual(
    freshJobs.map((job) => job.payload.minutes).filter((minutes) => [15, 60, 120, 240].includes(minutes)),
    freshJobs.map((job) => job.payload.minutes)
  );
});

test("backfill queues initial SMS instead of sending immediately", async () => {
  const { bot, store } = makeBot();
  const runAt = new Date(Date.now() + 30 * 60 * 1000);

  const result = await bot.queueNoResponseBackfill(
    {
      contactId: "backfill-1",
      name: "Backfill",
      phone: "+15550000041",
      timezone: "America/Chicago",
      tags: ["NR"]
    },
    runAt
  );

  assert.equal(result.status, "queued");
  assert.equal(store.data.messages.length, 0);
  assert.equal(store.getContact("backfill-1").currentSequenceName, "backfill_pending");
  assert.equal(
    Object.values(store.data.jobs).some(
      (job) => job.contactId === "backfill-1" && job.type === "initial_sms" && job.status === "pending"
    ),
    true
  );
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "backfill-1" && job.type === "fresh_lead_followup"),
    false
  );
});

test("backfill skips NQ signed and DNC contacts", async () => {
  const { bot } = makeBot();
  const runAt = new Date(Date.now() + 30 * 60 * 1000);

  const nq = await bot.queueNoResponseBackfill(
    { contactId: "backfill-nq", name: "NQ", phone: "+15550000042", tags: ["NR", "NQ"] },
    runAt
  );
  const signed = await bot.queueNoResponseBackfill(
    { contactId: "backfill-signed", name: "Signed", phone: "+15550000043", tags: ["NR", "signed"] },
    runAt
  );
  const dnc = await bot.queueNoResponseBackfill(
    { contactId: "backfill-dnc", name: "DNC", phone: "+15550000044", tags: ["NR", "DNC"] },
    runAt
  );

  assert.equal(nq.status, "skipped");
  assert.equal(signed.status, "skipped");
  assert.equal(dnc.status, "skipped");
});

test("cold outreach does not schedule templates already sent", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "cold-2",
    ghlContactId: "cold-2",
    name: "Cold",
    phone: "+15550000016",
    timezone: "America/Chicago",
    sentColdTemplateKeys: ["day_2_pm"]
  });

  await bot.scheduleColdOutreach(store.getContact("cold-2"));

  assert.equal(
    Object.values(store.data.jobs).some((job) => job.payload?.templateKey === "day_2_pm"),
    false
  );
});

test("normalizes timezone from GHL state when timezone is empty", () => {
  const normalized = normalizePayload(
    {
      contactId: "tz-1",
      name: "Timezone",
      phone: "+15550000017",
      state: "CA"
    },
    testConfig("")
  );

  assert.equal(normalized.state, "CA");
  assert.equal(normalized.timezone, "America/Los_Angeles");
});

test("normalizes timezone from owner/state even when GHL sends account default timezone", () => {
  const normalized = normalizePayload(
    {
      contactId: "tz-owner-ca",
      name: "Francisco González",
      phone: "+15550000067",
      timezone: "America/Chicago",
      owner: "California Intake"
    },
    testConfig("")
  );

  assert.equal(normalized.owner, "California Intake");
  assert.equal(normalized.timezone, "America/Los_Angeles");
});

test("inbound payload with owner state corrects an existing default timezone", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "tz-existing",
    ghlContactId: "tz-existing",
    name: "Timezone Existing",
    phone: "+15550000068",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
  });

  await bot.handleInboundSms({
    contactId: "tz-existing",
    message: "tomorrow at 2pm",
    timezone: "America/Chicago",
    owner: "CA"
  });

  assert.equal(store.getContact("tz-existing").timezone, "America/Los_Angeles");
  assert.match(store.getContact("tz-existing").preferredCallTime, /PDT|PST/);
});

test("normalizes nested GHL contact payloads", () => {
  const normalized = normalizePayload(
    {
      contact: {
        id: "nested-1",
        contactName: "Nested Lead",
        phone: "+15550000019",
        state: "TX",
        source: "GHL workflow",
        tags: ["lead"]
      }
    },
    testConfig("")
  );

  assert.equal(normalized.id, "nested-1");
  assert.equal(normalized.name, "Nested Lead");
  assert.equal(normalized.phone, "+15550000019");
  assert.equal(normalized.state, "TX");
  assert.equal(normalized.timezone, "America/Chicago");
  assert.equal(normalized.leadSource, "GHL workflow");
});

test("normalizes GHL webhook standard data fields", () => {
  const normalized = normalizePayload(
    {
      "Contact ID": "standard-1",
      "Contact Name": "Standard Lead",
      "Contact Phone": "+15550000020",
      source: "GHL standard webhook",
      disposition: "NR"
    },
    testConfig("")
  );

  assert.equal(normalized.id, "standard-1");
  assert.equal(normalized.name, "Standard Lead");
  assert.equal(normalized.phone, "+15550000020");
  assert.equal(normalized.leadSource, "GHL standard webhook");
});

test("normalizes inbound message from nested GHL customData", () => {
  const normalized = normalizePayload(
    {
      contact_id: "custom-data-1",
      full_name: "Custom Data Lead",
      phone: "+15550000021",
      customData: {
        message: "No, the other driver hit me"
      }
    },
    testConfig("")
  );

  assert.equal(normalized.id, "custom-data-1");
  assert.equal(normalized.name, "Custom Data Lead");
  assert.equal(normalized.lastInboundMessage, "No, the other driver hit me");
});

test("normalizes inbound message object from GHL merge fields", () => {
  const normalized = normalizePayload(
    {
      contact_id: "object-message-1",
      full_name: "Object Message Lead",
      phone: "+15550000022",
      customData: {
        message: {
          body: "It was yesterday"
        }
      }
    },
    testConfig("")
  );

  assert.equal(normalized.lastInboundMessage, "It was yesterday");
});

test("normalizes AI MVP latest reply field", () => {
  const normalized = normalizePayload(
    {
      contact_id: "latest-reply-1",
      full_name: "Latest Reply Lead",
      phone: "+15550000023",
      "AI MVP Latest Reply": {
        value: "No I was not at fault"
      }
    },
    testConfig("")
  );

  assert.equal(normalized.lastInboundMessage, "No I was not at fault");
});

test("no-response disposition accepts NR abbreviation", () => {
  assert.equal(isNoResponseDisposition("no response"), true);
  assert.equal(isNoResponseDisposition("NR"), true);
  assert.equal(isNoResponseDisposition("answered"), false);
});

test("no-response enrollment accepts NR tags from GHL payloads", () => {
  assert.equal(hasNoResponseTag({ tags: ["NR"] }), true);
  assert.equal(hasNoResponseTag({ contact: { tags: ["no answer", "nr"] } }), true);
  assert.equal(hasNoResponseTag({ customData: { tags: "facebook_lead, NR" } }), true);
  assert.equal(isNoResponseSignal({ contact: { tags: ["NR"] } }), true);
  assert.equal(isNoResponseSignal({ disposition: "answered", tags: ["warm"] }), false);
});
