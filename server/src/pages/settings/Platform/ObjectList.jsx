import React, { useEffect, useMemo, useState } from "react";
import { Box, ExternalLink, Plus, Search, Settings2 } from "lucide-react";
import { apiRequest } from "../../../services/api.js";
import { objectTypeDescription, objectTypeLabel } from "../../../utils/platformObjectType.js";

const TYPE_FILTERS = [
  { value: "all", label: "All objects" },
  { value: "standard", label: "Standard" },
  { value: "custom", label: "Custom" },
];

const STATUS_FILTERS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

export default function ObjectList({ onNavigate }) {
  const [objects, setObjects] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    let cancelled = false;

    async function loadObjects() {
      setLoading(true);
      setError("");

      try {
        const [metadataData, modulesData] = await Promise.all([
          apiRequest("/api/platform/metadata"),
          apiRequest("/api/platform/modules"),
        ]);

        const metadataObjects =
          metadataData?.data?.objects ||
          [];

        if (!cancelled) {
          setObjects(Array.isArray(metadataObjects) ? metadataObjects : []);
          setModules(
            modulesData?.data || []
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Unable to load objects.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadObjects();

    return () => {
      cancelled = true;
    };
  }, []);

  const moduleNames = useMemo(() => {
    const map = new Map();

    modules.forEach((module) => {
      const key = module.id || module.module_key || module.key;
      if (key != null) {
        map.set(String(key), module.name || module.display_name || key);
      }
    });

    return map;
  }, [modules]);

  function getObjectName(object) {
    return (
      object.name ||
      object.label ||
      object.object_name ||
      object.object_key ||
      object.key ||
      "Unnamed Object"
    );
  }

  function getObjectKey(object) {
    return object.object_key || object.key || object.api_name || "—";
  }

  function getModuleName(object) {
    if (!object.module_key) {
      return "Platform";
    }

    return (
      moduleNames.get(String(object.module_key)) ||
      object.module_name ||
      object.module_key
    );
  }

  function isActive(object) {
    return (
      object.active !== false &&
      object.is_active !== false &&
      object.enabled !== false
    );
  }

  const filteredObjects = useMemo(() => {
    const value = search.trim().toLowerCase();

    return objects.filter((object) => {
      const type = objectTypeLabel(object) === "Standard" ? "standard" : "custom";
      if (typeFilter !== "all" && type !== typeFilter) return false;
      if (statusFilter === "active" && !isActive(object)) return false;
      if (statusFilter === "inactive" && isActive(object)) return false;
      if (!value) return true;

      const text = [
        object.name,
        object.label,
        object.object_key,
        object.key,
        object.api_name,
        object.description,
        object.module_key,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(value);
    });
  }, [objects, search, typeFilter, statusFilter]);

  function navigate(target, object = null) {
    if (typeof onNavigate === "function") {
      onNavigate(target, object);
    }
  }

  const filtersApplied = Boolean(search.trim() || typeFilter !== "all" || statusFilter !== "all");

  return (
    <div className="platform-object-page">
      <div className="onepos-page-header">
        <div>
          <h1 className="onepos-page-title">Objects</h1>
          <p className="onepos-page-subtitle">
            Define the business objects available to onePOS applications.
            Existing Retail POS objects can use their existing database
            tables and columns.
          </p>
        </div>

        <div className="onepos-page-header-actions">
          <button
            type="button"
            className="onepos-btn onepos-btn-sm onepos-btn-primary"
            onClick={() => navigate("new-object")}
          >
            <Plus size={14} aria-hidden="true" />
            New Object
          </button>
        </div>
      </div>

      <div className="onepos-card">
        <div className="onepos-toolbar pobj-toolbar">
          <div className="pobj-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              className="onepos-input pobj-search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search objects..."
              aria-label="Search objects"
            />
          </div>

          <label className="pobj-filter">
            <span className="pobj-filter-label">Type</span>
            <select
              className="onepos-input pobj-filter-select"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              aria-label="Filter by object type"
            >
              {TYPE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label className="pobj-filter">
            <span className="pobj-filter-label">Status</span>
            <select
              className="onepos-input pobj-filter-select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              aria-label="Filter by status"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <div className="pobj-count" role="status">
            {loading
              ? "Loading…"
              : `${filteredObjects.length} object${filteredObjects.length === 1 ? "" : "s"}`}
          </div>
        </div>

        {error ? (
          <div className="pobj-alert-wrap">
            <div className="onepos-alert onepos-alert-error">
              <strong>Unable to load objects.</strong> {error}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="onepos-empty">
            <span>Loading objects…</span>
          </div>
        ) : filteredObjects.length === 0 ? (
          <div className="onepos-empty">
            <Box size={20} aria-hidden="true" className="pobj-empty-icon" />
            <span className="onepos-empty-title">
              {filtersApplied ? "No matching objects" : "No objects configured"}
            </span>
            <span className="pobj-empty-hint">
              {filtersApplied
                ? "Try a different search term or clear the filters."
                : "Create your first platform object to begin configuring the system."}
            </span>

            {!filtersApplied ? (
              <button
                type="button"
                className="onepos-btn onepos-btn-sm onepos-btn-secondary pobj-empty-action"
                onClick={() => navigate("new-object")}
              >
                Create Object
              </button>
            ) : (
              <button
                type="button"
                className="onepos-btn onepos-btn-sm onepos-btn-secondary pobj-empty-action"
                onClick={() => {
                  setSearch("");
                  setTypeFilter("all");
                  setStatusFilter("all");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="pobj-table-wrap">
            <table className="onepos-table pobj-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>API Name</th>
                  <th className="pobj-col-type">Type</th>
                  <th className="pobj-col-module">Module</th>
                  <th>Status</th>
                  <th className="pobj-col-actions" />
                </tr>
              </thead>

              <tbody>
                {filteredObjects.map((object) => {
                  const id =
                    object.id ||
                    object.object_id ||
                    object.object_key ||
                    object.key;

                  const active = isActive(object);
                  const label = objectTypeLabel(object);

                  return (
                    <tr key={id}>
                      <td>
                        <button
                          type="button"
                          className="pobj-object-name"
                          onClick={() => navigate("edit-object", object)}
                        >
                          <span className="pobj-object-icon" aria-hidden="true">
                            <Box size={14} />
                          </span>
                          <span className="pobj-object-text">
                            <strong>{getObjectName(object)}</strong>

                            {object.description ? (
                              <small>{object.description}</small>
                            ) : null}
                          </span>
                        </button>
                      </td>

                      <td>
                        <code className="pobj-api">{getObjectKey(object)}</code>
                      </td>

                      <td className="pobj-col-type">
                        <span
                          className={
                            "onepos-badge "
                            + (label === "Standard" ? "onepos-badge-neutral" : "onepos-badge-info")
                          }
                          title={objectTypeDescription(object)}
                        >
                          {label}
                        </span>
                      </td>

                      <td className="pobj-col-module">{getModuleName(object)}</td>

                      <td>
                        <span className={"onepos-badge " + (active ? "onepos-badge-success" : "onepos-badge-warning")}>
                          {active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td className="pobj-col-actions">
                        <div className="pobj-row-actions">
                          <button
                            type="button"
                            className="onepos-btn onepos-btn-sm onepos-btn-secondary"
                            onClick={() => navigate("view-object", object)}
                            aria-label={`Open ${getObjectName(object)}`}
                          >
                            <ExternalLink size={13} aria-hidden="true" />
                            <span className="pobj-action-label">Open</span>
                          </button>
                          <button
                            type="button"
                            className="onepos-btn onepos-btn-sm onepos-btn-secondary"
                            onClick={() => navigate("edit-object", object)}
                            aria-label={`Configure ${getObjectName(object)}`}
                          >
                            <Settings2 size={13} aria-hidden="true" />
                            <span className="pobj-action-label">Configure</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        /* Object administration list — compact administration layout built on
           the shared onePOS primitives. Only layout that the shared classes do
           not already provide is declared here, always through tokens. */

        .platform-object-page { color: var(--text-primary); }

        .pobj-toolbar { gap: 8px; }

        .pobj-search {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 1 1 240px;
          min-width: 0;
          max-width: 380px;
          color: var(--text-secondary);
        }

        .pobj-search-input {
          height: calc(var(--onepos-control-height, 38px) - 8px);
          font-size: 13px;
        }

        .pobj-filter {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 0 0 auto;
        }

        .pobj-filter-label {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }

        .pobj-filter-select {
          width: auto;
          min-width: 128px;
          height: calc(var(--onepos-control-height, 38px) - 8px);
          font-size: 13px;
        }

        .pobj-count {
          margin-left: auto;
          color: var(--text-secondary);
          font-size: 12px;
          white-space: nowrap;
        }

        .pobj-alert-wrap { padding: 12px; }
        .pobj-alert-wrap .onepos-alert { border-radius: var(--onepos-radius-sm, 8px); }

        .pobj-empty-icon { color: var(--text-secondary); }
        .pobj-empty-hint { margin-top: 4px; font-size: 12.5px; }
        .pobj-empty-action { margin-top: 14px; }

        .pobj-table-wrap { overflow-x: auto; }

        .pobj-table { min-width: 520px; }
        .pobj-table td { vertical-align: middle; }

        .pobj-object-name {
          display: flex;
          align-items: center;
          gap: 8px;
          border: 0;
          background: transparent;
          padding: 0;
          color: var(--text-primary);
          text-align: left;
          cursor: pointer;
          max-width: 340px;
        }

        .pobj-object-text {
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .pobj-object-text strong {
          font-size: 13px;
          font-weight: 600;
        }

        .pobj-object-text small {
          margin-top: 2px;
          color: var(--text-secondary);
          font-size: 11.5px;
          line-height: 1.4;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .pobj-object-icon {
          display: inline-grid;
          place-items: center;
          width: 26px;
          height: 26px;
          flex: 0 0 auto;
          border-radius: var(--onepos-icon-chip-radius, 8px);
          background: var(--muted-background);
          color: var(--text-secondary);
        }

        .pobj-api {
          padding: 2px 6px;
          border-radius: 5px;
          background: var(--muted-background);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 11.5px;
        }

        .pobj-col-actions { text-align: right; }

        .pobj-row-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
        }

        @media (max-width: 900px) {
          .pobj-col-module { display: none; }
        }

        @media (max-width: 700px) {
          .pobj-col-type { display: none; }
          .pobj-toolbar { flex-direction: column; align-items: stretch; }
          .pobj-search { max-width: none; }
          .pobj-count { margin-left: 0; }
          .pobj-action-label { display: none; }
          .pobj-table { min-width: 0; }
        }
      `}</style>
    </div>
  );
}
