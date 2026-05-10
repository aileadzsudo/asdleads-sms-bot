function ghlHeaders(config) {
  return {
    Authorization: `Bearer ${config.ghl.token}`,
    "Content-Type": "application/json",
    Version: "2021-07-28"
  };
}

async function ghlGet(config, path) {
  if (!config.ghl.token) {
    return { ok: true, skipped: true, reason: "GHL_API_TOKEN not configured", path };
  }
  const response = await fetch(`${config.ghl.apiBase}${path}`, {
    method: "GET",
    headers: ghlHeaders(config)
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`GHL GET ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function ghlSearch(config, path, body) {
  if (config.dryRun || !config.ghl.token) {
    return { ok: true, skipped: true, reason: "GHL_API_TOKEN not configured", path, body, contacts: [] };
  }
  const response = await fetch(`${config.ghl.apiBase}${path}`, {
    method: "POST",
    headers: ghlHeaders(config),
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`GHL search ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function ghlRequest(config, path, body, method = "POST") {
  if (config.dryRun || !config.ghl.token) {
    return { ok: true, skipped: true, reason: "GHL_API_TOKEN not configured", method, path, body };
  }
  const response = await fetch(`${config.ghl.apiBase}${path}`, {
    method,
    headers: ghlHeaders(config),
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`GHL ${path} failed: ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

async function getContact(config, contactId) {
  if (!contactId) return null;
  return ghlGet(config, `/contacts/${encodeURIComponent(contactId)}`);
}

function extractContacts(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["contacts", "items", "results", "data"]) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      for (const nested of ["contacts", "items", "results"]) {
        if (Array.isArray(value[nested])) return value[nested];
      }
    }
  }
  return [];
}

async function searchContactsByTag(config, tag = "NR", options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 100), 100));
  const page = Math.max(1, Number(options.page || 1));
  const normalizedTag = String(tag || "NR").replace(/^#/, "").toLowerCase();
  const payload = await ghlSearch(config, "/contacts/search", {
    locationId: config.ghl.locationId,
    page,
    pageLimit: limit,
    filters: [
      {
        field: "tags",
        operator: "contains",
        value: normalizedTag
      }
    ]
  });
  return {
    raw: payload,
    contacts: extractContacts(payload),
    nextPage: payload.nextPage || payload.meta?.nextPage || payload.pageInfo?.nextPage || null,
    total: payload.total || payload.meta?.total || payload.totalCount || null
  };
}

async function searchContactsByPhone(config, phone, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
  const page = Math.max(1, Number(options.page || 1));
  const payload = await ghlSearch(config, "/contacts/search", {
    locationId: config.ghl.locationId,
    page,
    pageLimit: limit,
    filters: [
      {
        field: "phone",
        operator: "eq",
        value: phone
      }
    ]
  });
  return {
    raw: payload,
    contacts: extractContacts(payload),
    nextPage: payload.nextPage || payload.meta?.nextPage || payload.pageInfo?.nextPage || null,
    total: payload.total || payload.meta?.total || payload.totalCount || null
  };
}

async function sendSms(config, contact, message) {
  return ghlRequest(config, "/conversations/messages", {
    type: "SMS",
    contactId: contact.ghlContactId || contact.id,
    locationId: config.ghl.locationId,
    message
  });
}

async function createAppointment(config, contact, startsAt, endsAt, notes = "") {
  return ghlRequest(config, "/calendars/events/appointments", {
    calendarId: config.ghl.calendarId,
    locationId: config.ghl.locationId,
    contactId: contact.ghlContactId || contact.id,
    startTime: startsAt,
    endTime: endsAt,
    title: `Accident Support Desk Specialist call - ${contact.name || contact.phone}`,
    appointmentStatus: "confirmed",
    source: "asdleads-sms-bot",
    notes
  });
}

async function updateAppointment(config, contact, appointmentId, startsAt, endsAt, notes = "") {
  if (!appointmentId) return createAppointment(config, contact, startsAt, endsAt, notes || "Rescheduled by Accident Support Desk SMS bot");
  return ghlRequest(
    config,
    `/calendars/events/appointments/${encodeURIComponent(appointmentId)}`,
    {
      calendarId: config.ghl.calendarId,
      locationId: config.ghl.locationId,
      contactId: contact.ghlContactId || contact.id,
      startTime: startsAt,
      endTime: endsAt,
      title: `Accident Support Desk Specialist call - ${contact.name || contact.phone}`,
      appointmentStatus: "confirmed",
      source: "asdleads-sms-bot",
      notes
    },
    "PUT"
  );
}

async function deleteAppointment(config, appointmentId) {
  if (!appointmentId) return { ok: true, skipped: true, reason: "appointmentId missing" };
  return ghlRequest(config, `/calendars/events/${encodeURIComponent(appointmentId)}`, {}, "DELETE");
}

function contactLink(config, contact) {
  if (contact.ghlContactLink) return contact.ghlContactLink;
  const contactId = contact.ghlContactId || contact.id;
  if (!contactId || !config.ghl?.locationId) return "";
  const baseUrl = config.ghl.appBaseUrl || "https://app.gohighlevel.com";
  return `${baseUrl}/v2/location/${encodeURIComponent(config.ghl.locationId)}/contacts/detail/${encodeURIComponent(contactId)}`;
}

module.exports = {
  sendSms,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getContact,
  searchContactsByTag,
  searchContactsByPhone,
  contactLink
};
