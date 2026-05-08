const test = require("node:test");
const assert = require("node:assert/strict");
const { formatForContact, localSlotDate } = require("../src/time");

const config = { texting: { defaultTimezone: "America/Chicago" } };

test("cold outreach PM slot is 6 PM local time", () => {
  const runAt = localSlotDate({ timezone: "America/Chicago" }, config, 1, "pm");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(runAt);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  assert.equal(values.hour, "18");
  assert.equal(values.minute, "00");
});

test("contact-facing time labels use familiar standard timezone abbreviations", () => {
  const summer = new Date("2026-07-01T19:00:00.000Z");

  assert.match(formatForContact(summer, { timezone: "America/New_York" }, config), /EST/);
  assert.match(formatForContact(summer, { timezone: "America/Chicago" }, config), /CST/);
  assert.match(formatForContact(summer, { timezone: "America/Denver" }, config), /MST/);
  assert.match(formatForContact(summer, { timezone: "America/Los_Angeles" }, config), /PST/);
});
