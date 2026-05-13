const test = require("node:test");
const assert = require("node:assert/strict");

const { PostgresStore } = require("../src/postgresStore");

function fakePostgresStore() {
  const queries = [];
  const store = Object.create(PostgresStore.prototype);
  store.pool = {
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      const valueParam = sql.includes("settings") ? params[1] : "null";
      return {
        rowCount: 1,
        rows: [{ key: params[0], value: JSON.parse(valueParam || "null"), updated_at: new Date() }]
      };
    }
  };
  return { store, queries };
}

test("PostgresStore stringifies webhook payloads before writing jsonb", async () => {
  const { store, queries } = fakePostgresStore();

  await store.recordWebhookEvent("human-outbound:event-1", "raw-string-payload");

  assert.equal(queries.length, 1);
  assert.equal(typeof queries[0].params[1], "string");
  assert.equal(JSON.parse(queries[0].params[1]), "raw-string-payload");
});

test("PostgresStore stringifies settings and message data before writing jsonb", async () => {
  const { store, queries } = fakePostgresStore();

  await store.setSetting("last_human_outbound_webhook", { stage: "received", payloadKeys: ["contactId"] });
  await store.addMessage({ contactId: "contact-1", direction: "human_outbound", body: "Human reply", raw: { nested: true } });

  assert.equal(typeof queries[0].params[1], "string");
  assert.deepEqual(JSON.parse(queries[0].params[1]), { stage: "received", payloadKeys: ["contactId"] });
  assert.equal(typeof queries[1].params[5], "string");
  assert.equal(JSON.parse(queries[1].params[5]).raw.nested, true);
});
