#!/usr/bin/env node
const { loadConfig } = require("../src/config");
const { Store, normalizePhone } = require("../src/store");
const { SmsBot } = require("../src/flow");
const { ENGAGEMENT, QUALIFICATION } = require("../src/constants");
const { qualificationTemplates } = require("../src/templates");

const TEST_CONTACT = {
  contactId: "KWGdWZKQc1ntzefGLaH2",
  name: "collins test",
  phone: "+19529941286",
  timezone: "America/Chicago",
  leadSource: "real local flow test"
};

function bodyText(item) {
  return item.body || item.message || item.text || item.content || "";
}

function itemId(item) {
  return item.id || item.messageId || item.message_id || "";
}

function contactId(item) {
  return item.contactId || item.contact_id || item.contact?.id || "";
}

function direction(item) {
  const raw = String(item.direction || item.messageDirection || item.type || item.status || "").toLowerCase();
  if (raw.includes("inbound") || raw === "incoming" || raw === "received") return "inbound";
  if (raw.includes("outbound") || raw === "outgoing" || raw === "sent") return "outbound";
  return raw;
}

function createdAt(item) {
  return item.createdAt || item.dateAdded || item.dateCreated || item.timestamp || item.created_at || "";
}

function phone(item) {
  return item.phone || item.phoneNumber || item.contact?.phone || "";
}

function testConfig() {
  const config = loadConfig();
  config.dryRun = false;
  return config;
}

async function fetchRecentSms(config) {
  const url = new URL(`${config.ghl.apiBase}/conversations/messages/export`);
  url.searchParams.set("locationId", config.ghl.locationId);
  url.searchParams.set("channel", "SMS");
  url.searchParams.set("limit", "100");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.ghl.token}`,
      Version: "2023-02-21",
      Accept: "application/json"
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(payload));
  return payload.messages || payload.data?.messages || payload.data || payload.items || [];
}

function isTestContactMessage(item) {
  const knownContactIds = new Set(["KWGdWZKQc1ntzefGLaH2", "2Yb53CdmcNPhLXaaXe0g"]);
  const idMatch = knownContactIds.has(String(contactId(item)));
  const phoneMatch = normalizePhone(phone(item)) === normalizePhone(TEST_CONTACT.phone);
  return idMatch || phoneMatch;
}

function getPrimary(store) {
  return store.getContact(TEST_CONTACT.contactId);
}

async function start() {
  const config = testConfig();
  const store = new Store(config.dataFile);
  const bot = new SmsBot(store, config);
  const contact = await bot.startFromNoResponseDisposition(TEST_CONTACT);
  store.upsertContact({
    ...contact,
    realFlowTest: {
      startedAt: new Date().toISOString(),
      processedGhlMessageIds: []
    }
  });
  console.log(JSON.stringify({ ok: true, action: "started", contact: store.getContact(contact.id) }, null, 2));
}

async function startCallLaterBranch() {
  const config = testConfig();
  const store = new Store(config.dataFile);
  const bot = new SmsBot(store, config);
  store.cancelJobsForContact(TEST_CONTACT.contactId, "starting real call-later branch test");
  const contact = store.upsertContact({
    id: TEST_CONTACT.contactId,
    ghlContactId: TEST_CONTACT.contactId,
    name: TEST_CONTACT.name,
    phone: TEST_CONTACT.phone,
    timezone: TEST_CONTACT.timezone,
    leadSource: TEST_CONTACT.leadSource,
    engagementStatus: ENGAGEMENT.ACTIVE_CONVERSATION,
    qualificationProgress: QUALIFICATION.NEEDS_CALL_TIME,
    optOutStatus: false,
    humanEscalationStatus: false,
    automationPaused: false,
    accidentDate: "yesterday",
    faultAnswer: "not_at_fault",
    medicalTreatmentAnswer: "yes",
    workLifeImpactAnswer: "yes",
    awaitingBackupTime: false,
    realFlowTest: {
      branch: "call_later",
      startedAt: new Date().toISOString(),
      processedGhlMessageIds: []
    }
  });
  const sent = await bot.sendBotMessage(contact, qualificationTemplates.callAsk, { bypassQuietHours: true });
  const latest = store.upsertContact({
    ...(sent || contact),
    realFlowTest: contact.realFlowTest
  });
  console.log(JSON.stringify({ ok: true, action: "call_later_branch_started", contact: latest }, null, 2));
}

async function startOptOutBranch() {
  const config = testConfig();
  const store = new Store(config.dataFile);
  const bot = new SmsBot(store, config);
  store.cancelJobsForContact(TEST_CONTACT.contactId, "starting real opt-out branch test");
  const contact = store.upsertContact({
    id: TEST_CONTACT.contactId,
    ghlContactId: TEST_CONTACT.contactId,
    name: TEST_CONTACT.name,
    phone: TEST_CONTACT.phone,
    timezone: TEST_CONTACT.timezone,
    leadSource: TEST_CONTACT.leadSource,
    engagementStatus: ENGAGEMENT.COLD_OUTREACH,
    qualificationProgress: QUALIFICATION.NEEDS_FAULT,
    optOutStatus: false,
    humanEscalationStatus: false,
    automationPaused: false,
    awaitingBackupTime: false,
    realFlowTest: {
      branch: "opt_out",
      startedAt: new Date().toISOString(),
      processedGhlMessageIds: []
    }
  });
  const sent = await bot.sendBotMessage(
    contact,
    "Accident Support Desk controlled opt-out test. Reply STOP to confirm opt-out handling.",
    { bypassQuietHours: true }
  );
  const latest = store.upsertContact({
    ...(sent || contact),
    realFlowTest: contact.realFlowTest
  });
  console.log(JSON.stringify({ ok: true, action: "opt_out_branch_started", contact: latest }, null, 2));
}

async function poll() {
  const config = testConfig();
  const store = new Store(config.dataFile);
  const bot = new SmsBot(store, config);
  const primary = getPrimary(store);
  if (!primary?.realFlowTest) {
    throw new Error("Real flow test has not been started. Run: node scripts/real_flow_test.js start");
  }
  const processed = new Set(primary.realFlowTest.processedGhlMessageIds || []);
  const startedAt = new Date(primary.realFlowTest.startedAt).getTime();
  const items = (await fetchRecentSms(config))
    .filter(isTestContactMessage)
    .filter((item) => direction(item) === "inbound")
    .filter((item) => itemId(item) && !processed.has(itemId(item)))
    .filter((item) => {
      const at = Date.parse(createdAt(item));
      return Number.isNaN(at) || at >= startedAt;
    })
    .sort((a, b) => Date.parse(createdAt(a) || 0) - Date.parse(createdAt(b) || 0));

  const handled = [];
  for (const item of items) {
    const result = await bot.handleInboundSms({
      contactId: contactId(item) || TEST_CONTACT.contactId,
      name: TEST_CONTACT.name,
      phone: phone(item) || TEST_CONTACT.phone,
      timezone: TEST_CONTACT.timezone,
      leadSource: TEST_CONTACT.leadSource,
      message: bodyText(item)
    });
    processed.add(itemId(item));
    const latest = store.getContact(result.id) || result;
    store.upsertContact({
      ...latest,
      realFlowTest: {
        ...(latest.realFlowTest || primary.realFlowTest),
        processedGhlMessageIds: Array.from(processed)
      }
    });
    handled.push({ id: itemId(item), contactId: contactId(item), body: bodyText(item), botContactId: result.id });
  }

  console.log(JSON.stringify({ ok: true, handled, contact: getPrimary(store) }, null, 2));
}

async function status() {
  const config = loadConfig();
  const store = new Store(config.dataFile);
  const contact = getPrimary(store);
  const messages = store.data.messages.filter((message) => message.contactId === TEST_CONTACT.contactId).slice(-10);
  console.log(JSON.stringify({ ok: true, contact, messages }, null, 2));
}

async function main() {
  const command = process.argv[2];
  if (command === "start") return start();
  if (command === "start-call-later") return startCallLaterBranch();
  if (command === "start-opt-out") return startOptOutBranch();
  if (command === "poll") return poll();
  if (command === "status") return status();
  throw new Error("Use one command: start, start-call-later, start-opt-out, poll, or status");
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
