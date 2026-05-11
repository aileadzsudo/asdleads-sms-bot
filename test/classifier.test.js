const test = require("node:test");
const assert = require("node:assert/strict");
const { QUALIFICATION } = require("../src/constants");
const {
  isOptOut,
  parseExpectedAnswer,
  parseAccidentDate,
  parseCallTime,
  escalationReason,
  classifyHumanContextIntent,
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
  assert.equal(
    parseExpectedAnswer(QUALIFICATION.NEEDS_FAULT, "Yes it was yesterday and the driver hit my front fender").value,
    "not_at_fault"
  );
  assert.equal(
    parseExpectedAnswer(QUALIFICATION.NEEDS_FAULT, "I wasn't driving, my Lyft driver hit someone and I was a rideshare passenger").value,
    "not_at_fault"
  );
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
  assert.equal(parseCallTime("Now is ok", contact, config).type, "now");
  assert.equal(parseCallTime("anytime", contact, config).type, "needs_specific_time");
  assert.equal(parseCallTime("can you call back later?", contact, config).type, "needs_specific_time");
  assert.equal(parseCallTime("tomorrow morning", contact, config, new Date("2026-05-07T15:00:00Z")).type, "needs_specific_time");
  assert.equal(
    parseCallTime("tomorrow is better late afternoon", contact, config, new Date("2026-05-07T15:00:00Z")).type,
    "needs_specific_time"
  );
  const relative = parseCallTime("in 20 minutes", contact, config, new Date("2026-05-07T15:00:00Z"));
  assert.equal(relative.type, "needs_specific_time");
  assert.equal(relative.relativeTarget, "2026-05-07T15:20:00.000Z");
  const relativeHour = parseCallTime("in an hour", contact, config, new Date("2026-05-07T17:16:00Z"));
  assert.equal(relativeHour.type, "needs_specific_time");
  assert.equal(relativeHour.relativeTarget, "2026-05-07T18:16:00.000Z");
  const parsed = parseCallTime("tomorrow at 3pm", contact, config, new Date("2026-05-07T15:00:00Z"));
  assert.equal(parsed.type, "scheduled");
  assert.ok(parsed.startsAt);
});

test("call-time parser asks for clarification when the lead says today does not work", () => {
  assert.equal(parseCallTime("Today is not tha day", contact, config).type, "needs_specific_time");
  assert.equal(parseCallTime("Again today doesn't work", contact, config).preferredDay, "tomorrow_or_later");
});

test("call-time parser does not turn bare dates or money amounts into appointments", () => {
  assert.equal(parseCallTime("2026-05-10", contact, config).type, "needs_specific_time");
  assert.equal(parseCallTime("I'll call tomorrow", contact, config).type, "needs_specific_time");
  assert.equal(parseCallTime("They tried to offer me $23,000 but I turned it down", contact, config), null);
});

test("call-time parser does not turn medical dates plus weekday into an appointment", () => {
  const parsed = parseCallTime(
    "PCP visit and 4/30 Orthopedic visit 4/30 probably not until Tuesday",
    contact,
    config,
    new Date("2026-05-10T16:00:00.000Z")
  );
  assert.equal(parsed.type, "needs_specific_time");
  assert.equal(parsed.preferredDay, "weekday");
  assert.equal(parsed.preferredDayLabel, "tuesday");
  assert.equal(parsed.startsAt, undefined);
});

test("future availability phrasing wins over call-now words", () => {
  const pacificContact = { timezone: "America/Los_Angeles" };
  const pacificConfig = { texting: { defaultTimezone: "America/Chicago" } };
  const parsed = parseCallTime(
    "yes I will be available anytime after 2:30p.m. - in about 40 minutes",
    pacificContact,
    pacificConfig,
    new Date("2026-05-08T20:51:32.000Z")
  );

  assert.equal(parsed.type, "scheduled");
  assert.equal(parsed.startsAt, "2026-05-08T21:30:00.000Z");
});

test("p.m. and a.m. punctuation is parsed as normal meridiem", () => {
  const parsed = parseCallTime("I can do 4:15 p.m.", contact, config, new Date("2026-05-08T18:00:00Z"));
  assert.equal(parsed.type, "scheduled");
  assert.equal(parsed.startsAt, "2026-05-08T21:15:00.000Z");
});

test("parses weekday call times into the upcoming weekday", () => {
  const parsed = parseCallTime("Monday 9am", contact, config, new Date("2026-05-08T16:00:00Z"));
  assert.equal(parsed.type, "scheduled");
  assert.equal(parsed.startsAt, "2026-05-11T14:00:00.000Z");
});

test("moves ambiguous past time-only replies to the next day", () => {
  const parsed = parseCallTime("3 pm", contact, config, new Date("2026-05-08T23:00:00Z"));
  assert.equal(parsed.type, "scheduled");
  assert.equal(parsed.startsAt, "2026-05-09T20:00:00.000Z");
});

test("detects human context before treating yes as qualification answer", () => {
  const intent = classifyHumanContextIntent("I'm sorry yes I'm currently busy", QUALIFICATION.NEEDS_MEDICAL);
  assert.equal(intent.intent, "busy_now");
});

test("does not block real medical answers that include context", () => {
  assert.equal(classifyHumanContextIntent("I went to the hospital but I am busy right now", QUALIFICATION.NEEDS_MEDICAL), null);
});

test("does not block real call-time answers that include busy context", () => {
  assert.equal(classifyHumanContextIntent("I'm busy but tomorrow afternoon works", QUALIFICATION.NEEDS_CALL_TIME), null);
});

test("flags common escalation messages", () => {
  assert.equal(escalationReason("Can I talk to a human?"), "human_request");
  assert.equal(escalationReason("How much can I get?"), "outside_question");
  assert.equal(escalationReason("Who is this?"), "company_question");
  assert.equal(escalationReason("I was in an accident yesterday"), "");
  assert.equal(escalationReason("Your verification code for JustCall account login is - 162705"), "off_topic_verification_code");
  assert.equal(escalationReason("I need an attorney"), "attorney_request");
  assert.equal(escalationReason("They only paid for the car damage and never gave me anything for the accident"), "outside_question");
});

test("flags document and report messages", () => {
  assert.equal(isDocumentOrReport("File attachment: IMG_2744.MOV download it here"), true);
  assert.equal(isDocumentOrReport("Here is my police report and claim #"), true);
  assert.equal(escalationReason("Here is my police report and claim #"), "document_or_report");
});
