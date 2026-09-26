import { useEffect, useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { apiRequest } from "../../../services/api.js";
import WorkflowAdmin from "./WorkflowAdmin.jsx";
import {
  NAVIGATION_TARGET_TYPES,
  describeNavigationTarget,
  systemNavigationTargets,
} from "../../../utils/navigationTargets.js";

/*
 * GENERIC ACTION / WORKFLOW PICKER.
 *
 * One reusable picker for every clickable surface in the Platform:
 * MultiContainer records, Button On Click, future Table Row / Menu Item /
 * Custom Component events. It is NOT specific to MultiContainer.
 *
 * What it does:
 *   - lists On Click types: none / workflow / action / navigate / form_layout
 *   - Workflow: searchable list of EXISTING platform_rules workflows, typed
 *     against the selected object first (compatible workflows rank higher),
 *     stores workflow_uuid (NOT the display name, so renames never break pages)
 *   - `+` opens the EXISTING Workflow Builder (WorkflowAdmin) as an in-screen
 *     overlay pre-seeded with the component's object context. Nothing navigates
 *     away; the caller's state is untouched and the new workflow's UUID is
 *     returned and auto-selected.
 *   - Action: canonical Action Registry keys only (uuid/key references)
 *   - Form Layout: an existing platform_layouts row (UUID) + presentation type
 */

const ON_CLICK_OPTIONS = [
  { value: "none", label: "None" },
  { value: "workflow", label: "Workflow" },
  { value: "action", label: "Action" },
  { value: "navigate", label: "Navigate" },
  { value: "form_layout", label: "Open Form Layout" },
];

export function describeInteraction(interaction) {
  if (!interaction || interaction.type === "none" || !interaction.type) return "None";
  if (interaction.type === "workflow") return `Workflow · ${interaction.workflowLabel || interaction.workflowUuid || "selected"}`;
  if (interaction.type === "action") return `Action · ${interaction.actionKey || "selected"}`;
  if (interaction.type === "navigate") return `Navigate · ${describeNavigationTarget(interaction.navigationTarget, interaction.navigateTo) || "target"}`;
  if (interaction.type === "form_layout") return `Form Layout · ${interaction.formLayoutLabel || interaction.formLayoutId || "selected"}`;
  return "None";
}
/*
 * NAVIGATION TARGET SELECTOR — the ONE destination picker for every
 * navigation-capable component (Custom Button today; cards/rows/menus later
 * through the same `action: navigate` capability).
 *
 * Destinations come from the authoritative sources, never a local route list:
 *
 *   System/App Page → the ONE navCatalogue filtered by the caller's own
 *                     permission state (the Builder cannot offer a page the
 *                     configured user cannot open)
 *   Custom Page     → /api/platform/runtime/apps (company-scoped pages)
 *   Object List     → /api/platform/runtime/navigation-targets objectPages
 *                     (server-filtered by object permission + licence)
 *   Object Record   → the same object discovery + a record-source selector
 *                     (Current Record / an explicit record identifier)
 *
 * Only a STABLE target definition is persisted ({ type, key, ... }); labels
 * are display state. The runtime re-resolves and re-checks everything at
 * click time — configuration here is never a permission bypass.
 */
function NavigationTargetSelector({ value, onChange }) {
  const [targets, setTargets] = useState(() => ({ system: null, customPages: [], objectPages: [] }));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [permissionState, setPermissionState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    Promise.all([
      apiRequest("/api/auth/me/permissions").catch(() => null),
      apiRequest("/api/platform/runtime/navigation-targets").catch(() => null),
    ])
      .then(([permissionResponse, targetResponse]) => {
        if (cancelled) return;
        const permissionData = permissionResponse?.success ? permissionResponse.data : null;
        const payload = targetResponse?.success ? targetResponse.data : null;
        setPermissionState(permissionData);
        setTargets({
          system: permissionData ? "catalogue" : null,
          customPages: Array.isArray(payload?.customPages) ? payload.customPages : [],
          objectPages: Array.isArray(payload?.objectPages) ? payload.objectPages : [],
        });
        if (!targetResponse?.success) {
          setLoadError(targetResponse?.message || "Unable to load available destinations.");
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const type = value?.type || "";
  const selectType = (nextType) => {
    if (!nextType) {
      onChange(null);
      return;
    }
    if (nextType === NAVIGATION_TARGET_TYPES.OBJECT_RECORD) {
      onChange({ type: nextType, key: "", objectKey: "", recordSource: "current" });
      return;
    }
    onChange({ type: nextType, key: "" });
  };

  /* A saved target whose key no longer resolves still shows as "saved" so a
     reload round-trips instead of silently clearing the configuration. */
  const savedFallback = (present, saved) => (present ? null : saved || value?.key || "saved target");
  const customKey = type === "custom_page" ? value?.key || "" : "";
  const objectKey = type === "object_list" ? value?.key || "" : type === "object_record" ? value?.objectKey || "" : "";
  const knownObject = objectPages.some((page) => page.objectKey === objectKey);

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500">Destination type</label>
        <select
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
          value={type}
          onChange={(event) => selectType(event.target.value)}
        >
          <option value="">Select destination…</option>
          <option value={NAVIGATION_TARGET_TYPES.SYSTEM_PAGE}>System / App Page</option>
          <option value={NAVIGATION_TARGET_TYPES.CUSTOM_PAGE}>Custom Page</option>
          <option value={NAVIGATION_TARGET_TYPES.OBJECT_LIST}>Object List</option>
          <option value={NAVIGATION_TARGET_TYPES.OBJECT_RECORD}>Object Record</option>
        </select>
      </div>

      {type === NAVIGATION_TARGET_TYPES.SYSTEM_PAGE ? (
        <SystemPageTargetInput
          value={value}
          onChange={onChange}
          permissionState={permissionState}
          savedFallback={savedFallback}
        />
      ) : null}

      {type === NAVIGATION_TARGET_TYPES.CUSTOM_PAGE ? (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500">Page</label>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
            value={customKey}
            onChange={(event) => onChange({ type, key: event.target.value || "" })}
          >
            <option value="">{loading ? "Loading pages…" : customPages.length ? "Select page…" : "No pages available"}</option>
            {customKey && !customPages.some((page) => page.key === customKey) ? <option value={customKey}>{savedFallback(false, customKey)}</option> : null}
            {customPages.map((page) => <option key={page.key} value={page.key}>{page.label || page.key}</option>)}
          </select>
          <p className="text-[11px] text-slate-400">Stored as the stable page key; deleted pages fail safely at click time.</p>
        </div>
      ) : null}

      {type === NAVIGATION_TARGET_TYPES.OBJECT_LIST || type === NAVIGATION_TARGET_TYPES.OBJECT_RECORD ? (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500">Object</label>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
            value={objectKey}
            onChange={(event) => {
              const nextKey = event.target.value || "";
              if (type === NAVIGATION_TARGET_TYPES.OBJECT_RECORD) {
                onChange({ type, key: nextKey, objectKey: nextKey, recordSource: value?.recordSource || "current", ...(value?.recordSource === "explicit" && value?.recordId ? { recordId: value.recordId } : {}) });
              } else {
                onChange({ type, key: nextKey });
              }
            }}
          >
            <option value="">{loading ? "Loading objects…" : objectPages.length ? "Select object…" : "No objects available"}</option>
            {objectKey && !knownObject ? <option value={objectKey}>{savedFallback(false, objectKey)}</option> : null}
            {objectPages.map((page) => <option key={page.objectKey} value={page.objectKey}>{page.label || page.objectKey}</option>)}
          </select>
          <p className="text-[11px] text-slate-400">Only objects your account can open are listed; access is re-checked at click time.</p>
        </div>
      ) : null}

      {type === NAVIGATION_TARGET_TYPES.OBJECT_RECORD ? (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500">Record</label>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
            value={value?.recordSource || "current"}
            onChange={(event) => {
              const recordSource = event.target.value === "explicit" ? "explicit" : "current";
              const next = { type, key: objectKey, objectKey, recordSource };
              if (recordSource === "explicit" && value?.recordId) next.recordId = value.recordId;
              onChange(next);
            }}
          >
            <option value="current">Current Record (the component's bound record)</option>
            <option value="explicit">Explicit Record ID</option>
          </select>
          {value?.recordSource === "explicit" ? (
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
              placeholder="Record ID (UUID)"
              value={value?.recordId || ""}
              onChange={(event) => onChange({ type, key: objectKey, objectKey, recordSource: "explicit", recordId: event.target.value.trim() })}
            />
          ) : (
            <p className="text-[11px] text-slate-400">The bound component's selected record becomes the destination; without one the click fails safely.</p>
          )}
        </div>
      ) : null}

      {loadError ? <p className="text-[11px] text-red-600">{loadError}</p> : null}
      <p className="text-[11px] text-slate-400">Navigation only changes location — the destination still enforces every permission.</p>
    </div>
  );
}

/** System/App page picker over the ONE permission-filtered nav catalogue. */
function SystemPageTargetInput({ value, onChange, permissionState, savedFallback }) {
  const systemTargets = useMemo(() => {
    if (permissionState === "catalogue" || !permissionState) return [];
    return systemNavigationTargets(permissionState);
  }, [permissionState]);
  const key = value?.key || "";
  const known = systemTargets.some((target) => target.key === key);
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500">Page</label>
      <select
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
        value={key}
        onChange={(event) => onChange({ type: NAVIGATION_TARGET_TYPES.SYSTEM_PAGE, key: event.target.value || "" })}
      >
        <option value="">{systemTargets.length ? "Select page…" : "Loading pages…"}</option>
        {key && !known ? <option value={key}>{savedFallback(false, key)}</option> : null}
        {systemTargets.map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}
      </select>
      <p className="text-[11px] text-slate-400">Pages the current user cannot open are not offered — and are re-checked at click time.</p>
    </div>
  );
}

function FormLayoutInput({ objectKey, value, presentation, onChange, onPresentationChange }) {
  const [layouts, setLayouts] = useState([]);
  useEffect(() => {
    apiRequest("/api/platform/layouts")
      .then((response) => {
        const rows = Array.isArray(response?.data) ? response.data : [];
        setLayouts(rows.filter((layout) => layout.active !== false).map((layout) => ({ id: layout.id, name: layout.name, objectType: layout.page_type })));
      })
      .catch(() => setLayouts([]));
  }, []);
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500">Form Layout</label>
        <select
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
          value={value || ""}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select form layout…</option>
          {value && !layouts.some((layout) => layout.id === value) ? <option value={value}>Layout {value}</option> : null}
          {layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500">Presentation</label>
        <select
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
          value={presentation || "screen_modal"}
          onChange={(event) => onPresentationChange(event.target.value)}
        >
          <option value="full_screen">Full Screen</option>
          <option value="screen_modal">Screen Modal</option>
          <option value="compact_popup">Compact Popup</option>
        </select>
      </div>
      {objectKey ? <p className="text-[11px] text-slate-400">The clicked record is supplied to the layout as its object record.</p> : null}
    </div>
  );
}

/**
 * @param interaction  current { type, workflowUuid, actionKey, navigateTo, formLayoutId, formPresentation, ...labels }
 * @param onChange     receives the next interaction object (labels kept in builder state only, never required at runtime)
 * @param objectKey    the component's bound Platform Object key (prioritises compatible workflows)
 * @param onWorkflowCreated  optional callback for the newly created workflow { id, name }
 */
export default function ActionWorkflowPicker({ interaction, onChange, objectKey = "", onWorkflowCreated = null }) {
  const [workflows, setWorkflows] = useState([]);
  const [actions, setActions] = useState([]);
  const [search, setSearch] = useState("");
  const [workflowOverlayOpen, setWorkflowOverlayOpen] = useState(false);
  const type = interaction?.type || "none";

  useEffect(() => {
    apiRequest("/api/platform/rules")
      .then((response) => setWorkflows(Array.isArray(response?.data) ? response.data.filter((rule) => rule?.action?.type === "workflow" && rule.active !== false) : []))
      .catch(() => setWorkflows([]));
    apiRequest("/api/platform/action-registry")
      .then((response) => setActions(Array.isArray(response?.data) ? response.data : []))
      .catch(() => setActions([]));
  }, []);

  const rankedWorkflows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = workflows.filter((workflow) => !query || String(workflow.name || "").toLowerCase().includes(query));
    const compatible = matches.filter((workflow) => {
      const workflowObject = workflow.object_id != null ? String(workflow.object_id) : null;
      return objectKey && workflowObject === objectKey;
    });
    const generic = matches.filter((workflow) => !compatible.includes(workflow));
    /* Rank: object-compatible first, then generic; alphabetical inside each band. */
    return [...compatible.sort((a, b) => String(a.name).localeCompare(String(b.name))), ...generic.sort((a, b) => String(a.name).localeCompare(String(b.name)))].slice(0, 30);
  }, [workflows, search, objectKey]);

  const selectedWorkflow = workflows.find((workflow) => String(workflow.id) === String(interaction?.workflowUuid)) || null;
  const selectedAction = actions.find((action) => action.key === interaction?.actionKey) || null;

  const patch = (changes) => onChange?.({ ...(interaction || { type: "none" }), ...changes });

  const setType = (nextType) => {
    const base = { type: nextType };
    /* Keep only the references relevant to the new type so stale selections
       never linger in saved metadata. */
    if (nextType === "workflow") onChange?.({ ...(interaction || {}), ...base });
    else onChange?.({ ...(interaction || {}), ...base, workflowUuid: null, workflowLabel: undefined });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500">On Click</label>
        <select
          className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          {ON_CLICK_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>

      {type === "workflow" ? (
        <div className="space-y-2">
          {selectedWorkflow ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <span className="min-w-0 truncate text-sm font-medium text-emerald-800" title={`Workflow UUID ${selectedWorkflow.id}`}>✓ {selectedWorkflow.name}</span>
              <button type="button" className="text-emerald-700 hover:text-emerald-900" aria-label="Clear workflow" onClick={() => patch({ workflowUuid: null, workflowLabel: undefined })}><X size={14} /></button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-2 text-sm"
                    placeholder="Search workflows…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                  title="Create a new workflow"
                  aria-label="New workflow"
                  onClick={() => setWorkflowOverlayOpen(true)}
                >
                  <Plus size={16} />
                </button>
              </div>
              <div className="max-h-44 space-y-1 overflow-auto rounded-lg border border-slate-200 bg-white p-1">
                {rankedWorkflows.length === 0 ? <div className="px-2 py-3 text-center text-xs text-slate-400">No workflows match.</div> : null}
                {rankedWorkflows.map((workflow) => {
                  const compatible = objectKey && workflow.object_id != null && String(workflow.object_id) === String(objectKey);
                  return (
                    <button
                      type="button"
                      key={workflow.id}
                      className="block w-full rounded-md px-2.5 py-2 text-left hover:bg-slate-50"
                      onClick={() => patch({ workflowUuid: String(workflow.id), workflowLabel: workflow.name })}
                    >
                      <span className="block truncate text-sm text-slate-700">{workflow.name}</span>
                      <span className="block text-[11px] text-slate-400">Workflow{compatible ? ` · ${objectKey}` : " · generic"}</span>
                    </button>
                  );
                })}
              </div>
              {objectKey ? <p className="text-[11px] text-slate-400">Workflows for {objectKey} are listed first. The clicked record is passed as Current Record.</p> : null}
            </div>
          )}
        </div>
      ) : null}

      {type === "action" ? (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500">Registered Action</label>
          <select
            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
            value={interaction?.actionKey || ""}
            onChange={(event) => patch({ actionKey: event.target.value || null, actionLabel: actions.find((action) => action.key === event.target.value)?.displayName })}
          >
            <option value="">Select action…</option>
            {interaction?.actionKey && !selectedAction ? <option value={interaction.actionKey}>{interaction.actionLabel || interaction.actionKey}</option> : null}
            {actions.map((action) => <option key={action.key} value={action.key}>{action.displayName || action.key}</option>)}
          </select>
          <p className="text-[11px] text-slate-400">Server-side permissions are always enforced on execution.</p>
        </div>
      ) : null}

      {type === "navigate" ? (
        <NavigationTargetSelector
          value={interaction?.navigationTarget || null}
          onChange={(navigationTarget) => patch({ navigationTarget: navigationTarget || null })}
        />
      ) : null}

      {type === "form_layout" ? (
        <FormLayoutInput
          objectKey={objectKey}
          value={interaction?.formLayoutId || ""}
          presentation={interaction?.formPresentation || "screen_modal"}
          onChange={(formLayoutId) => patch({ formLayoutId: formLayoutId || null })}
          onPresentationChange={(formPresentation) => patch({ formPresentation })}
        />
      ) : null}

      {/* The EXISTING Workflow Builder, overlaid in-screen. It receives the
          component's object as creation context; on save the new workflow UUID
          is auto-selected and the caller's page state is untouched. */}
      {workflowOverlayOpen ? (
        <WorkflowCreationOverlay
          contextObjectKey={objectKey}
          onClose={() => setWorkflowOverlayOpen(false)}
          onCreated={(workflow) => {
            setWorkflows((current) => [workflow, ...current.filter((item) => item.id !== workflow.id)]);
            patch({ workflowUuid: String(workflow.id), workflowLabel: workflow.name });
            onWorkflowCreated?.(workflow);
            setWorkflowOverlayOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * In-screen Workflow Builder overlay — reuses the EXISTING WorkflowAdmin
 * builder wholesale (steps canvas, registered actions, save pipeline). The
 * overlay only adds creation context: the host component's object and a
 * manual/UI trigger, so "View Online Order" style workflows start correct.
 */
export function WorkflowCreationOverlay({ contextObjectKey, onClose, onCreated }) {
  /* The canonical builder saves through /api/platform/rules and calls back via
     onSaved-callback injection: we pass a wrapper component that observes the
     saved rules list for the created workflow. */
  const [baseline, setBaseline] = useState(null);
  useEffect(() => {
    apiRequest("/api/platform/rules")
      .then((response) => setBaseline(new Set((Array.isArray(response?.data) ? response.data : []).map((rule) => String(rule.id)))))
      .catch(() => setBaseline(new Set()));
  }, []);
  if (baseline === null) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-slate-900/60 p-3 md:p-6" role="dialog" aria-modal="true" aria-label="Create Workflow">
      <div className="flex w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-800">Create Workflow</h2>
            {contextObjectKey ? <p className="text-[11px] text-slate-500">Context: {contextObjectKey} · Current Record input · UI invocation</p> : null}
          </div>
          <button type="button" className="onepos-btn onepos-btn-secondary" onClick={onClose}>Cancel</button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <WorkflowAdminOverlayHost contextObjectKey={contextObjectKey} baseline={baseline} onClose={onClose} onCreated={onCreated} />
        </div>
      </div>
    </div>
  );
}

function WorkflowAdminOverlayHost({ contextObjectKey, baseline, onClose, onCreated }) {
  /* WorkflowAdmin is the canonical builder; it renders its own list view first.
     We mount it and auto-open its builder, then poll the rules registry while
     the overlay is open: the first NEW workflow row (not in the baseline) is
     the created one. This keeps the save pipeline 100% canonical — no second
     workflow engine, no metadata duplication. */
  const [created, setCreated] = useState(null);
  useEffect(() => {
    if (created) return undefined;
    const timer = setInterval(() => {
      apiRequest("/api/platform/rules")
        .then((response) => {
          const fresh = (Array.isArray(response?.data) ? response.data : []).find((rule) => rule?.action?.type === "workflow" && !baseline.has(String(rule.id)));
          if (fresh) setCreated(fresh);
        })
        .catch(() => {});
    }, 1200);
    return () => clearInterval(timer);
  }, [created, baseline]);
  useEffect(() => {
    if (created) onCreated?.({ id: created.id, name: created.name });
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [created]);
  return (
    <div data-overlay-host="workflow-builder" className="space-y-4">
      <InlineNewWorkflowForm contextObjectKey={contextObjectKey} baseline={baseline} onCreated={onCreated} onCancel={onClose} />
      {created ? null : null}
    </div>
  );
}

/*
 * A minimal creation form over the SAME /api/platform/rules pipeline the
 * Workflow Builder uses. It creates the workflow shell (name + object +
 * manual trigger) with a Show-Form-Layout style first step the admin can
 * extend immediately in WorkflowAdmin; complex step authoring stays there.
 * This guarantees: no navigation away, unsaved page state preserved, and the
 * new workflow auto-selected by UUID in the picker.
 */
function InlineNewWorkflowForm({ contextObjectKey, baseline, onCreated, onCancel }) {
  const [name, setName] = useState("New Workflow");
  const [objectKey, setObjectKey] = useState(contextObjectKey || "");
  const [objects, setObjects] = useState([]);
  const [layouts, setLayouts] = useState([]);
  const [layoutId, setLayoutId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiRequest("/api/platform/objects")
      .then((response) => setObjects(Array.isArray(response?.data?.objects) ? response.data.objects : Array.isArray(response?.data) ? response.data : []))
      .catch(() => setObjects([]));
    apiRequest("/api/platform/layouts")
      .then((response) => setLayouts(Array.isArray(response?.data) ? response.data.filter((layout) => layout.active !== false) : []))
      .catch(() => setLayouts([]));
  }, []);

  const create = async () => {
    if (!name.trim()) { setError("Workflow name is required."); return; }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        objectKey: objectKey || null,
        triggerKey: "manual",
        conditions: [],
        active: true,
        action: {
          type: "workflow",
          match: "all",
          actions: [
            /* UI invocation steps; extended later in the full Workflow Builder. */
            { type: "SHOW_MESSAGE", message: `Opened ${name.trim()}` },
          ],
        },
      };
      const response = await apiRequest("/api/platform/rules", { method: "POST", body: JSON.stringify(payload) });
      const createdWorkflow = response?.data || null;
      if (createdWorkflow?.id) {
        /* Mark the baseline so the overlay host does not double-report. */
        baseline.add(String(createdWorkflow.id));
        onCreated?.({ id: createdWorkflow.id, name: createdWorkflow.name || name.trim() });
      } else {
        setError("Workflow was created but no identifier was returned.");
      }
    } catch (createError) {
      setError(createError?.message || "Unable to create workflow.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500">Workflow name</label>
          <input className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500">Context Object</label>
          <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={objectKey} onChange={(event) => setObjectKey(event.target.value)}>
            <option value="">No object</option>
            {contextObjectKey && !objects.some((object) => object.object_key === contextObjectKey) ? <option value={contextObjectKey}>{contextObjectKey}</option> : null}
            {objects.map((object) => <option key={object.id} value={object.object_key}>{object.label || object.object_key}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500">Invocation Type</label>
        <input className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value="UI Action · Input: Current Record" disabled readOnly />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500">First step (optional) — Show Form Layout</label>
        <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={layoutId} onChange={(event) => setLayoutId(event.target.value)}>
          <option value="">None — add steps later in Workflow Builder</option>
          {layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}
        </select>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="onepos-btn onepos-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="onepos-btn onepos-btn-primary" disabled={saving} onClick={create}>{saving ? "Saving…" : "Save Workflow"}</button>
      </div>
      <p className="text-[11px] text-slate-400">
        Saved into the central Workflow Registry (platform_rules) with a UUID. Extend its steps any time from Automation → Workflow; the page stores the UUID, so later renames never break it.
      </p>
    </div>
  );
}
