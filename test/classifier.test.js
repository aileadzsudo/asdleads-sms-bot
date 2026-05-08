const test = require("node:test");
const assert = require("node:assert/strict");
const { QUALIFICATION } = require("../src/constants");
const {
  isOptOut,
  parseExpectedAnswer,
  parseAccidentDate,
  parseCallTime,
  escalationReason,
  isDocumentOrReport
} = require("../src/classifier");

const config = { texting: { defaultTimezone: "America/Chicago" } };
const contact = { timezone: "America/Chicago" };

test("detects natural opt-out language", () => {
  assert.equal(isOptOut("STOP"), true);
  assert.equal(isOptOut("please remove me"), true);
  assert.equal(isOptOut("wrong number"), true);
  assert.equal(isOptOut("yes tomorrow works"), false);
});

test("parses only the answer expected by current qualification progress", () => {
  assert.equal(parseExpectedAnswer(QUALIFICATION.NEEDS_FAULT, "the other driver was at fault").value, "not_at_fault");
  assert.equal(parseExpectedAnswer(QUALIFICATION.NEEDS_MEDICAL, "I went to urgent care").value, "yes");
  assert.equal(parseExpectedAnswer(QUALIFICATION.NEEDS_FAULT, "who is this"), null);
});

test("extracts accident date without needing AI", () => {
  assert.equal(parseAccidentDate("It was 4/12/2026").value, "4/12/2026");
  assert.equal(parseAccidentDate("March 3rd").value, "march 3rd");
  assert.equal(parseAccidentDate("yeserday").value, "yeserday");
  assert.equal(parseAccidentDate("I was in an accident yesterday").value, "yesterday");
  assert.equal(parseAccidentDate("a week ago").value, "a week ago");
  assert.equal(parseAccidentDate("last Friday").value, "last friday");
});

test("parses call now and simple scheduled time", () => {
  assert.equal(parseCallTime("call me now", contact, config).type, "now");
  assert.equal(parseCallTime("I can talk now", contact, config).type, "now");
  assert.equal(parseCallTime("anytime", contact, config).type, "now");
  assert.equal(parseCallTime("can you call back later?", contact, config).type, "needs_specific_time");
  assert.equal(parseCallTime("tomorrow morning", contact, config, new Date("2026-05-07T15:00:00Z")).type, "scheduled");
  assert.equal(parseCallTime("in 20 minutes", contact, config, new Date("2026-05-07T15:00:00Z")).type, "scheduled");
  const parsed = parseCallTime("tomorrow at 3pm", contact, config, new Date("2026-05-07T15:00:00Z"));
  assert.equal(parsed.type, "scheduled");
  assert.ok(parsed.startsAt);
});

test("flags common escalation messages", () => {
  assert.equal(escalationReason("Can I talk to a human?"), "human_request");
  assert.equal(escalationReason("How much can I get?"), "outside_question");
  assert.equal(escalationReason("Who is this?"), "company_question");
  assert.equal(escalationReason("I was in an accident yesterday"), "");
  assert.equal(escalationReason("Your verification code for JustCall account login is - 162705"), "off_topic_verification_code");
  assert.equal(escalationReason("I already signed with an attorney"), "attorney_request");
});

test("flags document and report messages", () => {
  assert.equal(isDocumentOrReport("File attachment: IMG_2744.MOV download it here"), true);
  assert.equal(isDocumentOrReport("Here is my police report and claim #"), true);
  assert.equal(escalationReason("Here is my police report and claim #"), "document_or_report");
});
