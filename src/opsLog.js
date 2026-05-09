const crypto = require("node:crypto");

const BOT_ERROR_LOG_KEY = "bot_error_log";
const BOT_ERROR_THROTTLE_KEY = "bot_error_throttle";
const BOT_ERROR_LIMIT = 250;
const SLACK_THROTTLE_MS = 30 * 60 * 1000;

function compact(value, max = 500) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function errorSignature(title, details = {}) {
  return [
    title,
    details.Error || details.error || "",
    details.Path || "",
    details.Type || "",
    details["Contact ID"] || details["GHL contact"] || details.Phone || ""
  ]
    .map((part) => compact(part, 160))
    .join("|");
}

async function recordBotError(store, title, details = {}, options = {}) {
  if (!store?.getSetting || !store?.setSetting) {
    return { shouldNotifySlack: options.slack !== false };
  }

  const now = new Date();
  const signature = errorSignature(title, details);
  const logSetting = await store.getSetting(BOT_ERROR_LOG_KEY);
  const log = Array.isArray(logSetting?.value) ? logSetting.value : [];
  const item = {
    id: crypto.randomUUID(),
    at: now.toISOString(),
    title,
    details,
    level: options.level || "error",
    operationalOnly: Boolean(options.operationalOnly),
    signature
  };
  await store.setSetting(BOT_ERROR_LOG_KEY, [item, ...log].slice(0, BOT_ERROR_LIMIT));

  if (options.slack === false || options.operationalOnly) {
    return { item, shouldNotifySlack: false };
  }

  const throttleSetting = await store.getSetting(BOT_ERROR_THROTTLE_KEY);
  const throttle = throttleSetting?.value && typeof throttleSetting.value === "object" ? throttleSetting.value : {};
  const lastAt = throttle[signature] ? new Date(throttle[signature]).getTime() : 0;
  const shouldNotifySlack = !lastAt || now.getTime() - lastAt > SLACK_THROTTLE_MS;
  if (shouldNotifySlack) {
    throttle[signature] = now.toISOString();
    await store.setSetting(BOT_ERROR_THROTTLE_KEY, throttle);
  }
  return { item, shouldNotifySlack };
}

async function listBotErrors(store, limit = 100) {
  const setting = store?.getSetting ? await store.getSetting(BOT_ERROR_LOG_KEY) : null;
  const log = Array.isArray(setting?.value) ? setting.value : [];
  return log.slice(0, limit);
}

module.exports = { recordBotError, listBotErrors };
