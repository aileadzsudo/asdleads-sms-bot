const test = require("node:test");
const assert = require("node:assert/strict");
const { localSlotDate } = require("../src/time");

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
