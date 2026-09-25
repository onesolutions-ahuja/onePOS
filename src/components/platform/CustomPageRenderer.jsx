import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import {
  SECTION_WIDTHS,
  multiContainerColumns,
  nodeLabel,
} from "../../pages/settings/Platform/customPageTree.js";

/*
 * SHARED CUSTOM PAGE RENDERER.
 *
 * The ONLY renderer for the Custom Page metadata tree. The visual builder's
 * canvas and the published runtime page both render through this component —
 * the builder just layers drag/drop handles and selection outlines on top
 * (builderMode=true), so design-time preview and runtime cannot diverge.
 *
 * Record-bound components consume Record Collections through the existing
 * Platform record APIs (/api/platform/objects/:objectKey/records) — the
 * condition engine and permissions stay server-side.
 */

const PAGE_BUILDER_GRID_CSS = `
  .cpb-tree { display: flex; flex-wrap: wrap; gap: 12px; min-width: 0; }
  .cpb-section { border-radius: var(--onepos-radius, 12px); min-width: 0; }
  .cpb-section-body { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
  .cpb-container-grid { display: grid; gap: 8px; min-width: 0; }
  .cpb-multi-grid { display: grid; min-width: 0; }
  .cpb-record-card {
    display: flex; flex-direction: column; gap: 4px;
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 10px; background: var(--card-background, #fff);
    padding: 12px; min-width: 0; overflow: hidden;
  }
  .cpb-record-card.clickable { cursor: pointer; transition: box-shadow .15s ease, transform .15s ease; }
  .cpb-record-card.clickable:hover { box-shadow: var(--onepos-shadow-md, 0 4px 12px rgba(15,23,42,.08)); }
  .cpb-card-title { font-weight: 600; font-size: 13px; color: var(--text-primary, #111827); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cpb-card-subtitle { font-size: 11px; color: var(--text-secondary, #6b7280); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cpb-card-field { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--text-secondary, #6b7280); }
  .cpb-card-field b { font-weight: 500; color: var(--text-primary, #374151); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cpb-placeholder-row {
    display: grid; gap: 8px; border: 1.5px dashed var(--border-color, #cbd5e1);
    border-radius: 10px; padding: 10px; color: var(--text-secondary, #94a3b8); font-size: 11px;
  }
  .cpb-empty { border: 1.5px dashed var(--border-color, #cbd5e1); border-radius: 10px; padding: 18px; text-align: center; color: var(--text-secondary, #94a3b8); font-size: 12px; }
`;

export function formatRecordValue(value, fieldType) {
  if (value === null || value === undefined || value === "") return "—";
  if (fieldType === "boolean") return value === true || value === "true" ? "Yes" : "No";
  if (fieldType === "date" || fieldType === "datetime") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return fieldType === "date" ? date.toLocaleDateString() : date.toLocaleString();
  }
  if (fieldType === "currency" || fieldType === "decimal" || fieldType === "number") {
    const num = Number(value);
    if (Number.isFinite(num)) return fieldType === "currency" ? num.toLocaleString(undefined, { style: "currency", currency: "GBP" }) : String(num);
  }
  return String(value);
}

/** Design-time placeholder record so the canvas previews real structure before save. */
function placeholderRecords(collection) {
  const fields = collection.fields?.length ? collection.fields : ["name", "status", "created_at"];
  const sample = { "text": "Sample value", "number": 42, "decimal": 19.5, "currency": 24.99, "date": new Date().toISOString().slice(0, 10), "datetime": new Date().toISOString(), "boolean": true, "select": "Option A", "picklist": "Option A", "lookup": "Related record", "long_text": "Sample text" };
  const records = [];
  for (let index = 0; index < Math.min(collection.maxRecords || 3, 3); index += 1) {
    const record = { id: `preview-${index + 1}` };
    for (const field of fields) record[field] = `${String(field).replace(/_/g, " ")} ${index + 1}`;
    records.push(record);
  }
  return { records, fields, placeholder: true };
}

/**
 * THE one Record Collection hook. Every record-bound component (MultiContainer,
 * Table/List, future Cards/Kanban) consumes THIS hook — one datasource, one
 * request shape, one place where conditions/sort/limit/offset are applied.
 * Pagination state lives with the caller so changing Max Records or filters
 * does not jump the page to the top, and page index is clamped when data
 * shrinks.
 */
export function useRecordCollection(collection, { enabled, page = 1 }) {
  const [state, setState] = useState(() => ({ records: [], total: 0, fields: [], placeholder: false, loading: false, error: "" }));
  const key = useMemo(() => JSON.stringify(collection || {}), [collection]);

  useEffect(() => {
    if (!enabled) return;
    const parsed = JSON.parse(key);
    if (!parsed?.objectKey) {
      setState({ records: [], total: 0, fields: [], placeholder: true, loading: false, error: "" });
      return undefined;
    }
    let live = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    /* Consume the Record Collection boundary — NOT a bespoke query. The
       endpoint resolves conditions/sort/limit against object metadata and
       enforces the same object-permission + read-scope gates as the object
       runtime. */
    const maxRecords = Math.min(parsed.maxRecords || 10, 50);
    const clampedPage = Math.max(1, Number(page) || 1);
    apiRequest("/api/platform/runtime/record-collection", {
      method: "POST",
      body: JSON.stringify({
        objectKey: parsed.objectKey,
        conditions: (parsed.conditions || []).filter((condition) => condition.field),
        conditionMatch: parsed.conditionMatch || "all",
        sort: parsed.sort || [],
        maxRecords,
        fields: parsed.fields || [],
        offset: (clampedPage - 1) * maxRecords,
      }),
    })
      .then((response) => {
        if (!live) return;
        const records = Array.isArray(response?.records) ? response.records : Array.isArray(response?.data) ? response.data : [];
        const total = Number(response?.total) || 0;
        setState({ records, total, fields: parsed.fields || [], placeholder: false, loading: false, error: "" });
      })
      .catch((error) => {
        if (live) setState({ records: [], total: 0, fields: parsed.fields || [], placeholder: true, loading: false, error: error?.message || "Records unavailable" });
      });
    return () => { live = false; };
  }, [key, enabled, page]);

  return state;
}

/** Shared pagination footer. Collection page state is owned by the page-level hook. */
function PaginationFooter({ total, maxRecords, page, onPageChange }) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / Math.max(1, maxRecords)));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      <button type="button" className="onepos-btn onepos-btn-secondary onepos-btn-sm" disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} aria-label="Previous page">
        <ChevronLeft size={13} /> Previous
      </button>
      <span className="text-xs" style={{ color: "var(--text-secondary, #6b7280)" }}>Page {page} of {pages}</span>
      <button type="button" className="onepos-btn onepos-btn-secondary onepos-btn-sm" disabled={page >= pages} onClick={() => onPageChange(Math.min(pages, page + 1))} aria-label="Next page">
        Next <ChevronRight size={13} />
      </button>
    </div>
  );
}

function MultiContainerView({ node, sectionWidth, device, builderMode, onRecordClick, data }) {
  const collection = node.collection || {};
  const designed = useMemo(() => placeholderRecords(collection), [collection]);
  const { records, fields, placeholder, loading, error } = data?.placeholder
    ? { records: [], fields: collection.fields || [], placeholder: true, loading: false, error: "" }
    : (data || designed);

  const columns = multiContainerColumns({ sectionWidth, containerSize: node.containerSize || "medium", device });
  const maxRecords = collection.maxRecords || 10;
  const shown = records.slice(0, maxRecords);
  const titleField = collection.titleField || fields[0] || "name";
  const subtitleField = collection.subtitleField || fields[1] || "";

  const cardFor = (record, index) => {
    const clickable = node.clickable !== false && node.interaction?.type !== "none" && !builderMode;
    return (
      <div
        key={record.id || index}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        className={`cpb-record-card${clickable ? " clickable" : ""}`}
        onClick={clickable ? () => onRecordClick?.({ record, node }) : undefined}
        onKeyDown={clickable ? (event) => { if (event.key === "Enter") onRecordClick?.({ record, node }); } : undefined}
      >
        <span className="cpb-card-title">{formatRecordValue(record[titleField], "text")}</span>
        {subtitleField ? <span className="cpb-card-subtitle">{formatRecordValue(record[subtitleField], "text")}</span> : null}
        {fields.filter((field) => field !== titleField && field !== subtitleField).slice(0, 4).map((field) => (
          <span className="cpb-card-field" key={field}><span>{String(field).replace(/_/g, " ")}</span><b>{formatRecordValue(record[field])}</b></span>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="cpb-multi-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: (node.spacing || 3) * 4 }}>
        {placeholder && !shown.length
          ? Array.from({ length: Math.min(columns, 3) }).map((_, index) => (
            <div className="cpb-placeholder-row" key={index}>
              <span className="cpb-card-title">{collection.titleField ? `${String(collection.titleField).replace(/_/g, " ")} #` : "Record #"}</span>
              {subtitleField ? <span className="cpb-card-subtitle">{String(subtitleField).replace(/_/g, " ")}</span> : null}
              {(collection.fields?.length ? collection.fields : ["status", "created_at"]).filter((field) => field !== titleField && field !== subtitleField).slice(0, 3).map((field) => (
                <span className="cpb-card-field" key={field}><span>{String(field).replace(/_/g, " ")}</span><b>—</b></span>
              ))}
            </div>
          ))
          : shown.map(cardFor)}
        {loading ? <div className="cpb-empty">Loading records…</div> : null}
        {!loading && error && !shown.length ? <div className="cpb-empty">{error}</div> : null}
        {!loading && !error && !placeholder && !shown.length ? <div className="cpb-empty">No records match this collection.</div> : null}
      </div>
      {!builderMode && !placeholder ? (
        <PaginationFooter total={data?.total || 0} maxRecords={maxRecords} page={data?.page || 1} onPageChange={data?.onPageChange} />
      ) : null}
    </div>
  );
}

/**
 * Table / List — consumes the SAME Record Collection datasource as
 * MultiContainer (same hook, same endpoint, same permissions). Row On Click
 * goes through the same interaction dispatch as record cards.
 */
function TableView({ node, builderMode, onRecordClick, data }) {
  const collection = node.collection || {};
  const { records, fields, placeholder, loading, error } = data?.placeholder
    ? { records: [], fields: collection.fields || [], placeholder: true, loading: false, error: "" }
    : (data || { records: [], fields: collection.fields || [], placeholder: true, loading: false, error: "" });
  const maxRecords = collection.maxRecords || 10;
  const shown = records.slice(0, maxRecords);
  const columns = (fields.length ? fields : Object.keys(shown[0] || {})).filter((field) => field !== "id").slice(0, 7);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border-color, #e5e7eb)" }}>
        <table className="w-full text-left text-sm" style={{ color: "var(--text-primary, #111827)", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--muted-background, #f8fafc)" }}>
              {columns.map((field) => (
                <th key={field} className="px-3 py-2 text-xs font-semibold" style={{ color: "var(--text-secondary, #6b7280)" }}>{String(field).replace(/_/g, " ")}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {placeholder && !shown.length
              ? Array.from({ length: 3 }).map((_, index) => (
                <tr key={index}>
                  {(columns.length ? columns : ["name", "status", "created_at"]).map((field) => (
                    <td key={field} className="px-3 py-2 text-xs" style={{ color: "var(--text-secondary, #94a3b8)" }}>{String(field).replace(/_/g, " ")} …</td>
                  ))}
                </tr>
              ))
              : shown.map((record, index) => {
                const clickable = node.clickable !== false && node.interaction?.type !== "none" && !builderMode;
                return (
                  <tr
                    key={record.id || index}
                    onClick={clickable ? () => onRecordClick?.({ record, node }) : undefined}
                    onKeyDown={clickable ? (event) => { if (event.key === "Enter") onRecordClick?.({ record, node }); } : undefined}
                    role={clickable ? "button" : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    className={clickable ? "cursor-pointer transition-colors hover:bg-slate-50" : undefined}
                  >
                    {columns.map((field) => (
                      <td key={field} className="border-t px-3 py-2 text-xs" style={{ borderColor: "var(--border-color, #f1f5f9)" }}>{formatRecordValue(record[field])}</td>
                    ))}
                  </tr>
                );
              })}
            {loading ? <tr><td className="px-3 py-3 text-xs text-slate-400" colSpan={Math.max(1, columns.length)}>Loading records…</td></tr> : null}
            {!loading && error && !shown.length ? <tr><td className="px-3 py-3 text-xs text-slate-400" colSpan={Math.max(1, columns.length)}>{error}</td></tr> : null}
            {!loading && !error && !placeholder && !shown.length ? <tr><td className="px-3 py-3 text-xs text-slate-400" colSpan={Math.max(1, columns.length)}>No records match this collection.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {!builderMode && !placeholder ? (
        <PaginationFooter total={data?.total || 0} maxRecords={maxRecords} page={data?.page || 1} onPageChange={data?.onPageChange} />
      ) : null}
    </div>
  );
}

function NodeView({ node, sectionWidth, device, builderMode, onRecordClick, onButtonClick, data }) {
  const key = node.componentKey;
  if (key === "container") {
    return (
      <div className="cpb-container-grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, node.columns || 2)}, minmax(0, 1fr))`, gap: (node.spacing || 3) * 4 }}>
        {(node.children || []).map((child) => <NodeView key={child.id} node={child} sectionWidth={sectionWidth} device={device} builderMode={builderMode} onRecordClick={onRecordClick} onButtonClick={onButtonClick} data={data} />)}
      </div>
    );
  }
  if (key === "multi_container") {
    return <MultiContainerView node={node} sectionWidth={sectionWidth} device={device} builderMode={builderMode} onRecordClick={onRecordClick} data={data?.[node.id]} />;
  }
  if (key === "table") {
    return <TableView node={node} builderMode={builderMode} onRecordClick={onRecordClick} data={data?.[node.id]} />;
  }
  if (key === "button") {
    const variantClass = { primary: "onepos-btn-primary", secondary: "onepos-btn-secondary", ghost: "onepos-btn-secondary", danger: "onepos-btn-danger" }[node.variant || "primary"] || "onepos-btn-primary";
    return (
      <button
        type="button"
        className={`onepos-btn ${variantClass}${node.size === "small" ? " onepos-btn-sm" : ""}`}
        onClick={builderMode ? undefined : () => onButtonClick?.(node)}
      >
        {node.label || "Button"}
      </button>
    );
  }
  if (key === "header") return <h3 className="text-base font-semibold" style={{ color: "var(--text-primary, #111827)" }}>{node.text || node.label || "Heading"}</h3>;
  if (key === "text") return <p className="text-sm" style={{ color: "var(--text-secondary, #475569)" }}>{node.text || node.label || "Text"}</p>;
  if (key === "divider") return <hr style={{ borderColor: "var(--border-color, #e5e7eb)", margin: 0 }} />;
  if (key === "spacer") return <div style={{ height: 16 + (Number(node.spacing) || 3) * 6 }} aria-hidden="true" />;
  if (key === "related_list") return <div className="cpb-empty">Related list{node.relationshipKey ? ` · ${node.relationshipKey}` : ""}</div>;
  if (key === "field_value") return <div className="text-sm" style={{ color: "var(--text-primary, #374151)" }}>{node.field ? `${String(node.field).replace(/_/g, " ")}` : "Field value"}</div>;
  return <div className="text-sm" style={{ color: "var(--text-secondary, #64748b)" }}>{nodeLabel(node)}</div>;
}

/**
 * Per-node hook host: the ONE useRecordCollection hook instance for each
 * record-bound node. Writing the fetch result into the page-level state map
 * (via setNodeState) keeps pagination page state and data in a single owner —
 * the shared renderer — so MultiContainer, Table and future record components
 * stay in perfect sync without extra wiring.
 */
function RecordBoundNodeBoundary({ node, collectionState, pageByNode, setNodeState, setPage, children }) {
  const collection = node.collection || {};
  const isRecordBound = node.componentKey === "multi_container" || node.componentKey === "table";
  const page = pageByNode[node.id] || 1;
  const live = useRecordCollection(collection, {
    enabled: isRecordBound && Boolean(collection.objectKey),
    page,
  });
  useEffect(() => {
    if (!isRecordBound) return;
    setNodeState(node.id, {
      ...live,
      page,
      onPageChange: (nextPage) => setPage((current) => ({ ...current, [node.id]: Math.max(1, Number(nextPage) || 1) })),
    });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [isRecordBound, node.id, live.records, live.total, live.loading, live.error, live.placeholder, page]);
  return children;
}

/**
 * The shared renderer.
 *
 * @param definition  normalised Custom Page tree (customPageTree.js shape)
 * @param builderMode when true, records stay as placeholders and interactions are inert
 * @param device      desktop | tablet | mobile (builder device preview / runtime width)
 */
export default function CustomPageRenderer({ definition, builderMode = false, device = "desktop", selectedId = null, onSelectNode = null, onRecordClick = null, onButtonClick = null, renderSectionChrome = null }) {
  const sections = Array.isArray(definition?.sections) ? definition.sections : [];

  /*
   * ONE page-level Record Collection state map.
   *
   * Every record-bound node gets a slot in one state map keyed by node id.
   * Pagination page indexes live HERE (not inside the node components), so a
   * Max Records or conditions change re-fetches the same page instead of
   * resetting it, and each collection keeps its own page while others change.
   * The hook is rendered through a tiny per-node component so rules-of-hooks
   * stay satisfied with a dynamic node list.
   */
  const [collectionState, setCollectionState] = useState({});
  const [pageByNode, setPageByNode] = useState({});

  const recordNodes = useMemo(() => {
    const nodes = [];
    for (const section of sections) {
      const visit = (list) => {
        for (const node of list || []) {
          if (node.componentKey === "multi_container" || node.componentKey === "table") nodes.push(node);
          if (Array.isArray(node.children)) visit(node.children);
        }
      };
      visit(section.children);
    }
    return nodes;
  }, [sections]);

  const setNodeState = (nodeId, patch) => setCollectionState((current) => ({ ...current, [nodeId]: { ...(current[nodeId] || {}), ...patch } }));

  return (
    <div className={`cpb-tree${device === "mobile" ? " mx-auto w-full max-w-[420px]" : device === "tablet" ? " mx-auto w-full max-w-[820px]" : " w-full"}`}>
      <style>{PAGE_BUILDER_GRID_CSS}</style>
      {sections.filter((section) => section.visible !== false).map((section) => {
        const body = (
          <div className="cpb-section-body">
            {(section.children || []).filter((child) => child.visible !== false).map((node) => (
              <div
                key={node.id}
                onClick={builderMode && onSelectNode ? (event) => { event.stopPropagation(); onSelectNode(node.id, null); } : undefined}
                style={{ minWidth: 0 }}
                className={`${builderMode && selectedId === node.id ? "cpb-selected" : ""}`}
              >
                <RecordBoundNodeBoundary node={node} collectionState={collectionState} pageByNode={pageByNode} setNodeState={setNodeState} setPage={setPageByNode}>
                  <NodeView node={node} sectionWidth={section.width} device={device} builderMode={builderMode} onRecordClick={onRecordClick} onButtonClick={onButtonClick} data={collectionState} />
                </RecordBoundNodeBoundary>
              </div>
            ))}
            {!section.children?.length ? <div className="cpb-empty">Drop components here</div> : null}
          </div>
        );
        /* The builder supplies its own section chrome (labels, width, drop zones);
           runtime renders the plain section card. */
        if (renderSectionChrome) return renderSectionChrome(section, body);
        return (
          <section key={section.id} className="cpb-section onepos-card p-4" style={{ flexBasis: SECTION_WIDTHS[section.width]?.basis || "100%", width: section.width === "full" ? "100%" : SECTION_WIDTHS[section.width]?.basis }}>
            {body}
          </section>
        );
      })}
      {!sections.length ? <div className="cpb-empty">Drag a Section onto the page to start.</div> : null}
    </div>
  );
}
