const passwordKey = "asd_dashboard_password";

function adminHeaders() {
  const password = sessionStorage.getItem(passwordKey) || "";
  return password ? { "x-admin-password": password } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...adminHeaders(),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export type ContactQueue = "hot" | "waiting" | "paused" | "all";

export function getContacts(queue: ContactQueue = "all", sort = "sla") {
  return request(`/api/contacts?queue=${encodeURIComponent(queue)}&sort=${encodeURIComponent(sort)}`);
}

export function getContact(contactId: string) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}`);
}

export function getContactMessages(contactId: string) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}/messages`);
}

export function getContactTimeline(contactId: string) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}/timeline`);
}

export function getContactQualification(contactId: string) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}/qualification`);
}

export function acknowledgeContact(contactId: string) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}/ack`, { method: "POST" });
}

export function returnContactToBot(contactId: string) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}/return-to-bot`, { method: "POST" });
}

export function pauseContactBot(contactId: string) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}/pause-bot`, { method: "POST" });
}

export function adminContactAction(contactId: string, action: string) {
  return request(`/api/admin/contact/action`, {
    method: "POST",
    body: JSON.stringify({ contactId, action })
  });
}

export function addContactNote(contactId: string, body: string) {
  return request(`/api/contacts/${encodeURIComponent(contactId)}/note`, {
    method: "POST",
    body: JSON.stringify({ body })
  });
}

export function getDashboard() {
  return request<any>("/api/admin/dashboard");
}

export function getScanner() {
  return request<any>("/api/admin/scanner");
}

export function getTemplates() {
  return request<any>("/api/admin/templates");
}

export function saveTemplates(overrides: Record<string, Record<string, string>>) {
  return request<any>("/api/admin/templates/save", {
    method: "POST",
    body: JSON.stringify({ overrides })
  });
}

export function resetTemplates() {
  return request<any>("/api/admin/templates/reset", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function getAbTests() {
  return request<any>("/api/admin/ab-tests");
}

export function saveAbTests(experiments: any[]) {
  return request<any>("/api/admin/ab-tests/save", {
    method: "POST",
    body: JSON.stringify({ experiments })
  });
}

export function pushAbWinner(experimentId: string, variantId: string) {
  return request<any>("/api/admin/ab-tests/push-live", {
    method: "POST",
    body: JSON.stringify({ experimentId, variantId })
  });
}

export function setDashboardPassword(password: string) {
  sessionStorage.setItem(passwordKey, password);
}

export function hasDashboardPassword() {
  return Boolean(sessionStorage.getItem(passwordKey));
}
