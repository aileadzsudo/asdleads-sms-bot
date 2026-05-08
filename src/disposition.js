function isNoResponseDisposition(value) {
  return ["no response", "nr"].includes(String(value || "").toLowerCase().trim());
}

function normalizeTagList(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.flatMap(normalizeTagList);
  if (typeof tags === "object") {
    return normalizeTagList(Object.values(tags));
  }
  return String(tags)
    .split(/[,\s]+/)
    .map((tag) => tag.toLowerCase().trim().replace(/^#/, "").replace(/[-\s]+/g, "_"))
    .filter(Boolean);
}

function hasNoResponseTag(payload = {}) {
  const tagSources = [
    payload.tags,
    payload.tag,
    payload.contactTags,
    payload.contact?.tags,
    payload.contact?.tag,
    payload.customData?.tags,
    payload.customData?.tag,
    payload.customData?.contactTags
  ];
  return tagSources.some((tags) => normalizeTagList(tags).includes("nr"));
}

function isNoResponseSignal(payload = {}) {
  return (
    isNoResponseDisposition(payload.disposition) ||
    isNoResponseDisposition(payload.customDisposition) ||
    isNoResponseDisposition(payload.customData?.disposition) ||
    isNoResponseDisposition(payload.customData?.customDisposition) ||
    hasNoResponseTag(payload)
  );
}

module.exports = { isNoResponseDisposition, hasNoResponseTag, isNoResponseSignal, normalizeTagList };
