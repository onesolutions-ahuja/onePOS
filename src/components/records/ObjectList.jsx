import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { isTechnicalRecordField, isUuid, parseBooleanValue } from "../../utils/recordDisplay.js";

/*
 * THE global record list presentation.
 *
 * ONE shared component renders every metadata record list — Platform object
 * pages, Settings-hosted object routes and future list surfaces — so Product,
 * Customer, Supplier etc. never grow page-specific list implementations.
 *
 * The caller owns data + behaviour (records, columns, handlers); this component
 * owns ONLY presentation: the search/filter toolbar, the consistent table
 * header, row spacing, status pills, the clickable primary (name) field and
 * right-aligned row actions. Columns come from metadata/list-layout data when
 * the caller supplies them; otherwise they are derived from the records.
 */

function cellText(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return parseBooleanValue(value) ? "Yes" : "No";
  if (typeof value === "object") {
    const label = value.label || value.name || value.title || value.display_name || value.value || "";
    return isUuid(String(label)) ? "" : String(label);
  }
  return isUuid(String(value)) ? "—" : String(value);
}

function truthy(value) {
  return parseBooleanValue(value);
}

/** Derive display columns from records when no explicit columns are given. */
function deriveColumns(records, primaryColumn) {
  const sample = records.slice(0, 20);
  const keys = [];
  const seen = new Set();
  for (const record of sample) {
    if (!record || typeof record !== "object") continue;
    for (const [key, value] of Object.entries(record)) {
      if (isTechnicalRecordField(key) || seen.has(key)) continue;
      if (value !== null && typeof value === "object") continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys.map((key) => ({
    key,
    label: key
      .replace(/_+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/^\w/, (c) => c.toUpperCase()),
    primary: key === primaryColumn,
  }));
}

function humanise(key) {
  return String(key || "")
    .replace(/_+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export default function ObjectList({
  records = [],
  columns = null,
  primaryColumn = "name",
  /** Metadata status pill: { key, labels: {on,off}, tones: {on,off} } or null. */
  statusColumn = null,
  /** Extra toolbar content (filters, buttons) rendered right of the search box. */
  toolbar,
  /** Optional row action renderer: (record) => nodes, placed right-aligned. */
  renderActions,
  onOpenRecord,
  /** Controlled search: when onSearchChange is supplied the caller owns the
   *  query (e.g. server-backed search) and internal client filtering is off. */
  searchValue,
  onSearchChange,
  /** Hide the built-in search box for callers whose search/filter toolbar
   *  already exists at page level (their semantics must not be duplicated). */
  showSearch = true,
  /** Optional id (or accessor result) of the currently selected record —
   *  rendered as the standard row highlight. */
  selectedId = null,
  loading = false,
  error = "",
  emptyMessage = "No records yet",
  emptyHint = "",
  searchPlaceholder = "Search records...",
  className = "",
}) {
  const [uncontrolledQuery, setUncontrolledQuery] = useState("");
  const query = onSearchChange ? searchValue ?? "" : uncontrolledQuery;
  const setQuery = (next) =>
    onSearchChange ? onSearchChange(next) : setUncontrolledQuery(next);

  const resolvedColumns = useMemo(() => {
    if (Array.isArray(columns) && columns.length) {
      return columns.map((column) =>
        typeof column === "string"
          ? { key: column, label: humanise(column), primary: column === primaryColumn }
          : { primary: column.key === primaryColumn, ...column },
      ).filter((column) => !isTechnicalRecordField(column.key));
    }
    return deriveColumns(records, primaryColumn);
  }, [columns, records, primaryColumn]);

  const filteredRecords = useMemo(() => {
    if (onSearchChange) return Array.isArray(records) ? records : [];
    const needle = query.trim().toLowerCase();
    if (!needle) return Array.isArray(records) ? records : [];
    return (Array.isArray(records) ? records : []).filter((record) =>
      resolvedColumns.some((column) => cellText(record?.[column.key]).toLowerCase().includes(needle)),
    );
  }, [records, query, resolvedColumns, onSearchChange]);

  const firstColumn = resolvedColumns[0];

  return (
    <section className={`onepos-object-list ${className}`}>
      <div className="onepos-object-list-toolbar">
        {showSearch ? (
          <div className="onepos-object-list-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </div>
        ) : null}
        {toolbar ? <div className="onepos-object-list-toolbar-extra">{toolbar}</div> : null}
      </div>

      {error ? (
        <div className="onepos-object-list-error" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="onepos-object-list-empty">
          <strong>Loading…</strong>
        </div>
      ) : filteredRecords.length === 0 ? (
        <div className="onepos-object-list-empty">
          <strong>{query ? "No matching records" : emptyMessage}</strong>
          {query ? <span>Try a different search.</span> : emptyHint ? <span>{emptyHint}</span> : null}
        </div>
      ) : (
        <div className="onepos-object-list-scroll">
          <table className="onepos-object-table">
            <thead>
              <tr>
                {resolvedColumns.map((column) => (
                  <th key={column.key} scope="col" data-column={column.key}>
                    {column.label}
                  </th>
                ))}
                {renderActions ? <th className="onepos-object-table-actions" aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record, index) => {
                const recordId = record?.id ?? record?.record_id ?? index;
                const openable = typeof onOpenRecord === "function" && recordId !== undefined;
                const open = () => onOpenRecord?.(record);
                const isSelected = selectedId !== null && recordId !== undefined && String(selectedId) === String(recordId);
                return (
                  <tr key={recordId} className={isSelected ? "onepos-object-row-selected" : undefined}>
                    {resolvedColumns.map((column) => {
                      const raw = record?.[column.key];
                      const text = column.format ? String(column.format(raw, record) ?? "") : cellText(raw);
                      const isPrimary = column.primary || (column === firstColumn && !resolvedColumns.some((c) => c.primary));
                      /* Column-level custom cell: a caller-supplied renderer
                         may return real nodes (avatars, sub-lines, badges).
                         Everything else stays string-based via format/pill. */
                      const cell = column.render ? column.render(raw, record) : null;
                      if (cell !== null && cell !== undefined && cell !== false) {
                        return <td key={column.key}>{cell}</td>;
                      }

                      /* Column-level pill: the format function maps a value to
                         a badge tone (success / info / warning / danger / neutral). */
                      if (column.pill) {
                        const tone = column.pill(raw, record) || "neutral";
                        return (
                          <td key={column.key}>
                            <span className={`onepos-badge onepos-badge-${tone}`}>{text || "—"}</span>
                          </td>
                        );
                      }

                      if (statusColumn && column.key === statusColumn.key) {
                        const on = truthy(raw);
                        const label = on ? statusColumn.labels?.on ?? "Active" : statusColumn.labels?.off ?? "Inactive";
                        const tone = on ? statusColumn.tones?.on ?? "success" : statusColumn.tones?.off ?? "neutral";
                        return (
                          <td key={column.key}>
                            <span className={`onepos-badge onepos-badge-${tone}`}>{label}</span>
                          </td>
                        );
                      }

                      return (
                        <td key={column.key} title={text}>
                          {isPrimary && openable ? (
                            <button type="button" className="onepos-object-table-primary" onClick={open}>
                              {text || "—"}
                            </button>
                          ) : (
                            text || "—"
                          )}
                        </td>
                      );
                    })}
                    {renderActions ? <td className="onepos-object-table-actions">{renderActions(record)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
