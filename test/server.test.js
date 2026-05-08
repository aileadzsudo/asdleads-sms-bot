const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEBHOOK_SECRET = "test-secret";

const { contactIssueFlags, isPermanentSmsBlock, requireWebhookSecret } = require("../src/server");

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

test("GHL SMS DND errors are treated as permanent send blocks", () => {
  assert.equal(isPermanentSmsBlock(new Error("GHL /conversations/messages failed: 400 {\"message\":\"Cannot send message as DND is active for SMS.\"}")), true);
  assert.equal(isPermanentSmsBlock(new Error("temporary network error")), false);
});

test("DND skipped jobs are dashboard info flags, not failed jobs", () => {
  const flags = contactIssueFlags(
    { id: "contact-1", engagementStatus: "cold_outreach", timezone: "America/Chicago" },
    [
      {
        id: "job-1",
        status: "skipped",
        skipReason: "permanent_sms_block",
        type: "initial_sms"
      }
    ],
    [{ id: "message-1", contactId: "contact-1", direction: "outbound", body: "Hi", createdAt: new Date().toISOString() }],
    []
  );

  assert.equal(flags.some((flag) => flag.code === "sms_dnd_blocked" && flag.type === "info"), true);
  assert.equal(flags.some((flag) => flag.code === "failed_jobs"), false);
});
