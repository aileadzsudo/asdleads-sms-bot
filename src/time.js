function getLocalParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const out = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

function localDateToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 2; i += 1) {
    const asLocal = getLocalParts(new Date(guess), timeZone);
    const localAsUtc = Date.UTC(
      asLocal.year,
      asLocal.month - 1,
      asLocal.day,
      asLocal.hour,
      asLocal.minute,
      asLocal.second
    );
    const wantedAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
    guess += wantedAsUtc - localAsUtc;
  }
  return new Date(guess);
}

function parseClock(value) {
  const [hour, minute] = value.split(":").map(Number);
  return { hour, minute };
}

function windowForContact(contact, config) {
  const state = contact.state || contact.locationState || "";
  return config.texting.stateWindows[state] || {
    start: config.texting.defaultStart,
    end: config.texting.defaultEnd
  };
}

function isWithinTextingWindow(contact, config, now = new Date()) {
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  const local = getLocalParts(now, timeZone);
  const window = windowForContact(contact, config);
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  const currentMinutes = local.hour * 60 + local.minute;
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

function nextTextingWindow(contact, config, now = new Date()) {
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  const local = getLocalParts(now, timeZone);
  const window = windowForContact(contact, config);
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  const currentMinutes = local.hour * 60 + local.minute;
  const startMinutes = start.hour * 60 + start.minute;
  const endMinutes = end.hour * 60 + end.minute;
  const dayOffset = currentMinutes < startMinutes ? 0 : currentMinutes > endMinutes ? 1 : 0;
  return localDateToUtc(
    {
      year: local.year,
      month: local.month,
      day: local.day + dayOffset,
      hour: start.hour,
      minute: start.minute
    },
    timeZone
  );
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function localSlotDate(contact, config, dayOffset, slot) {
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  const nowLocal = getLocalParts(new Date(), timeZone);
  const hour = slot === "am" ? 10 : 18;
  return localDateToUtc(
    {
      year: nowLocal.year,
      month: nowLocal.month,
      day: nowLocal.day + dayOffset,
      hour,
      minute: 0
    },
    timeZone
  );
}

function formatForContact(date, contact, config) {
  const timeZone = contact.timezone || config.texting.defaultTimezone;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
  return formatted
    .replace(/\bEDT\b/g, "EST")
    .replace(/\bCDT\b/g, "CST")
    .replace(/\bMDT\b/g, "MST")
    .replace(/\bPDT\b/g, "PST");
}

function sameLocalDay(a, b, timeZone) {
  const ap = getLocalParts(a, timeZone);
  const bp = getLocalParts(b, timeZone);
  return ap.year === bp.year && ap.month === bp.month && ap.day === bp.day;
}

module.exports = {
  getLocalParts,
  localDateToUtc,
  isWithinTextingWindow,
  nextTextingWindow,
  addMinutes,
  addDays,
  localSlotDate,
  formatForContact,
  sameLocalDay
};
