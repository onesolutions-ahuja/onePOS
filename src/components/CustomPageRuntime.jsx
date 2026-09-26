import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../services/api.js";
import CustomPageRenderer from "./platform/CustomPageRenderer.jsx";
import {
  nodeLabel,
  normalizeCustomPageTree,
} from "../pages/settings/Platform/customPageTree.js";
import {
  buildNavigationContext,
  navigateToTarget,
  resolveNavigationTarget,
} from "../utils/navigationTargets.js";
import HospitalityOperations from "../pages/hospitality/HospitalityOperations.jsx";
import KitchenDisplay from "../pages/hospitality/KitchenDisplay.jsx";

/*
 * CUSTOM PAGE RUNTIME.
 *
 * The published counterpart of the Custom Page Builder. It loads the SAME
 * platform_pages.definition tree and renders it through the SAME shared
 * renderer (components/platform/CustomPageRenderer.jsx) the builder canvas
 * uses — there is no second renderer and no divergent presentation.
 *
 * On Click dispatch reuses the canonical registries:
 *   workflow     → /api/platform/objects/:object/records/:id/actions/execute
 *                  would be layout-bound; instead the workflow executes through
 *                  the existing button-execute pipeline semantics by posting a
 *                  UI trigger to the record-actions endpoint of the object.
 *   action       → existing Action Registry enforcement server-side
 *   navigate     → in-app navigation through the existing URL contract
 *   form_layout  → the object's existing runtime detail form in a RecordModal
 *                  with the selected presentation type
 *
 * Every click supplies the runtime context the platform already defines:
 * record_uuid, object_uuid (via object key), current user/company/store are
 * attached server-side from the authenticated session; the clicked record is
 * the workflow's Current Record.
 */

function ControlFallback({ component }) {
  const key = component.component_key || component.componentKey;
  const label = component.label || "Field";
  const base = "onepos-control w-full";
  if (key === "checkbox") return <label className="flex items-center gap-2 text-sm"><input type="checkbox" /> {label}</label>;
  if (key === "picklist") return <label className="onepos-field"><span>{label}</span><select className={base}><option>Select…</option></select></label>;
  if (key === "long_text") return <label className="onepos-field"><span>{label}</span><textarea className={base} rows="4" /></label>;
  if (["text_input", "number", "currency", "date", "datetime", "lookup"].includes(key)) {
    const type = key === "date" ? "date" : key === "datetime" ? "datetime-local" : key === "number" || key === "currency" ? "number" : "text";
    return <label className="onepos-field"><span>{label}</span><input className={base} type={type} /></label>;
  }
  if (key === "button") return <button className="onepos-btn onepos-btn-primary">{label}</button>;
  if (key === "divider") return <hr className="border-slate-200" />;
  if (key === "spacer") return <div className="h-6" aria-hidden="true" />;
  if (key === "header") return <h2 className="text-xl font-semibold">{label}</h2>;
  return <div className="text-sm text-slate-700">{label}</div>;
}

/** Legacy flat definitions keep their original presentation. */
function LegacyFlatPage({ page, onClose }) {
  const definition = page?.definition || {};
  const sections = useMemo(() => Array.isArray(definition.sections) ? definition.sections : [], [definition]);
  const components = Array.isArray(definition.components) ? definition.components : [];
  const mode = definition.presentation_mode || "landing";
  const content = (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.id} className="onepos-card p-5">
          <h3 className="mb-4 font-semibold">{section.label}</h3>
          <div className={`grid gap-4 ${section.columns === 2 ? "md:grid-cols-2" : section.columns === 3 ? "md:grid-cols-3" : "grid-cols-1"}`}>
            {components.filter((component) => component.section_id === section.id && component.visible !== false).map((component) => (
              <div key={component.id} className={component.width === "full" ? "col-span-full" : ""}><ControlFallback component={component} /></div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
  if (mode === "landing") {
    return (
      <main className="onepos-motion-surface onepos-page-enter min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl">
          <header className="mb-5"><div className="text-xs text-slate-500">{page.app_label}</div><h1 className="text-2xl font-semibold">{page.label}</h1></header>
          {content}
        </div>
      </main>
    );
  }
  return (
    <div className="onepos-overlay-backdrop" role="presentation">
      <section role="dialog" aria-modal="true" aria-label={page.label} className={`onepos-overlay-panel ${mode === "overlay_square" ? "onepos-overlay-square" : "onepos-overlay-rectangle"}`}>
        <header className="onepos-overlay-header"><h2 className="font-semibold">{page.label}</h2><button className="onepos-icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="onepos-overlay-body">{content}</div>
      </section>
    </div>
  );
}

/** Form Layout presentation via the EXISTING runtime form endpoint + RecordModal. */
function FormLayoutModal({ objectKey, record, presentation, onClose }) {
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    apiRequest(`/api/platform/runtime-forms/${encodeURIComponent(objectKey)}?pageType=detail`)
      .then((response) => { if (live) setRuntime(response?.data || null); })
      .catch((loadError) => { if (live) setError(loadError.message || "Unable to load the form layout"); });
    return () => { live = false; };
  }, [objectKey]);

  const width = presentation === "compact_popup" ? "onepos-modal-sm" : presentation === "full_screen" ? "onepos-modal-xl" : "onepos-modal-lg";
  return (
    <div className="onepos-modal-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
      <div className={`onepos-modal ${width}`} role="dialog" aria-modal="true" aria-label="Record details">
        <div className="onepos-modal-header">
          <h2 className="onepos-modal-title">{record?.name || record?.id || "Record"}</h2>
          <button type="button" className="onepos-sidebar-iconbtn onepos-modal-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="onepos-modal-body">
          {error ? <div className="onepos-alert onepos-alert-error">{error}</div> : null}
          {runtime ? (
            <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(runtime.fields || []).filter((field) => field.readable !== false).slice(0, 24).map((field) => (
                <div key={field.id || field.api_name}>
                  <dt className="text-xs font-medium text-slate-500">{field.label || field.api_name}</dt>
                  <dd className="text-sm text-slate-800">{record?.[field.api_name] === null || record?.[field.api_name] === undefined ? "—" : String(record[field.api_name])}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="text-sm text-slate-500">Loading form layout…</p>}
        </div>
        <div className="onepos-modal-footer">
          <button type="button" className="onepos-btn onepos-btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function CustomPageRuntime({ pageKey, onClose }) {
  const [page, setPage] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [formModal, setFormModal] = useState(null);
  const [busy, setBusy] = useState(false);
  /*
   * NAVIGATION CONTEXT — the resolved catalogues every navigation target is
   * resolved against. Loaded once from the runtime navigation-targets feed
   * (custom pages + server-filtered object pages) plus the caller's permission
   * state; the record context comes from the component being clicked.
   */
  const [navigationContext, setNavigationContext] = useState(null);

  useEffect(() => {
    let live = true;
    apiRequest(`/api/platform/runtime/pages/${encodeURIComponent(pageKey)}`)
      .then((response) => { if (live) setPage(response.data); })
      .catch((loadError) => { if (live) setError(loadError.message); });
    return () => { live = false; };
  }, [pageKey]);

  useEffect(() => {
    let live = true;
    Promise.all([
      apiRequest("/api/auth/me/permissions").catch(() => null),
      apiRequest("/api/platform/runtime/navigation-targets").catch(() => null),
    ])
      .then(([permissionResponse, targetResponse]) => {
        if (!live) return;
        setNavigationContext(buildNavigationContext({
          permissionState: permissionResponse?.success ? permissionResponse.data : null,
          objectPages: targetResponse?.success ? targetResponse.data?.objectPages : [],
          customPages: targetResponse?.success ? targetResponse.data?.customPages : [],
        }));
      })
      .catch(() => { if (live) setNavigationContext(buildNavigationContext({})); });
    return () => { live = false; };
  }, []);

  const definition = page?.definition || {};
  const isTree = Array.isArray(definition?.sections) && definition.sections.some((section) => Array.isArray(section?.children));

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  /*
   * ONE interaction executor for every On Click binding — record clicks and
   * Button clicks both go through the page-interactions runtime endpoint,
   * which reuses the canonical workflow pipeline and the Action Registry with
   * full server-side permission enforcement. The record is OPTIONAL: a bound
   * record becomes the workflow's Current Record; a Button click runs the
   * workflow with page context only.
   */
  const executeInteraction = useCallback(async ({ type, objectKey = null, recordId = null, interaction }) => {
    const payload = { type, objectKey, recordId };
    if (type === "workflow") payload.workflowUuid = interaction.workflowUuid;
    if (type === "action") payload.actionKey = interaction.actionKey;
    const response = await apiRequest("/api/platform/runtime/page-interactions/execute", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return response?.data || null;
  }, []);

  /*
   * ONE navigation executor for every clickable surface on the page. The
   * saved target definition is resolved against the safe runtime context
   * (permissions, catalogues, the clicked component's record) and executed
   * through the existing URL contract — the app re-resolves the view from
   * the address bar, so a Custom Page button lands in Sales, on an Object
   * list or on a Record Page through the SAME runtime as the dock. Failed
   * resolution (missing page, unavailable object, no record) fails safely
   * with a toast — never a blank screen.
   */
  const runNavigation = useCallback(({ interaction, currentObjectKey = null, currentRecordId = null }) => {
    const context = buildNavigationContext({
      ...(navigationContext || {}),
      currentObjectKey,
      currentRecordId,
    });
    const result = resolveNavigationTarget(interaction?.navigationTarget, context);
    if (!result.ok) {
      setToast(result.message || "That destination is not available.");
      return;
    }
    navigateToTarget(result);
  }, [navigationContext]);

  const handleRecordClick = useCallback(async ({ record, node }) => {
    const interaction = node?.interaction || {};
    if (!interaction.type || interaction.type === "none" || busy) return;
    const objectKey = node?.collection?.objectKey || null;
    const recordId = record?.id || null;
    if ((interaction.type === "workflow" || interaction.type === "action") && !recordId) return;
    setBusy(true);
    try {
      if (interaction.type === "workflow") {
        if (!interaction.workflowUuid) { setToast("This component has no workflow assigned."); return; }
        await executeInteraction({ type: "workflow", objectKey, recordId, interaction });
        setToast("Workflow executed.");
      } else if (interaction.type === "action") {
        if (!interaction.actionKey || !objectKey) { setToast("This component has no action assigned."); return; }
        await executeInteraction({ type: "action", objectKey, recordId, interaction });
        setToast("Action executed.");
      } else if (interaction.type === "navigate") {
        runNavigation({ interaction, currentObjectKey: objectKey, currentRecordId: recordId });
      } else if (interaction.type === "form_layout") {
        if (!objectKey) { setToast("No object bound to this component."); return; }
        setFormModal({ objectKey, record, presentation: interaction.formPresentation || "screen_modal" });
      }
    } catch (runError) {
      setToast(runError?.message || "The interaction failed — you may lack permission.");
    } finally {
      setBusy(false);
    }
  }, [busy, executeInteraction, runNavigation]);

  const handleButtonClick = useCallback(async (node) => {
    const interaction = node?.interaction || {};
    if (busy || !interaction.type || interaction.type === "none") return;
    try {
      if (interaction.type === "workflow") {
        if (!interaction.workflowUuid) { setToast("This button has no workflow assigned."); return; }
        setBusy(true);
        /* Record-less: the workflow runs with page context (user/company/store). */
        await executeInteraction({ type: "workflow", objectKey: null, recordId: null, interaction });
        setToast("Workflow executed.");
      } else if (interaction.type === "action") {
        if (!interaction.actionKey) { setToast("This button has no action assigned."); return; }
        setBusy(true);
        await executeInteraction({ type: "action", objectKey: null, recordId: null, interaction });
        setToast("Action executed.");
      } else if (interaction.type === "navigate") {
        runNavigation({ interaction, currentObjectKey: null, currentRecordId: null });
      } else if (interaction.type === "form_layout") {
        setToast("A Form Layout needs a record — bind it to a record component.");
      }
    } catch (runError) {
      setToast(runError?.message || "The interaction failed — you may lack permission.");
    } finally {
      setBusy(false);
    }
  }, [busy, executeInteraction, runNavigation]);

  if (error) return <div className="onepos-page-enter min-h-screen grid place-items-center"><div className="onepos-card p-6">{error}</div></div>;
  if (!page) return <div className="min-h-screen grid place-items-center text-sm text-slate-500">Loading page…</div>;

  /* Pages with explicit legacy runtime components keep rendering them. */
  if (definition.runtime_component === "hospitality_operations") return <HospitalityOperations />;
  if (definition.runtime_component === "kitchen_display") return <KitchenDisplay />;
  if (definition.runtime_component === "uber_eats_settings") {
    return (
      <main className="onepos-motion-surface onepos-page-enter min-h-screen bg-slate-100 p-6">
        <section className="onepos-card onepos-card-body mx-auto max-w-3xl">
          <h1 className="text-2xl font-semibold">Uber Eats</h1>
          <p className="mt-2 text-sm text-slate-600">Configure this company’s Uber Eats connector, select an available store, and map menu fields in Settings.</p>
          <a className="mt-4 inline-flex onepos-btn onepos-btn-primary" href="/app/settings/uber-eats">Open Uber Eats settings</a>
        </section>
      </main>
    );
  }

  /* Legacy flat definitions (pre-builder pages) keep their original surface. */
  if (!isTree && Array.isArray(definition.components) && definition.components.length) {
    return <LegacyFlatPage page={page} onClose={onClose} />;
  }

  const tree = normalizeCustomPageTree(definition);
  const mode = tree.presentation_mode || "landing";
  const content = (
    <CustomPageRenderer
      definition={tree}
      builderMode={false}
      device="desktop"
      onRecordClick={handleRecordClick}
      onButtonClick={handleButtonClick}
    />
  );

  if (mode === "landing") {
    return (
      <main className="onepos-motion-surface onepos-page-enter min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl">
          <header className="mb-5 flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-slate-500">{page.app_label}</div>
              <h1 className="text-2xl font-semibold">{page.label}</h1>
            </div>
            <button className="onepos-icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </header>
          {content}
          {busy ? <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-1.5 text-xs text-white">Working…</div> : null}
          {toast ? <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-slate-900/85 px-4 py-1.5 text-xs text-white" role="status">{toast}</div> : null}
          {formModal ? <FormLayoutModal objectKey={formModal.objectKey} record={formModal.record} presentation={formModal.presentation} onClose={() => setFormModal(null)} /> : null}
        </div>
      </main>
    );
  }

  return (
    <div className="onepos-overlay-backdrop" role="presentation">
      <section role="dialog" aria-modal="true" aria-label={page.label} className={`onepos-overlay-panel ${mode === "overlay_square" ? "onepos-overlay-square" : "onepos-overlay-rectangle"}`}>
        <header className="onepos-overlay-header"><h2 className="font-semibold">{page.label}</h2><button className="onepos-icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="onepos-overlay-body">
          {content}
          {toast ? <div className="mt-2 text-xs text-slate-500" role="status">{toast}</div> : null}
          {formModal ? <FormLayoutModal objectKey={formModal.objectKey} record={formModal.record} presentation={formModal.presentation} onClose={() => setFormModal(null)} /> : null}
        </div>
      </section>
    </div>
  );
}
