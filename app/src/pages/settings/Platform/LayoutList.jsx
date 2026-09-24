import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../services/api.js";

/* Form (layout) list for one object.
 *
 * Presentation only: every handler below is the existing behaviour — the same
 * endpoints, the same conditions on Set default / Deactivate / Clone — so this
 * page still opens the existing LayoutEditor through its host.
 *
 * Purpose labels are humanised for display ("detail" → "View Details"). The
 * stored page_type is never rewritten. */

const PURPOSE_ORDER = ["create", "edit", "detail", "view", "quick_create", "list"];

const PURPOSE_LABELS = {
  create: "Create",
  edit: "Edit",
  detail: "View Details",
  view: "View Details",
  quick_create: "Quick Create",
  list: "List",
};

function rawPurpose(layout) {
  return layout.page_type || layout.pageType || "detail";
}

function purposeLabel(layout) {
  const raw = rawPurpose(layout);
  return PURPOSE_LABELS[raw] || raw;
}

export default function LayoutList({ onNew, onEdit, onMessage, onError, onBack, objectId = null }) {
  const [layouts, setLayouts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [purposeFilter, setPurposeFilter] = useState("all");

  const load = async () => {
    try {
      setLoading(true);
      const response = await apiRequest("/api/platform/layouts?includeInactive=true");
      const loaded = response.data || [];
      setLayouts(objectId
        ? loaded.filter((layout) => String(layout.object_id) === String(objectId))
        : loaded);
    } catch (error) {
      onError(error.message || "Unable to load layouts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [objectId]);

  const deactivate = async (layout) => {
    try {
      await apiRequest(`/api/platform/layouts/${layout.id}`, { method: "DELETE" });
      onMessage("Layout deactivated.");
      await load();
    } catch (error) {
      onError(error.message || "Unable to deactivate layout");
    }
  };

  const clone = async (layout) => {
    try {
      await apiRequest(`/api/platform/layouts/${layout.id}/clone`, {
        method: "POST",
        body: JSON.stringify({ name: `${layout.name || layout.layout_key} Copy` }),
      });
      onMessage("Layout cloned.");
      await load();
    } catch (error) {
      onError(error.message || "Unable to clone layout");
    }
  };

  const setDefault = async (layout) => {
    try {
      await apiRequest(`/api/platform/layouts/${layout.id}/default`, { method: "POST" });
      onMessage("Default layout updated.");
      await load();
    } catch (error) {
      onError(error.message || "Unable to set default layout");
    }
  };

  const activate = async (layout) => {
    try {
      await apiRequest(`/api/platform/layouts/${layout.id}/activate`, { method: "POST" });
      onMessage("Layout activated.");
      await load();
    } catch (error) {
      onError(error.message || "Unable to activate layout");
    }
  };

  /* Display order only — the four standard pages first, then anything else the
     tenant has configured, so Create/Edit/View Details/Quick Create read as a
     set. Nothing is filtered out of the data. */
  const visibleLayouts = useMemo(() => {
    const rank = (layout) => {
      const index = PURPOSE_ORDER.indexOf(rawPurpose(layout));
      return index === -1 ? PURPOSE_ORDER.length : index;
    };

    return layouts
      .filter((layout) => purposeFilter === "all" || purposeLabel(layout) === purposeFilter)
      .slice()
      .sort((a, b) => {
        const byPurpose = rank(a) - rank(b);
        if (byPurpose !== 0) return byPurpose;
        return String(a.name || a.layout_key || "").localeCompare(String(b.name || b.layout_key || ""));
      });
  }, [layouts, purposeFilter]);

  const purposes = useMemo(() => {
    const present = new Set(layouts.map((layout) => purposeLabel(layout)));
    return PURPOSE_ORDER
      .map((key) => PURPOSE_LABELS[key])
      .filter((label, index, all) => present.has(label) && all.indexOf(label) === index);
  }, [layouts]);

  return (
    <div className="platform-layout-list">
      <div className="onepos-page-header">
        <div>
          <h1 className="onepos-page-title">{objectId ? "Forms" : "Layouts"}</h1>
          <p className="onepos-page-subtitle">
            {objectId
              ? "Create, Edit, View Details and Quick Create forms for this object."
              : "Configure metadata-driven page layouts."}
          </p>
        </div>

        <div className="onepos-page-header-actions">
          <button
            type="button"
            onClick={onNew}
            className="onepos-btn onepos-btn-sm onepos-btn-primary"
          >
            + New Form
          </button>
        </div>
      </div>

      <div className="onepos-card">
        <div className="onepos-toolbar ll-toolbar">
          {purposes.length > 1 ? (
            <label className="ll-filter">
              <span className="ll-filter-label">Purpose</span>
              <select
                className="onepos-input ll-filter-select"
                value={purposeFilter}
                onChange={(event) => setPurposeFilter(event.target.value)}
                aria-label="Filter forms by purpose"
              >
                <option value="all">All purposes</option>
                {purposes.map((purpose) => (
                  <option key={purpose} value={purpose}>{purpose}</option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="ll-count" role="status">
            {loading
              ? "Loading…"
              : `${visibleLayouts.length} form${visibleLayouts.length === 1 ? "" : "s"}`}
          </div>
        </div>

        {loading ? (
          <div className="onepos-empty">
            <span>Loading layouts…</span>
          </div>
        ) : visibleLayouts.length === 0 ? (
          <div className="onepos-empty">
            <span className="onepos-empty-title">
              {layouts.length === 0 ? "No layouts configured." : "No forms for this purpose."}
            </span>
            <span className="ll-empty-hint">
              {layouts.length === 0
                ? "Create a form to control how this object is displayed."
                : "Choose a different purpose filter."}
            </span>
          </div>
        ) : (
          <div className="ll-table-wrap">
            <table className="onepos-table ll-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Purpose</th>
                  <th className="ll-col-role">Role</th>
                  <th className="ll-col-company">Company</th>
                  <th>Status</th>
                  <th className="ll-col-actions" />
                </tr>
              </thead>

              <tbody>
                {visibleLayouts.map((layout) => {
                  const active = layout.active !== false;
                  const name = layout.name || layout.label || layout.layout_key;

                  return (
                    <tr key={layout.id}>
                      <td>
                        <button
                          type="button"
                          className="ll-name"
                          onClick={() => onEdit(layout)}
                        >
                          <strong>{name}</strong>

                          {layout.is_default ? (
                            <span className="onepos-badge onepos-badge-success">Default</span>
                          ) : null}
                        </button>
                      </td>

                      <td>{purposeLabel(layout)}</td>

                      <td className="ll-col-role">
                        {layout.role_name || layout.role_id || "All roles"}
                      </td>

                      <td className="ll-col-company">
                        {layout.company_name || layout.company_id || "Global"}
                      </td>

                      <td>
                        <span
                          className={
                            "onepos-badge "
                            + (active ? "onepos-badge-success" : "onepos-badge-warning")
                          }
                        >
                          {active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td className="ll-col-actions">
                        <div className="ll-row-actions">
                          <button
                            type="button"
                            onClick={() => onEdit(layout)}
                            className="onepos-btn onepos-btn-sm onepos-btn-secondary"
                          >
                            Edit
                          </button>

                          {active ? (
                            <>
                              <button
                                type="button"
                                onClick={() => clone(layout)}
                                className="onepos-btn onepos-btn-sm onepos-btn-secondary"
                              >
                                Clone
                              </button>

                              {!layout.role_id && !layout.is_default ? (
                                <button
                                  type="button"
                                  onClick={() => setDefault(layout)}
                                  className="onepos-btn onepos-btn-sm onepos-btn-secondary"
                                >
                                  Set default
                                </button>
                              ) : null}

                              <button
                                type="button"
                                onClick={() => deactivate(layout)}
                                className="onepos-btn onepos-btn-sm onepos-btn-secondary ll-danger"
                              >
                                Deactivate
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => activate(layout)}
                              className="onepos-btn onepos-btn-sm onepos-btn-secondary"
                            >
                              Activate
                            </button>
                          )}
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

      {onBack ? (
        <button type="button" onClick={onBack} className="ll-back">
          ← {objectId ? "Object configuration" : "Platform"}
        </button>
      ) : null}

      <style>{`
        .platform-layout-list { display: flex; flex-direction: column; gap: var(--onepos-section-gap, 16px); }

        .ll-toolbar { gap: 8px; }

        .ll-filter {
          display: flex;
          align-items: center;
          gap: 6px;
          flex: 0 0 auto;
        }

        .ll-filter-label {
          color: var(--text-secondary);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .ll-filter-select {
          width: auto;
          min-width: 148px;
          height: calc(var(--onepos-control-height, 38px) - 8px);
          font-size: 13px;
        }

        .ll-count {
          margin-left: auto;
          color: var(--text-secondary);
          font-size: 12px;
          white-space: nowrap;
        }

        .ll-empty-hint { margin-top: 4px; font-size: 12.5px; }

        .ll-table-wrap { overflow-x: auto; }
        .ll-table { min-width: 720px; }
        .ll-table td { vertical-align: middle; }

        .ll-name {
          display: flex;
          align-items: center;
          gap: 8px;
          border: 0;
          background: transparent;
          padding: 0;
          color: var(--text-primary);
          text-align: left;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .ll-col-actions { text-align: right; }

        .ll-row-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 6px;
          flex-wrap: wrap;
        }

        .ll-danger { color: var(--text-secondary); }

        .ll-back {
          align-self: flex-start;
          border: 0;
          background: transparent;
          padding: 0;
          color: var(--text-secondary);
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
        }

        .ll-back:hover { color: var(--primary-color); }

        @media (max-width: 1024px) {
          .ll-col-company { display: none; }
        }

        @media (max-width: 760px) {
          .ll-col-role { display: none; }
          .ll-table { min-width: 0; }
          .ll-toolbar { flex-direction: column; align-items: stretch; }
          .ll-count { margin-left: 0; }
        }
      `}</style>
    </div>
  );
}
