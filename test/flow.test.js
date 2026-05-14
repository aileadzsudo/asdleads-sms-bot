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
const { addDays, getLocalParts, localDateToUtc } = require("../src/time");
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

function localDayNumber(date, timeZone) {
  const parts = getLocalParts(date, timeZone);
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / (24 * 60 * 60 * 1000));
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

test("blank literal inbound messages are ignored instead of escalated", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "blank-inbound",
    ghlContactId: "blank-inbound",
    name: "Blank Inbound",
    phone: "+15550000080",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  const contact = await bot.handleInboundSms({ contactId: "blank-inbound", message: "undefined" });

  assert.equal(contact.lastInboundMessage, undefined);
  assert.equal(store.data.messages.length, 0);
  assert.equal(store.data.escalations.length, 0);
  assert.equal(store.getSetting("last_ignored_inbound_sms").value.reason, "blank_inbound_message");
});

test("template name personalization uses first name only", () => {
  assert.equal(render("Hi [NAME]", { name: "eric johnson" }), "Hi Eric");
  assert.equal(render("Hi [NAME]", { firstName: "SARAH", name: "Sarah Johnson" }), "Hi Sarah");
});

test("Spanish tag localizes cold outreach and qualification replies", async () => {
  const { bot, store } = makeBot();
  await bot.startFromNoResponseDisposition({
    contactId: "spanish-lead",
    name: "Maria Lopez",
    phone: "+15550000101",
    tags: ["NR", "Spanish"]
  });

  assert.equal(store.getContact("spanish-lead").language, "es");
  assert.match(store.getContact("spanish-lead").lastOutboundMessage, /fecha del accidente/i);

  await bot.queueInboundSms({ contactId: "spanish-lead", message: "ayer", tags: ["Spanish"] });
  const job = Object.values(store.data.jobs).find((item) => item.contactId === "spanish-lead" && item.type === "process_inbound_buffer" && item.status === "pending");
  await bot.runDueJob(job);

  const contact = store.getContact("spanish-lead");
  assert.equal(contact.accidentDate, "ayer");
  assert.match(contact.lastOutboundMessage, /fuiste culpable|otro conductor/i);
  assert.doesNotMatch(contact.lastOutboundMessage, /were you at fault/i);
});

test("Spanish tag localizes appointment reminders", async () => {
  const { bot, store } = makeBot();
  const startsAt = new Date(Date.now() + 65 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "spanish-reminder",
    ghlContactId: "spanish-reminder",
    name: "Carlos Rivera",
    phone: "+15550000102",
    tags: ["Spanish"],
    language: "es",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Hoy 3:00 PM CST",
    preferredCallTimeIso: startsAt
  });
  const reminder = store.addJob({
    type: "appointment_reminder",
    contactId: "spanish-reminder",
    runAt: new Date(new Date(startsAt).getTime() - 60 * 60 * 1000).toISOString(),
    payload: { templateKey: "sameDayOneHour", appointmentIso: startsAt }
  });

  await bot.runDueJob(reminder);

  assert.match(store.getContact("spanish-reminder").lastOutboundMessage, /llamada con el Especialista/i);
  assert.doesNotMatch(store.getContact("spanish-reminder").lastOutboundMessage, /Specialist call is coming up/i);
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

test("lead asked not to be blown up pauses all bot follow-up until they reply", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "pause-me",
    ghlContactId: "pause-me",
    name: "Lynda",
    phone: "+15550000052",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });
  store.addJob({ type: "send_cold_template", contactId: "pause-me", runAt: new Date().toISOString(), payload: {} });
  store.addJob({ type: "warm_followup", contactId: "pause-me", runAt: new Date().toISOString(), payload: {} });
  store.addJob({ type: "appointment_reminder", contactId: "pause-me", runAt: new Date().toISOString(), payload: {} });

  const contact = await bot.handleInboundSms({
    contactId: "pause-me",
    message: "Not a good time. I'll txt when I'm free. Pls dont blow up my phone"
  });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "lead_requested_pause");
  assert.equal(contact.humanEscalationStatus, false);
  assert.equal(contact.optOutStatus, undefined);
  assert.equal(contact.currentSequenceName, "lead_requested_pause");
  assert.match(contact.lastOutboundMessage, /won't keep texting/i);
  assert.equal(store.data.escalations.filter((item) => item.contactId === "pause-me").length, 1);
  assert.equal(store.data.escalations.find((item) => item.contactId === "pause-me").reason, "lead_requested_pause");
  assert.equal(
    Object.values(store.data.jobs).every((job) => job.contactId !== "pause-me" || job.status === "cancelled"),
    true
  );
  assert.equal(store.listDecisionLogs("pause-me").some((log) => log.reason === "lead_requested_pause"), true);
});

test("lead-requested pause resumes only after the lead texts again", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "pause-resume",
    ghlContactId: "pause-resume",
    name: "Lynda",
    phone: "+15550000053",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  await bot.handleInboundSms({
    contactId: "pause-resume",
    message: "Not a good time. I'll txt when I'm free. Pls dont blow up my phone"
  });
  const contact = await bot.handleInboundSms({ contactId: "pause-resume", message: "I'm free now" });

  assert.equal(contact.automationPaused, false);
  assert.equal(contact.automationPauseReason, "");
  assert.equal(store.listDecisionLogs("pause-resume").some((log) => log.reason === "lead_replied_after_pause"), true);
});

test("repeated lead-requested pause does not spam escalation alerts", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "pause-dedupe",
    ghlContactId: "pause-dedupe",
    name: "Lynda",
    phone: "+15550000054",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  await bot.handleInboundSms({
    contactId: "pause-dedupe",
    message: "Not a good time. I'll txt when I'm free. Pls dont blow up my phone"
  });
  await bot.handleInboundSms({
    contactId: "pause-dedupe",
    message: "Please don't blow up my phone"
  });

  assert.equal(store.data.escalations.filter((item) => item.contactId === "pause-dedupe").length, 1);
});

test("long fault answer is saved instead of escalated as detailed information", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "long-fault",
    ghlContactId: "long-fault",
    name: "Thurston",
    phone: "+15550000090",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  const contact = await bot.handleInboundSms({
    contactId: "long-fault",
    message:
      "No I was crossing the street in the green light while I was in the middle of the road on the crosswalk and the driver in the far right lane floored it and hit me"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("long-fault").faultAnswer, "not_at_fault");
  assert.equal(store.getContact("long-fault").qualificationProgress, QUALIFICATION.NEEDS_MEDICAL);
  assert.match(store.getContact("long-fault").lastOutboundMessage, /medical treatment/i);
});

test("medical yes with paperwork and photos advances instead of escalating", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "medical-paperwork",
    ghlContactId: "medical-paperwork",
    name: "Jesus",
    phone: "+15550000145",
    timezone: "America/Los_Angeles",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault",
    lastOutboundMessage: "Have you needed to see any doctors or receive any medical treatment after the accident?"
  });

  const contact = await bot.handleInboundSms({
    contactId: "medical-paperwork",
    message: "Yes I have all paperwork, pictures, video footage etc"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("medical-paperwork").humanEscalationStatus, undefined);
  assert.equal(store.getContact("medical-paperwork").medicalTreatmentAnswer, "yes");
  assert.equal(store.getContact("medical-paperwork").qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.match(store.getContact("medical-paperwork").lastOutboundMessage, /What time works best|open for a call/i);
});

test("detailed emergency and medication message counts as medical answer", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "roberta-medical",
    ghlContactId: "roberta-medical",
    name: "Roberta Barajas Rios",
    phone: "+15550000148",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault",
    lastOutboundMessage: "Have you needed to see any doctors or receive any medical treatment after the accident?"
  });

  const contact = await bot.handleInboundSms({
    contactId: "roberta-medical",
    message:
      "This just happened last sat my neck felt stuck and pain on Thurs and yesterday I got a bad headache from my temple to my eye. So went to emergency. They said I got neck sprain like whip lash and to basically rest 4 to 6 weeks and gave me meds for pain and muscle relaxer"
  });

  assert.equal(contact.humanEscalationStatus, undefined);
  assert.equal(contact.medicalTreatmentAnswer, "yes");
  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.match(store.getContact("roberta-medical").lastOutboundMessage, /What time works best|open for a call|Specialist/i);
});

test("soft human escalation still captures a qualification answer instead of repeating stale question", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "soft-answer",
    ghlContactId: "soft-answer",
    name: "Karson",
    phone: "+15550000100",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "llm_unhandled_confused"
  });
  store.addJob({
    type: "human_escalation_sla",
    contactId: "soft-answer",
    runAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    payload: { minutes: 5, reason: "llm_unhandled_confused" }
  });

  const contact = await bot.handleInboundSms({ contactId: "soft-answer", message: "No" });
  const latest = store.getContact("soft-answer");

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(latest.humanEscalationStatus, false);
  assert.equal(latest.faultAnswer, "not_at_fault");
  assert.equal(latest.qualificationProgress, QUALIFICATION.NEEDS_MEDICAL);
  assert.match(latest.lastOutboundMessage, /medical treatment/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "soft-answer" && job.type === "human_escalation_sla" && job.status === "pending"),
    false
  );
});

test("fresh NR enrollment sends the initial cold message immediately even outside texting hours", async () => {
  const { bot, store } = makeBot();
  bot.config.texting.defaultStart = "23:59";
  bot.config.texting.defaultEnd = "00:00";

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "fresh-quiet",
    name: "Andrea",
    phone: "+15550000092"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.INITIAL_SMS_SENT);
  assert.match(store.getContact("fresh-quiet").lastOutboundMessage, /date of the accident/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "fresh-quiet" && job.type === "initial_sms" && job.status === "pending"),
    false
  );
});

test("repeat NR after call-now no answer uses recovery scheduling instead of restarting cold outreach", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "call-now-missed",
    ghlContactId: "call-now-missed",
    name: "Chelesy West",
    phone: "+15550000093",
    engagementStatus: ENGAGEMENT.READY_FOR_CALL,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes",
    humanEscalationStatus: true,
    escalationReason: "call_now",
    lastOutboundMessage: "Perfect! I'm connecting you with a Specialist right now"
  });

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "call-now-missed",
    name: "Chelesy West",
    phone: "+15550000093",
    disposition: "NR"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("call-now-missed").qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.match(store.getContact("call-now-missed").lastOutboundMessage, /tried giving you a call/i);
  assert.doesNotMatch(store.getContact("call-now-missed").lastOutboundMessage, /looking over your accident info/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "call-now-missed" && job.type === "warm_followup" && job.status === "pending"),
    true
  );
});

test("repeat NR after short yes-now reply uses missed-call recovery even if human flag was cleared", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "john-now-missed",
    ghlContactId: "john-now-missed",
    name: "John Aguilar",
    phone: "+15550000094",
    tags: ["lhpark_ca", "nr"],
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    humanEscalationStatus: false,
    humanEscalationStage: "human_review_pending",
    escalationReason: "detailed_information",
    lastInboundMessage: "Yes now",
    lastOutboundMessage: "Hi John, do you remember the date of the accident?",
    sentColdTemplateKeys: ["day_1_am"]
  });

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "john-now-missed",
    name: "John Aguilar",
    phone: "+15550000094",
    tags: ["NR"],
    disposition: "NR"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("john-now-missed").qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.match(store.getContact("john-now-missed").lastOutboundMessage, /tried giving you a call/i);
  assert.doesNotMatch(store.getContact("john-now-missed").lastOutboundMessage, /looking over your accident info/i);
});

test("repeat NR on an already enrolled NR lead does not resend the initial cold SMS", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "already-nr",
    ghlContactId: "already-nr",
    name: "Already NR",
    phone: "+15550000095",
    tags: ["NR"],
    engagementStatus: ENGAGEMENT.INITIAL_SMS_SENT,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    currentSequenceName: "initial_sms",
    sentColdTemplateKeys: ["day_1_am"],
    lastOutboundMessage: "Hi Already, do you remember the date of the accident?"
  });

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "already-nr",
    name: "Already NR",
    phone: "+15550000095",
    tags: ["NR"],
    disposition: "NR"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.INITIAL_SMS_SENT);
  assert.equal(store.getContact("already-nr").lastOutboundMessage, "Hi Already, do you remember the date of the accident?");
  assert.equal(
    Object.values(store.data.messages).some((message) => message.contactId === "already-nr" && /looking over your accident info/i.test(message.body || "")),
    false
  );
  assert.equal(
    store.data.decisionLogs.some((log) => log.contactId === "already-nr" && log.reason === "repeat_no_response_already_enrolled"),
    true
  );
});

test("repeat NR without a stored NR tag does not resend the initial cold SMS", async () => {
  const { bot, store } = makeBot();

  await bot.startFromNoResponseDisposition({
    contactId: "joseph-dupe",
    name: "Joseph Gomez",
    phone: "+15550000123",
    disposition: "NR"
  });
  await bot.startFromNoResponseDisposition({
    contactId: "joseph-dupe",
    name: "Joseph Gomez",
    phone: "+15550000123",
    disposition: "NR"
  });

  const outbound = store.data.messages.filter((message) => message.contactId === "joseph-dupe" && message.direction === "outbound");
  assert.equal(outbound.length, 1);
  assert.match(outbound[0].body, /do you remember the date of the accident/i);
  assert.equal(
    store.data.decisionLogs.some((log) => log.contactId === "joseph-dupe" && log.reason === "repeat_no_response_already_enrolled"),
    true
  );
});

test("short yes-now inbound triggers urgent call-now instead of staying in cold outreach", async () => {
  const { bot, store } = makeBot();
  let urgentAlerts = 0;
  const originalUrgent = slack.sendUrgentCallNow;
  slack.sendUrgentCallNow = async () => {
    urgentAlerts += 1;
  };
  store.upsertContact({
    id: "yes-now",
    ghlContactId: "yes-now",
    name: "Yes Now",
    phone: "+15550000096",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    lastOutboundMessage: "What was the date of the accident?"
  });

  try {
    const contact = await bot.handleInboundSms({
      contactId: "yes-now",
      message: "Yes now"
    });

    assert.equal(contact.engagementStatus, ENGAGEMENT.READY_FOR_CALL);
    assert.equal(urgentAlerts, 1);
  } finally {
    slack.sendUrgentCallNow = originalUrgent;
  }
});

test("admin can force call-now no-answer recovery and cancel stale cold cadence", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "admin-call-now-missed",
    ghlContactId: "admin-call-now-missed",
    name: "Admin Missed",
    phone: "+15550000097",
    tags: ["NR"],
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    lastInboundMessage: "Yes now",
    sentColdTemplateKeys: ["day_1_am"],
    lastOutboundMessage: "What was the date of the accident?"
  });
  store.addJob({
    type: "send_cold_template",
    contactId: "admin-call-now-missed",
    runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    payload: { templateKey: "day_1_pm" }
  });

  const contact = await bot.applyBotControl({
    contactId: "admin-call-now-missed",
    action: "call_now_no_answer"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.match(store.getContact("admin-call-now-missed").lastOutboundMessage, /tried giving you a call/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "admin-call-now-missed" && job.type === "send_cold_template" && job.status === "pending"),
    false
  );
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "admin-call-now-missed" && job.type === "warm_followup" && job.status === "pending"),
    true
  );
});

test("stale warm follow-up is skipped when qualification progress already advanced", async () => {
  const { bot, store } = makeBot();
  const oldOutbound = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "stale-warm",
    ghlContactId: "stale-warm",
    name: "Mary Brown",
    phone: "+15550000094",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "no",
    lastOutboundTimestamp: oldOutbound,
    lastResponseTimestamp: new Date().toISOString()
  });
  const job = store.addJob({
    type: "warm_followup",
    contactId: "stale-warm",
    runAt: new Date().toISOString(),
    payload: {
      step: 3,
      expectedProgress: QUALIFICATION.NEEDS_MEDICAL,
      baseOutboundTimestamp: oldOutbound
    }
  });

  await bot.runDueJob(job);

  assert.equal(store.data.jobs[job.id].status, "skipped");
  assert.equal(store.data.jobs[job.id].skipReason, "stale_warm_followup_progress_changed");
  assert.equal(store.getContact("stale-warm").lastOutboundMessage, undefined);
});

test("not-today replies ask for another day instead of pushing later today", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "not-today",
    ghlContactId: "not-today",
    name: "Cornellius",
    phone: "+15550000095",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });

  const contact = await bot.handleInboundSms({ contactId: "not-today", message: "Today is not tha day" });

  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.match(store.getContact("not-today").lastOutboundMessage, /tomorrow or another day/i);
  assert.doesNotMatch(store.getContact("not-today").lastOutboundMessage, /later today/i);
});

test("insurance payment detail while asking fault escalates instead of repeating yes-no clarification", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "yolanda-payment",
    ghlContactId: "yolanda-payment",
    name: "Yolanda",
    phone: "+15550000098",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    clarificationAttemptsByQuestion: { [QUALIFICATION.NEEDS_FAULT]: 1 }
  });

  const contact = await bot.handleInboundSms({
    contactId: "yolanda-payment",
    message: "They only paid for the car damage. Never gave me anything for the accident"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(store.getContact("yolanda-payment").escalationReason, "outside_question");
  assert.doesNotMatch(store.getContact("yolanda-payment").lastOutboundMessage || "", /yes, no, or not sure/i);
});

test("payment and cost questions at call stage escalate instead of confirming a time", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "cost-question",
    ghlContactId: "cost-question",
    name: "Cost Question",
    phone: "+15550000101",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes",
    lastOutboundMessage: "What time works best for your Specialist call?"
  });

  const contact = await bot.handleInboundSms({ contactId: "cost-question", message: "Will I have to pay anything?" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(store.getContact("cost-question").escalationReason, "outside_question");
  assert.doesNotMatch(store.getContact("cost-question").lastOutboundMessage || "", /got you down|locked in|exact time/i);
});

test("repeated low-confidence non-answer escalates after one clarification", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "repeat-non-answer",
    ghlContactId: "repeat-non-answer",
    name: "Repeat",
    phone: "+15550000099",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  await bot.clarifyOrEscalate(store.getContact("repeat-non-answer"), "Call you tomorrow", "call_time_before_qualification_needs_human");
  const contact = await bot.clarifyOrEscalate(
    store.getContact("repeat-non-answer"),
    "Never gave me anything for the accident",
    "llm_low_confidence_answer"
  );

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(store.getContact("repeat-non-answer").clarificationAttemptsByQuestion[QUALIFICATION.NEEDS_FAULT], 2);
});

test("LLM call_later date-only output asks for exact time instead of booking a random time", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "bare-tomorrow",
    ghlContactId: "bare-tomorrow",
    name: "Dejee",
    phone: "+15550000096",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });

  const contact = await bot.applyLlmClassification(store.getContact("bare-tomorrow"), {
    label: "call_later",
    confidence: 0.9,
    normalized_value: "2026-05-10",
    reason: "Lead wants a call tomorrow but did not give a time."
  }, "I'll call tomorrow");

  assert.equal(contact.appointmentId, undefined);
  assert.equal(store.getContact("bare-tomorrow").awaitingSpecificCallTime, true);
  assert.match(store.getContact("bare-tomorrow").lastOutboundMessage, /specific time tomorrow/i);
});

test("medical dates plus weekday at call stage ask for exact weekday time instead of booking", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "autumn-weekday",
    ghlContactId: "autumn-weekday",
    name: "Autumn",
    phone: "+15550000098",
    timezone: "America/Denver",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });

  const contact = await bot.handleInboundSms({
    contactId: "autumn-weekday",
    message: "PCP visit and 4/30 Orthopedic visit 4/30 probably not until Tuesday"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("autumn-weekday").appointmentId, undefined);
  assert.equal(store.getContact("autumn-weekday").awaitingSpecificCallTime, true);
  assert.match(store.getContact("autumn-weekday").lastOutboundMessage, /specific time tuesday/i);
});

test("settlement or offer details at call stage escalate instead of becoming an appointment time", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "money-not-time",
    ghlContactId: "money-not-time",
    name: "Kipshowbe",
    phone: "+15550000097",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });

  const contact = await bot.handleInboundSms({
    contactId: "money-not-time",
    message: "I got a bad MRI. They tried to offer me $23,000, but I turned it down"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(store.getContact("money-not-time").appointmentId, undefined);
  assert.equal(store.getContact("money-not-time").escalationReason, "detailed_information");
});

test("acknowledgement LLM path schedules warm follow-ups after repeating current question", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "ack-warm",
    ghlContactId: "ack-warm",
    name: "Chiquita",
    phone: "+15550000091",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    accidentDate: "May 8"
  });

  const contact = await bot.applyLlmClassification(store.getContact("ack-warm"), {
    label: "acknowledgement",
    confidence: 0.9,
    normalized_value: "",
    reason: "Lead acknowledged but did not answer the fault question."
  }, "Ok");

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.match(store.getContact("ack-warm").lastOutboundMessage, /fault/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "ack-warm" && job.type === "warm_followup" && job.status === "pending"),
    true
  );
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
    preferredCallTime: "Thu, May 7, 3:00 PM CDT",
    preferredCallTimeIso: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
    appointmentId: "thanks-appt"
  });
  store.addJob({
    type: "appointment_reminder",
    contactId: "thanks-booked",
    runAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    payload: { templateKey: "sameDayOneHour" }
  });

  const contact = await bot.handleInboundSms({ contactId: "thanks-booked", message: "Okay thanks" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.equal(store.getContact("thanks-booked").appointmentConfirmed, true);
  assert.equal(store.getContact("thanks-booked").humanEscalationStatus, false);
  assert.equal(store.data.escalations.length, 0);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "thanks-booked" && job.type === "appointment_reminder" && job.status === "pending"),
    true
  );
});

test("appointment escalation preserves appointment reminders", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "booked-escalation",
    ghlContactId: "booked-escalation",
    name: "Booked Escalation",
    phone: "+15550000077",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Thu, May 7, 3:00 PM CDT",
    preferredCallTimeIso: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
    appointmentId: "booked-appt"
  });
  store.addJob({
    type: "appointment_reminder",
    contactId: "booked-escalation",
    runAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    payload: { templateKey: "sameDayOneHour" }
  });
  store.addJob({
    type: "warm_followup",
    contactId: "booked-escalation",
    runAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    payload: { step: 1 }
  });

  await bot.escalate(store.getContact("booked-escalation"), "appointment_reply_needs_human_review");
  const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "booked-escalation");

  assert.equal(jobs.some((job) => job.type === "appointment_reminder" && job.status === "pending"), true);
  assert.equal(jobs.some((job) => job.type === "warm_followup" && job.status === "pending"), false);
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

test("soft refusal at call-time escalates instead of asking yes/no clarification", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "arthur-refusal",
    ghlContactId: "arthur-refusal",
    name: "Arthur Jackson",
    phone: "+15550000180",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes",
    lastOutboundMessage: "What time works best for a quick call?"
  });

  const contact = await bot.handleInboundSms({ contactId: "arthur-refusal", message: "No thank you" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(contact.humanEscalationStatus, true);
  assert.equal(contact.escalationReason, "soft_refusal");
  assert.doesNotMatch(store.getContact("arthur-refusal").lastOutboundMessage || "", /quick yes, no, or not sure/i);
});

test("primary and backup in the same scheduling reply are both saved", async () => {
  const { bot, store } = makeBot();
  const originalSendAppointmentBooked = slack.sendAppointmentBooked;
  const alerts = [];
  slack.sendAppointmentBooked = async (_config, _contact, extra) => {
    alerts.push(extra);
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "maggie-inline-backup",
      ghlContactId: "maggie-inline-backup",
      name: "Maggie Lopez",
      phone: "+15550000152",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      faultAnswer: "not_at_fault",
      medicalTreatmentAnswer: "yes"
    });

    const contact = await bot.handleCallTime(
      store.getContact("maggie-inline-backup"),
      "Anytime work after 10am. Let's say tomorrow about 10:30 Yeah for sure let's say 230 pm if I happen to miss u at 10:30"
    );

    assert.equal(contact.awaitingBackupTime, false);
    assert.equal(contact.qualificationProgress, QUALIFICATION.COMPLETE);
    assert.match(contact.preferredCallTime, /10:30 AM/);
    assert.match(contact.backupCallTime, /2:30 PM/);
    assert.ok(contact.backupCallTimeIso);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0]["Backup time"], /2:30 PM/);
    assert.match(store.getContact("maggie-inline-backup").lastOutboundMessage, /2:30 PM CST as a backup/);
  } finally {
    slack.sendAppointmentBooked = originalSendAppointmentBooked;
  }
});

test("explicit earlier call time while awaiting backup reschedules primary appointment", async () => {
  const { bot, store } = makeBot();
  const originalUpdateAppointment = ghl.updateAppointment;
  const updates = [];
  ghl.updateAppointment = async (_config, _contact, appointmentId, startsAt, endsAt, notes) => {
    updates.push({ appointmentId, startsAt, endsAt, notes });
    return { id: appointmentId };
  };
  store.upsertContact({
    id: "backup-primary-correction",
    ghlContactId: "backup-primary-correction",
    name: "Backup Correction",
    phone: "+15550000081",
    tags: ["lhpark_ca"],
    timezone: "America/Los_Angeles",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "next week",
    preferredCallTimeIso: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    appointmentId: "appt-backup-primary",
    awaitingBackupTime: true
  });

  try {
    const contact = await bot.handleInboundSms({
      contactId: "backup-primary-correction",
      message: "you can call tomorrow at 2 pm"
    });

    assert.equal(contact.awaitingBackupTime, false);
    assert.equal(contact.backupCallTime, undefined);
    assert.match(contact.preferredCallTime, /2:00 PM PST/);
    assert.equal(updates.some((update) => update.appointmentId === "appt-backup-primary"), true);
    assert.match(store.getContact("backup-primary-correction").lastOutboundMessage, /rescheduled|updated|locked|moved/i);
  } finally {
    ghl.updateAppointment = originalUpdateAppointment;
  }
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

test("booking Slack waits until backup time is resolved or timeout fires", async () => {
  const { bot, store } = makeBot();
  const originalSendAppointmentBooked = slack.sendAppointmentBooked;
  let bookingAlerts = 0;
  slack.sendAppointmentBooked = async () => {
    bookingAlerts += 1;
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "booking-alert-delay",
      ghlContactId: "booking-alert-delay",
      name: "Booking Alert Delay",
      phone: "+15550000141",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
    });

    const booked = await bot.handleCallTime(store.getContact("booking-alert-delay"), "tomorrow at 10am");
    const timeoutJob = Object.values(store.data.jobs).find(
      (job) => job.contactId === "booking-alert-delay" && job.type === "backup_time_timeout" && job.status === "pending"
    );

    assert.equal(booked.awaitingBackupTime, true);
    assert.equal(store.getContact("booking-alert-delay").bookingAlertSentAt, undefined);
    assert.equal(bookingAlerts, 0);
    assert.ok(timeoutJob);

    await bot.syncAppointment({
      contactId: "booking-alert-delay",
      appointmentId: "ghl-echo-before-backup",
      startTime: store.getContact("booking-alert-delay").preferredCallTimeIso,
      status: "confirmed"
    });

    assert.equal(store.getContact("booking-alert-delay").awaitingBackupTime, true);
    assert.equal(bookingAlerts, 0);
    assert.equal(store.data.jobs[timeoutJob.id].status, "pending");

    await bot.runDueJob({ ...store.data.jobs[timeoutJob.id], runAt: new Date().toISOString() });

    assert.equal(store.getContact("booking-alert-delay").awaitingBackupTime, false);
    assert.ok(store.getContact("booking-alert-delay").bookingAlertSentAt);
    assert.equal(bookingAlerts, 1);
  } finally {
    slack.sendAppointmentBooked = originalSendAppointmentBooked;
  }
});

test("backup time answer sends the first booking Slack with backup included", async () => {
  const { bot, store } = makeBot();
  const originalSendAppointmentBooked = slack.sendAppointmentBooked;
  const alerts = [];
  slack.sendAppointmentBooked = async (_config, _contact, extra) => {
    alerts.push(extra);
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "booking-alert-backup",
      ghlContactId: "booking-alert-backup",
      name: "Backup Alert",
      phone: "+15550000142",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
      qualificationProgress: QUALIFICATION.CALL_BOOKED,
      preferredCallTime: "Mon, May 11, 10:00 AM CST",
      preferredCallTimeIso: "2026-05-11T15:00:00.000Z",
      appointmentId: "appt-backup-alert",
      awaitingBackupTime: true
    });

    const contact = await bot.handleInboundSms({ contactId: "booking-alert-backup", message: "11am works as backup" });

    assert.equal(contact.awaitingBackupTime, false);
    assert.ok(store.getContact("booking-alert-backup").bookingAlertSentAt);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0]["Backup time"], /11:00 AM/);
  } finally {
    slack.sendAppointmentBooked = originalSendAppointmentBooked;
  }
});

test("call time range after tomorrow clarification books primary and backup", async () => {
  const { bot, store } = makeBot();
  const originalCreateAppointment = ghl.createAppointment;
  ghl.createAppointment = async () => ({ id: "range-appt" });
  try {
    store.upsertContact({
      id: "range-call-time",
      ghlContactId: "range-call-time",
      name: "Halema",
      phone: "+15550000188",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      faultAnswer: "not_at_fault",
      medicalTreatmentAnswer: "yes",
      awaitingSpecificCallTime: true,
      callTimeClarificationDay: "tomorrow",
      callTimeClarificationAskedAt: new Date().toISOString()
    });

    const contact = await bot.handleInboundSms({ contactId: "range-call-time", message: "3-4" });
    const saved = store.getContact("range-call-time");

    assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
    assert.equal(saved.appointmentId, "range-appt");
    assert.match(saved.preferredCallTime, /3:00 PM/);
    assert.match(saved.backupCallTime, /4:00 PM/);
    assert.equal(saved.backupCallTimeType, "exact");
    assert.match(saved.lastOutboundMessage, /4:00 PM .*backup/i);
    assert.equal(
      Object.values(store.data.jobs).some(
        (job) => job.contactId === "range-call-time" && job.type === "appointment_reminder" && job.status === "pending"
      ),
      true
    );
  } finally {
    ghl.createAppointment = originalCreateAppointment;
  }
});

test("natural time window suggests a clean reschedule slot instead of repeating exact-time asks", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "natural-window-reschedule",
    ghlContactId: "natural-window-reschedule",
    name: "Derick",
    phone: "+15550000189",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Wed, May 13, 3:00 PM CST",
    preferredCallTimeIso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    appointmentId: "appt-natural-window",
    awaitingSpecificCallTime: true,
    callTimeClarificationDay: "tomorrow",
    callTimeClarificationMode: "reschedule",
    callTimeClarificationAskedAt: new Date().toISOString()
  });

  const contact = await bot.handleInboundSms({ contactId: "natural-window-reschedule", message: "After 330 before 5" });

  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.equal(contact.availabilitySuggestionMode, "reschedule");
  assert.match(contact.lastOutboundMessage, /4:00 PM/);
  assert.match(contact.lastOutboundMessage, /4:30 PM.*backup/);
  assert.doesNotMatch(contact.lastOutboundMessage, /exact time/i);
  assert.equal(
    Object.values(store.data.jobs).some(
      (job) => job.contactId === "natural-window-reschedule" && job.type === "warm_followup" && job.status === "pending"
    ),
    true
  );
});

test("yes to a suggested reschedule slot updates the existing appointment with backup", async () => {
  const { bot, store } = makeBot();
  const originalUpdateAppointment = ghl.updateAppointment;
  ghl.updateAppointment = async () => ({ id: "appt-natural-window" });
  try {
    const localTomorrow = getLocalParts(addDays(new Date(), 1), "America/Chicago");
    const primaryIso = localDateToUtc(
      { year: localTomorrow.year, month: localTomorrow.month, day: localTomorrow.day, hour: 16, minute: 0 },
      "America/Chicago"
    ).toISOString();
    const backupIso = localDateToUtc(
      { year: localTomorrow.year, month: localTomorrow.month, day: localTomorrow.day, hour: 16, minute: 30 },
      "America/Chicago"
    ).toISOString();
    store.upsertContact({
      id: "natural-window-confirm",
      ghlContactId: "natural-window-confirm",
      name: "Derick",
      phone: "+15550000190",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      preferredCallTime: "Wed, May 13, 3:00 PM CST",
      preferredCallTimeIso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      appointmentId: "appt-natural-window",
      awaitingSpecificCallTime: true,
      availabilitySuggestionMode: "reschedule",
      availabilitySuggestedPrimaryIso: primaryIso,
      availabilitySuggestedPrimaryText: "4:00 PM",
      availabilitySuggestedSecondaryIso: backupIso,
      availabilitySuggestedSecondaryText: "4:30 PM"
    });

    const contact = await bot.handleCallTime(store.getContact("natural-window-confirm"), "yes");

    assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
    assert.equal(contact.appointmentId, "appt-natural-window");
    assert.equal(contact.backupCallTimeType, "exact");
    assert.match(contact.backupCallTime, /4:30 PM/);
    assert.match(contact.lastOutboundMessage, /moved your Specialist call/i);
  } finally {
    ghl.updateAppointment = originalUpdateAppointment;
  }
});

test("human outbound time can complete scheduling and create reminders", async () => {
  const { bot, store } = makeBot();
  const originalCreateAppointment = ghl.createAppointment;
  ghl.createAppointment = async () => ({ id: "human-booked-appt" });
  try {
    store.upsertContact({
      id: "human-booked-time",
      ghlContactId: "human-booked-time",
      name: "Human Assist",
      phone: "+15550000189",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      humanEscalationStatus: true,
      humanEscalationStage: "human_working",
      automationPaused: true,
      automationPauseReason: "human_working",
      awaitingSpecificCallTime: true,
      callTimeClarificationDay: "tomorrow",
      callTimeClarificationAskedAt: new Date().toISOString()
    });

    const contact = await bot.handleHumanOutbound({ contactId: "human-booked-time", message: "3 pm" });
    const messages = store.data.messages.filter((message) => message.contactId === "human-booked-time");

    assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
    assert.equal(store.getContact("human-booked-time").appointmentId, "human-booked-appt");
    assert.equal(messages.some((message) => message.direction === "human_outbound" && message.body === "3 pm"), true);
    assert.match(store.getContact("human-booked-time").lastOutboundMessage, /backup time/i);
    assert.equal(
      Object.values(store.data.jobs).some(
        (job) => job.contactId === "human-booked-time" && job.type === "appointment_reminder" && job.status === "pending"
      ),
      true
    );
  } finally {
    ghl.createAppointment = originalCreateAppointment;
  }
});

test("legacy next-day evening reminder jobs still render", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "legacy-evening-reminder",
    ghlContactId: "legacy-evening-reminder",
    name: "Leslie",
    phone: "+15550000060",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Sat, May 9, 5:00 PM CST",
    preferredCallTimeIso: new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString(),
    appointmentId: "appt-legacy"
  });
  const job = store.addJob({
    type: "appointment_reminder",
    contactId: "legacy-evening-reminder",
    runAt: new Date().toISOString(),
    payload: { templateKey: "nextDayEvening" }
  });

  await bot.runDueJob(job);

  assert.match(store.getContact("legacy-evening-reminder").lastOutboundMessage, /tomorrow/i);
  assert.equal(store.data.jobs[job.id].status, "done");
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
  const localNowForSoon = getLocalParts(new Date(), "America/Chicago");
  const localSoon = getLocalParts(new Date(soon), "America/Chicago");
  const soonExpected =
    localSoon.year === localNowForSoon.year &&
    localSoon.month === localNowForSoon.month &&
    localSoon.day === localNowForSoon.day
      ? ["sameDayFiveMinutes"]
      : ["nextDayFiveMinutes"];
  assert.deepEqual(
    Object.values(store.data.jobs)
      .filter((job) => job.contactId === "reminder-soon" && job.type === "appointment_reminder")
      .map((job) => job.payload.templateKey),
    soonExpected
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
  const localNowForLater = getLocalParts(new Date(), "America/Chicago");
  const localLater = getLocalParts(new Date(later), "America/Chicago");
  const laterExpected =
    localLater.year === localNowForLater.year &&
    localLater.month === localNowForLater.month &&
    localLater.day === localNowForLater.day
      ? ["sameDayOneHour", "sameDayFiveMinutes"]
      : ["nextDayOneHour", "nextDayFiveMinutes"];
  assert.deepEqual(
    Object.values(store.data.jobs)
      .filter((job) => job.contactId === "reminder-later" && job.type === "appointment_reminder")
      .map((job) => job.payload.templateKey),
    laterExpected
  );

  const nearOneHour = new Date(Date.now() + 70 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "reminder-near-one-hour",
    ghlContactId: "reminder-near-one-hour",
    name: "Near",
    phone: "+15550000079",
    timezone: "America/Chicago",
    preferredCallTimeIso: nearOneHour
  });
  await bot.scheduleAppointmentReminders(store.getContact("reminder-near-one-hour"));
  const localNearOneHour = getLocalParts(new Date(nearOneHour), "America/Chicago");
  const nearOneHourExpected =
    localNearOneHour.year === localNowForLater.year &&
    localNearOneHour.month === localNowForLater.month &&
    localNearOneHour.day === localNowForLater.day
      ? ["sameDayFiveMinutes"]
      : ["nextDayFiveMinutes"];
  assert.deepEqual(
    Object.values(store.data.jobs)
      .filter((job) => job.contactId === "reminder-near-one-hour" && job.type === "appointment_reminder")
      .map((job) => job.payload.templateKey),
    nearOneHourExpected
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
  assert.equal(
    Object.values(store.data.jobs)
      .filter((job) => job.contactId === "reminder-tomorrow" && job.type === "appointment_reminder")
      .every((job) => job.payload.appointmentIso === tomorrow),
    true
  );
});

test("appointment reminder copy uses time only instead of repeating the full date", async () => {
  const { bot, store } = makeBot();
  const appointment = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const runAt = new Date(new Date(appointment).getTime() - 60 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "reminder-time-only",
    ghlContactId: "reminder-time-only",
    name: "Time Only",
    phone: "+15550000181",
    timezone: "America/Chicago",
    preferredCallTime: "Mon, May 11, 3:00 PM CST",
    preferredCallTimeIso: appointment
  });
  const job = store.addJob({
    type: "appointment_reminder",
    contactId: "reminder-time-only",
    runAt,
    payload: { templateKey: "sameDayOneHour", appointmentIso: appointment }
  });

  await bot.runDueJob(job);

  assert.match(store.getContact("reminder-time-only").lastOutboundMessage, /\b\d{1,2}:\d{2} [AP]M (?:CST|MST|PST|EST)\b/);
  assert.doesNotMatch(store.getContact("reminder-time-only").lastOutboundMessage, /Mon, May|Tue, May|Wed, May|Thu, May|Fri, May|Sat, May|Sun, May/);
});

test("stale appointment reminder is skipped when appointment time changes", async () => {
  const { bot, store } = makeBot();
  const localTomorrow = getLocalParts(addDays(new Date(), 1), "America/Chicago");
  const appointment = localDateToUtc(
    { year: localTomorrow.year, month: localTomorrow.month, day: localTomorrow.day, hour: 23, minute: 0 },
    "America/Chicago"
  ).toISOString();
  const staleRunAt = localDateToUtc(
    { year: localTomorrow.year, month: localTomorrow.month, day: localTomorrow.day, hour: 8, minute: 0 },
    "America/Chicago"
  ).toISOString();
  store.upsertContact({
    id: "stale-reminder",
    ghlContactId: "stale-reminder",
    name: "Stale Reminder",
    phone: "+15550000182",
    timezone: "America/Chicago",
    preferredCallTime: "Tomorrow 11:00 PM CST",
    preferredCallTimeIso: appointment
  });
  const job = store.addJob({
    type: "appointment_reminder",
    contactId: "stale-reminder",
    runAt: staleRunAt,
    payload: { templateKey: "sameDayOneHour" }
  });

  await bot.runDueJob(job);

  assert.equal(store.data.jobs[job.id].status, "skipped");
  assert.equal(store.data.jobs[job.id].skipReason, "stale_appointment_reminder_time_changed");
  assert.equal(store.getContact("stale-reminder").lastOutboundMessage, undefined);
});

test("admin action can ensure reminders for an already booked appointment", async () => {
  const { bot, store } = makeBot();
  const startsAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "ensure-reminders",
    ghlContactId: "ensure-reminders",
    name: "Ensure Reminders",
    phone: "+15550000083",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTimeIso: startsAt,
    appointmentId: "appt-ensure"
  });

  await bot.applyBotControl({ contactId: "ensure-reminders", action: "ensure_appointment_reminders" });

  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "ensure-reminders" && job.type === "appointment_reminder" && job.status === "pending"),
    true
  );
});

test("stuck-state healer recreates missing appointment reminders for scheduled calls", async () => {
  const { bot, store } = makeBot();
  const startsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "missing-reminder-heal",
    ghlContactId: "missing-reminder-heal",
    name: "Sidiki",
    phone: "+15550000241",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Today at 4:00 PM CST",
    preferredCallTimeIso: startsAt,
    appointmentId: "appt-missing-reminders"
  });

  const healed = await bot.healStuckContacts();
  const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "missing-reminder-heal");

  assert.deepEqual(healed, [{ contactId: "missing-reminder-heal", action: "scheduled_missing_appointment_reminders" }]);
  assert.equal(jobs.some((job) => job.type === "appointment_reminder" && job.status === "pending"), true);
});

test("stuck-state healer recreates missing appointment reminders for human-booked appointments", async () => {
  const { bot, store } = makeBot();
  const startsAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "human-booked-missing-reminder",
    ghlContactId: "human-booked-missing-reminder",
    name: "Human Booked",
    phone: "+15550000243",
    timezone: "America/Denver",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.COMPLETE,
    humanEscalationStatus: true,
    humanEscalationStage: "human_working",
    automationPaused: true,
    automationPauseReason: "human_working",
    preferredCallTime: "Today at 2:00 PM MST",
    preferredCallTimeIso: startsAt,
    appointmentId: "appt-human-booked",
    appointmentSyncedAt: new Date().toISOString()
  });

  const healed = await bot.healStuckContacts();
  const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "human-booked-missing-reminder");

  assert.deepEqual(healed, [{ contactId: "human-booked-missing-reminder", action: "scheduled_missing_appointment_reminders" }]);
  assert.equal(jobs.some((job) => job.type === "appointment_reminder" && job.status === "pending"), true);
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

test("specific time after tomorrow clarification books tomorrow instead of today", async () => {
  const { bot, store } = makeBot();
  const timeZone = "America/Denver";
  store.upsertContact({
    id: "tomorrow-context-booking",
    ghlContactId: "tomorrow-context-booking",
    name: "Lester",
    phone: "+15550000101",
    timezone: timeZone,
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "no",
    awaitingSpecificCallTime: true,
    callTimeClarificationDay: "tomorrow",
    callTimeClarificationMode: "booking",
    callTimeClarificationAskedAt: new Date().toISOString()
  });

  await bot.handleInboundSms({ contactId: "tomorrow-context-booking", message: "6" });

  const contact = store.getContact("tomorrow-context-booking");
  const booked = getLocalParts(new Date(contact.preferredCallTimeIso), timeZone);
  assert.equal(booked.hour, 18);
  assert.equal(localDayNumber(new Date(contact.preferredCallTimeIso), timeZone), localDayNumber(new Date(), timeZone) + 1);
  assert.match(contact.lastOutboundMessage, /6:00 PM/);
});

test("reschedule correction remembers tomorrow when lead gives only the new time", async () => {
  const { bot, store } = makeBot();
  const timeZone = "America/Denver";
  store.upsertContact({
    id: "lester-reschedule-context",
    ghlContactId: "lester-reschedule-context",
    name: "Lester",
    phone: "+15550000102",
    timezone: timeZone,
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "today at 6",
    preferredCallTimeIso: localDateToUtc({ ...getLocalParts(new Date(), timeZone), hour: 18, minute: 0 }, timeZone).toISOString(),
    appointmentId: "appt-lester-context"
  });

  let contact = await bot.handleInboundSms({
    contactId: "lester-reschedule-context",
    message: "That's today I said tomorrow"
  });

  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.equal(store.getContact("lester-reschedule-context").callTimeClarificationDay, "tomorrow");
  assert.match(store.getContact("lester-reschedule-context").lastOutboundMessage, /tomorrow/i);

  contact = await bot.handleInboundSms({ contactId: "lester-reschedule-context", message: "6 pm" });

  const booked = getLocalParts(new Date(contact.preferredCallTimeIso), timeZone);
  assert.equal(booked.hour, 18);
  assert.equal(localDayNumber(new Date(contact.preferredCallTimeIso), timeZone), localDayNumber(new Date(), timeZone) + 1);
  assert.equal(contact.callTimeClarificationDay, "");
  assert.match(store.getContact("lester-reschedule-context").lastOutboundMessage, /moved your Specialist call/i);
});

test("admin can reschedule an appointment to a supplied time", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "admin-reschedule",
    ghlContactId: "admin-reschedule",
    name: "Admin Reschedule",
    phone: "+15550000103",
    timezone: "America/Denver",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "old time",
    preferredCallTimeIso: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    appointmentId: "appt-admin-reschedule"
  });

  const contact = await bot.applyBotControl({
    contactId: "admin-reschedule",
    action: "reschedule_to",
    callTime: "tomorrow at 6 pm",
    source: "admin_contact_action"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.match(contact.preferredCallTime, /6:00 PM/);
  assert.match(contact.lastOutboundMessage, /moved your Specialist call/i);
});

test("admin can silently repair a bad appointment sync without changing booking alert", async () => {
  const { bot, store } = makeBot();
  const originalAlertAt = "2026-05-10T23:23:20.000Z";
  store.upsertContact({
    id: "admin-silent-sync",
    ghlContactId: "admin-silent-sync",
    name: "Admin Silent Sync",
    phone: "+15550000081",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Mon, May 11, 5:00 AM CST",
    preferredCallTimeIso: "2026-05-11T10:00:00.000Z",
    appointmentId: "bad-id",
    bookingAlertSentAt: originalAlertAt
  });

  const contact = await bot.applyBotControl({
    contactId: "admin-silent-sync",
    action: "silent_appointment_sync",
    appointmentId: "fixed-id",
    startTime: "2026-05-11T10:00:00"
  });

  assert.equal(contact.preferredCallTimeIso, "2026-05-11T15:00:00.000Z");
  assert.match(contact.preferredCallTime, /10:00 AM CST/);
  assert.equal(contact.appointmentId, "fixed-id");
  assert.equal(contact.bookingAlertSentAt, originalAlertAt);
});

test("state correction after booking keeps the wall-clock appointment time in the corrected timezone", async () => {
  const { bot, store } = makeBot();
  const originalUpdateAppointment = ghl.updateAppointment;
  const updates = [];
  ghl.updateAppointment = async (_config, _contact, appointmentId, startsAt, endsAt, notes) => {
    updates.push({ appointmentId, startsAt, endsAt, notes });
    return { id: appointmentId };
  };
  store.upsertContact({
    id: "booking-timezone-correction",
    ghlContactId: "booking-timezone-correction",
    name: "Timezone Correction",
    phone: "+15550000078",
    timezone: "America/New_York",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Fri, May 8, 4:00 PM EST",
    preferredCallTimeIso: "2026-05-08T20:00:00.000Z",
    appointmentId: "appt-tz",
    awaitingBackupTime: true
  });

  try {
    const contact = await bot.handleInboundSms({
      contactId: "booking-timezone-correction",
      message: "Okay\nI am in California"
    });

    assert.equal(contact.timezone, "America/Los_Angeles");
    assert.match(contact.preferredCallTime, /4:00 PM PST/);
    assert.equal(contact.preferredCallTimeIso, "2026-05-08T23:00:00.000Z");
    assert.equal(updates.some((update) => update.startsAt === "2026-05-08T23:00:00.000Z"), true);
    assert.match(store.getContact("booking-timezone-correction").lastOutboundMessage, /4:00 PM PST/);
  } finally {
    ghl.updateAppointment = originalUpdateAppointment;
  }
});

test("timezone correction ignores normal words like call me", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "timezone-call-me",
    ghlContactId: "timezone-call-me",
    name: "Timezone Call Me",
    phone: "+15550000079",
    tags: ["lhpark_ca"],
    timezone: "America/Los_Angeles",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "no"
  });

  await bot.handleInboundSms({
    contactId: "timezone-call-me",
    message: "Yes I am at 2 pm u can call me"
  });

  assert.equal(store.getContact("timezone-call-me").timezone, "America/Los_Angeles");
  assert.match(store.getContact("timezone-call-me").preferredCallTime, /PST/);
});

test("admin timezone refresh uses firm tag and preserves booked wall-clock time", async () => {
  const { bot, store } = makeBot();
  const originalUpdateAppointment = ghl.updateAppointment;
  const updates = [];
  ghl.updateAppointment = async (_config, _contact, appointmentId, startsAt, endsAt, notes) => {
    updates.push({ appointmentId, startsAt, endsAt, notes });
    return { id: appointmentId };
  };
  store.upsertContact({
    id: "admin-tz-refresh",
    ghlContactId: "admin-tz-refresh",
    name: "Admin Timezone",
    phone: "+15550000080",
    tags: ["lhpark_ca", "nr"],
    timezone: "America/Los_Angeles",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Sat, May 9, 2:00 PM EST",
    preferredCallTimeIso: "2026-05-09T18:00:00.000Z",
    appointmentId: "appt-admin-tz"
  });

  try {
    const contact = await bot.applyBotControl({ contactId: "admin-tz-refresh", action: "refresh_timezone" });

    assert.equal(contact.timezone, "America/Los_Angeles");
    assert.equal(contact.preferredCallTimeIso, "2026-05-09T21:00:00.000Z");
    assert.match(contact.preferredCallTime, /2:00 PM PST/);
    assert.equal(updates.some((update) => update.appointmentId === "appt-admin-tz" && update.startsAt === "2026-05-09T21:00:00.000Z"), true);
  } finally {
    ghl.updateAppointment = originalUpdateAppointment;
  }
});

test("admin primary call time repair uses latest inbound without sending another SMS", async () => {
  const { bot, store } = makeBot();
  const originalUpdateAppointment = ghl.updateAppointment;
  const updates = [];
  const targetLocal = getLocalParts(new Date(), "America/Los_Angeles");
  const targetIso = localDateToUtc(
    {
      year: targetLocal.year,
      month: targetLocal.month,
      day: targetLocal.day + 1,
      hour: 14,
      minute: 0
    },
    "America/Los_Angeles"
  ).toISOString();
  ghl.updateAppointment = async (_config, _contact, appointmentId, startsAt, endsAt, notes) => {
    updates.push({ appointmentId, startsAt, endsAt, notes });
    return { id: appointmentId };
  };
  store.upsertContact({
    id: "admin-primary-repair",
    ghlContactId: "admin-primary-repair",
    name: "Primary Repair",
    phone: "+15550000082",
    tags: ["lhpark_ca"],
    timezone: "America/Los_Angeles",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Sat, May 9, 2:00 PM EST",
    preferredCallTimeIso: "2026-05-09T18:00:00.000Z",
    backupCallTime: "Fri, May 8, 2:00 PM PST",
    backupCallTimeIso: "2026-05-08T21:00:00.000Z",
    appointmentId: "appt-primary-repair",
    lastInboundMessage: "U can call tomorrow at 2 pm",
    lastOutboundMessage: "old message"
  });

  try {
    const contact = await bot.applyBotControl({ contactId: "admin-primary-repair", action: "repair_primary_call_time" });

    assert.equal(contact.preferredCallTimeIso, targetIso);
    assert.match(contact.preferredCallTime, /2:00 PM PST/);
    assert.equal(contact.backupCallTime, "");
    assert.equal(contact.lastOutboundMessage, "old message");
    assert.equal(updates.some((update) => update.appointmentId === "appt-primary-repair" && update.startsAt === targetIso), true);
  } finally {
    ghl.updateAppointment = originalUpdateAppointment;
  }
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

test("contract set tag prevents no-response outreach from starting", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "contract-set-1",
    name: "Contract Set",
    phone: "+15550000076",
    tags: ["contract set"],
    disposition: "no response"
  });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "contract_pending_tag");
  assert.equal(store.data.messages.length, 0);
});

test("plain contract tag prevents no-response outreach from starting", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "contract-plain-1",
    name: "Contract Plain",
    phone: "+15550000077",
    tags: ["contract"],
    disposition: "no response"
  });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "contract_pending_tag");
  assert.equal(store.data.messages.length, 0);
});

test("follow up tag prevents no-response outreach from starting", async () => {
  const { bot, store } = makeBot();

  const contact = await bot.startFromNoResponseDisposition({
    contactId: "follow-up-hold-1",
    name: "Follow Up Hold",
    phone: "+15550000078",
    tags: ["follow up"],
    disposition: "no response"
  });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "manual_hold_tag");
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

test("duplicate escalations for same human-managed contact are suppressed", async () => {
  const { bot, store } = makeBot();
  const contact = store.upsertContact({
    id: "dedupe-escalation",
    ghlContactId: "dedupe-escalation",
    name: "Dedupe Escalation",
    phone: "+15550000084",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    lastInboundMessage: "Please call to discuss next step"
  });

  const first = await bot.escalate(contact, "llm_call_now");
  const second = await bot.escalate({ ...first, lastInboundMessage: "Please call to discuss next step" }, "llm_call_now");

  assert.equal(second.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(store.data.escalations.length, 1);
  assert.equal(store.getContact("dedupe-escalation").lastSuppressedEscalationReason, "llm_call_now");
});

test("new inbound replies on escalated contacts notify Slack without resuming bot", async () => {
  const { bot, store } = makeBot();
  const originalSendEscalatedInbound = slack.sendEscalatedInbound;
  let alerts = 0;
  slack.sendEscalatedInbound = async () => {
    alerts += 1;
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "escalated-typing",
      ghlContactId: "escalated-typing",
      name: "Escalated Typing",
      phone: "+15550000149",
      engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      humanEscalationStatus: true,
      humanEscalationStage: "human_review_pending",
      escalationReason: "human_request",
      lastInboundMessage: "Can someone call me?"
    });

    const contact = await bot.handleInboundSms({
      contactId: "escalated-typing",
      message: "Also my neck is hurting badly"
    });

    assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
    assert.equal(contact.humanEscalationStatus, true);
    assert.equal(alerts, 1);
    assert.equal(store.data.escalations.filter((item) => item.contactId === "escalated-typing").length, 1);
    assert.equal(store.getContact("escalated-typing").lastHumanManagedInboundMessage, "Also my neck is hurting badly");
  } finally {
    slack.sendEscalatedInbound = originalSendEscalatedInbound;
  }
});

test("human escalation SLA jobs are tracked silently instead of posting bot-error Slack alerts", async () => {
  const { bot, store } = makeBot();
  let botErrorCount = 0;
  bot.notifyBotError = async () => {
    botErrorCount += 1;
  };
  store.upsertContact({
    id: "human-sla-silent",
    ghlContactId: "human-sla-silent",
    name: "Human Silent",
    phone: "+15550000075",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "human_request",
    lastInboundMessage: "Can I speak to someone?"
  });
  const job = store.addJob({
    type: "human_escalation_sla",
    contactId: "human-sla-silent",
    runAt: new Date().toISOString(),
    payload: { minutes: 5, reason: "human_request" }
  });

  await bot.runDueJob(job);

  const contact = store.getContact("human-sla-silent");
  assert.equal(botErrorCount, 0);
  assert.equal(contact.lastHumanEscalationSlaMinutes, 5);
  assert.equal(contact.lastHumanEscalationSlaReason, "human_request");
  assert.equal(store.data.jobs[job.id].status, "done");
});

test("recoverable unacknowledged human escalation returns to bot after 30 minutes", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-sla-return",
    ghlContactId: "human-sla-return",
    name: "Human Return",
    phone: "+15550000076",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "detailed_information",
    lastInboundMessage: "It is up in the air and there were a lot of details."
  });
  const job = store.addJob({
    type: "human_escalation_sla",
    contactId: "human-sla-return",
    runAt: new Date().toISOString(),
    payload: { minutes: 30, reason: "detailed_information" }
  });

  await bot.runDueJob(job);

  const contact = store.getContact("human-sla-return");
  assert.equal(contact.humanEscalationStatus, false);
  assert.equal(contact.automationPaused, false);
  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(contact.humanEscalationStage, "auto_returned_after_unacknowledged_escalation");
  assert.match(contact.lastOutboundMessage, /still here with me/i);
  assert.equal(
    Object.values(store.data.jobs).some((item) => item.contactId === "human-sla-return" && item.type === "warm_followup" && item.status === "pending"),
    true
  );
});

test("LLM needs-escalation without human ack can return to bot after 30 minutes", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-sla-llm",
    ghlContactId: "human-sla-llm",
    name: "Mukul",
    phone: "+15550000092",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "llm_needs_escalation",
    lastInboundMessage: "I already answered all the questions before"
  });
  const job = store.addJob({
    type: "human_escalation_sla",
    contactId: "human-sla-llm",
    runAt: new Date().toISOString(),
    payload: { minutes: 30, reason: "llm_needs_escalation" }
  });

  await bot.runDueJob(job);

  const contact = store.getContact("human-sla-llm");
  assert.equal(contact.humanEscalationStatus, false);
  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(contact.humanEscalationStage, "auto_returned_after_unacknowledged_escalation");
  assert.match(contact.lastOutboundMessage, /still here with me/i);
});

test("stuck active qualification contact gets warm follow-ups repaired", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "stuck-active",
    ghlContactId: "stuck-active",
    name: "Chiquita",
    phone: "+15550000093",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    lastResponseTimestamp: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    lastOutboundTimestamp: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    lastOutboundMessage: "Were you at fault?"
  });

  const healed = await bot.healStuckContacts();

  assert.deepEqual(healed, [{ contactId: "stuck-active", action: "scheduled_warm_followups" }]);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "stuck-active" && job.type === "warm_followup" && job.status === "pending"),
    true
  );
});

test("stuck contact with unprocessed call time inbound resumes booking flow", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "stuck-inbound-time",
    ghlContactId: "stuck-inbound-time",
    name: "Steve",
    phone: "+15550000095",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    lastResponseTimestamp: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    lastInboundMessage: "10:30 a.m.",
    lastOutboundTimestamp: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    lastOutboundMessage: "What time works best?"
  });

  const healed = await bot.healStuckContacts();

  assert.deepEqual(healed, [{ contactId: "stuck-inbound-time", action: "processed_stale_inbound" }]);
  assert.equal(store.getContact("stuck-inbound-time").engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.match(store.getContact("stuck-inbound-time").lastOutboundMessage, /backup time/i);
});

test("stuck recoverable soft escalation gets queued back to bot", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "stuck-soft",
    ghlContactId: "stuck-soft",
    name: "Mukul",
    phone: "+15550000094",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "llm_needs_escalation",
    escalatedAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    lastInboundMessage: "I already answered all the questions before"
  });

  const healed = await bot.healStuckContacts();

  assert.deepEqual(healed, [{ contactId: "stuck-soft", action: "auto_returned_soft_escalation" }]);
  assert.equal(store.getContact("stuck-soft").humanEscalationStatus, false);
  assert.equal(store.getContact("stuck-soft").engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
});

test("stuck-state healer does not reprocess already escalated human leads every minute", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "stuck-escalated-no-loop",
    ghlContactId: "stuck-escalated-no-loop",
    name: "No Loop",
    phone: "+15550000087",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "llm_call_now",
    escalatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    lastInboundMessage: "Please call to discuss next step",
    lastResponseTimestamp: new Date().toISOString(),
    lastOutboundTimestamp: new Date(Date.now() - 20 * 60 * 1000).toISOString()
  });

  const healed = await bot.healStuckContacts();

  assert.deepEqual(healed, []);
  assert.equal(store.data.escalations.length, 0);
});

test("hard human escalations do not auto-return from SLA watchdog", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-sla-hard",
    ghlContactId: "human-sla-hard",
    name: "Human Hard",
    phone: "+15550000078",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "attorney_request",
    lastInboundMessage: "I need an attorney."
  });
  const job = store.addJob({
    type: "human_escalation_sla",
    contactId: "human-sla-hard",
    runAt: new Date().toISOString(),
    payload: { minutes: 30, reason: "attorney_request" }
  });

  await bot.runDueJob(job);

  const contact = store.getContact("human-sla-hard");
  assert.equal(contact.humanEscalationStatus, true);
  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(contact.humanEscalationStage, "human_review_pending");
  assert.equal(contact.lastOutboundMessage, undefined);
});

test("SMS escalation Slack copy stays compact without unknown qualification fields", async () => {
  const baseConfig = testConfig("");
  const result = await slack.sendEscalation(
    {
      ...baseConfig,
      dryRun: true,
      ghl: { ...baseConfig.ghl, locationId: "loc-1" },
      slack: { token: "", channel: "#sms", botErrorsChannel: "#bot-errors", bookingChannel: "#booking" }
    },
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
  assert.equal(
    result.text,
    [
      "Name: Slack Copy",
      "Message: Can you help?",
      "Link: https://app.gohighlevel.com/v2/location/loc-1/contacts/detail/slack-copy"
    ].join("\n")
  );
  assert.doesNotMatch(result.text, /Reason:/);
  assert.doesNotMatch(result.text, /Phone:/);
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

test("urgent call-now Slack alerts route to leads channel", async () => {
  const result = await slack.sendUrgentCallNow(
    {
      ...testConfig(""),
      dryRun: true,
      slack: {
        token: "",
        channel: "#sms-escalations",
        leadsChannel: "C09N85J9G4Q",
        botErrorsChannel: "#bot-errors",
        bookingChannel: "#booking"
      }
    },
    {
      id: "urgent-lead",
      ghlContactId: "urgent-lead",
      name: "Urgent Lead",
      phone: "+15550000070",
      lastInboundMessage: "Call me now"
    }
  );

  assert.equal(result.skipped, true);
  assert.equal(result.channel, "C09N85J9G4Q");
  assert.match(result.text, /URGENT: PC wants a call now/);
});

test("backup no-show Slack copy tells team the backup attempt is active", async () => {
  const result = await slack.sendAppointmentNotice(
    { ...testConfig(""), dryRun: true, slack: { token: "", channel: "#sms", botErrorsChannel: "#bot-errors", bookingChannel: "#booking" } },
    {
      id: "backup-notice",
      ghlContactId: "backup-notice",
      name: "Backup Notice",
      phone: "+15550000077",
      preferredCallTime: "Sun, May 10, 11:00 AM MST",
      backupCallTime: "Sun, May 10, 12:00 PM MST",
      appointmentId: "appt-1"
    },
    "No-show: backup time active",
    {
      Action: "Primary call was missed. Backup time is now the next attempt."
    }
  );

  assert.equal(result.skipped, true);
  assert.match(result.text, /No-show: backup time active/);
  assert.match(result.text, /Primary: Sun, May 10, 11:00 AM MST/);
  assert.match(result.text, /Backup: Sun, May 10, 12:00 PM MST/);
  assert.match(result.text, /Primary call was missed/);
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
  assert.ok(new Date(timeout.runAt).getTime() - Date.now() >= 14 * 60 * 1000);

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

test("human outbound webhook ignores non-SMS marketplace events", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-call-outbound",
    ghlContactId: "human-call-outbound",
    name: "Human Call",
    phone: "+15550000242",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    humanEscalationStatus: true,
    humanEscalationStage: "human_working",
    automationPaused: true,
    automationPauseReason: "human_working"
  });

  await bot.handleHumanOutbound({
    type: "OutboundMessage",
    contactId: "human-call-outbound",
    messageType: "CALL",
    messageTypeString: "TYPE_CALL",
    callDuration: 42,
    callStatus: "completed"
  });

  assert.equal(
    Object.values(store.data.messages).some(
      (message) => message.contactId === "human-call-outbound" && message.direction === "human_outbound"
    ),
    false
  );
  assert.equal(
    Object.values(store.data.jobs).some(
      (job) => job.contactId === "human-call-outbound" && job.type === "human_reply_timeout" && job.status === "pending"
    ),
    false
  );
});

test("human outbound webhook ignores the bot's own outbound SMS echo", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "bot-echo",
    ghlContactId: "bot-echo",
    name: "Bot Echo",
    phone: "+15550000243",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    lastOutboundMessage: "Have you needed to see any doctors or receive any medical treatment after the accident?",
    lastOutboundTimestamp: new Date().toISOString()
  });

  await bot.handleHumanOutbound({
    type: "OutboundMessage",
    contactId: "bot-echo",
    messageType: "SMS",
    messageTypeString: "TYPE_SMS",
    body: "Have you needed to see any doctors or receive any medical treatment after the accident?"
  });

  assert.equal(
    Object.values(store.data.messages).some(
      (message) => message.contactId === "bot-echo" && message.direction === "human_outbound"
    ),
    false
  );
  assert.equal(store.getContact("bot-echo").automationPaused, undefined);
});

test("human outbound webhook ignores recent stored bot SMS echoes even when contact state is stale", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "bot-echo-stale",
    ghlContactId: "bot-echo-stale",
    name: "Bot Echo Stale",
    phone: "+15550000244",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    lastOutboundMessage: "Old bot message",
    lastOutboundTimestamp: new Date().toISOString()
  });
  store.addMessage({
    contactId: "bot-echo-stale",
    direction: "outbound",
    body: "Based on what you've shared, are you open for a call now or later today?"
  });

  await bot.handleHumanOutbound({
    type: "OutboundMessage",
    contactId: "bot-echo-stale",
    messageType: "SMS",
    messageTypeString: "TYPE_SMS",
    body: "Based on what you've shared, are you open for a call now or later today?"
  });

  assert.equal(
    Object.values(store.data.messages).some(
      (message) => message.contactId === "bot-echo-stale" && message.direction === "human_outbound"
    ),
    false
  );
  assert.equal(store.getContact("bot-echo-stale").automationPaused, undefined);
  assert.equal(store.listDecisionLogs("bot-echo-stale").some((log) => log.reason === "human_outbound_bot_echo_ignored"), true);
});

test("bot outbound safety blocks duplicate copies and pauses flood loops", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "outbound-safety",
    ghlContactId: "outbound-safety",
    name: "Outbound Safety",
    phone: "+15550000245",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
  });

  await bot.sendBotMessage(store.getContact("outbound-safety"), "Same message", { bypassQuietHours: true });
  await bot.sendBotMessage(store.getContact("outbound-safety"), "Same message", { bypassQuietHours: true });

  assert.equal(store.listMessages("outbound-safety").filter((message) => message.direction === "outbound").length, 1);
  assert.equal(
    store.listDecisionLogs("outbound-safety").some((log) => log.reason === "duplicate_bot_message_recently_sent"),
    true
  );

  await bot.sendBotMessage(store.getContact("outbound-safety"), "Second unique message", { bypassQuietHours: true });
  await bot.sendBotMessage(store.getContact("outbound-safety"), "Third unique message", { bypassQuietHours: true });
  await bot.sendBotMessage(store.getContact("outbound-safety"), "Fourth unique message", { bypassQuietHours: true });

  const updated = store.getContact("outbound-safety");
  assert.equal(store.listMessages("outbound-safety").filter((message) => message.direction === "outbound").length, 3);
  assert.equal(updated.automationPaused, true);
  assert.equal(updated.automationPauseReason, "outbound_flood_guard");
  assert.equal(store.listDecisionLogs("outbound-safety").some((log) => log.reason === "outbound_flood_guard_paused"), true);
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

test("stuck human review with unanswered human outbound returns to bot after 15 minutes", async () => {
  const { bot, store } = makeBot();
  const humanAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "human-log-return",
    ghlContactId: "human-log-return",
    name: "Human Log",
    phone: "+15550000184",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes",
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalatedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString()
  });
  store.addMessage({
    contactId: "human-log-return",
    direction: "human_outbound",
    body: "Can you talk with us?",
    createdAt: humanAt
  });

  const healed = await bot.healStuckContacts();
  const contact = store.getContact("human-log-return");

  assert.equal(healed.some((item) => item.action === "auto_returned_after_human_message_log_timeout"), true);
  assert.equal(contact.humanEscalationStatus, false);
  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.match(contact.lastOutboundMessage, /Specialist call|connected|call/i);
});

test("recent unanswered human outbound gets a 15-minute return job", async () => {
  const { bot, store } = makeBot();
  const humanAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "human-log-schedule",
    ghlContactId: "human-log-schedule",
    name: "Human Schedule",
    phone: "+15550000185",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalatedAt: new Date(Date.now() - 8 * 60 * 1000).toISOString()
  });
  store.addMessage({
    contactId: "human-log-schedule",
    direction: "human_outbound",
    body: "Following up manually.",
    createdAt: humanAt
  });

  const healed = await bot.healStuckContacts();
  const contact = store.getContact("human-log-schedule");
  const job = Object.values(store.data.jobs).find(
    (item) => item.contactId === "human-log-schedule" && item.type === "human_reply_timeout" && item.status === "pending"
  );

  assert.equal(healed.some((item) => item.action === "scheduled_human_reply_timeout_from_message_log"), true);
  assert.equal(contact.humanEscalationStage, "human_replied_waiting");
  assert.ok(job);
  assert.ok(new Date(job.runAt).getTime() - new Date(humanAt).getTime() >= 15 * 60 * 1000);
});

test("lead replies while human is working notify Slack but do not resume bot", async () => {
  const { bot, store } = makeBot();
  const originalSendEscalatedInbound = slack.sendEscalatedInbound;
  let alerts = 0;
  slack.sendEscalatedInbound = async () => {
    alerts += 1;
    return { ok: true };
  };
  try {
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
  assert.equal(alerts, 1);
  assert.equal(store.data.escalations.length, 1);
  assert.equal(store.getContact("human-managed-inbound").lastHumanManagedInboundMessage, "yes I am here");
  } finally {
    slack.sendEscalatedInbound = originalSendEscalatedInbound;
  }
});

test("warm follow-up jobs are blocked while lead is escalated to human", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-escalated-job",
    ghlContactId: "human-escalated-job",
    name: "Human Escalated",
    phone: "+15550000079",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending"
  });
  const job = store.addJob({
    type: "warm_followup",
    contactId: "human-escalated-job",
    runAt: new Date().toISOString(),
    payload: { step: 1 }
  });

  await bot.runDueJob(job);

  assert.equal(store.data.jobs[job.id].status, "skipped");
  assert.equal(store.data.jobs[job.id].skipReason, "human_escalation_active");
  assert.equal(store.getContact("human-escalated-job").lastOutboundMessage, undefined);
});

test("no-show follow-up jobs are blocked while human escalation is active even if engagement status drifted", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-escalated-no-show",
    ghlContactId: "human-escalated-no-show",
    name: "Human Escalated No Show",
    phone: "+15550000080",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "appointment_reply_needs_human_review"
  });
  const job = store.addJob({
    type: "missed_call_followup",
    contactId: "human-escalated-no-show",
    runAt: new Date().toISOString(),
    payload: { templateGroup: "noShowTemplates", templateKey: "sameDay1" }
  });

  await bot.runDueJob(job);

  assert.equal(store.data.jobs[job.id].status, "skipped");
  assert.equal(store.data.jobs[job.id].skipReason, "human_escalation_active");
  assert.equal(store.getContact("human-escalated-no-show").lastOutboundMessage, undefined);
});

test("missing appointment reminder template is skipped instead of crashing scheduler", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "missing-reminder-template",
    ghlContactId: "missing-reminder-template",
    name: "Missing Reminder",
    phone: "+15550000081",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "today at 4 PM",
    preferredCallTimeIso: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    appointmentId: "appt-missing-template"
  });
  const job = store.addJob({
    type: "appointment_reminder",
    contactId: "missing-reminder-template",
    runAt: new Date().toISOString(),
    payload: { templateKey: "legacy_missing_template" }
  });

  await bot.runDueJob(job);

  assert.equal(store.data.jobs[job.id].status, "skipped");
  assert.equal(store.data.jobs[job.id].skipReason, "missing_reminder_template");
  assert.equal(store.getContact("missing-reminder-template").lastOutboundMessage, undefined);
});

test("tag lookup failure defers outbound jobs instead of sending blindly", async () => {
  const { bot, store } = makeBot();
  bot.config.ghl.token = "test-token";
  const originalGetContact = ghl.getContact;
  ghl.getContact = async () => {
    throw new Error("GHL unavailable");
  };
  try {
    store.upsertContact({
      id: "tag-failure-defer",
      ghlContactId: "tag-failure-defer",
      name: "Tag Failure",
      phone: "+15550000082",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
      faultAnswer: "not_at_fault"
    });
    const job = store.addJob({
      type: "warm_followup",
      contactId: "tag-failure-defer",
      runAt: new Date().toISOString(),
      payload: { step: 1 }
    });

    await bot.runDueJob(job);

    assert.equal(store.data.jobs[job.id].status, "pending");
    assert.equal(store.data.jobs[job.id].retryReason, "tag_lookup_failed");
    assert.equal(store.getContact("tag-failure-defer").lastOutboundMessage, undefined);
    const errorLog = store.getSetting("bot_error_log").value;
    assert.equal(errorLog[0].title, "GHL contact tag lookup failed");
    assert.equal(errorLog[0].operationalOnly, true);
  } finally {
    ghl.getContact = originalGetContact;
  }
});

test("lead scheduling reply during human handoff lets bot resume booking help", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "human-scheduling-inbound",
    ghlContactId: "human-scheduling-inbound",
    name: "Human Scheduling",
    phone: "+15550000075",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    humanEscalationStatus: true,
    humanEscalationStage: "human_replied_waiting",
    automationPaused: true,
    automationPauseReason: "human_working"
  });
  store.addJob({
    type: "human_reply_timeout",
    contactId: "human-scheduling-inbound",
    runAt: new Date().toISOString(),
    payload: {}
  });

  const contact = await bot.handleInboundSms({
    contactId: "human-scheduling-inbound",
    message: "Later I am sick in bed I had surgery"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(contact.humanEscalationStatus, false);
  assert.equal(contact.automationPaused, false);
  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.match(contact.lastOutboundMessage, /hope you feel better/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "human-scheduling-inbound" && job.type === "human_reply_timeout" && job.status === "pending"),
    false
  );
});

test("QR tag blocks bot from resuming during human handoff", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "qr-human-handoff",
    ghlContactId: "qr-human-handoff",
    name: "QR Hold",
    phone: "+15550000077",
    tags: ["QR"],
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    humanEscalationStatus: true,
    humanEscalationStage: "human_replied_waiting",
    automationPaused: true,
    automationPauseReason: "human_working"
  });

  const contact = await bot.handleInboundSms({
    contactId: "qr-human-handoff",
    message: "later today"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "manual_hold_tag");
  assert.equal(contact.lastOutboundMessage, undefined);
});

test("manual call activity pauses bot and creates call outcome watchdog", async () => {
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

  const contact = await bot.applyBotControl({ contactId: "human-call-timeout", action: "call_started", callDurationSeconds: 42 });
  const watchdog = Object.values(store.data.jobs).find(
    (job) => job.contactId === "human-call-timeout" && job.type === "call_outcome_required" && job.status === "pending"
  );

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.humanEscalationStage, "human_call_active");
  assert.equal(contact.automationPauseReason, "human_call_needs_outcome");
  assert.equal(contact.callOutcomeNeeded, true);
  assert.equal(watchdog.payload.durationSeconds, 42);
  const minutesAway = Math.round((new Date(watchdog.runAt).getTime() - Date.now()) / 60000);
  assert.ok(minutesAway >= 9 && minutesAway <= 10);
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
  assert.equal(contact.automationPauseReason, "human_call_needs_outcome");
  assert.equal(contact.callOutcomeNeeded, true);
  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
});

test("call outcome watchdog alerts when no disposition is recorded", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "call-outcome-needed",
    ghlContactId: "call-outcome-needed",
    name: "Needs Outcome",
    phone: "+15550000901",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
  });

  await bot.applyBotControl({ contactId: "call-outcome-needed", action: "manual_call", callDurationSeconds: 20 });
  const watchdog = Object.values(store.data.jobs).find((job) => job.type === "call_outcome_required");
  await bot.runDueJob(watchdog);

  const contact = store.getContact("call-outcome-needed");
  const errors = store.getSetting("bot_error_log").value;
  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "call_outcome_required");
  assert.equal(contact.humanEscalationStage, "call_outcome_required");
  assert.equal(errors[0].title, "No call disposition recorded");
});

test("call_drop tag sends reconnect recovery and cancels call outcome watchdog", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "call-drop",
    ghlContactId: "call-drop",
    name: "Drop Lead",
    phone: "+15550000902",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    humanEscalationStatus: true,
    automationPaused: true,
    automationPauseReason: "human_call_needs_outcome"
  });
  store.addJob({ type: "call_outcome_required", contactId: "call-drop", runAt: new Date().toISOString(), payload: {} });

  const contact = await bot.applyBotControl({ contactId: "call-drop", action: "call_drop" });

  assert.equal(contact.automationPaused, false);
  assert.equal(contact.currentSequenceName, "call_dropped_recovery");
  assert.match(store.getContact("call-drop").lastOutboundMessage, /call may have dropped|missed each other/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "call-drop" && job.type === "call_outcome_required" && job.status === "pending"),
    false
  );
});

test("call_connected_follow_up tag keeps bot paused and resolves call outcome", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "call-connected",
    ghlContactId: "call-connected",
    name: "Connected Lead",
    phone: "+15550000903",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    humanEscalationStatus: true,
    automationPaused: true,
    automationPauseReason: "human_call_needs_outcome",
    callOutcomeNeeded: true
  });
  store.addJob({ type: "call_outcome_required", contactId: "call-connected", runAt: new Date().toISOString(), payload: {} });

  const contact = await bot.applyBotControl({ contactId: "call-connected", action: "call_connected_follow_up" });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "call_connected_follow_up");
  assert.equal(contact.callOutcomeNeeded, false);
  assert.equal(contact.callOutcomeStatus, "call_connected_follow_up");
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "call-connected" && job.status === "pending"),
    false
  );
});

test("scheduled lead reschedule request suppresses current reminders and asks for exact time", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "reschedule-request",
    ghlContactId: "reschedule-request",
    name: "Reschedule Lead",
    phone: "+15550000904",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    appointmentId: "appt-1",
    preferredCallTime: "Tue, May 12, 2:00 PM CST",
    preferredCallTimeIso: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
  });
  store.addJob({ type: "appointment_reminder", contactId: "reschedule-request", runAt: new Date().toISOString(), payload: { templateKey: "sameDayOneHour" } });

  const contact = await bot.handleInboundSms({ contactId: "reschedule-request", message: "I am not free anymore can we reschedule" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.equal(contact.currentSequenceName, "reschedule_requested");
  assert.match(contact.lastOutboundMessage, /What new time works best/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "reschedule-request" && job.type === "appointment_reminder" && job.status === "pending"),
    false
  );
});

test("early availability clue asks for exact slot instead of booking immediately", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "availability-clue",
    ghlContactId: "availability-clue",
    name: "Available Later",
    phone: "+15550000905",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes"
  });

  const contact = await bot.handleInboundSms({ contactId: "availability-clue", message: "I get off work at 4" });

  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.equal(Boolean(contact.availabilityClue), true);
  assert.equal(contact.appointmentId, undefined);
  assert.match(contact.lastOutboundMessage, /Does .* or .* work/i);
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

  const contact = await bot.applyBotControl({
    contactId: "admin-pause",
    action: "pause_bot",
    controlSource: "admin_contact_action",
    controlActor: "dashboard_admin",
    controlNote: "debug pause",
    requestPath: "/api/admin/contact/action"
  });

  assert.equal(contact.automationPaused, true);
  assert.equal(contact.automationPauseReason, "admin_pause");
  assert.equal(contact.lastAutomationPauseSource, "admin_contact_action");
  assert.equal(contact.lastAutomationPauseActor, "dashboard_admin");
  assert.equal(contact.lastAutomationPauseNote, "debug pause");
  assert.equal(contact.lastAutomationPauseRequestPath, "/api/admin/contact/action");
  assert.equal(contact.optOutStatus, undefined);
  assert.equal(contact.humanEscalationStage, "admin_paused");
  const pauseLog = store.listDecisionLogs("admin-pause").find((log) => log.reason === "admin_pause");
  assert.equal(pauseLog.meta.source, "admin_contact_action");
  assert.equal(pauseLog.meta.note, "debug pause");
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "admin-pause" && job.status === "pending"),
    false
  );
});

test("GHL bot-control webhook cannot create an admin pause", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "webhook-pause-block",
    ghlContactId: "webhook-pause-block",
    name: "Webhook Pause",
    phone: "+15550000101",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
  });

  const contact = await bot.applyBotControl({
    contactId: "webhook-pause-block",
    action: "pause_bot",
    controlSource: "ghl_bot_control_webhook"
  });

  assert.equal(contact.automationPaused, undefined);
  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  const pauseLog = store.listDecisionLogs("webhook-pause-block").find((log) => log.reason === "admin_pause_blocked_from_non_admin_source");
  assert.equal(pauseLog.action, "skipped");
  assert.equal(pauseLog.meta.source, "ghl_bot_control_webhook");
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

test("return to bot uses last inbound answer instead of repeating the same question", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "return-smart",
    ghlContactId: "return-smart",
    name: "Pedro",
    phone: "+15550000075",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "post_intake_or_firm_issue",
    lastInboundMessage: "Yes it was yesterday may 7 2026 the driver hit my front fender and just kept going I filled a police report as well"
  });

  const contact = await bot.applyBotControl({ contactId: "return-smart", action: "return_to_bot" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("return-smart").accidentDate, "may 7 2026");
  assert.equal(store.getContact("return-smart").faultAnswer, "not_at_fault");
  assert.equal(store.getContact("return-smart").humanEscalationStatus, false);
  assert.match(store.getContact("return-smart").lastOutboundMessage, /medical treatment/i);
});

test("return to bot at scheduling reuses recent call time", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "return-call-time",
    ghlContactId: "return-call-time",
    name: "Pedro",
    phone: "+15550000077",
    timezone: "America/Los_Angeles",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "no"
  });
  store.addMessage({
    contactId: "return-call-time",
    direction: "inbound",
    body: "Yes, I am open"
  });
  store.addMessage({
    contactId: "return-call-time",
    direction: "inbound",
    body: "2"
  });

  const contact = await bot.applyBotControl({ contactId: "return-call-time", action: "return_to_bot" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.equal(store.getContact("return-call-time").qualificationProgress, QUALIFICATION.CALL_BOOKED);
  assert.equal(store.getContact("return-call-time").recoveredCallTimeMessage, "2");
  assert.match(store.getContact("return-call-time").lastOutboundMessage, /backup time/i);
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

test("generic follow up tag stops no-response outreach from starting", async () => {
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
  assert.equal(store.data.messages.length, 0);
  assert.equal(Object.values(store.data.jobs).some((job) => job.contactId === "hold-start" && job.status === "pending"), false);
});

test("fresh NR enrollment queues retry if initial SMS could not be safely sent", async () => {
  const { bot, store } = makeBot();
  bot.config.ghl.token = "test-token";
  const originalGetContact = ghl.getContact;
  ghl.getContact = async () => {
    throw new Error("GHL unavailable");
  };
  try {
    const contact = await bot.startFromNoResponseDisposition({
      contactId: "nr-retry",
      name: "NR Retry",
      phone: "+15550000085",
      timezone: "America/Chicago",
      disposition: "NR"
    });

    assert.equal(contact.currentSequenceName, "initial_sms_pending");
    assert.equal(store.data.messages.length, 0);
    assert.equal(
      Object.values(store.data.jobs).some((job) => job.contactId === "nr-retry" && job.type === "initial_sms" && job.status === "pending"),
      true
    );
  } finally {
    ghl.getContact = originalGetContact;
  }
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

test("accident date sentence with time is not booked as a call", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "accident-time-not-call",
    ghlContactId: "accident-time-not-call",
    name: "Terrill",
    phone: "+15550000080",
    engagementStatus: ENGAGEMENT.INITIAL_SMS_SENT,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  const contact = await bot.handleInboundSms({
    contactId: "accident-time-not-call",
    message: "William the accident happened last Saturday around 3pm"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_FAULT);
  assert.equal(store.getContact("accident-time-not-call").accidentDate, "last saturday");
  assert.match(store.getContact("accident-time-not-call").lastOutboundMessage, /were you at fault/i);
  assert.equal(store.getContact("accident-time-not-call").appointmentId, undefined);
});

test("accident date reply with police report detail still advances instead of escalating", async () => {
  const { bot, store } = makeBot();
  await bot.startFromNoResponseDisposition({
    contactId: "c6c",
    name: "Pedro",
    phone: "+15550000074",
    timezone: "America/Los_Angeles"
  });

  const contact = await bot.handleInboundSms({
    contactId: "c6c",
    message: "Yes it was yesterday may 7 2026 the driver hit my front fender and just kept going I filled a police report as well"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(store.getContact("c6c").accidentDate, "may 7 2026");
  assert.equal(store.getContact("c6c").faultAnswer, "not_at_fault");
  assert.equal(store.getContact("c6c").humanEscalationStatus, false);
  assert.match(store.getContact("c6c").lastOutboundMessage, /medical treatment/i);
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

test("outbound SMS is blocked when a same-phone GHL duplicate has an NQ tag", async () => {
  const { bot, store } = makeBot();
  bot.config.dryRun = false;
  bot.config.ghl.token = "test-token";
  bot.config.ghl.locationId = "loc-test";
  let sent = false;
  const originalGetContact = ghl.getContact;
  const originalSearchContactsByPhone = ghl.searchContactsByPhone;
  const originalSendSms = ghl.sendSms;
  ghl.getContact = async () => ({ contact: { id: "manuel-active", tags: ["levin_co", "nr"] } });
  ghl.searchContactsByPhone = async () => ({
    contacts: [
      { id: "manuel-active", phone: "+17192895474", tags: ["levin_co", "nr"] },
      { id: "manuel-duplicate-nq", phone: "+17192895474", tags: ["levin_co", "nq"] }
    ]
  });
  ghl.sendSms = async () => {
    sent = true;
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "manuel-active",
      ghlContactId: "manuel-active",
      name: "Manuel",
      phone: "+17192895474",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
    });

    const result = await bot.sendBotMessage(store.getContact("manuel-active"), "What exact call time works for you?", {
      bypassQuietHours: true
    });

    const contact = store.getContact("manuel-active");
    assert.equal(result, null);
    assert.equal(sent, false);
    assert.equal(contact.automationPaused, true);
    assert.equal(contact.automationPauseReason, "duplicate_nq_tag");
    assert.equal(contact.duplicateTerminalContactId, "manuel-duplicate-nq");
    assert.equal(store.listDecisionLogs("manuel-active").some((log) => log.reason === "duplicate_nq_tag"), true);
  } finally {
    ghl.getContact = originalGetContact;
    ghl.searchContactsByPhone = originalSearchContactsByPhone;
    ghl.sendSms = originalSendSms;
  }
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
  assert.equal(jobs.some((job) => job.payload.templateKey === "same_day_now"), true);
  assert.equal(jobs.some((job) => job.payload.templateKey === "day_2_am"), true);
  assert.equal(jobs.some((job) => job.payload.templateKey === "day_14_pm"), true);
  assert.equal(contact.noShowCount, 1);
  assert.equal(store.getSetting("last_no_show_webhook").value.result, "jobs_scheduled");

  const firstJob = jobs.find((job) => job.payload.templateKey === "same_day_now") || jobs[0];
  store.updateJob(firstJob.id, { runAt: new Date().toISOString() });
  await bot.runDueJob(store.data.jobs[firstJob.id]);

  assert.match(store.getContact("no-show-1").lastOutboundMessage, /missed you|missed the call|rescheduled|calendar/i);
  assert.doesNotMatch(store.getContact("no-show-1").lastOutboundMessage, /date of the accident/i);
});

test("stuck-state healer recreates missing no-show recovery jobs", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "missing-no-show-heal",
    ghlContactId: "missing-no-show-heal",
    name: "No Show Heal",
    phone: "+15550000242",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.MISSED_CALL,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    currentSequenceName: "appointment_no_show",
    appointmentNoShowAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    preferredCallTime: "Earlier today",
    preferredCallTimeIso: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    appointmentId: "appt-missing-no-show"
  });

  const healed = await bot.healStuckContacts();
  const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "missing-no-show-heal");

  assert.deepEqual(healed, [{ contactId: "missing-no-show-heal", action: "scheduled_missing_no_show_recovery" }]);
  assert.equal(jobs.some((job) => job.type === "missed_call_followup" && job.status === "pending"), true);
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

  assert.equal(backupJobs.length >= 1, true);
  assert.equal(backupJobs.some((job) => job.payload.templateKey === "afterPrimaryMissed"), false);
  assert.equal(backupJobs.some((job) => job.payload.templateKey === "thirtyBefore" || job.payload.templateKey === "fiveBefore"), true);
  assert.match(store.getContact("no-show-backup").lastOutboundMessage, /backup time/i);
  assert.match(store.getContact("no-show-backup").lastOutboundMessage, /4:00 PM/i);
});

test("admin mark no-show preserves backup time and schedules backup reminders", async () => {
  const { bot, store } = makeBot();
  const primary = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const backup = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "admin-no-show-backup",
    ghlContactId: "admin-no-show-backup",
    name: "Leslie",
    phone: "+15550000074",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Fri, May 8, 4:00 PM CST",
    preferredCallTimeIso: primary,
    backupCallTime: "Fri, May 8, 5:00 PM CST",
    backupCallTimeIso: backup,
    backupCallTimeType: "exact",
    appointmentId: "appt-no-show"
  });

  const contact = await bot.applyBotControl({ contactId: "admin-no-show-backup", action: "mark_no_show" });
  const backupJobs = Object.values(store.data.jobs).filter(
    (job) => job.contactId === "admin-no-show-backup" && job.type === "backup_no_show_reminder" && job.status === "pending"
  );

  assert.equal(contact.engagementStatus, ENGAGEMENT.MISSED_CALL);
  assert.equal(store.getContact("admin-no-show-backup").preferredCallTime, "Fri, May 8, 4:00 PM CST");
  assert.equal(store.getContact("admin-no-show-backup").backupCallTime, "Fri, May 8, 5:00 PM CST");
  assert.equal(store.getContact("admin-no-show-backup").lastOutboundMessage.includes("5:00 PM"), true);
  assert.equal(backupJobs.some((job) => job.payload.templateKey === "afterPrimaryMissed"), false);
});

test("generic follow up tag does not block explicit no-show recovery", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "follow-up-no-show",
    ghlContactId: "follow-up-no-show",
    name: "Follow Up No Show",
    phone: "+15550000186",
    tags: ["follow up"],
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Fri, May 8, 4:00 PM CST",
    preferredCallTimeIso: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    appointmentId: "follow-up-no-show-appt"
  });

  const contact = await bot.markNoShow({ contactId: "follow-up-no-show", appointmentId: "follow-up-no-show-appt", status: "no_show" });
  const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "follow-up-no-show");

  assert.equal(contact.engagementStatus, ENGAGEMENT.MISSED_CALL);
  assert.equal(jobs.some((job) => job.type === "missed_call_followup" && job.status === "pending"), true);
});

test("hard human hold tag still blocks explicit no-show recovery", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "hard-hold-no-show",
    ghlContactId: "hard-hold-no-show",
    name: "Hard Hold No Show",
    phone: "+15550000187",
    tags: ["human_hold"],
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Fri, May 8, 4:00 PM CST",
    preferredCallTimeIso: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    appointmentId: "hard-hold-no-show-appt"
  });

  const contact = await bot.markNoShow({ contactId: "hard-hold-no-show", appointmentId: "hard-hold-no-show-appt", status: "no_show" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.equal(store.getSetting("last_no_show_webhook").value.result, "skipped_manual_hold_tag");
  assert.equal(Object.values(store.data.jobs).some((job) => job.contactId === "hard-hold-no-show" && job.status === "pending"), false);
});

test("manual GHL appointment sync adopts appointment and schedules reminders", async () => {
  const { bot, store } = makeBot();
  const startsAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "manual-appt",
    ghlContactId: "manual-appt",
    name: "Manual Appt",
    phone: "+15550000075",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });
  store.addJob({
    type: "send_cold_template",
    contactId: "manual-appt",
    runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    payload: { templateKey: "day_1_pm" }
  });

  const contact = await bot.syncAppointment({
    contactId: "manual-appt",
    appointmentId: "manual-appt-event",
    startTime: startsAt,
    status: "confirmed"
  });
  const jobs = Object.values(store.data.jobs);

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.equal(contact.qualificationProgress, QUALIFICATION.COMPLETE);
  assert.equal(contact.appointmentId, "manual-appt-event");
  assert.equal(contact.appointmentSource, "ghl_manual");
  assert.equal(contact.awaitingBackupTime, false);
  assert.match(store.getContact("manual-appt").lastOutboundMessage, /Specialist call is set/i);
  assert.equal(jobs.some((job) => job.contactId === "manual-appt" && job.type === "send_cold_template" && job.status === "pending"), false);
  assert.equal(jobs.some((job) => job.contactId === "manual-appt" && job.type === "appointment_reminder" && job.status === "pending"), true);
  assert.equal(jobs.some((job) => job.contactId === "manual-appt" && job.type === "backup_time_timeout" && job.status === "pending"), false);
});

test("manual appointment sync LLM correction restores existing time without rolling to next week", async () => {
  const { bot, store } = makeBot();
  const originalHandleReschedule = bot.handleReschedule.bind(bot);
  const oldStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const proposedStart = new Date(oldStart.getTime() + 15 * 60 * 1000);
  const oldDisplay = "Today 9:00 PM PST";
  bot.handleReschedule = async () => {
    throw new Error("manual sync correction should not call handleReschedule");
  };
  bot.evaluateDecisionGate = async () => ({
    decision: "correct_time",
    confidence: 0.9,
    reason: "No lead confirmation of the changed manual appointment time.",
    corrected_time_text: oldDisplay,
    risk_flags: ["time_mismatch"]
  });

  try {
    store.upsertContact({
      id: "manual-sync-correct-existing",
      ghlContactId: "manual-sync-correct-existing",
      name: "Manual Correct",
      phone: "+15550001075",
      timezone: "America/Los_Angeles",
      engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
      qualificationProgress: QUALIFICATION.COMPLETE,
      preferredCallTime: oldDisplay,
      preferredCallTimeIso: oldStart.toISOString(),
      appointmentId: "existing-appt",
      lastInboundMessage: "Ok"
    });

    const contact = await bot.syncAppointment({
      contactId: "manual-sync-correct-existing",
      appointmentId: "existing-appt",
      startTime: proposedStart.toISOString(),
      status: "confirmed"
    });
    const jobs = Object.values(store.data.jobs);

    assert.equal(contact.preferredCallTimeIso, oldStart.toISOString());
    assert.equal(contact.preferredCallTime, oldDisplay);
    assert.equal(contact.lastAppointmentSyncSuppressedReason, "llm_gate_corrected_to_existing_appointment");
    assert.equal(store.data.messages.length, 0);
    assert.equal(
      jobs.some((job) => job.status === "pending" && job.payload?.appointmentIso === proposedStart.toISOString()),
      false
    );
    assert.equal(
      store.data.decisionLogs.some((log) => log.reason === "manual_appointment_sync_corrected_to_existing_time"),
      true
    );
  } finally {
    bot.handleReschedule = originalHandleReschedule;
  }
});

test("date replies can also save medical treatment details for later qualification memory", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "date-medical",
    ghlContactId: "date-medical",
    name: "Deanna",
    phone: "+15550000951",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  await bot.handleInboundSms({
    contactId: "date-medical",
    message: "Jan 14 2026 n yes went to emergency room for xrays"
  });
  let contact = store.getContact("date-medical");
  assert.equal(contact.accidentDate, "jan 14 2026");
  assert.equal(contact.medicalTreatmentAnswer, "yes");
  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_FAULT);
  assert.match(contact.lastOutboundMessage, /at fault/i);

  await bot.handleInboundSms({ contactId: "date-medical", message: "The other driver was at fault" });
  contact = store.getContact("date-medical");
  assert.equal(contact.faultAnswer, "not_at_fault");
  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.match(contact.lastOutboundMessage, /call/i);
  assert.doesNotMatch(contact.lastOutboundMessage, /doctors|medical treatment/i);
});

test("relative call time asks once, then auto-books if the lead does not answer", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "relative-auto-book",
    ghlContactId: "relative-auto-book",
    name: "Maria",
    phone: "+15550000952",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
  });

  await bot.handleInboundSms({ contactId: "relative-auto-book", message: "In an hour you can call" });
  let contact = store.getContact("relative-auto-book");
  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.match(contact.lastOutboundMessage, /Just to confirm/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "relative-auto-book" && job.type === "warm_followup" && job.status === "pending"),
    false
  );
  const job = Object.values(store.data.jobs).find(
    (item) => item.contactId === "relative-auto-book" && item.type === "relative_call_time_autobook" && item.status === "pending"
  );
  assert.ok(job);
  await store.updateJob(job.id, { runAt: new Date().toISOString() });
  await bot.runDueJob(store.data.jobs[job.id]);

  contact = store.getContact("relative-auto-book");
  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.ok(contact.preferredCallTimeIso);
  assert.match(contact.lastOutboundMessage, /backup time|locked in/i);
});

test("contract-sent contact still syncs manual contract review appointment", async () => {
  const { bot, store } = makeBot();
  const originalSendAppointmentBooked = slack.sendAppointmentBooked;
  const alerts = [];
  slack.sendAppointmentBooked = async (_config, _contact, extra) => {
    alerts.push(extra);
    return { ok: true };
  };
  try {
    const startsAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    store.upsertContact({
      id: "contract-review-sync",
      ghlContactId: "contract-review-sync",
      name: "Walter Watson",
      phone: "+15550000901",
      timezone: "America/Chicago",
      tags: ["contract_sent"],
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      automationPaused: true,
      automationPauseReason: "contract_pending_tag"
    });
    store.addJob({
      type: "send_reengagement_template",
      contactId: "contract-review-sync",
      runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      payload: { sequence: "after_call_booking" }
    });

    const contact = await bot.syncAppointment({
      contactId: "contract-review-sync",
      appointmentId: "contract-review-appt",
      startTime: startsAt,
      status: "confirmed",
      title: "ASD Contract Review Call - Walter Watson"
    });
    const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "contract-review-sync");

    assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
    assert.equal(contact.appointmentType, "contract_review");
    assert.equal(contact.appointmentTitle, "ASD Contract Review Call - Walter Watson");
    assert.equal(contact.automationPaused, false);
    assert.equal(jobs.some((job) => job.type === "send_reengagement_template" && job.status === "pending"), false);
    assert.equal(jobs.some((job) => job.type === "appointment_reminder" && job.status === "pending" && job.payload.templateGroup === "contractReviewReminderTemplates"), true);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].Title, "Contract review booked");
  } finally {
    slack.sendAppointmentBooked = originalSendAppointmentBooked;
  }
});

test("signed contact stays terminal when appointment sync fires", async () => {
  const { bot, store } = makeBot();
  const originalSendAppointmentBooked = slack.sendAppointmentBooked;
  const alerts = [];
  slack.sendAppointmentBooked = async (_config, _contact, extra) => {
    alerts.push(extra);
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "signed-appointment-sync",
      ghlContactId: "signed-appointment-sync",
      name: "Signed Contact",
      phone: "+15550000902",
      timezone: "America/Chicago",
      tags: ["signed"],
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
    });

    const contact = await bot.syncAppointment({
      contactId: "signed-appointment-sync",
      appointmentId: "signed-appt",
      startTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      status: "confirmed",
      title: "ASD Contract Review Call - Signed Contact"
    });
    const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "signed-appointment-sync");

    assert.equal(contact.automationPaused, true);
    assert.equal(contact.automationPauseReason, "signed_tag");
    assert.equal(jobs.some((job) => job.type === "appointment_reminder" && job.status === "pending"), false);
    assert.equal(alerts.length, 0);
  } finally {
    slack.sendAppointmentBooked = originalSendAppointmentBooked;
  }
});

test("qualified follow-up title uses qualified reminder templates", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "qualified-follow-up-sync",
    ghlContactId: "qualified-follow-up-sync",
    name: "Qualified Follow",
    phone: "+15550000903",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
  });

  const contact = await bot.syncAppointment({
    contactId: "qualified-follow-up-sync",
    appointmentId: "qualified-follow-up-appt",
    startTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    status: "confirmed",
    title: "ASD Qualified Follow-Up Call - Qualified Follow"
  });
  const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "qualified-follow-up-sync");

  assert.equal(contact.appointmentType, "qualified_follow_up");
  assert.equal(jobs.some((job) => job.type === "appointment_reminder" && job.status === "pending" && job.payload.templateGroup === "qualifiedFollowUpReminderTemplates"), true);
});

test("contract review no-show uses contract recovery and urgent missed notice", async () => {
  const { bot, store } = makeBot();
  const originalSendAppointmentNotice = slack.sendAppointmentNotice;
  const notices = [];
  slack.sendAppointmentNotice = async (_config, _contact, title, extra) => {
    notices.push({ title, extra });
    return { ok: true };
  };
  try {
    const primary = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    store.upsertContact({
      id: "contract-review-no-show",
      ghlContactId: "contract-review-no-show",
      name: "Contract No Show",
      phone: "+15550000904",
      timezone: "America/Chicago",
      tags: ["contract_sent"],
      engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
      qualificationProgress: QUALIFICATION.COMPLETE,
      appointmentType: "contract_review",
      appointmentTitle: "ASD Contract Review Call - Contract No Show",
      preferredCallTime: "Primary time",
      preferredCallTimeIso: primary,
      appointmentId: "contract-no-show-appt",
      automationPaused: true,
      automationPauseReason: "signed_tag"
    });

    const contact = await bot.markNoShow({ contactId: "contract-review-no-show", appointmentId: "contract-no-show-appt", status: "no_show" });
    const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "contract-review-no-show");

    assert.equal(contact.engagementStatus, ENGAGEMENT.MISSED_CALL);
    assert.equal(contact.appointmentType, "contract_review");
    assert.equal(contact.automationPaused, false);
    assert.equal(contact.automationPauseReason, "");
    assert.equal(jobs.some((job) => job.type === "missed_call_followup" && job.status === "pending" && job.payload.templateGroup === "contractReviewNoShowTemplates"), true);
    assert.equal(notices.some((notice) => notice.title === "Contract review missed"), true);
  } finally {
    slack.sendAppointmentNotice = originalSendAppointmentNotice;
  }
});

test("GHL appointment no-show status preserves backup and starts no-show recovery", async () => {
  const { bot, store } = makeBot();
  const primary = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const backup = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "sync-no-show",
    ghlContactId: "sync-no-show",
    name: "Sync No Show",
    phone: "+15550000076",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Primary time",
    preferredCallTimeIso: primary,
    backupCallTime: "Backup time",
    backupCallTimeIso: backup,
    backupCallTimeType: "exact",
    appointmentId: "sync-no-show-event"
  });

  const contact = await bot.syncAppointment({
    contactId: "sync-no-show",
    appointmentId: "sync-no-show-event",
    status: "no_show"
  });
  const jobs = Object.values(store.data.jobs);

  assert.equal(contact.engagementStatus, ENGAGEMENT.MISSED_CALL);
  assert.equal(store.getContact("sync-no-show").preferredCallTime, "Primary time");
  assert.equal(store.getContact("sync-no-show").backupCallTime, "Backup time");
  assert.equal(jobs.some((job) => job.contactId === "sync-no-show" && job.type === "backup_no_show_reminder" && job.status === "pending"), true);
  assert.equal(jobs.some((job) => job.contactId === "sync-no-show" && job.type === "missed_call_followup" && job.status === "pending"), true);
  assert.ok(store.getContact("sync-no-show").noShowBackupAlertSentAt);
});

test("GHL nested appointment no-show status starts no-show recovery without start time", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "sync-nested-no-show",
    ghlContactId: "sync-nested-no-show",
    name: "Nested No Show",
    phone: "+15550000182",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Primary time",
    preferredCallTimeIso: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    appointmentId: "nested-no-show-event"
  });

  const contact = await bot.syncAppointment({
    contact: { id: "sync-nested-no-show" },
    calendarEvent: {
      id: "nested-no-show-event",
      appointmentStatus: "No Show"
    }
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.MISSED_CALL);
  assert.equal(store.getSetting("last_no_show_webhook").value.result, "jobs_scheduled");
});

test("GHL boolean didShow false starts no-show recovery", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "sync-boolean-no-show",
    ghlContactId: "sync-boolean-no-show",
    name: "Boolean No Show",
    phone: "+15550000183",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Primary time",
    preferredCallTimeIso: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    appointmentId: "boolean-no-show-event"
  });

  const contact = await bot.syncAppointment({
    contactId: "sync-boolean-no-show",
    appointment: {
      id: "boolean-no-show-event",
      didShow: false
    }
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.MISSED_CALL);
  assert.equal(store.getSetting("last_no_show_webhook").value.status, "no_show_flag");
});

test("no-show webhook with missing contact logs operational issue without crashing", async () => {
  const { bot, store } = makeBot();
  const contact = await bot.markNoShow({ appointmentId: "missing-contact-appt", status: "no_show" });

  assert.equal(contact, null);
  assert.equal(store.getSetting("last_no_show_webhook").value.result, "missing_contact_id");
  const errors = store.getSetting("bot_error_log").value;
  assert.equal(errors[0].title, "GHL no-show webhook missing contact");
  assert.equal(errors[0].operationalOnly, true);
});

test("exact time reply during no-show recovery rebooks and schedules reminders", async () => {
  const { bot, store } = makeBot();
  const originalUpdateAppointment = ghl.updateAppointment;
  const originalSendAppointmentBooked = slack.sendAppointmentBooked;
  const updates = [];
  const alerts = [];
  ghl.updateAppointment = async (_config, _contact, appointmentId, startsAt, _endsAt, notes) => {
    updates.push({ appointmentId, startsAt, notes });
    return { id: appointmentId || "new-no-show-appt" };
  };
  slack.sendAppointmentBooked = async (_config, _contact, extra) => {
    alerts.push(extra);
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "no-show-rebook",
      ghlContactId: "no-show-rebook",
      name: "Rebook",
      phone: "+15550000082",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.MISSED_CALL,
      qualificationProgress: QUALIFICATION.CALL_BOOKED,
      currentSequenceName: "appointment_no_show",
      appointmentNoShowAt: new Date().toISOString(),
      appointmentId: "old-appt"
    });
    store.addJob({
      type: "missed_call_followup",
      contactId: "no-show-rebook",
      runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      payload: { templateGroup: "noShowTemplates", templateKey: "same_day_60" }
    });

    const contact = await bot.handleCallTime(store.getContact("no-show-rebook"), "tomorrow at 11am");
    const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "no-show-rebook");

    assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
    assert.equal(contact.currentSequenceName, "no_show_rebooked");
    assert.equal(contact.appointmentSource, "no_show_recovery");
    assert.equal(contact.previousAppointmentMissed, true);
    assert.ok(contact.rebookedAfterNoShowAt);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].appointmentId, "old-appt");
    assert.equal(alerts[0].Title, "Call rebooked after no-show");
    assert.match(store.getContact("no-show-rebook").lastOutboundMessage, /rebooked/i);
    assert.equal(jobs.some((job) => job.type === "missed_call_followup" && job.status === "pending"), false);
    assert.equal(jobs.some((job) => job.type === "appointment_reminder" && job.status === "pending"), true);
  } finally {
    ghl.updateAppointment = originalUpdateAppointment;
    slack.sendAppointmentBooked = originalSendAppointmentBooked;
  }
});

test("third no-show escalates instead of continuing blind automation", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "third-no-show",
    ghlContactId: "third-no-show",
    name: "Repeat",
    phone: "+15550000083",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    noShowCount: 2
  });

  const contact = await bot.markNoShow({ contactId: "third-no-show", appointmentId: "repeat-appt", status: "no_show" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
  assert.equal(contact.escalationReason, "third_no_show");
  assert.equal(Object.values(store.data.jobs).some((job) => job.contactId === "third-no-show" && job.type === "missed_call_followup" && job.status === "pending"), false);
});

test("third no-show does not send unknown-message Slack escalation or resurrect jobs", async () => {
  const { bot, store } = makeBot();
  const originalSendEscalation = slack.sendEscalation;
  let escalationPosts = 0;
  slack.sendEscalation = async () => {
    escalationPosts += 1;
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "third-no-show-no-inbound",
      ghlContactId: "third-no-show-no-inbound",
      name: "No Inbound Third",
      phone: "+15550000190",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
      qualificationProgress: QUALIFICATION.CALL_BOOKED,
      appointmentId: "third-no-show-no-inbound-appt",
      noShowCount: 2
    });

    const contact = await bot.markNoShow({
      contactId: "third-no-show-no-inbound",
      appointmentId: "third-no-show-no-inbound-appt",
      status: "no_show"
    });
    const healed = await bot.healStuckContacts();
    const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "third-no-show-no-inbound");

    assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
    assert.equal(contact.escalationReason, "third_no_show");
    assert.equal(store.getContact("third-no-show-no-inbound").automationPauseReason, "third_no_show");
    assert.equal(store.getContact("third-no-show-no-inbound").currentSequenceName, "third_no_show_escalated");
    assert.equal(escalationPosts, 0);
    assert.equal(healed.some((item) => item.contactId === "third-no-show-no-inbound"), false);
    assert.equal(jobs.some((job) => job.status === "pending" && ["missed_call_followup", "backup_no_show_reminder"].includes(job.type)), false);
  } finally {
    slack.sendEscalation = originalSendEscalation;
  }
});

test("duplicate third no-show webhook does not repair terminal no-show recovery", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "duplicate-third-no-show",
    ghlContactId: "duplicate-third-no-show",
    name: "Duplicate Third",
    phone: "+15550000191",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "third_no_show",
    automationPaused: true,
    automationPauseReason: "third_no_show",
    currentSequenceName: "third_no_show_escalated",
    appointmentNoShowAt: new Date().toISOString(),
    appointmentId: "duplicate-third-no-show-appt",
    noShowCount: 3
  });

  const contact = await bot.markNoShow({
    contactId: "duplicate-third-no-show",
    appointmentId: "duplicate-third-no-show-appt",
    status: "no_show"
  });
  const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "duplicate-third-no-show");

  assert.equal(contact.escalationReason, "third_no_show");
  assert.equal(store.getSetting("last_no_show_webhook").value.result, "duplicate_no_show_ignored_terminal_or_held");
  assert.equal(jobs.some((job) => job.status === "pending" && ["missed_call_followup", "backup_no_show_reminder"].includes(job.type)), false);
});

test("manual appointment edit after no-show replaces recovery with normal reminders", async () => {
  const { bot, store } = makeBot();
  const primary = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const backup = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "sync-no-show-reschedule",
    ghlContactId: "sync-no-show-reschedule",
    name: "Sync No Show Reschedule",
    phone: "+15550000078",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Primary time",
    preferredCallTimeIso: primary,
    backupCallTime: "Backup time",
    backupCallTimeIso: backup,
    backupCallTimeType: "exact",
    appointmentId: "sync-no-show-reschedule-event"
  });

  await bot.syncAppointment({
    contactId: "sync-no-show-reschedule",
    appointmentId: "sync-no-show-reschedule-event",
    status: "no_show"
  });
  const resynced = await bot.syncAppointment({
    contactId: "sync-no-show-reschedule",
    appointmentId: "sync-no-show-reschedule-event",
    startTime: backup,
    status: "confirmed"
  });
  const jobs = Object.values(store.data.jobs).filter((job) => job.contactId === "sync-no-show-reschedule");

  assert.equal(resynced.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.equal(resynced.preferredCallTimeIso, backup);
  assert.equal(jobs.some((job) => job.type === "backup_no_show_reminder" && job.status === "pending"), false);
  assert.equal(jobs.some((job) => job.type === "missed_call_followup" && job.status === "pending"), false);
  assert.equal(jobs.some((job) => job.type === "appointment_reminder" && job.status === "pending"), true);
});

test("GHL appointment sync treats no-zone start time as contact local and suppresses duplicate booking alert", async () => {
  const { bot, store } = makeBot();
  const originalAlertAt = "2026-05-10T23:23:20.000Z";
  store.upsertContact({
    id: "appointment-echo",
    ghlContactId: "appointment-echo",
    name: "Appointment Echo",
    phone: "+15550000079",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTime: "Mon, May 11, 10:00 AM CST",
    preferredCallTimeIso: "2026-05-11T15:00:00.000Z",
    appointmentId: "bot-created-id",
    bookingAlertSentAt: originalAlertAt
  });

  const contact = await bot.syncAppointment({
    contactId: "appointment-echo",
    appointmentId: "ghl-echo-id",
    startTime: "2026-05-11T10:00:00",
    status: "confirmed"
  });

  assert.equal(contact.preferredCallTimeIso, "2026-05-11T15:00:00.000Z");
  assert.match(contact.preferredCallTime, /10:00 AM CST/);
  assert.equal(contact.appointmentId, "ghl-echo-id");
  assert.equal(contact.bookingAlertSentAt, originalAlertAt);
});

test("GHL appointment sync treats UTC-looking merge field as calendar local and does not reuse calendar id", async () => {
  const { bot, store } = makeBot();
  const originalSendAppointmentBooked = slack.sendAppointmentBooked;
  const alerts = [];
  slack.sendAppointmentBooked = async (_config, _contact, extra) => {
    alerts.push(extra);
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "manual-pacific-appt",
      ghlContactId: "manual-pacific-appt",
      name: "Manual Pacific",
      phone: "+15550000081",
      timezone: "America/Los_Angeles",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
    });

    const contact = await bot.syncAppointment({
      contactId: "manual-pacific-appt",
      startTime: "2026-05-11T10:00:00.000Z",
      status: "confirmed",
      calendar: { id: "calendar-not-appointment-id" }
    });

    assert.equal(contact.preferredCallTimeIso, "2026-05-11T15:00:00.000Z");
    assert.match(contact.preferredCallTime, /8:00 AM PST/);
    assert.equal(contact.appointmentId, "");
    assert.equal(alerts.length, 1);
    assert.match(alerts[0]["Primary call time"], /8:00 AM PST/);

    await bot.syncAppointment({
      contactId: "manual-pacific-appt",
      startTime: "2026-05-11T10:00:00.000Z",
      status: "confirmed",
      calendar: { id: "calendar-not-appointment-id" }
    });

    assert.equal(alerts.length, 1);
  } finally {
    slack.sendAppointmentBooked = originalSendAppointmentBooked;
  }
});

test("manual appointment sync can recover bad GHL start time from recent lead call-time text", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "manual-bad-start",
    ghlContactId: "manual-bad-start",
    name: "Manual Bad Start",
    phone: "+15550000083",
    timezone: "America/Denver",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
  });
  store.addMessage({
    contactId: "manual-bad-start",
    direction: "inbound",
    body: "If you can call me tomorrow at 11:30 I would appreciate it"
  });

  const contact = await bot.syncAppointment({
    contactId: "manual-bad-start",
    appointmentId: "manual-bad-start-appt",
    startTime: new Date().toISOString(),
    status: "confirmed",
    suppressAlert: true
  });
  const local = getLocalParts(new Date(contact.preferredCallTimeIso), "America/Denver");

  assert.equal(local.hour, 11);
  assert.equal(local.minute, 30);
  assert.equal(contact.lastAppointmentSyncTimeSource, "recent_inbound_call_time");
  assert.match(contact.lastAppointmentSyncRecoveredFromInbound, /tomorrow at 11:30/i);
});

test("silent appointment sync can repair an existing bad UTC-shifted display from no-zone calendar time", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "manual-pacific-repair",
    ghlContactId: "manual-pacific-repair",
    name: "Manual Pacific Repair",
    phone: "+15550000082",
    timezone: "America/Los_Angeles",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Mon, May 11, 3:00 AM PST",
    preferredCallTimeIso: "2026-05-11T10:00:00.000Z",
    appointmentId: "bad-calendar-id",
    bookingAlertSentAt: "2026-05-11T14:17:08.032Z"
  });

  const contact = await bot.syncAppointment({
    contactId: "manual-pacific-repair",
    appointmentId: "real-appointment-id",
    startTime: "2026-05-11T10:00:00",
    status: "confirmed",
    suppressAlert: true
  });

  assert.equal(contact.preferredCallTimeIso, "2026-05-11T15:00:00.000Z");
  assert.match(contact.preferredCallTime, /8:00 AM PST/);
  assert.equal(contact.appointmentId, "real-appointment-id");
  assert.equal(contact.bookingAlertSentAt, "2026-05-11T14:17:08.032Z");
});

test("GHL appointment sync can repair appointment time silently", async () => {
  const { bot, store } = makeBot();
  const originalAlertAt = "2026-05-10T23:23:20.000Z";
  store.upsertContact({
    id: "appointment-repair",
    ghlContactId: "appointment-repair",
    name: "Appointment Repair",
    phone: "+15550000080",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
    qualificationProgress: QUALIFICATION.COMPLETE,
    preferredCallTime: "Mon, May 11, 5:00 AM CST",
    preferredCallTimeIso: "2026-05-11T10:00:00.000Z",
    appointmentId: "wrong-sync-id",
    bookingAlertSentAt: originalAlertAt
  });

  const contact = await bot.syncAppointment({
    contactId: "appointment-repair",
    appointmentId: "correct-sync-id",
    startTime: "2026-05-11T10:00:00",
    status: "confirmed",
    suppressAlert: true
  });

  assert.equal(contact.preferredCallTimeIso, "2026-05-11T15:00:00.000Z");
  assert.match(contact.preferredCallTime, /10:00 AM CST/);
  assert.equal(contact.appointmentId, "correct-sync-id");
  assert.equal(contact.bookingAlertSentAt, originalAlertAt);
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

test("LLM call-now intent at call-time stage is accepted without generic yes-no clarification", async () => {
  const { bot, store } = makeBot();
  bot.config.llm = {
    apiKey: "test-key",
    fallbackEnabled: true,
    classifierModel: "test-model",
    minConfidence: 0.85,
    clarifyConfidence: 0.6
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        label: "call_now",
        confidence: 0.75,
        should_escalate: false,
        normalized_value: "call_now",
        reason: "The lead said yes after being asked if they were open for a call now or later today."
      })
    })
  });
  try {
    store.upsertContact({
      id: "llm-call-now-low-confidence",
      ghlContactId: "llm-call-now-low-confidence",
      name: "Craig",
      phone: "+15550000079",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      lastOutboundMessage: "Are you open for a call now or later today?"
    });

    const contact = await bot.tryLlmFallback(store.getContact("llm-call-now-low-confidence"), "Yes");

    assert.equal(contact.engagementStatus, ENGAGEMENT.READY_FOR_CALL);
    assert.match(store.getContact("llm-call-now-low-confidence").lastOutboundMessage, /connecting you with a Specialist/i);
    assert.doesNotMatch(store.getContact("llm-call-now-low-confidence").lastOutboundMessage, /yes, no, or not sure/i);
  } finally {
    global.fetch = originalFetch;
  }
});

test("LLM decision gate blocks risky call-now confirmation", async () => {
  const { bot, store } = makeBot();
  bot.config.llm = {
    apiKey: "test-key",
    fallbackEnabled: true,
    classifierModel: "test-model",
    decisionGateEnabled: true,
    decisionGateModel: "test-model",
    decisionGateMinConfidence: 0.82,
    minConfidence: 0.85,
    clarifyConfidence: 0.6
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        decision: "block_clarify",
        confidence: 0.93,
        reason: "The recent context says the lead is not available right now.",
        corrected_intent: "ask_for_later_time",
        risk_flags: ["negative_availability"]
      })
    })
  });
  try {
    store.upsertContact({
      id: "gate-not-right-now",
      ghlContactId: "gate-not-right-now",
      name: "DeAndre",
      phone: "+15550000191",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      lastOutboundMessage: "Are you open for a call now or later today?"
    });

    const contact = await bot.handleCallTime(store.getContact("gate-not-right-now"), "now is fine");

    assert.notEqual(contact.engagementStatus, ENGAGEMENT.READY_FOR_CALL);
    assert.match(store.getContact("gate-not-right-now").lastOutboundMessage, /later today or tomorrow/i);
    assert.equal(
      store.listDecisionLogs().some((decision) => decision.contactId === "gate-not-right-now" && decision.action === "llm_gate_blocked"),
      true
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("LLM decision gate corrects conflicting reschedule time", async () => {
  const { bot, store } = makeBot();
  bot.config.llm = {
    apiKey: "test-key",
    fallbackEnabled: true,
    classifierModel: "test-model",
    decisionGateEnabled: true,
    decisionGateModel: "test-model",
    decisionGateMinConfidence: 0.82,
    minConfidence: 0.85,
    clarifyConfidence: 0.6
  };
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        decision: "correct_time",
        confidence: 0.96,
        reason: "The lead rejected the old 3:15 time and gave 6pm as the new time.",
        corrected_intent: "reschedule",
        corrected_time_text: "6pm",
        risk_flags: ["conflicting_existing_time"]
      })
    })
  });
  try {
    store.upsertContact({
      id: "gate-riley-reschedule",
      ghlContactId: "gate-riley-reschedule",
      name: "Riley",
      phone: "+15550000192",
      timezone: "America/Los_Angeles",
      engagementStatus: ENGAGEMENT.CALL_SCHEDULED,
      qualificationProgress: QUALIFICATION.CALL_BOOKED,
      preferredCallTime: "Wed, May 13, 3:15 PM PST",
      preferredCallTimeIso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      appointmentId: "riley-appt"
    });

    const contact = await bot.handleReschedule(
      store.getContact("gate-riley-reschedule"),
      "I cant make it at 3:15 i can only make it at 6pm"
    );

    assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
    assert.match(store.getContact("gate-riley-reschedule").preferredCallTime, /6:00 PM/);
    assert.doesNotMatch(store.getContact("gate-riley-reschedule").lastOutboundMessage, /3:15 PM/);
    assert.equal(
      store.listDecisionLogs().some((decision) => decision.contactId === "gate-riley-reschedule" && decision.action === "llm_gate_corrected_time"),
      true
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("LLM decision gate failure blocks booking instead of guessing", async () => {
  const { bot, store } = makeBot();
  bot.config.llm = {
    apiKey: "test-key",
    fallbackEnabled: true,
    classifierModel: "test-model",
    decisionGateEnabled: true,
    decisionGateModel: "test-model",
    decisionGateMinConfidence: 0.82,
    minConfidence: 0.85,
    clarifyConfidence: 0.6
  };
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("network down");
  };
  try {
    store.upsertContact({
      id: "gate-failure-booking",
      ghlContactId: "gate-failure-booking",
      name: "Gate Failure",
      phone: "+15550000193",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
    });

    const contact = await bot.handleCallTime(store.getContact("gate-failure-booking"), "tomorrow at 2pm");

    assert.equal(contact.engagementStatus, ENGAGEMENT.ESCALATED_TO_HUMAN);
    assert.equal(store.getContact("gate-failure-booking").appointmentId, undefined);
    assert.equal(
      store.listDecisionLogs().some((decision) => decision.contactId === "gate-failure-booking" && decision.action === "llm_gate_failed"),
      true
    );
  } finally {
    global.fetch = originalFetch;
  }
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

test("brief acknowledgement at call stage asks for exact time instead of repeating call ask", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "call-ask-ok",
    ghlContactId: "call-ask-ok",
    name: "Juan",
    phone: "+15550000108",
    timezone: "America/Los_Angeles",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    lastOutboundMessage: "Are you open for a call now or later today?"
  });

  const contact = await bot.handleInboundSms({ contactId: "call-ask-ok", message: "Ok" });

  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.equal(contact.awaitingSpecificCallTime, true);
  assert.match(store.getContact("call-ask-ok").lastOutboundMessage, /what time works best/i);
  assert.doesNotMatch(store.getContact("call-ask-ok").lastOutboundMessage, /Based on what/);
});

test("cold acknowledgement asks for accident date instead of starting fault warm chase", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "cold-ack-date",
    ghlContactId: "cold-ack-date",
    name: "Cold Ack",
    phone: "+15550000086",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT
  });

  const contact = await bot.applyLlmClassification(
    store.getContact("cold-ack-date"),
    { label: "acknowledgement", confidence: 0.92, should_escalate: false },
    "Ok"
  );

  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_FAULT);
  assert.match(store.getContact("cold-ack-date").lastOutboundMessage, /date of the accident/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "cold-ack-date" && job.type === "warm_followup" && job.status === "pending"),
    false
  );
});

test("warm follow-up job skips cold acknowledgements that still need accident date", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "cold-ack-existing-warm",
    ghlContactId: "cold-ack-existing-warm",
    name: "Cold Ack Existing",
    phone: "+15550000088",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.WARM_FOLLOW_UP,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    lastInboundMessage: "Ok",
    lastResponseTimestamp: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  });
  const job = store.addJob({
    type: "warm_followup",
    contactId: "cold-ack-existing-warm",
    runAt: new Date().toISOString(),
    payload: { step: 3, minutes: 30 }
  });

  await bot.runDueJob(job);

  assert.equal(store.data.jobs[job.id].status, "skipped");
  assert.equal(store.data.jobs[job.id].skipReason, "cold_ack_needs_accident_date");
  assert.equal(store.getContact("cold-ack-existing-warm").lastOutboundMessage, undefined);
});

test("soft escalated lead can auto-resume when they send a scheduling reply", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "soft-resume-later",
    ghlContactId: "soft-resume-later",
    name: "Behnaz",
    phone: "+15550000074",
    timezone: "America/New_York",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    humanEscalationStatus: true,
    humanEscalationStage: "human_review_pending",
    escalationReason: "message_after_bot_paused"
  });
  store.addJob({
    type: "human_escalation_sla",
    contactId: "soft-resume-later",
    runAt: new Date().toISOString(),
    payload: { minutes: 5 }
  });

  const contact = await bot.handleInboundSms({
    contactId: "soft-resume-later",
    message: "Later I am sick in bed I had surgery"
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(contact.humanEscalationStatus, false);
  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
  assert.equal(store.getContact("soft-resume-later").awaitingSpecificCallTime, true);
  assert.match(store.getContact("soft-resume-later").lastOutboundMessage, /hope you feel better/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "soft-resume-later" && job.type === "human_escalation_sla" && job.status === "pending"),
    false
  );
});

test("detailed reply with police report still advances when it answers current question", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "detailed-fault-answer",
    ghlContactId: "detailed-fault-answer",
    name: "Detailed Fault",
    phone: "+15550000083",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    accidentDate: "May 7 2026"
  });

  const contact = await bot.handleInboundSms({
    contactId: "detailed-fault-answer",
    message: "Yes it was yesterday May 7 2026, the driver hit my front fender and kept going. I filed a police report as well."
  });

  assert.equal(contact.engagementStatus, ENGAGEMENT.ACTIVE_CONVERSATION);
  assert.equal(contact.qualificationProgress, QUALIFICATION.NEEDS_MEDICAL);
  assert.equal(contact.faultAnswer, "not_at_fault");
  assert.equal(store.data.escalations.length, 0);
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
  assert.match(store.getContact("tomorrow-afternoon").lastOutboundMessage, /time tomorrow/i);
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
  assert.match(contact.lastOutboundMessage, /time tomorrow/i);
});

test("medical answer reuses recent call time given before scheduling step", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "reuse-call-time",
    ghlContactId: "reuse-call-time",
    name: "Pedro",
    phone: "+15550000076",
    timezone: "America/Los_Angeles",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
    faultAnswer: "not_at_fault",
    lastOutboundMessage: "Old scheduling prompt"
  });
  store.addMessage({
    contactId: "reuse-call-time",
    direction: "inbound",
    body: "Yes, I am open"
  });
  store.addMessage({
    contactId: "reuse-call-time",
    direction: "inbound",
    body: "tomorrow at 2"
  });

  const contact = await bot.handleInboundSms({ contactId: "reuse-call-time", message: "No" });

  assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
  assert.equal(store.getContact("reuse-call-time").medicalTreatmentAnswer, "no");
  assert.equal(store.getContact("reuse-call-time").qualificationProgress, QUALIFICATION.CALL_BOOKED);
  assert.ok(store.getContact("reuse-call-time").preferredCallTimeIso);
  assert.equal(store.getContact("reuse-call-time").recoveredCallTimeMessage, "tomorrow at 2");
  assert.match(store.getContact("reuse-call-time").lastOutboundMessage, /backup time/i);
  assert.equal(
    Object.values(store.data.jobs).some((job) => job.contactId === "reuse-call-time" && job.type === "appointment_reminder" && job.status === "pending"),
    true
  );
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

test("queued call-now inbound sends Slack immediately but delays bot SMS until buffer", async () => {
  const { bot, store } = makeBot();
  const originalSendUrgentCallNow = slack.sendUrgentCallNow;
  let urgentAlerts = 0;
  slack.sendUrgentCallNow = async () => {
    urgentAlerts += 1;
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "fastlane-call-now",
      ghlContactId: "fastlane-call-now",
      name: "Alexander",
      phone: "+15550000180",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      lastOutboundMessage: "Are you open for a call now or later today?"
    });

    await bot.queueInboundSms({ contactId: "fastlane-call-now", message: "Yes call me now" });

    assert.equal(urgentAlerts, 1);
    assert.equal(store.getContact("fastlane-call-now").engagementStatus, ENGAGEMENT.READY_FOR_CALL);
    assert.equal(
      store.data.messages.filter((message) => message.contactId === "fastlane-call-now" && message.direction === "outbound").length,
      0
    );

    const job = Object.values(store.data.jobs).find(
      (item) => item.contactId === "fastlane-call-now" && item.type === "process_inbound_buffer" && item.status === "pending"
    );
    await bot.runDueJob(job);

    assert.equal(urgentAlerts, 1);
    assert.match(store.getContact("fastlane-call-now").lastOutboundMessage, /connecting you with a Specialist/i);
  } finally {
    slack.sendUrgentCallNow = originalSendUrgentCallNow;
  }
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

test("call-now phrase interrupts qualification and sends urgent call alert", async () => {
  const { bot, store } = makeBot();
  const originalSendUrgentCallNow = slack.sendUrgentCallNow;
  let urgentAlerts = 0;
  slack.sendUrgentCallNow = async () => {
    urgentAlerts += 1;
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "call-now-mid-qualification",
      ghlContactId: "call-now-mid-qualification",
      name: "Wytasha",
      phone: "+15550000143",
      timezone: "America/Los_Angeles",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
      lastOutboundMessage: "Have you needed to see any doctors or receive any medical treatment after the accident?"
    });

    const contact = await bot.handleInboundSms({
      contactId: "call-now-mid-qualification",
      message: "Okay\nNow is ok"
    });

    assert.equal(contact.engagementStatus, ENGAGEMENT.READY_FOR_CALL);
    assert.equal(contact.humanEscalationStatus, true);
    assert.equal(urgentAlerts, 1);
    assert.match(store.getContact("call-now-mid-qualification").lastOutboundMessage, /connecting you with a Specialist/i);
  } finally {
    slack.sendUrgentCallNow = originalSendUrgentCallNow;
  }
});

test("not-right-now reply asks for a better time instead of sending call-now alert", async () => {
  const { bot, store } = makeBot();
  const originalSendUrgentCallNow = slack.sendUrgentCallNow;
  let urgentAlerts = 0;
  slack.sendUrgentCallNow = async () => {
    urgentAlerts += 1;
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "deandre-not-now",
      ghlContactId: "deandre-not-now",
      name: "DeAndre Jackson",
      phone: "+15550000151",
      timezone: "America/Chicago",
      engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
      qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
      faultAnswer: "not_at_fault",
      medicalTreatmentAnswer: "yes",
      lastOutboundMessage:
        "Based on what you’ve shared, we can definitely help you out! Are you open for a call now or later today?"
    });

    const contact = await bot.handleInboundSms({
      contactId: "deandre-not-now",
      message: "Not right now. I'm sorry."
    });

    assert.equal(urgentAlerts, 0);
    assert.notEqual(contact.engagementStatus, ENGAGEMENT.READY_FOR_CALL);
    assert.equal(store.getContact("deandre-not-now").qualificationProgress, QUALIFICATION.NEEDS_CALL_TIME);
    assert.match(store.getContact("deandre-not-now").lastOutboundMessage, /No worries|What time/i);
    assert.doesNotMatch(store.getContact("deandre-not-now").lastOutboundMessage, /connecting you with a Specialist/i);
  } finally {
    slack.sendUrgentCallNow = originalSendUrgentCallNow;
  }
});

test("urgent call-now Slack posts to leads channel id", async () => {
  const originalFetch = global.fetch;
  let postedBody = null;
  global.fetch = async (_url, options) => {
    postedBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    await slack.sendUrgentCallNow(
      {
        dryRun: false,
        slack: {
          token: "xoxb-test",
          channel: "C0B2PN1APFT",
          leadsChannel: "wrong-channel"
        },
        ghl: { appBaseUrl: "https://app.gohighlevel.com", locationId: "loc" }
      },
      {
        name: "Call Now Lead",
        phone: "+15550000150",
        ghlContactId: "ghl-call-now"
      }
    );
    assert.equal(postedBody.channel, "C09N85J9G4Q");
    assert.match(postedBody.text, /URGENT: PC wants a call now/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("admin can force urgent call-now alert for a missed call-now lead", async () => {
  const { bot, store } = makeBot();
  const originalSendUrgentCallNow = slack.sendUrgentCallNow;
  let urgentAlerts = 0;
  slack.sendUrgentCallNow = async () => {
    urgentAlerts += 1;
    return { ok: true };
  };
  try {
    store.upsertContact({
      id: "admin-urgent-now",
      ghlContactId: "admin-urgent-now",
      name: "Admin Urgent",
      phone: "+15550000144",
      timezone: "America/Los_Angeles",
      engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
      qualificationProgress: QUALIFICATION.NEEDS_MEDICAL,
      humanEscalationStatus: true,
      escalationReason: "detailed_information",
      lastInboundMessage: "Now is ok"
    });

    const contact = await bot.applyBotControl({ contactId: "admin-urgent-now", action: "urgent_call_now" });

    assert.equal(contact.engagementStatus, ENGAGEMENT.READY_FOR_CALL);
    assert.equal(urgentAlerts, 1);
  } finally {
    slack.sendUrgentCallNow = originalSendUrgentCallNow;
  }
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
  assert.match(store.getContact("warm-status").lastOutboundMessage, /medical visit|treat|evaluate|urgent care|chiro|doctor/i);
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
  assert.match(store.getContact("warm-copy").lastOutboundMessage, /call is quick|later today|tomorrow|Specialist call|time today/i);
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
  assert.match(store.getContact("warm-2").lastOutboundMessage, /fault part|medical treatment|checked out/i);
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

  assert.match(store.getContact("reengage-message").lastOutboundMessage, /fault part|medical treatment|checked out/i);
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

test("queued initial SMS skips when the initial cold SMS was already sent", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "initial-job-dupe",
    ghlContactId: "initial-job-dupe",
    name: "Initial Job Dupe",
    phone: "+15550000124",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.INITIAL_SMS_SENT,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    currentSequenceName: "initial_sms",
    currentSequenceDay: 1,
    sentColdTemplateKeys: ["day_1_am"],
    lastOutboundMessage: "Hi Initial Job Dupe, do you remember the date of the accident?"
  });
  const job = store.addJob({
    type: "initial_sms",
    contactId: "initial-job-dupe",
    runAt: new Date().toISOString(),
    payload: { templateKey: "day_1_am", source: "fresh_retry" }
  });

  await bot.runDueJob(job);

  assert.equal(store.data.jobs[job.id].status, "skipped");
  assert.equal(store.data.jobs[job.id].skipReason, "initial_sms_already_sent");
  assert.equal(
    store.data.messages.filter((message) => message.contactId === "initial-job-dupe" && message.direction === "outbound").length,
    0
  );
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
  const cadenceTimezone = ["Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Chicago"].find((timeZone) => {
    const local = getLocalParts(new Date(), timeZone);
    return local.hour <= 22;
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
    freshJobs.map((job) => job.payload.minutes).filter((minutes) => [15, 45, 120, 240].includes(minutes)),
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

test("preserves valid IANA timezone strings before applying common aliases", () => {
  const normalized = normalizePayload(
    {
      contactId: "tz-iana",
      name: "TZ IANA",
      phone: "+15550000071",
      timezone: "Pacific/Honolulu",
      tags: ["NR"]
    },
    testConfig("")
  );

  assert.equal(normalized.timezone, "Pacific/Honolulu");
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

test("owner timezone wins over contact address state", () => {
  const normalized = normalizePayload(
    {
      contactId: "tz-owner-wins",
      name: "Behnaz Alisalehi",
      phone: "+15550000070",
      timezone: "America/Chicago",
      state: "NJ",
      owner: "California"
    },
    testConfig("")
  );

  assert.equal(normalized.state, "NJ");
  assert.equal(normalized.owner, "California");
  assert.equal(normalized.timezone, "America/Los_Angeles");
});

test("state-like pipeline tags can resolve timezone before contact address state", () => {
  const normalized = normalizePayload(
    {
      contactId: "tz-tag-wins",
      name: "Tag Timezone",
      phone: "+15550000071",
      timezone: "America/Chicago",
      state: "NJ",
      tags: "lhpark_ca,nr"
    },
    testConfig("")
  );

  assert.equal(normalized.state, "NJ");
  assert.equal(normalized.timezone, "America/Los_Angeles");
});

test("known firm tags hard-map to the correct timezone", () => {
  const expected = {
    LHPARK_CA: "America/Los_Angeles",
    LEVIN_CO: "America/Denver",
    GASLMP_CA: "America/Los_Angeles",
    MOUDGL_TX: "America/Chicago",
    RODRGZ_TX: "America/Chicago",
    BERNRD_WA: "America/Los_Angeles",
    LARLAT_ND: "America/Chicago",
    EDBERN_NV: "America/Los_Angeles",
    HOWBNT_KY: "America/New_York",
    TAKLAW_TX: "America/Chicago",
    CHALIK_TX: "America/Chicago",
    OAKWOD_CA: "America/Los_Angeles"
  };

  for (const [tag, timezone] of Object.entries(expected)) {
    const normalized = normalizePayload(
      {
        contactId: `tz-${tag}`,
        name: tag,
        phone: "+15550000073",
        timezone: "America/Chicago",
        state: "NJ",
        tags: [tag, "NR"]
      },
      testConfig("")
    );

    assert.equal(normalized.timezone, timezone, tag);
  }
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
  assert.match(store.getContact("tz-existing").preferredCallTime, /PST/);
});

test("inbound payload with state tag corrects an existing default timezone", async () => {
  const { bot, store } = makeBot();
  store.upsertContact({
    id: "tz-existing-tag",
    ghlContactId: "tz-existing-tag",
    name: "Timezone Existing Tag",
    phone: "+15550000072",
    timezone: "America/Chicago",
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME
  });

  await bot.handleInboundSms({
    contactId: "tz-existing-tag",
    message: "tomorrow at 2pm",
    timezone: "America/Chicago",
    state: "NJ",
    tags: "lhpark_ca,nr"
  });

  assert.equal(store.getContact("tz-existing-tag").timezone, "America/Los_Angeles");
  assert.match(store.getContact("tz-existing-tag").preferredCallTime, /PST/);
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

test("calendar failsafe silently syncs GHL appointments and schedules reminders", async () => {
  const { bot, store } = makeBot();
  bot.config.ghl.token = "test-token";
  bot.config.ghl.locationId = "loc";
  bot.config.ghl.calendarId = "cal";
  const startsAt = Date.now() + 2 * 60 * 60 * 1000;
  store.upsertContact({
    id: "calendar-sync-1",
    ghlContactId: "calendar-sync-1",
    name: "Calendar Lead",
    phone: "+15550000400",
    tags: ["levin_co"],
    timezone: "America/Denver",
    engagementStatus: ENGAGEMENT.ESCALATED_TO_HUMAN,
    humanEscalationStatus: true,
    automationPaused: true
  });
  const originalListCalendarEvents = ghl.listCalendarEvents;
  try {
    ghl.listCalendarEvents = async () => ({
      ok: true,
      events: [
        {
          id: "appt-calendar-1",
          contactId: "calendar-sync-1",
          startTime: startsAt,
          endTime: startsAt + 15 * 60 * 1000,
          appointmentStatus: "confirmed",
          title: "Calendar Lead"
        }
      ]
    });

    const result = await bot.syncUpcomingCalendarAppointments({ force: true });
    const contact = store.getContact("calendar-sync-1");
    const reminders = store
      .listJobs("calendar-sync-1")
      .filter((job) => job.status === "pending" && job.type === "appointment_reminder");

    assert.equal(result.some((item) => item.action === "calendar_appointment_synced"), true);
    assert.equal(contact.appointmentId, "appt-calendar-1");
    assert.equal(contact.engagementStatus, ENGAGEMENT.CALL_SCHEDULED);
    assert.equal(reminders.length, 2);
    assert.equal(store.listMessages("calendar-sync-1").length, 0);
  } finally {
    ghl.listCalendarEvents = originalListCalendarEvents;
  }
});

test("duplicate no-show webhook for same appointment is idempotent", async () => {
  const { bot, store } = makeBot();
  const startsAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  store.upsertContact({
    id: "noshow-idempotent",
    ghlContactId: "noshow-idempotent",
    name: "No Show Lead",
    phone: "+15550000401",
    timezone: "America/Chicago",
    appointmentId: "appt-noshow-1",
    appointmentNoShowAt: new Date().toISOString(),
    noShowCount: 1,
    currentSequenceName: "appointment_no_show",
    engagementStatus: ENGAGEMENT.MISSED_CALL,
    qualificationProgress: QUALIFICATION.CALL_BOOKED,
    preferredCallTimeIso: startsAt
  });

  const contact = await bot.markNoShow({
    contactId: "noshow-idempotent",
    appointmentId: "appt-noshow-1",
    startTime: startsAt,
    appointmentStatus: "noshow"
  });

  assert.equal(contact.noShowCount, 1);
  assert.equal(store.getContact("noshow-idempotent").noShowCount, 1);
  assert.equal(
    store.listDecisionLogs("noshow-idempotent").some((log) => log.reason === "repeat_no_show_started"),
    false
  );
});
