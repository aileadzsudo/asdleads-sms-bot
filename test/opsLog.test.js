const test = require("node:test");
const assert = require("node:assert/strict");
const { recordBotError, listBotErrors, listBotOperationalEvents } = require("../src/opsLog");

function makeSettingsStore() {
  const settings = {};
  return {
    async getSetting(key) {
      return settings[key] || null;
    },
    async setSetting(key, value) {
      settings[key] = { key, value, updatedAt: new Date().toISOString() };
      return settings[key];
    },
    settings
  };
}

test("operational bot notices are kept out of the error log", async () => {
  const store = makeSettingsStore();

  const recorded = await recordBotError(
    store,
    "Outbound flood guard paused contact",
    { Phone: "+15550000000" },
    { operationalOnly: true, slack: false, level: "warn" }
  );

  assert.equal(recorded.shouldNotifySlack, false);
  assert.equal((await listBotErrors(store)).length, 0);
  assert.equal((await listBotOperationalEvents(store)).length, 1);
  assert.equal((await listBotOperationalEvents(store))[0].title, "Outbound flood guard paused contact");
});

test("legacy operational items in bot_error_log are hidden from error views", async () => {
  const store = makeSettingsStore();
  await store.setSetting("bot_error_log", [
    { id: "op", title: "Signed contact paused SMS bot", operationalOnly: true },
    { id: "err", title: "GHL SMS send failed", operationalOnly: false }
  ]);

  const errors = await listBotErrors(store);

  assert.deepEqual(errors.map((item) => item.title), ["GHL SMS send failed"]);
});
