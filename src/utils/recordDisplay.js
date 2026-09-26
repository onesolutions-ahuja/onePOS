const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TECHNICAL_FIELD_KEYS = new Set(["id", "record_id", "record_uuid", "uuid", "key"]);

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

export function isTechnicalRecordField(fieldOrKey) {
  const key = typeof fieldOrKey === "string"
    ? fieldOrKey
    : fieldOrKey?.apiName || fieldOrKey?.api_name || fieldOrKey?.fieldKey || fieldOrKey?.field_key || fieldOrKey?.name || "";
  return TECHNICAL_FIELD_KEYS.has(String(key).trim().toLowerCase());
}

export function parseBooleanValue(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

export function getRecordDisplayTitle(record, fallback = "Record") {
  const candidates = [
    record?.name,
    record?.display_name,
    record?.title,
    record?.reference,
    record?.reference_number,
    record?.receipt_number,
    record?.number,
    record?.code,
    record?.sku,
    fallback,
  ];
  const title = candidates.find((value) => (
    value !== null &&
    value !== undefined &&
    String(value).trim() !== "" &&
    !isUuid(String(value).trim())
  ));
  return title === undefined ? "Record" : String(title);
}

function currencyCodeOf(field) {
  return field?.currencyCode ||
    field?.currency_code ||
    field?.config?.currencyCode ||
    field?.config?.currency_code ||
    field?.config?.currency ||
    "";
}

function lookupLabel(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const label = value.label ?? value.displayName ?? value.display_name ?? value.name ?? value.title ?? value.value;
  return label === null || label === undefined || label === "" || isUuid(String(label)) ? null : String(label);
}

export function formatRecordDisplayValue(value, field = {}) {
  if (value === null || value === undefined || value === "") return "—";

  const type = String(
    field?.config?.resultType || field?.fieldType || field?.field_type || field?.type || "text"
  ).toLowerCase();

  if (type === "boolean") {
    const enabled = parseBooleanValue(value);
    const label = String(field?.label || field?.name || "").toLowerCase();
    if (label.includes("enabled")) return enabled ? "Enabled" : "Disabled";
    if (label.includes("active")) return enabled ? "Active" : "Inactive";
    return enabled ? "Yes" : "No";
  }

  if (type === "lookup") {
    if (typeof value === "object") return lookupLabel(value) || "—";
    return isUuid(String(value)) ? "—" : String(value);
  }

  if (type === "currency") {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return String(value);
    const currency = currencyCodeOf(field);
    if (currency) {
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    }
    return new Intl.NumberFormat().format(amount);
  }

  if (type === "number" || type === "decimal") {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : String(value);
  }

  if (type === "date" || type === "datetime") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, type === "datetime"
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }).format(date);
  }

  if (typeof value === "object") return lookupLabel(value) || "—";
  if (isUuid(String(value))) return "—";
  return String(value);
}
