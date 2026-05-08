const templates = require("./templates");

const SETTING_KEY = "template_overrides";
const EXPERIMENTS_KEY = "template_experiments";

const TEMPLATE_GROUPS = {
  coldOutreachTemplates: "Cold Outreach",
  freshLeadFollowUpTemplates: "Fresh Lead Follow-Up",
  qualificationTemplates: "Qualification",
  reengagementTemplates: "Fast Re-Engagement",
  persistentReengagementTemplates: "Daily Re-Engagement",
  warmFollowUpTemplates: "Warm Follow-Up",
  reminderTemplates: "Appointment Reminders",
  missedCallTemplates: "Missed Call",
  noShowTemplates: "No-Show Recovery",
  backupReminderTemplates: "Backup Time Reminders"
};

const templateRoots = Object.fromEntries(Object.keys(TEMPLATE_GROUPS).map((key) => [key, templates[key]]));
const defaultTemplateRoots = clone(templateRoots);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getAtPath(root, path) {
  return path.reduce((current, part) => (current ? current[part] : undefined), root);
}

function setAtPath(root, path, value) {
  let current = root;
  for (const part of path.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part];
  }
  current[path[path.length - 1]] = value;
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < String(value).length; index += 1) {
    hash = (hash * 31 + String(value).charCodeAt(index)) >>> 0;
  }
  return hash;
}

function flattenTemplates(root, path = []) {
  if (typeof root === "string") {
    return [{ path, value: root }];
  }
  return Object.entries(root || {}).flatMap(([key, value]) => flattenTemplates(value, [...path, key]));
}

function defaultTemplateSnapshot() {
  return clone(defaultTemplateRoots);
}

function normalizeOverrides(overrides = {}) {
  const clean = {};
  for (const [group, paths] of Object.entries(overrides || {})) {
    if (!templateRoots[group] || typeof paths !== "object" || !paths) continue;
    for (const [pathKey, value] of Object.entries(paths)) {
      if (typeof value !== "string") continue;
      const path = pathKey.split(".");
      if (typeof getAtPath(templateRoots[group], path) !== "string") continue;
      clean[group] = clean[group] || {};
      clean[group][pathKey] = value;
    }
  }
  return clean;
}

function applyTemplateOverrides(overrides = {}) {
  const clean = normalizeOverrides(overrides);
  for (const [group, paths] of Object.entries(clean)) {
    for (const [pathKey, value] of Object.entries(paths)) {
      setAtPath(templateRoots[group], pathKey.split("."), value);
    }
  }
  return clean;
}

async function loadTemplateOverrides(store) {
  const setting = store.getSetting ? await store.getSetting(SETTING_KEY) : null;
  return applyTemplateOverrides(setting?.value || {});
}

async function saveTemplateOverrides(store, overrides) {
  const clean = applyTemplateOverrides(overrides);
  if (store.setSetting) await store.setSetting(SETTING_KEY, clean);
  return clean;
}

async function resetTemplateOverrides(store) {
  const defaults = defaultTemplateSnapshot();
  for (const [group, value] of Object.entries(defaults)) {
    for (const { path, value: template } of flattenTemplates(value)) {
      setAtPath(templateRoots[group], path, template);
    }
  }
  if (store.setSetting) await store.setSetting(SETTING_KEY, {});
  return {};
}

function editableTemplates() {
  const groups = [];
  for (const [group, label] of Object.entries(TEMPLATE_GROUPS)) {
    groups.push({
      group,
      label,
      templates: flattenTemplates(templateRoots[group]).map((item) => ({
        key: item.path.join("."),
        path: item.path,
        value: item.value
      }))
    });
  }
  return groups;
}

function normalizeExperiments(experiments = []) {
  const list = Array.isArray(experiments) ? experiments : [];
  return list
    .filter((item) => item && templateRoots[item.group] && typeof getAtPath(templateRoots[item.group], String(item.key || "").split(".")) === "string")
    .map((item) => ({
      id: item.id || `${item.group}:${item.key}:${Date.now()}`,
      name: String(item.name || `${TEMPLATE_GROUPS[item.group]} ${item.key}`),
      group: item.group,
      key: String(item.key),
      status: ["draft", "active", "paused", "winner"].includes(item.status) ? item.status : "draft",
      winnerVariantId: item.winnerVariantId || "",
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      variants: (Array.isArray(item.variants) ? item.variants : [])
        .filter((variant) => variant && typeof variant.body === "string")
        .slice(0, 5)
        .map((variant, index) => ({
          id: variant.id || (index === 0 ? "control" : `variant_${index + 1}`),
          name: String(variant.name || (index === 0 ? "Control" : `Variant ${index + 1}`)),
          body: variant.body,
          weight: Math.max(0, Math.min(Number(variant.weight ?? (index === 0 ? 50 : 50)), 100))
        }))
    }))
    .filter((item) => item.variants.length);
}

async function loadTemplateExperiments(store) {
  const setting = store.getSetting ? await store.getSetting(EXPERIMENTS_KEY) : null;
  return normalizeExperiments(setting?.value || []);
}

async function saveTemplateExperiments(store, experiments) {
  const clean = normalizeExperiments(experiments);
  if (store.setSetting) await store.setSetting(EXPERIMENTS_KEY, clean);
  return clean;
}

async function chooseTemplateVariant(store, contact, group, key, fallback) {
  const experiments = await loadTemplateExperiments(store);
  const experiment = experiments.find((item) => item.group === group && item.key === key && item.status === "active");
  if (!experiment) return { template: fallback, experimentId: "", variantId: "control", variantName: "Control" };

  const variants = experiment.variants.length ? experiment.variants : [{ id: "control", name: "Control", body: fallback, weight: 100 }];
  const totalWeight = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.weight || 0)), 0) || variants.length;
  let target = hashString(`${contact.id || contact.phone || ""}:${experiment.id}`) % totalWeight;
  let selected = variants[0];
  for (const variant of variants) {
    target -= Math.max(0, Number(variant.weight || 0)) || 1;
    if (target < 0) {
      selected = variant;
      break;
    }
  }
  return {
    template: selected.body || fallback,
    experimentId: experiment.id,
    variantId: selected.id,
    variantName: selected.name
  };
}

module.exports = {
  SETTING_KEY,
  EXPERIMENTS_KEY,
  applyTemplateOverrides,
  chooseTemplateVariant,
  editableTemplates,
  loadTemplateExperiments,
  loadTemplateOverrides,
  resetTemplateOverrides,
  saveTemplateExperiments,
  saveTemplateOverrides
};
