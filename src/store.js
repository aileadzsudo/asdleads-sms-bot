const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

function emptyStore() {
  return { contacts: {}, jobs: {}, messages: [], escalations: [], decisionLogs: [], webhookEvents: {}, settings: {} };
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

function isActiveBotContact(contact) {
  if (!contact || contact.optOutStatus || contact.automationPaused) return false;
  return Boolean(
    contact.engagementStatus &&
      !["opted_out", "escalated_to_human"].includes(contact.engagementStatus)
  );
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = emptyStore();
    this.load();
  }

  load() {
    if (!fs.existsSync(this.filePath)) {
      this.save();
      return;
    }
    const raw = fs.readFileSync(this.filePath, "utf8");
    this.data = { ...emptyStore(), ...(raw ? JSON.parse(raw) : emptyStore()) };
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  upsertContact(contact) {
    const id = contact.id || contact.ghlContactId || contact.phone;
    const previous = this.data.contacts[id] || {};
    const next = { ...previous, ...contact, id };
    this.data.contacts[id] = next;
    this.save();
    return next;
  }

  getContact(id) {
    return this.data.contacts[id] || null;
  }

  findActiveContactsByPhone(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    return Object.values(this.data.contacts).filter(
      (contact) => normalizePhone(contact.phone) === normalized && isActiveBotContact(contact)
    );
  }

  addMessage(message) {
    this.data.messages.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...message });
    this.save();
  }

  addEscalation(escalation) {
    this.data.escalations.push({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...escalation });
    this.save();
  }

  addJob(job) {
    const id = job.id || crypto.randomUUID();
    this.data.jobs[id] = { id, status: "pending", createdAt: new Date().toISOString(), ...job };
    this.save();
    return this.data.jobs[id];
  }

  dueJobs(now = new Date()) {
    return Object.values(this.data.jobs)
      .filter((job) => job.status === "pending" && new Date(job.runAt) <= now)
      .sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
  }

  updateJob(id, patch) {
    if (!this.data.jobs[id]) return null;
    this.data.jobs[id] = { ...this.data.jobs[id], ...patch };
    this.save();
    return this.data.jobs[id];
  }

  claimJob(id) {
    const job = this.data.jobs[id];
    if (!job || job.status !== "pending") return null;
    this.data.jobs[id] = { ...job, status: "running", runningAt: new Date().toISOString() };
    this.save();
    return this.data.jobs[id];
  }

  cancelJobsForContact(contactId, reason, predicate = () => true) {
    for (const job of Object.values(this.data.jobs)) {
      if (job.contactId === contactId && job.status === "pending" && predicate(job)) {
        job.status = "cancelled";
        job.cancelReason = reason;
      }
    }
    this.save();
  }

  listJobs(contactId = "") {
    return Object.values(this.data.jobs).filter((job) => !contactId || job.contactId === contactId);
  }

  listMessages(contactId = "") {
    return this.data.messages.filter((message) => !contactId || message.contactId === contactId);
  }

  listEscalations(contactId = "") {
    return this.data.escalations.filter((item) => !contactId || item.contactId === contactId);
  }

  addDecisionLog(entry) {
    const item = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...entry };
    this.data.decisionLogs = this.data.decisionLogs || [];
    this.data.decisionLogs.push(item);
    this.save();
    return item;
  }

  listDecisionLogs(contactId = "") {
    return (this.data.decisionLogs || []).filter((item) => !contactId || item.contactId === contactId);
  }

  listContacts() {
    return Object.values(this.data.contacts);
  }

  getSetting(key) {
    return this.data.settings?.[key] || null;
  }

  setSetting(key, value) {
    this.data.settings = this.data.settings || {};
    this.data.settings[key] = { key, value, updatedAt: new Date().toISOString() };
    this.save();
    return this.data.settings[key];
  }

  listSettings() {
    return Object.values(this.data.settings || {});
  }

  reset() {
    const settings = this.data.settings || {};
    this.data = { ...emptyStore(), settings };
    this.save();
  }

  recordWebhookEvent(id, payload = {}) {
    if (!id) return { inserted: true };
    if (this.data.webhookEvents[id]) return { inserted: false, event: this.data.webhookEvents[id] };
    this.data.webhookEvents[id] = { id, receivedAt: new Date().toISOString(), payload };
    this.save();
    return { inserted: true, event: this.data.webhookEvents[id] };
  }

  health() {
    return {
      ok: true,
      type: "json",
      contacts: Object.keys(this.data.contacts).length,
      pendingJobs: Object.values(this.data.jobs).filter((job) => job.status === "pending").length
    };
  }
}

module.exports = { Store, normalizePhone };
