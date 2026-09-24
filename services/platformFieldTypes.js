export const PLATFORM_FIELD_TYPES = Object.freeze([
  "text",
  "number",
  "decimal",
  "currency",
  "boolean",
  "date",
  "datetime",
  "email",
  "phone",
  "select",
  "picklist",
  "multiselect",
  "lookup",
  "formula",
  "rollup",
]);

export const PLATFORM_FIELD_TYPE_SQL = PLATFORM_FIELD_TYPES
  .map((type) => `'${type}'`)
  .join(",");

export const PLATFORM_FIELD_TYPE_SET = new Set(PLATFORM_FIELD_TYPES);
