/*
 * T9M - Field mapping editor (Partner field | onePOS field).
 *
 * The onePOS side is a searchable dropdown driven by the T9E field
 * catalogue (never hard-coded here) with a free-text custom path fallback.
 * Validates every row via the T9D contract, surfaces per-row errors,
 * duplicate partner-field detection and array indicators. Non-direct
 * (constant/template) mappings support a static value.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { getIntegrationFieldCatalogue } from "../../services/integrationFieldCatalogue.js";
import { validateMapping } from "../../services/integrationMapping.js";

const MAPPING_TYPES = [
  { value: "direct", label: "Direct" },
  { value: "constant", label: "Constant" },
  { value: "template", label: "Template" },
];

/* A mapping row as loaded from the API / edited in the table. */
function rowFromApi(row) {
  return {
    partnerFieldPath: row.partner_field_path || "",
    oneposSourcePath: row.onepos_source_path || "",
    mappingType: row.mapping_type || "direct",
    staticValue: row.static_value ?? "",
  };
}

export default function MappingEditorModal({ integration, endpoint, onClose }) {
  const catalogue = useMemo(() => getIntegrationFieldCatalogue(), []);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");

  const loadMappings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest(`/api/integrations/${integration.id}/endpoints/${endpoint.id}/mappings`);
      setMappings((data?.data || []).map(rowFromApi));
    } catch (err) {
      setError(err.message || "Unable to load mappings");
    } finally {
      setLoading(false);
    }
  }, [integration.id, endpoint.id]);

  useEffect(() => {
    loadMappings();
  }, [loadMappings]);

  const addRow = () => setMappings((rows) => [...rows, { partnerFieldPath: "", oneposSourcePath: "", mappingType: "direct", staticValue: "" }]);
  const removeRow = (index) => setMappings((rows) => rows.filter((_, i) => i !== index));
  const updateRow = (index, patch) => setMappings((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /* Validation for the current editor state: per-row messages + duplicate
   * partner fields (a partner payload path appearing twice would overwrite
   * itself). Empty rows are ignored so a fresh row never shows noise. */
  const validation = useMemo(() => {
    const rowErrors = {};
    const seen = new Map();
    const duplicates = new Set();
    mappings.forEach((row, index) => {
      const partner = row.partnerFieldPath.trim();
      const type = row.mappingType || "direct";
      if (!partner && !(type !== "direct" && row.staticValue)) return; // untouched/empty row
      const result = validateMapping(
        type === "direct"
          ? { partnerField: partner, sourcePath: row.oneposSourcePath }
          : { partnerField: partner, sourcePath: "x.valid" } // source not used for static types
      );
      const messages = result.valid ? [] : [...result.errors];
      if (type !== "direct" && !String(row.staticValue ?? "").length) {
        messages.push("Static value is required for constant/template mappings.");
      }
      if (type === "direct" && !row.oneposSourcePath.trim()) {
        messages.push("Select a onePOS field for direct mappings.");
      }
      if (partner) {
        if (seen.has(partner)) duplicates.add(partner);
        else seen.set(partner, index);
      }
      if (messages.length) rowErrors[index] = messages;
    });
    if (duplicates.size) {
      mappings.forEach((row, index) => {
        if (duplicates.has(row.partnerFieldPath.trim())) {
          rowErrors[index] = [...(rowErrors[index] || []), "Duplicate partner field."];
        }
      });
    }
    return { rowErrors, duplicates, hasErrors: Object.keys(rowErrors).length > 0 };
  }, [mappings]);

  const save = async () => {
    setError("");
    setMessage("");
    if (validation.hasErrors) {
      setError("Fix the highlighted mapping errors before saving.");
      return;
    }
    setSaving(true);
    try {
      const cleaned = mappings
        .filter((row) => row.partnerFieldPath.trim())
        .map((row) => ({
          partnerFieldPath: row.partnerFieldPath.trim(),
          oneposSourcePath: row.mappingType === "direct" ? row.oneposSourcePath.trim() : null,
          mappingType: row.mappingType || "direct",
          staticValue: row.mappingType === "direct" ? null : row.staticValue || null,
        }));
      await apiRequest(`/api/integrations/${integration.id}/endpoints/${endpoint.id}/mappings`, {
        method: "PUT",
        body: JSON.stringify({ mappings: cleaned }),
      });
      setMessage("Mappings saved.");
      loadMappings();
    } catch (err) {
      setError(err.message || "Unable to save mappings");
    } finally {
      setSaving(false);
    }
  };

  const filteredCatalogue = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q
      ? catalogue.filter((entry) => `${entry.path} ${entry.label}`.toLowerCase().includes(q))
      : catalogue;
  }, [catalogue, search]);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Field Mappings — {endpoint.name}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="py-6 text-center text-slate-400 text-sm">Loading…</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_1.5fr_auto] gap-2 px-1 pb-1 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <span>Partner field</span><span>onePOS field</span><span />
              </div>
              <div className="space-y-2">
                {mappings.length === 0 && <div className="text-sm text-slate-400 py-3">No mappings yet — add one below.</div>}
                {mappings.map((row, index) => {
                  const isDirect = (row.mappingType || "direct") === "direct";
                  const entry = catalogue.find((e) => e.path === row.oneposSourcePath);
                  const errors = validation.rowErrors[index] || [];
                  return (
                    <div key={index} className={`grid grid-cols-[1fr_1.5fr_auto] gap-2 items-start ${errors.length ? "bg-red-50/60 rounded-lg p-1 -m-1" : ""}`}>
                      <div>
                        <input
                          value={row.partnerFieldPath}
                          onChange={(e) => updateRow(index, { partnerFieldPath: e.target.value })}
                          placeholder="e.g. InvoiceNumber"
                          className={`h-9 w-full px-2.5 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${errors.length ? "border-red-300" : "border-slate-200"}`}
                        />
                        {validation.duplicates.has(row.partnerFieldPath.trim()) && row.partnerFieldPath.trim() && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 mt-0.5"><AlertTriangle size={11} /> duplicate</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isDirect ? (
                          <>
                            <select
                              value={row.oneposSourcePath || ""}
                              onChange={(e) => updateRow(index, { oneposSourcePath: e.target.value })}
                              className="h-9 px-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-[11rem] shrink-0"
                              aria-label="onePOS source field"
                            >
                              <option value="">Custom / none…</option>
                              {catalogue.some((e) => e.path === row.oneposSourcePath) || !row.oneposSourcePath
                                ? null
                                : <option value={row.oneposSourcePath}>{row.oneposSourcePath}</option>}
                              {filteredCatalogue.map((e) => (
                                <option key={e.path} value={e.path}>{e.label} ({e.path})</option>
                              ))}
                            </select>
                            <input
                              value={row.oneposSourcePath}
                              onChange={(e) => updateRow(index, { oneposSourcePath: e.target.value })}
                              placeholder="sales.customer.name"
                              className="h-9 px-2.5 border border-slate-200 rounded-lg text-sm font-mono flex-1 min-w-0 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              aria-label="onePOS source path (custom)"
                            />
                            {entry?.array && (
                              <span className="shrink-0 px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] font-medium" title="Collection field — resolves one value per item">[ ]</span>
                            )}
                          </>
                        ) : (
                          <input
                            value={row.staticValue}
                            onChange={(e) => updateRow(index, { staticValue: e.target.value })}
                            placeholder={row.mappingType === "template" ? "Template, e.g. {{sales.receipt_number}}" : "Static value"}
                            className="h-9 w-full px-2.5 border border-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                            aria-label="Static value"
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 h-9">
                        <select
                          value={row.mappingType || "direct"}
                          onChange={(e) => updateRow(index, { mappingType: e.target.value })}
                          className="h-9 px-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          aria-label="Mapping type"
                          title="Direct: from onePOS · Constant/Template: static value"
                        >
                          {MAPPING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                        <button onClick={() => removeRow(index)} className="h-9 w-9 flex items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50" title="Remove mapping"><Trash2 size={14} /></button>
                      </div>
                      {errors.length > 0 && (
                        <div className="col-span-3 -mt-1 mb-1 text-[11px] text-red-600">
                          {errors.map((m, i) => <div key={i}>{m}</div>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <button onClick={addRow} className="h-8 px-3 border border-slate-200 rounded-lg text-xs flex items-center gap-1.5 hover:bg-slate-50"><Plus size={13} /> Add mapping</button>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search onePOS fields…"
                  className="h-8 px-3 border border-slate-200 rounded-lg text-xs flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Source paths support relationship traversal (<code>sales.customer.address.postcode</code>) and collections (<code>sales.items[].product.ean</code> — marked&nbsp;[&nbsp;]).
              </p>
              {message && <div className="mt-3 px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{message}</div>}
              {error && <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
            </>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-slate-200 text-sm hover:bg-slate-50">Close</button>
          <button type="button" onClick={save} disabled={saving || loading} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {saving ? "Saving…" : "Save Mappings"}
          </button>
        </div>
      </div>
    </div>
  );
}
