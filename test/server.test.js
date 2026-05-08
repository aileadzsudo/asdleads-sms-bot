const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEBHOOK_SECRET = "test-secret";

const { requireWebhookSecret } = require("../src/server");

test("webhook secret accepts header value", () => {
  const result = requireWebhookSecret({ headers: { "x-webhook-secret": "test-secret" } }, {});
  assert.equal(result.ok, true);
});

test("webhook secret accepts GHL custom data fallback", () => {
  const result = requireWebhookSecret({ headers: {} }, { webhookSecret: "test-secret" });
  assert.equal(result.ok, true);
});

test("webhook secret accepts nested GHL customData fallback", () => {
  const result = requireWebhookSecret({ headers: {} }, { customData: { webhookSecret: "test-secret" } });
  assert.equal(result.ok, true);
});

test("webhook secret rejects missing value", () => {
  const result = requireWebhookSecret({ headers: {} }, {});
  assert.equal(result.ok, false);
});
