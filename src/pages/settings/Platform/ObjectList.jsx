import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, Plus, Settings2 } from "lucide-react";
import { apiRequest } from "../../../services/api.js";

export default function ObjectList({ onNavigate }) {
  const [objects, setObjects] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

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

  const filteredObjects = useMemo(() => {
    const value = search.trim().toLowerCase();

    if (!value) {
      return objects;
    }

    return objects.filter((object) => {
      const text = [
        object.name,
        object.label,
        object.object_key,
        object.key,
        object.description,
        object.module_key,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return text.includes(value);
    });
  }, [objects, search]);

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

  function navigate(target, object = null) {
    if (typeof onNavigate === "function") {
      onNavigate(target, object);
    }
  }

  return (
    <div className="platform-object-page">
      <div className="platform-object-header">
        <div>
          <div className="platform-eyebrow">PLATFORM / OBJECTS</div>
          <h1>Objects</h1>
          <p>
            Define the business objects available to onePOS applications.
            Existing Retail POS objects can use their existing database
            tables and columns.
          </p>
        </div>

        <button
          type="button"
          className="platform-primary-button"
          onClick={() => navigate("new-object")}
        >
          <Plus size={16} aria-hidden="true" />
          New Object
        </button>
      </div>

      <div className="platform-toolbar">
        <div className="platform-search">
          <span className="platform-search-icon">⌕</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search objects..."
            aria-label="Search objects"
          />
        </div>

        <div className="platform-result-count">
          {loading
            ? "Loading..."
            : `${filteredObjects.length} object${
                filteredObjects.length === 1 ? "" : "s"
              }`}
        </div>
      </div>

      {error ? (
        <div className="platform-alert platform-alert-error">
          <strong>Unable to load objects.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="platform-object-card">
          <div className="platform-empty-state">Loading objects…</div>
        </div>
      ) : filteredObjects.length === 0 ? (
        <div className="platform-object-card">
          <div className="platform-empty-state">
            <div className="platform-empty-icon">□</div>
            <strong>
              {search ? "No matching objects" : "No objects configured"}
            </strong>
            <p>
              {search
                ? "Try a different search term."
                : "Create your first platform object to begin configuring the system."}
            </p>

            {!search ? (
              <button
                type="button"
                className="platform-secondary-button"
                onClick={() => navigate("new-object")}
              >
                Create Object
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="platform-object-card">
          <div className="platform-object-table-wrap">
            <table className="platform-object-table">
              <thead>
                <tr>
                  <th>Object</th>
                  <th>API Key</th>
                  <th>Module</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {filteredObjects.map((object) => {
                  const id =
                    object.id ||
                    object.object_id ||
                    object.object_key ||
                    object.key;

                  const active =
                    object.active !== false &&
                    object.is_active !== false &&
                    object.enabled !== false;

                  return (
                    <tr key={id}>
                      <td>
                        <button
                          type="button"
                          className="platform-object-name"
                          onClick={() => navigate("edit-object", object)}
                        >
                          <span className="platform-object-icon">□</span>
                          <span>
                            <strong>{getObjectName(object)}</strong>

                            {object.description ? (
                              <small>{object.description}</small>
                            ) : null}
                          </span>
                        </button>
                      </td>

                      <td>
                        <code>{getObjectKey(object)}</code>
                      </td>

                      <td>{getModuleName(object)}</td>

                      <td>
                        <span
                          className={
                            active
                              ? "platform-status-active"
                              : "platform-status-disabled"
                          }
                        >
                          {active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td>
                        <div className="platform-row-actions">
                          <button
                            type="button"
                            className="platform-row-button"
                            onClick={() => navigate("view-object", object)}
                            aria-label={`Open ${getObjectName(object)}`}
                          >
                            <ExternalLink size={14} aria-hidden="true" />
                            Open
                          </button>
                          <button
                            type="button"
                            className="platform-row-button"
                            onClick={() => navigate("edit-object", object)}
                            aria-label={`Configure ${getObjectName(object)}`}
                          >
                            <Settings2 size={14} aria-hidden="true" />
                            Configure
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .platform-object-page {
          padding: 24px;
          max-width: 1500px;
          margin: 0 auto;
          color: var(--text-primary, #1f2937);
        }

        .platform-object-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
          margin-bottom: 22px;
        }

        .platform-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          opacity: 0.6;
          margin-bottom: 6px;
        }

        .platform-object-header h1 {
          margin: 0;
          font-size: 30px;
          line-height: 1.2;
        }

        .platform-object-header p {
          margin: 8px 0 0;
          max-width: 800px;
          color: var(--text-secondary, #6b7280);
          line-height: 1.5;
          font-size: 13px;
        }

        .platform-primary-button,
        .platform-secondary-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border: 1px solid transparent;
          border-radius: 8px;
          padding: 10px 15px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }

        .platform-primary-button {
          background: var(--primary-color, #2563eb);
          color: #ffffff;
        }

        .platform-primary-button:hover {
          opacity: 0.92;
        }

        .platform-secondary-button {
          background: var(--card-background, #ffffff);
          border-color: var(--border-color, #d1d5db);
          color: var(--text-primary, #1f2937);
        }

        .platform-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 14px;
        }

        .platform-search {
          width: min(500px, 100%);
          height: 42px;
          display: flex;
          align-items: center;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 9px;
          background: var(--card-background, #ffffff);
          overflow: hidden;
        }

        .platform-search-icon {
          padding-left: 13px;
          font-size: 18px;
          opacity: 0.55;
        }

        .platform-search input {
          width: 100%;
          height: 100%;
          border: 0;
          outline: 0;
          padding: 0 12px 0 9px;
          background: transparent;
          color: inherit;
          font-size: 13px;
        }

        .platform-result-count {
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
          white-space: nowrap;
        }

        .platform-object-card {
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #ffffff);
          overflow: hidden;
        }

        .platform-object-table-wrap {
          overflow-x: auto;
        }

        .platform-object-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 760px;
        }

        .platform-object-table th {
          padding: 12px 16px;
          text-align: left;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--text-secondary, #6b7280);
          background: var(--muted-background, #f8fafc);
          border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .platform-object-table td {
          padding: 13px 16px;
          border-bottom: 1px solid var(--border-color, #f0f0f0);
          font-size: 13px;
          vertical-align: middle;
        }

        .platform-object-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .platform-object-table tbody tr:hover {
          background: var(--hover-background, #fafafa);
        }

        .platform-object-name {
          display: flex;
          align-items: center;
          gap: 10px;
          border: 0;
          background: transparent;
          padding: 0;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }

        .platform-object-name strong {
          display: block;
          font-size: 13px;
        }

        .platform-object-name small {
          display: block;
          margin-top: 3px;
          max-width: 420px;
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
          line-height: 1.4;
        }

        .platform-object-icon {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          border-radius: 7px;
          background: var(--muted-background, #f3f4f6);
          font-size: 14px;
        }

        .platform-object-table code {
          padding: 3px 6px;
          border-radius: 5px;
          background: var(--muted-background, #f3f4f6);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            monospace;
          font-size: 11px;
        }

        .platform-status-active,
        .platform-status-disabled {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 999px;
          background: var(--muted-background, #f3f4f6);
          font-size: 11px;
          font-weight: 600;
        }

        .platform-status-active {
          color: #166534;
        }

        .platform-status-disabled {
          color: #991b1b;
        }

        .platform-row-button {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 7px;
          padding: 7px 10px;
          background: var(--card-background, #ffffff);
          color: var(--primary-color, #2563eb);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }

        .platform-row-button:hover {
          background: var(--muted-background, #f8fafc);
        }

        .platform-row-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .platform-empty-state {
          padding: 60px 20px;
          text-align: center;
          color: var(--text-secondary, #6b7280);
          font-size: 13px;
        }

        .platform-empty-icon {
          width: 44px;
          height: 44px;
          margin: 0 auto 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          background: var(--muted-background, #f3f4f6);
          font-size: 20px;
          color: var(--text-secondary, #6b7280);
        }

        .platform-empty-state strong {
          display: block;
          color: var(--text-primary, #1f2937);
          margin-bottom: 5px;
        }

        .platform-empty-state p {
          max-width: 480px;
          margin: 0 auto 18px;
          line-height: 1.5;
        }

        .platform-alert {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 18px;
          padding: 14px 16px;
          border-radius: 9px;
          border: 1px solid #fecaca;
          background: #fff7f7;
          color: #991b1b;
          font-size: 13px;
        }

        @media (max-width: 700px) {
          .platform-object-page {
            padding: 16px;
          }

          .platform-object-header,
          .platform-toolbar {
            flex-direction: column;
            align-items: stretch;
          }

          .platform-primary-button {
            align-self: flex-start;
          }

          .platform-search {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
