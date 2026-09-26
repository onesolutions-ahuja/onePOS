import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { apiRequest, getActingCompanyId, setActingCompanyId } from "../../services/api.js";
import { buildAppPath } from "../../utils/adminRoutes.js";
import {
  PLATFORM_GROUPS,
  SURFACE_BY_KEY,
  SURFACE_KEY_BY_VIEW,
} from "./Platform/platformNav.js";
import ObjectList from "./Platform/ObjectList.jsx";
import ObjectEditor from "./Platform/ObjectEditor.jsx";
import RelationshipList from "./Platform/RelationshipList.jsx";
import RelationshipEditor from "./Platform/RelationshipEditor.jsx";
const LayoutList = lazy(() => import("./Platform/LayoutList.jsx"));
const LayoutEditor = lazy(() => import("./Platform/LayoutEditor.jsx"));
import FieldEditor from "./Platform/FieldEditor.jsx";
import RuleList from "./Platform/RuleList.jsx";
import RuleEditor from "./Platform/RuleEditor.jsx";
import ObjectPage from "./Platform/ObjectPage.jsx";
import ValueSetList from "./Platform/ValueSetList.jsx";
import PlatformStudio from "./Platform/PlatformStudio.jsx";
import WorkflowAdmin from "./Platform/WorkflowAdmin.jsx";
import WorkflowRunsAdmin from "./Platform/WorkflowRunsAdmin.jsx";
import InternalAppCatalog from "./Platform/InternalAppCatalog.jsx";
import PageBuilder from "./Platform/PageBuilder.jsx";
import CustomPageBuilder from "./Platform/CustomPageBuilder.jsx";
import VisualFlowBuilder from "./Platform/VisualFlowBuilder.jsx";
import LandingFlowBuilder from "./Platform/LandingFlowBuilder.jsx";
import ApprovalProcessBuilder from "./Platform/ApprovalProcessBuilder.jsx";

/*
 * GLOBAL PLATFORM NAVIGATION — one surface, one rail.
 *
 * Platform administration used to render a flat tab strip that competed with
 * the object configuration tabs. It is now a single grouped rail (described by
 * platformNav.js) that lists only global Platform surfaces; configuration of
 * ONE selected object is a different context entirely — the object's own tabs,
 * plus a breadcrumb back to Objects for its tool views — so the two never
 * appear together.
 *
 * Every entry is an existing, already-reachable surface. Nothing is listed
 * that does not exist, and nothing was made unreachable: the cross-object
 * metadata lists are grouped under "Across all objects" so they read as the
 * platform-wide lists rather than duplicates of the object tabs.
 */


const PLATFORM_CHROME_CSS = `
  /* Platform administration shell — layout only; every colour comes from the
     shared tokens so the rail follows the preset, appearance and accent. */

  .platform-surface {
    display: grid;
    grid-template-columns: minmax(210px, 250px) minmax(0, 1fr);
    align-items: start;
    gap: 18px;
    color: var(--text-primary);
    min-width: 0;
    width: 100%;
  }

  .platform-surface-body { min-width: 0; }
  .platform-surface > .psnav-banner { grid-column: 1 / -1; }

  .psnav {
    display: flex;
    flex-direction: column;
    gap: 12px;
    position: sticky;
    top: 12px;
    max-height: calc(100vh - 32px);
    padding: 14px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--onepos-radius, 12px);
    background: var(--onepos-surface-raised);
    box-shadow: var(--onepos-shadow-sm, none);
    overflow-y: auto;
    scrollbar-gutter: stable both-edges;
  }

  .psnav-rail {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .psnav-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }

  .psnav-group-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    padding: 0 8px;
    white-space: nowrap;
  }

  .psnav-group-items {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
  }

  .psnav-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 0;
    border-left: 3px solid transparent;
    border-radius: var(--onepos-radius-sm, 8px);
    background: transparent;
    padding: 8px 9px;
    color: var(--text-secondary);
    font: inherit;
    font-size: 12.5px;
    font-weight: 500;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }

  .psnav-item:hover {
    color: var(--primary-color);
    background-color: var(--muted-background);
  }

  .psnav-item:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }

  .psnav-item-active {
    color: var(--primary-color);
    font-weight: 600;
    border-left-color: var(--primary-color);
    background-color: var(--muted-background);
  }

  .psnav-search {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 0 2px 4px;
  }

  .psnav-search-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .psnav-search-input { width: 100%; }

  .psnav-empty {
    padding: 10px 8px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .psnav-compact { display: none; }

  .psnav-compact-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }

  .psnav-banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .platform-company-gate { display: flex; flex-direction: column; gap: 12px; width: min(100%, 720px); }
  .platform-company-gate-select { width: 100%; }

  .psnav-banner select {
    width: auto;
    min-width: 160px;
    height: calc(var(--onepos-control-height, 38px) - 10px);
    font-size: 13px;
  }

  .platform-back {
    align-self: flex-start;
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--text-secondary);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .platform-back:hover { color: var(--primary-color); }

  .platform-object-context {
    display: flex;
    flex-direction: column;
    gap: var(--onepos-section-gap, 16px);
  }

  .platform-object-crumb {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    color: var(--text-secondary);
    font-size: 12px;
  }

  .platform-object-crumb button {
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--primary-color);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .platform-object-crumb strong {
    color: var(--text-primary);
    font-weight: 600;
  }

  @media (max-width: 900px) {
    .platform-surface { grid-template-columns: 190px minmax(0, 1fr); }
    .psnav-item { font-size: 12px; }
  }

  @media (max-width: 639px) {
    .platform-surface { display: flex; flex-direction: column; }
    .psnav { position: static; width: 100%; max-height: none; }
    .psnav-rail { display: none; }
    .psnav-compact {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding-bottom: 8px;
    }
    .psnav-compact .onepos-input { width: 100%; }
  }
`;

/** The single global Platform navigation. Grouped, keyboard accessible, and
 *  collapsed to a labelled select on phone widths so it never overflows. */
function PlatformSectionNav({ activeKey, onSelect }) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = useMemo(
    () => PLATFORM_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => !normalizedQuery || item.label.toLowerCase().includes(normalizedQuery)),
    })).filter((group) => group.items.length > 0),
    [normalizedQuery],
  );

  return (
    <nav className="psnav" aria-label="Platform configuration">
      <label className="psnav-search">
        <span className="psnav-search-label">Quick Find</span>
        <input
          type="search"
          className="onepos-input psnav-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          /* Wording distinguishes this rail filter from Pane 2's "Search
             settings" (they sit side-by-side on the Platform tab). */
          placeholder="Search platform settings"
          aria-label="Filter platform navigation"
        />
      </label>
      <div className="psnav-rail">
        {visibleGroups.map((group) => (
          <div className="psnav-group" key={group.label}>
            <span className="psnav-group-label">{group.label}</span>

            <div className="psnav-group-items">
              {group.items.map((item) => {
                const active = activeKey === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
                    className={"psnav-item" + (active ? " psnav-item-active" : "")}
                    aria-current={active ? "page" : undefined}
                    onClick={() => onSelect(item)}
                    title={
                      group.openInApp
                        ? `${item.label} — opens the main application`
                        : item.label
                    }
                  >
                    {item.label}
                    {group.openInApp ? <ArrowUpRight size={12} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
            {!visibleGroups.length ? <div className="psnav-empty">No matching settings.</div> : null}
          </div>
        ))}
      </div>

      <label className="psnav-compact">
        <span className="psnav-compact-label">Platform section</span>
        <select
          className="onepos-input"
          aria-label="Platform section"
          value={activeKey || "objects"}
          onChange={(event) => {
            const item = SURFACE_BY_KEY[event.target.value];
            if (item) onSelect(item);
          }}
        >
          {PLATFORM_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}{group.openInApp ? " ↗" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <style>{PLATFORM_CHROME_CSS}</style>
    </nav>
  );
}

/*
 * Leaving Platform for a main-application page (Reports, Dashboards).
 *
 * The Admin shell already owns the URL contract (buildAppPath) and already
 * re-resolves the page from the address bar on popstate, so this is those two
 * existing mechanisms and nothing else — no second router, no new route.
 */
function openAdminPage(page) {
  if (typeof window === "undefined") return;

  const target = buildAppPath(page);
  if (window.location.pathname !== target) {
    window.history.pushState({}, "", target);
  }

  if (typeof window.PopStateEvent === "function") {
    window.dispatchEvent(new window.PopStateEvent("popstate"));
  }
}

export default function PlatformAdmin({ user, onMessage, onError }) {
  const [modules, setModules] = useState([]);
  const [view, setView] = useState("objects");
  const [selectedObject, setSelectedObject] = useState(null);
  const [selectedRelationship, setSelectedRelationship] = useState(null);
  const [selectedLayout, setSelectedLayout] = useState(null);
  const [layoutPageTypes, setLayoutPageTypes] = useState(["create", "edit", "quick_create"]);
  const [selectedRule, setSelectedRule] = useState(null);
  // Field editing from inside the Form Builder. Holding the field + the field
  // list here (rather than navigating away) keeps LayoutEditor MOUNTED, so any
  // unsaved builder work survives the round trip.
  const [editingField, setEditingField] = useState(null);
  const [fieldRefreshKey, setFieldRefreshKey] = useState(0);
  const isDeveloper = user?.isPlatformDeveloper === true;
  const [actingCompanyId, setActingCompanyIdState] = useState(getActingCompanyId());
  const [actingCompanies, setActingCompanies] = useState([]);

  useEffect(() => {
    if (isDeveloper) {
      apiRequest("/api/platform/developer/companies")
        .then((response) => setActingCompanies(response.data || []))
        .catch((error) => onError(error.message || "Unable to load authorised companies"));
    }
    apiRequest("/api/platform/modules")
      .then((response) => setModules(response.data || []))
      .catch((error) => onError(error.message || "Unable to load platform modules"));
  }, [isDeveloper]);

  const selectActingCompany = async (companyId) => {
    try {
      await apiRequest("/api/platform/developer/acting-company", { method: "PUT", body: JSON.stringify({ actingCompanyId: companyId }) });
      setActingCompanyId(companyId);
      setActingCompanyIdState(companyId);
      setView("objects");
    } catch (error) {
      onError(error.message || "Unable to select company");
    }
  };

  if (isDeveloper && !actingCompanyId) {
    return (
      <div className="onepos-card onepos-card-body platform-company-gate">
        <div className="onepos-alert onepos-alert-warning">
          <strong>Select a company</strong>
          <span>Choose an authorised company before editing tenant metadata.</span>
        </div>

        <select
          className="onepos-input platform-company-gate-select"
          value=""
          onChange={(event) => selectActingCompany(event.target.value)}
          aria-label="Acting company"
        >
          <option value="">Choose company…</option>
          {actingCompanies.map((company) => (
            <option key={company.id} value={company.id}>{company.name}</option>
          ))}
        </select>
      </div>
    );
  }

  const companyBanner = isDeveloper ? (
    <div className="onepos-alert onepos-alert-warning psnav-banner">
      <span>Acting company:</span>
      <select
        className="onepos-input"
        value={actingCompanyId}
        onChange={(event) => selectActingCompany(event.target.value)}
        aria-label="Acting company"
      >
        {actingCompanies.map((company) => (
          <option key={company.id} value={company.id}>{company.name}</option>
        ))}
      </select>
    </div>
  ) : null;

  /*
   * Global Platform surfaces render inside one frame: the developer company
   * context plus the grouped rail. The rail selects GLOBAL surfaces only, so
   * opening one clears the selected object — the cross-object lists then show
   * every object's metadata rather than silently staying scoped.
   */
  const platformFrame = (activeKey, content) => (
    <div className="platform-surface">
      {companyBanner}
      <PlatformSectionNav activeKey={activeKey} onSelect={openSurface} />
      <div className="platform-surface-body">{content}</div>
    </div>
  );

  /*
   * One selected object is a DIFFERENT context from global Platform config:
   * a breadcrumb back to Objects, and the object's own tabs (rendered by the
   * object screens). The global rail is deliberately not shown here, so the
   * two navigation systems never compete.
   */
  const objectLabel =
    selectedObject?.label ||
    selectedObject?.name ||
    selectedObject?.object_key ||
    "Object";

  /* Object-scope crumb: configured display label first — the technical key
     only appears when no label exists. */
  const objectCrumbLabel = selectedObject?.label || selectedObject?.name || "Object";

  const objectFrame = (content) => (
    <div className="platform-object-context">
      <div className="platform-object-crumb">
        <button type="button" onClick={() => setView("objects")}>Objects</button>
        <span aria-hidden="true">/</span>
        <strong>{objectCrumbLabel}</strong>
      </div>

      {content}
    </div>
  );

  function openSurface(item) {
    if (!item) return;

    if (item.page) {
      openAdminPage(item.page);
      return;
    }

    setSelectedObject(null);
    setSelectedRelationship(null);
    setSelectedLayout(null);
    setSelectedRule(null);
    setEditingField(null);
    setView(item.view);
  }

  const navigate = (target, object = null) => {
    if (target === "new-object") {
      setSelectedObject(null);
      setView("editor");
    } else if (target === "edit-object") {
      setSelectedObject(object);
      setView("editor");
    } else if (target === "view-object") {
      setSelectedObject(object);
      setView("object-page");
    } else if (target === "new-relationship" || target === "edit-relationship") {
      setSelectedRelationship(target === "edit-relationship" ? object : null);
      setView("relationships-editor");
    } else if (target === "relationships") {
      setView("relationships");
    } else if (target === "new-layout" || target === "edit-layout") {
      setSelectedLayout(target === "edit-layout" ? object : null);
      setEditingField(null);
      if (target === "new-layout" && object?.page_type) {
        setLayoutPageTypes([object.page_type]);
      }
      setView("layouts-editor");
    } else if (target === "layouts") {
      setLayoutPageTypes(["create", "edit", "quick_create"]);
      setView("layouts");
    } else if (target === "page-layouts") {
      setLayoutPageTypes(["list", "detail", "view"]);
      setView("layouts");
    } else if (target === "new-rule" || target === "edit-rule") {
      setSelectedRule(target === "edit-rule" ? object : null);
      setView("rules-editor");
    } else if (target === "rules") {
      setView("rules");
    } else if (target === "value-sets") {
      setView("value-sets");
    } else if (target === "studio") {
      setView("studio");
    } else if (target === "workflow") {
      setView("workflow");
    } else if (target === "app-catalog") {
      setView("app-catalog");
    } else {
      setView("objects");
    }
  };

  /* Object configuration + record page keep their own headers and tabs. */
  if (view === "editor") {
    return (
      <ObjectEditor
        object={selectedObject}
        modules={modules}
        onBack={() => setView("objects")}
        onNavigate={(target) => {
          if (target === "records") {
            setView("object-page");
          } else if (target === "relationships") {
            setView("relationships");
          } else if (target === "layouts") {
            setLayoutPageTypes(["create", "edit", "quick_create"]);
            setView("layouts");
          } else if (target === "page-layouts") {
            setLayoutPageTypes(["list", "detail", "view"]);
            setView("layouts");
          } else if (target === "rules") {
            setView("rules");
          }
        }}
        onSaved={(savedObject) => {
          if (savedObject?.id || savedObject?.object_id) {
            setSelectedObject(savedObject);
            setView("editor");
          } else {
            setView("objects");
          }

        }}
        onMessage={onMessage}
        onError={onError}
      />
    );
  }

  if (view === "object-page") {
    return (
      <ObjectPage
        objectKey={selectedObject?.object_key || selectedObject?.objectKey || selectedObject?.api_name}
        object={selectedObject}
        onBack={() => setView("editor")}
        onSelectRecord={(record, relatedObjectKey) => {
          if (relatedObjectKey) {
            setSelectedObject({ object_key: relatedObjectKey });
            setView("object-page");
          }
        }}
      />
    );
  }

  if (view === "relationships-editor") {
    return (
      <RelationshipEditor
        relationship={selectedRelationship}
        initialObjectId={selectedObject?.id || selectedObject?.object_id || ""}
        onCancel={() => setView("relationships")}
        onSave={() => {
          onMessage(selectedRelationship ? "Relationship updated." : "Relationship created.");
          setView("relationships");
        }}
      />
    );
  }

  if (view === "relationships") {
    const content = (
      <div className="space-y-4">
        <button
          type="button"
          className="platform-back"
          onClick={() => setView(selectedObject ? "editor" : "objects")}
        >
          ← {selectedObject ? "Object configuration" : "Platform objects"}
        </button>

        <RelationshipList
          objectId={selectedObject?.id || selectedObject?.object_id}
          onNavigate={navigate}
          onMessage={onMessage}
          onError={onError}
        />
      </div>
    );

    return selectedObject
      ? objectFrame(content)
      : platformFrame("all-relationships", content);
  }

  if (view === "layouts-editor") {
    const layoutObject = (field) => ({
      id: field?.object_id || selectedObject?.id || selectedObject?.object_id || selectedLayout?.object_id || "",
      name: selectedObject?.name || selectedObject?.label || selectedLayout?.object_key || "Object",
      label: selectedObject?.label || selectedLayout?.object_label || selectedObject?.name || "Object",
    });
    return (
      <>
        {companyBanner}
        <div hidden={Boolean(editingField)}>
          <Suspense fallback={<div className="onepos-empty"><span>Loading form builder…</span></div>}>
            <LayoutEditor
              layout={selectedLayout}
              initialObjectId={selectedObject?.id || selectedObject?.object_id || ""}
              initialPageType={layoutPageTypes[0]}
              onCancel={() => setView("layouts")}
              onSave={() => { onMessage(selectedLayout ? "Form updated." : "Form created."); setView("layouts"); }}
              fieldRefreshKey={fieldRefreshKey}
              onEditField={(field, fieldList) => {
                // The field UUID is the identity. A stale field with no metadata
                // row has nothing to edit, so the action stays inert.
                if (!field?.id && !field?.field_id) return;
                setEditingField({ field, fields: Array.isArray(fieldList) ? fieldList : [] });
              }}
            />
          </Suspense>
        </div>
        {editingField ? (
          <FieldEditor
            object={layoutObject(editingField.field)}
            field={{
              ...editingField.field,
              apiName: editingField.field.api_name,
              sourceColumn: editingField.field.source_column,
            }}
            fields={editingField.fields}
            onCancel={() => setEditingField(null)}
            onSave={() => {
              setEditingField(null);
              setFieldRefreshKey((key) => key + 1);
              onMessage("Field saved successfully.");
            }}
          />
        ) : null}
      </>
    );
  }

  if (view === "layouts") {
    const list = (
      <Suspense fallback={<div className="onepos-empty"><span>Loading forms…</span></div>}>
        <LayoutList
          objectId={selectedObject?.id || selectedObject?.object_id}
          pageTypes={layoutPageTypes}
          title={layoutPageTypes.includes("detail") ? "Record Pages" : "Forms"}
          onNew={() => navigate("new-layout")}
          onEdit={(layout) => navigate("edit-layout", layout)}
          onMessage={onMessage}
          onError={onError}
          onBack={() => setView(selectedObject ? "editor" : "objects")}
        />
      </Suspense>
    );

    return selectedObject ? objectFrame(list) : platformFrame("all-forms", list);
  }

  if (view === "rules-editor") {
    return <RuleEditor rule={selectedRule} initialObjectId={selectedObject?.id || selectedObject?.object_id || ""} onCancel={() => setView("rules")} onSave={() => { onMessage(selectedRule ? "Rule updated." : "Rule created."); setView("rules"); }} />;
  }

  if (view === "rules") {
    const list = (
      <RuleList
        objectId={selectedObject?.id || selectedObject?.object_id}
        onNew={() => navigate("new-rule")}
        onEdit={(rule) => navigate("edit-rule", rule)}
        onBack={() => setView(selectedObject ? "editor" : "objects")}
      />
    );

    return selectedObject ? objectFrame(list) : platformFrame("all-rules", list);
  }

  if (view === "value-sets") {
    return platformFrame(
      "value-sets",
      <ValueSetList onBack={() => setView("objects")} onMessage={onMessage} onError={onError} />,
    );
  }

  if (view === "studio") {
    return platformFrame(
      "studio",
      <PlatformStudio onMessage={onMessage} onError={onError} />,
    );
  }

  if (view === "page-builder") {
    return platformFrame("page-builder", <PageBuilder onMessage={onMessage} onError={onError} />);
  }

  /*
   * VISUAL CUSTOM PAGE BUILDER — a full-workspace surface.
   * The grouped rail is deliberately NOT rendered here: the builder is a
   * three-pane WYSIWYG tool (palette / live canvas / properties) and the rail
   * would steal workspace from the canvas. One custom header gives the only
   * way out (back to Platform), keeping the shell single-surface.
   */
  if (view === "custom-page-builder") {
    return (
      <div className="platform-surface-body min-w-0 flex-1">
        <div className="mb-3 flex items-center gap-2">
          <button type="button" className="platform-back" onClick={() => setView("objects")}>← Platform</button>
          <h2 className="text-xl font-semibold">Custom Page Builder</h2>
        </div>
        <CustomPageBuilder onMessage={onMessage} onError={onError} />
      </div>
    );
  }

  if (view === "flow-builder") {
    return platformFrame("flow-builder", <VisualFlowBuilder onMessage={onMessage} onError={onError} />);
  }

  if (view === "landing-flow") {
    return platformFrame("landing-flow", <LandingFlowBuilder onMessage={onMessage} onError={onError} />);
  }

  if (view === "approval-builder") {
    return platformFrame("approval-builder", <ApprovalProcessBuilder onMessage={onMessage} onError={onError} />);
  }

  if (view === "workflow") {
    return platformFrame(
      "automation",
      <WorkflowAdmin onMessage={onMessage} onError={onError} />,
    );
  }

  if (view === "workflow-runs") {
    return platformFrame(
      "workflow-runs",
      <WorkflowRunsAdmin onMessage={onMessage} onError={onError} />,
    );
  }

  if (view === "app-catalog") {
    return platformFrame(
      "app-catalog",
      <InternalAppCatalog onMessage={onMessage} onError={onError} onBack={() => setView("objects")} />,
    );
  }

  return platformFrame(
    SURFACE_KEY_BY_VIEW.objects,
    <ObjectList onNavigate={navigate} />,
  );
}
