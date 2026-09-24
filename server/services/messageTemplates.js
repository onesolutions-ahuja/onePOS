const CHANNELS = new Set(["EMAIL", "SMS", "WHATSAPP"]);
const TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

export function validateTemplateChannel(channel) {
  return typeof channel === "string" && CHANNELS.has(channel.toUpperCase());
}

export function extractMergeFields(value) {
  const fields = [];
  const text = String(value || "");
  let match;
  while ((match = TOKEN_RE.exec(text))) {
    if (!fields.includes(match[1])) fields.push(match[1]);
  }
  return fields;
}

export function renderMessageTemplate(value, record, allowedFields = null) {
  const source = String(value || "");
  const invalid = [];
  const rendered = source.replace(TOKEN_RE, (_, path) => {
    if (allowedFields && !allowedFields.has(path)) {
      invalid.push(path);
      return "";
    }
    const result = path.split(".").reduce((current, key) => current == null ? undefined : current[key], record);
    if (result === undefined || result === null) {
      invalid.push(path);
      return "";
    }
    return Array.isArray(result) || typeof result === "object" ? JSON.stringify(result) : String(result);
  });
  if (invalid.length) {
    const error = new Error(`Invalid or unavailable merge fields: ${[...new Set(invalid)].join(", ")}`);
    error.code = "INVALID_MERGE_FIELD";
    throw error;
  }
  return rendered;
}

export { CHANNELS };
