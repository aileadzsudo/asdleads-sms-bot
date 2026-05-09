const crypto = require("node:crypto");
const { Pool } = require("pg");
const { normalizePhone } = require("./store");

function isActiveBotContact(contact) {
  if (!contact || contact.optOutStatus || contact.automationPaused) return false;
  return Boolean(
    contact.engagementStatus &&
      !["opted_out", "escalated_to_human"].includes(contact.engagementStatus)
  );
}

function rowData(row) {
  return row?.data || null;
}

class PostgresStore {
  constructor(databaseUrl) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
    });
  }

  async init() {
    await this.pool.query(`
      create table if not exists contacts (
        id text primary key,
        phone text,
        ghl_contact_id text,
        data jsonb not null,
        updated_at timestamptz not null default now()
      );
      create index if not exists contacts_phone_idx on contacts(phone);

      create table if not exists jobs (
        id text primary key,
        contact_id text,
        type text not null,
        status text not null,
        run_at timestamptz,
        data jsonb not null,
        updated_at timestamptz not null default now()
      );
      create index if not exists jobs_due_idx on jobs(status, run_at);
      create index if not exists jobs_contact_idx on jobs(contact_id);

      create table if not exists messages (
        id text primary key,
        contact_id text,
        direction text,
        body text,
        created_at timestamptz not null default now(),
        data jsonb not null
      );
      create index if not exists messages_contact_idx on messages(contact_id);

      create table if not exists escalations (
        id text primary key,
        contact_id text,
        reason text,
        created_at timestamptz not null default now(),
        data jsonb not null
      );
      create index if not exists escalations_contact_idx on escalations(contact_id);

      create table if not exists decision_logs (
        id text primary key,
        contact_id text,
        action text,
        reason text,
        created_at timestamptz not null default now(),
        data jsonb not null
      );
      create index if not exists decision_logs_contact_idx on decision_logs(contact_id);

      create table if not exists webhook_events (
        id text primary key,
        received_at timestamptz not null default now(),
        payload jsonb not null
      );

      create table if not exists settings (
        key text primary key,
        value jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);
  }

  async upsertContact(contact) {
    const id = contact.id || contact.ghlContactId || contact.phone;
    const previous = await this.getContact(id);
    const next = { ...(previous || {}), ...contact, id };
    await this.pool.query(
      `insert into contacts (id, phone, ghl_contact_id, data, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (id) do update set
        phone = excluded.phone,
        ghl_contact_id = excluded.ghl_contact_id,
        data = excluded.data,
        updated_at = now()`,
      [id, next.phone || "", next.ghlContactId || "", next]
    );
    return next;
  }

  async getContact(id) {
    if (!id) return null;
    const result = await this.pool.query("select data from contacts where id = $1", [id]);
    return rowData(result.rows[0]);
  }

  async findActiveContactsByPhone(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    const result = await this.pool.query("select data from contacts");
    return result.rows
      .map(rowData)
      .filter((contact) => normalizePhone(contact.phone) === normalized && isActiveBotContact(contact));
  }

  async addMessage(message) {
    const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...message };
    await this.pool.query(
      `insert into messages (id, contact_id, direction, body, created_at, data)
       values ($1, $2, $3, $4, $5, $6)`,
      [item.id, item.contactId || "", item.direction || "", item.body || "", item.createdAt, item]
    );
    return item;
  }

  async addEscalation(escalation) {
    const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...escalation };
    await this.pool.query(
      `insert into escalations (id, contact_id, reason, created_at, data)
       values ($1, $2, $3, $4, $5)`,
      [item.id, item.contactId || "", item.reason || "", item.createdAt, item]
    );
    return item;
  }

  async addJob(job) {
    const item = { id: job.id || crypto.randomUUID(), status: "pending", createdAt: new Date().toISOString(), ...job };
    await this.pool.query(
      `insert into jobs (id, contact_id, type, status, run_at, data, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (id) do update set
        contact_id = excluded.contact_id,
        type = excluded.type,
        status = excluded.status,
        run_at = excluded.run_at,
        data = excluded.data,
        updated_at = now()`,
      [item.id, item.contactId || "", item.type, item.status, item.runAt || null, item]
    );
    return item;
  }

  async dueJobs(now = new Date()) {
    const result = await this.pool.query(
      "select data from jobs where status = 'pending' and run_at <= $1 order by run_at asc",
      [now.toISOString()]
    );
    return result.rows.map(rowData);
  }

  async updateJob(id, patch) {
    const result = await this.pool.query("select data from jobs where id = $1", [id]);
    const existing = rowData(result.rows[0]);
    if (!existing) return null;
    const next = { ...existing, ...patch };
    await this.pool.query(
      `update jobs set status = $2, run_at = $3, data = $4, updated_at = now() where id = $1`,
      [id, next.status, next.runAt || null, next]
    );
    return next;
  }

  async claimJob(id) {
    const runningAt = new Date().toISOString();
    const patch = { status: "running", runningAt };
    const result = await this.pool.query(
      `update jobs
       set status = 'running',
           data = data || $2::jsonb,
           updated_at = now()
       where id = $1 and status = 'pending'
       returning data`,
      [id, JSON.stringify(patch)]
    );
    return rowData(result.rows[0]);
  }

  async cancelJobsForContact(contactId, reason, predicate = () => true) {
    const jobs = await this.listJobs(contactId);
    for (const job of jobs) {
      if (job.status === "pending" && predicate(job)) {
        await this.updateJob(job.id, { status: "cancelled", cancelReason: reason });
      }
    }
  }

  async listJobs(contactId = "") {
    const result = contactId
      ? await this.pool.query("select data from jobs where contact_id = $1 order by run_at asc nulls last", [contactId])
      : await this.pool.query("select data from jobs order by run_at asc nulls last");
    return result.rows.map(rowData);
  }

  async listMessages(contactId = "") {
    const result = contactId
      ? await this.pool.query("select data from messages where contact_id = $1 order by created_at asc", [contactId])
      : await this.pool.query("select data from messages order by created_at asc");
    return result.rows.map(rowData);
  }

  async listEscalations(contactId = "") {
    const result = contactId
      ? await this.pool.query("select data from escalations where contact_id = $1 order by created_at asc", [contactId])
      : await this.pool.query("select data from escalations order by created_at asc");
    return result.rows.map(rowData);
  }

  async addDecisionLog(entry) {
    const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry };
    await this.pool.query(
      `insert into decision_logs (id, contact_id, action, reason, created_at, data)
       values ($1, $2, $3, $4, $5, $6)`,
      [item.id, item.contactId || "", item.action || "", item.reason || "", item.createdAt, item]
    );
    return item;
  }

  async listDecisionLogs(contactId = "") {
    const result = contactId
      ? await this.pool.query("select data from decision_logs where contact_id = $1 order by created_at asc", [contactId])
      : await this.pool.query("select data from decision_logs order by created_at asc");
    return result.rows.map(rowData);
  }

  async listContacts() {
    const result = await this.pool.query("select data from contacts order by updated_at desc");
    return result.rows.map(rowData);
  }

  async getSetting(key) {
    const result = await this.pool.query("select key, value, updated_at from settings where key = $1", [key]);
    const row = result.rows[0];
    return row ? { key: row.key, value: row.value, updatedAt: row.updated_at.toISOString() } : null;
  }

  async setSetting(key, value) {
    const result = await this.pool.query(
      `insert into settings (key, value, updated_at)
       values ($1, $2, now())
       on conflict (key) do update set value = excluded.value, updated_at = now()
       returning key, value, updated_at`,
      [key, value]
    );
    const row = result.rows[0];
    return { key: row.key, value: row.value, updatedAt: row.updated_at.toISOString() };
  }

  async listSettings() {
    const result = await this.pool.query("select key, value, updated_at from settings order by key");
    return result.rows.map((row) => ({ key: row.key, value: row.value, updatedAt: row.updated_at.toISOString() }));
  }

  async reset() {
    await this.pool.query("truncate table messages, escalations, decision_logs, jobs, contacts, webhook_events");
  }

  async recordWebhookEvent(id, payload = {}) {
    if (!id) return { inserted: true };
    const result = await this.pool.query(
      `insert into webhook_events (id, payload)
       values ($1, $2)
       on conflict (id) do nothing`,
      [id, payload]
    );
    return { inserted: result.rowCount === 1 };
  }

  async health() {
    const result = await this.pool.query(`
      select
        (select count(*)::int from contacts) as contacts,
        (select count(*)::int from jobs where status = 'pending') as pending_jobs
    `);
    return {
      ok: true,
      type: "postgres",
      contacts: result.rows[0].contacts,
      pendingJobs: result.rows[0].pending_jobs
    };
  }
}

module.exports = { PostgresStore };
