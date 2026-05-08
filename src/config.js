const path = require("node:path");
const fs = require("node:fs");

function loadDotEnv(filePath = path.join(__dirname, "..", ".env")) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function parseStateWindows(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function loadConfig() {
  loadDotEnv();
  const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "data");
  const renderBaseUrl = process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "";
  return {
    port: Number(process.env.PORT || 3000),
    host: process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
    dataDir,
    dataFile: process.env.DATA_FILE || path.join(dataDir, "store.json"),
    databaseUrl: process.env.DATABASE_URL || "",
    webhookSecret: process.env.WEBHOOK_SECRET || "",
    adminPassword: process.env.ADMIN_PASSWORD || "",
    reportDir: process.env.REPORT_DIR || path.join(__dirname, "..", "reports"),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || renderBaseUrl,
    botName: process.env.BOT_NAME || "William",
    dryRun: String(process.env.DRY_RUN || "true").toLowerCase() !== "false",
    llm: {
      apiKey: process.env.OPENAI_API_KEY || "",
      classifierModel: process.env.OPENAI_CLASSIFIER_MODEL || "gpt-5-mini",
      fallbackEnabled: String(process.env.LLM_FALLBACK_ENABLED || "false").toLowerCase() === "true",
      minConfidence: Number(process.env.LLM_MIN_CONFIDENCE || 0.85),
      clarifyConfidence: Number(process.env.LLM_CLARIFY_CONFIDENCE || 0.6)
    },
    ghl: {
      apiBase: process.env.GHL_API_BASE || "https://services.leadconnectorhq.com",
      appBaseUrl: process.env.GHL_APP_BASE_URL || "https://app.gohighlevel.com",
      token: process.env.GHL_API_TOKEN || "",
      locationId: process.env.GHL_LOCATION_ID || "",
      calendarId: process.env.GHL_CALENDAR_ID || ""
    },
    slack: {
      token: process.env.SLACK_BOT_TOKEN || "",
      channel: process.env.SLACK_ESCALATION_CHANNEL || "#sms-esiliation",
      botErrorsChannel: process.env.SLACK_BOT_ERRORS_CHANNEL || "",
      bookingChannel: process.env.SLACK_BOOKING_CHANNEL || process.env.SLACK_ESCALATION_CHANNEL || "#sms-esiliation",
      sendInDryRun: String(process.env.SLACK_SEND_IN_DRY_RUN || "false").toLowerCase() === "true"
    },
    texting: {
      defaultTimezone: process.env.DEFAULT_TIMEZONE || "America/Chicago",
      defaultStart: process.env.DEFAULT_TEXTING_START || "08:00",
      defaultEnd: process.env.DEFAULT_TEXTING_END || "21:00",
      stateWindows: parseStateWindows(process.env.STATE_TEXTING_WINDOWS_JSON)
    }
  };
}

module.exports = { loadConfig };
