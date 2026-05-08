function isNoResponseDisposition(value) {
  return ["no response", "nr"].includes(String(value || "").toLowerCase().trim());
}

module.exports = { isNoResponseDisposition };
