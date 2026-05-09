const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEBHOOK_SECRET = "test-secret";

const { contactIssueFlags, isPermanentSmsBlock, leadSourceInfo, requireWebhookSecret, safeText, scannerOutput } = require("../src/server");

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

test("dashboard source values are string-safe when GHL sends an object", () => {
  const source = { medium: "zapier", sessionSource: "Third Party" };
  assert.equal(safeText(source), "Third Party");
  assert.equal(safeText({ source: { medium: "zapier", sessionSource: "Nested Source" } }), "Nested Source");
  assert.deepEqual(leadSourceInfo({ leadSource: source }), {
    leadSourceLabel: "Third Party",
    leadSourceRaw: source,
    leadSourceType: "object"
  });
});

test("scanner groups recoverable operational issues for dashboard repair", () => {
  const output = scannerOutput(
    [
      {
        id: "contact-1",
        name: "Alex",
        engagementStatus: "call_scheduled",
        issueFlags: [
          {
            type: "warn",
            code: "scheduled_without_reminders",
            label: "Scheduled call has no pending reminders",
            recommendedAction: "Click Ensure reminders."
          }
        ],
        stuckStateReasons: [
          {
            type: "warn",
            code: "scheduled_without_reminders",
            label: "Scheduled call has no pending reminders",
            recommendedAction: "Click Ensure reminders."
          }
        ],
        recommendedAction: "Click Ensure reminders."
      }
    ],
    [{ id: "job-1", contactId: "contact-2", type: "send_sms", status: "failed", error: "boom" }]
  );

  assert.equal(output.counts.appointmentIssues, 1);
  assert.equal(output.buckets.appointmentIssues[0].recommendedAction, "Click Ensure reminders.");
  assert.equal(output.failedJobs[0].error, "boom");
});
