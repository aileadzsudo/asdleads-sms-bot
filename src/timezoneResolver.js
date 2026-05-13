const STATE_TIMEZONES = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DC: "America/New_York",
  DE: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  IA: "America/Chicago",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  MA: "America/New_York",
  MD: "America/New_York",
  ME: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MO: "America/Chicago",
  MS: "America/Chicago",
  MT: "America/Denver",
  NC: "America/New_York",
  ND: "America/Chicago",
  NE: "America/Chicago",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NV: "America/Los_Angeles",
  NY: "America/New_York",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VA: "America/New_York",
  VT: "America/New_York",
  WA: "America/Los_Angeles",
  WI: "America/Chicago",
  WV: "America/New_York",
  WY: "America/Denver"
};

const STATE_NAMES = {
  ALABAMA: "AL",
  ALASKA: "AK",
  ARIZONA: "AZ",
  ARKANSAS: "AR",
  CALIFORNIA: "CA",
  COLORADO: "CO",
  CONNECTICUT: "CT",
  DELAWARE: "DE",
  FLORIDA: "FL",
  GEORGIA: "GA",
  HAWAII: "HI",
  IDAHO: "ID",
  ILLINOIS: "IL",
  INDIANA: "IN",
  IOWA: "IA",
  KANSAS: "KS",
  KENTUCKY: "KY",
  LOUISIANA: "LA",
  MAINE: "ME",
  MARYLAND: "MD",
  MASSACHUSETTS: "MA",
  MICHIGAN: "MI",
  MINNESOTA: "MN",
  MISSISSIPPI: "MS",
  MISSOURI: "MO",
  MONTANA: "MT",
  NEBRASKA: "NE",
  NEVADA: "NV",
  "NEW HAMPSHIRE": "NH",
  "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM",
  "NEW YORK": "NY",
  "NORTH CAROLINA": "NC",
  "NORTH DAKOTA": "ND",
  OHIO: "OH",
  OKLAHOMA: "OK",
  OREGON: "OR",
  PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI",
  "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN",
  TEXAS: "TX",
  UTAH: "UT",
  VERMONT: "VT",
  VIRGINIA: "VA",
  WASHINGTON: "WA",
  "WEST VIRGINIA": "WV",
  WISCONSIN: "WI",
  WYOMING: "WY"
};

const TIMEZONE_ALIASES = [
  ["America/Los_Angeles", /\b(pacific|pst|pdt)\b/i],
  ["America/Denver", /\b(mountain|mst|mdt)\b/i],
  ["America/Chicago", /\b(central|cst|cdt)\b/i],
  ["America/New_York", /\b(eastern|est|edt)\b/i]
];

const FIRM_STATE_TAGS = {
  LHPARK_CA: "CA",
  LEVIN_CO: "CO",
  GASLMP_CA: "CA",
  MOUDGL_TX: "TX",
  RODRGZ_TX: "TX",
  BERNRD_WA: "WA",
  LARLAT_ND: "ND",
  EDBERN_NV: "NV",
  HOWBNT_KY: "KY",
  TAKLAW_TX: "TX",
  CHALIK_TX: "TX",
  OAKWOD_CA: "CA"
};

function normalizeState(value) {
  const raw = String(value || "").trim();
  const upper = raw.toUpperCase();
  if (!upper) return "";
  if (STATE_TIMEZONES[upper]) return upper;
  if (STATE_NAMES[upper]) return STATE_NAMES[upper];
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (new RegExp(`\\b${name.replace(/\s+/g, "\\s+")}\\b`, "i").test(raw)) return code;
  }
  const code = upper.match(/\b(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/);
  return code ? code[1] : "";
}

function timezoneFromState(value) {
  return STATE_TIMEZONES[normalizeState(value)] || "";
}

function timezoneFromText(value) {
  const raw = String(value || "");
  if (raw.includes("/")) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
      return raw;
    } catch {
      // Fall through to state and common timezone aliases.
    }
  }
  const fromState = timezoneFromState(raw);
  if (fromState) return fromState;
  const alias = TIMEZONE_ALIASES.find(([, pattern]) => pattern.test(raw));
  return alias?.[0] || "";
}

function tagsToList(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.flatMap((tag) => tagsToList(tag));
  if (typeof tags === "object") {
    return [tags.name, tags.label, tags.value, tags.tag, tags.text].flatMap((tag) => tagsToList(tag)).filter(Boolean);
  }
  return String(tags)
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function timezoneFromFirmTags(tags) {
  for (const tag of tagsToList(tags)) {
    const normalized = String(tag || "").trim().replace(/^#/, "").replace(/[\s-]+/g, "_").toUpperCase();
    const state = FIRM_STATE_TAGS[normalized];
    if (state && STATE_TIMEZONES[state]) return STATE_TIMEZONES[state];
  }
  return "";
}

function resolveContactTimezone(contact, config) {
  const ownerSignal = [
    contact.owner,
    contact.contactOwner,
    contact.assignedTo,
    contact.assignedUser,
    contact.user
  ]
    .filter(Boolean)
    .join(" ");
  const firmTagTimezone = timezoneFromFirmTags(contact.tags);
  if (firmTagTimezone) return firmTagTimezone;

  const tagSignal = Array.isArray(contact.tags) ? contact.tags.join(" ") : String(contact.tags || "");
  const normalizedTagSignal = tagSignal.replace(/[_-]/g, " ");
  const ownerTimezone = timezoneFromText(ownerSignal) || timezoneFromText(normalizedTagSignal);
  if (ownerTimezone) return ownerTimezone;

  const stateTimezone = timezoneFromText(contact.state || contact.locationState);
  if (stateTimezone) return stateTimezone;

  return timezoneFromText(contact.timezone) || contact.timezone || config.texting.defaultTimezone;
}

module.exports = {
  STATE_TIMEZONES,
  FIRM_STATE_TAGS,
  normalizeState,
  timezoneFromState,
  timezoneFromText,
  timezoneFromFirmTags,
  resolveContactTimezone
};
