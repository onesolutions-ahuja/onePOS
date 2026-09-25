import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Copy, Eye, GripVertical, Monitor, Plus, Redo2, Smartphone, Tablet, Trash2, Undo2 } from "lucide-react";
import { apiRequest } from "../../../services/api.js";
import { FALLBACK_COMPONENT_REGISTRY } from "./componentRegistry.js";
import CustomPageRenderer from "../../../components/platform/CustomPageRenderer.jsx";
import ActionWorkflowPicker, { describeInteraction } from "./ActionWorkflowPicker.jsx";
import { CONDITION_OPERATORS } from "./conditionOperators.js";
import {
  CONTAINER_SIZES,
  MAX_RECORD_LIMIT,
  SECTION_WIDTHS,
  canDropNode,
  duplicateNodeInSections,
  findNode,
  makeNodeId,
  moveNodeInSections,
  multiContainerColumns,
  nodeLabel,
  normalizeCustomPageTree,
  removeNodeFromSections,
  updateNodeInSections,
} from "./customPageTree.js";

/*
 * VISUAL CUSTOM PAGE BUILDER — WYSIWYG, drag-and-drop, live canvas.
 *
 * Layout (canvas gets the majority of width):
 *
 *   COMPONENTS (palette)  │        LIVE CANVAS         │  PROPERTIES
 *   from the Component    │   shared renderer in       │  selected node
 *   Registry              │   builder mode             │
 *
 * The canvas renders through CustomPageRenderer — the SAME component the
 * runtime page uses — with selection outlines and drop zones layered on top.
 * Property changes re-render instantly; Save is explicit and stores into the
 * existing platform_pages.definition through the existing pages API.
 *
 * Architecture rules honoured here:
 *   - palette comes from /api/platform/component-registry (no second list)
 *   - On Click references go through the generic ActionWorkflowPicker
 *   - `+ New Workflow` happens in-screen (no navigation, no state loss)
 *   - builder-only controls (move/duplicate/delete) never reach runtime
 */

const DRAG_MIME_NODE = "application/x-onepos-cpb-node";
const DRAG_MIME_PALETTE = "application/x-onepos-cpb-palette";
const DRAG_MIME_SECTION = "application/x-onepos-cpb-section";

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm";
const labelClass = "block text-xs font-medium text-slate-500";

const BUILDER_CSS = `
  .cpb-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr) 300px; gap: 12px; align-items: start; width: 100%; min-width: 0; }
  @media (max-width: 1100px) { .cpb-shell { grid-template-columns: 180px minmax(0, 1fr); } .cpb-properties { grid-column: 1 / -1; } }
  .cpb-panel { border: 1px solid var(--border-color, #e5e7eb); border-radius: 12px; background: var(--card-background, #fff); }
  .cpb-palette-item { display: flex; align-items: center; gap: 8px; width: 100%; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; background: var(--card-background, #fff); padding: 8px 10px; text-align: left; font-size: 12.5px; color: var(--text-primary, #334155); cursor: grab; }
  .cpb-palette-item:hover { border-color: var(--primary-color, #176f6a); }
  .cpb-canvas { border: 1px solid var(--border-color, #e5e7eb); border-radius: 12px; background: var(--muted-background, #f8fafc); padding: 14px; min-height: 480px; overflow: auto; }
  .cpb-dropzone { outline: 2px dashed var(--primary-color, #176f6a); outline-offset: 2px; border-radius: 8px; }
  .cpb-node-selected { outline: 2px solid var(--primary-color, #176f6a); outline-offset: 3px; border-radius: 8px; }
  .cpb-section-selected { outline: 2px solid var(--primary-color, #176f6a); outline-offset: 3px; }
  .cpb-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .cpb-device-btn { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; background: var(--card-background, #fff); padding: 6px 10px; font-size: 12px; color: var(--text-secondary, #475569); }
  .cpb-device-btn.active { background: var(--primary-color, #176f6a); border-color: var(--primary-color, #176f6a); color: #fff; }
  .cpb-chip { display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; background: var(--muted-background, #f1f5f9); padding: 2px 8px; font-size: 10.5px; color: var(--text-secondary, #64748b); }
`;

function uid(prefix) { return makeNodeId(prefix); }

function newPageDraft() {
  return {
    pageKey: "",
    label: "New Custom Page",
    presentation_mode: "landing",
    device: "desktop",
    sections: [],
  };
}

/** Palette groups derived from the Component Registry response. */
function paletteGroups(registry) {
  const layout = registry.filter((component) => ["section", "container", "multi_container"].includes(component.key));
  const rest = registry.filter((component) => !["section", "container", "multi_container", "table", "field"].includes(component.key) && component.category !== "field");
  return [
    { label: "Layout", items: layout },
    { label: "Content & actions", items: rest },
  ];
}

export default function CustomPageBuilder({ onMessage, onError }) {
  const [apps, setApps] = useState([]);
  const [appId, setAppId] = useState("");
  const [pages, setPages] = useState([]);
  const [pageId, setPageId] = useState("");
  const [page, setPage] = useState(null);
  const [draft, setDraft] = useState(() => newPageDraft());
  const [registry, setRegistry] = useState(FALLBACK_COMPONENT_REGISTRY);
  const [objects, setObjects] = useState([]);
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  /* Undo/redo: bounded snapshot stack of draft trees. Every mutation pushes. */
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const skipHistoryRef = useRef(false);

  useEffect(() => {
    apiRequest("/api/platform/apps").then((response) => setApps(response.data || [])).catch((error) => onError?.(error.message));
    apiRequest("/api/platform/component-registry").then((response) => {
      if (Array.isArray(response?.data) && response.data.length) setRegistry(response.data);
    }).catch(() => {});
    apiRequest("/api/platform/objects").then((response) => setObjects(Array.isArray(response?.data?.objects) ? response.data.objects : Array.isArray(response?.data) ? response.data : [])).catch(() => {});
  }, [onError]);

  useEffect(() => {
    if (!appId) { setPages([]); setPageId(""); setPage(null); return; }
    apiRequest(`/api/platform/apps/${appId}/pages`).then((response) => setPages(response.data || [])).catch((error) => onError?.(error.message));
  }, [appId, onError]);

  const applyDraft = useCallback((updater, { history = true } = {}) => {
    setDraft((current) => {
      if (history && !skipHistoryRef.current) {
        setUndoStack((stack) => [...stack.slice(-49), current]);
        setRedoStack([]);
      }
      const next = typeof updater === "function" ? updater(current) : updater;
      setDirty(true);
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      const previous = stack[stack.length - 1];
      setDraft((current) => { setRedoStack((redo) => [...redo.slice(-49), current]); return previous; });
      setDirty(true);
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack;
      const next = stack[stack.length - 1];
      setDraft((current) => { setUndoStack((undo) => [...undo.slice(-49), current]); return next; });
      setDirty(true);
      return stack.slice(0, -1);
    });
  }, []);

  const loadPage = (row) => {
    setPageId(row?.id || "");
    setPage(row || null);
    const tree = normalizeCustomPageTree(row?.definition || {});
    setDraft({ pageKey: row?.page_key || "", label: row?.label || "Custom Page", presentation_mode: tree.presentation_mode, device: tree.device, sections: tree.sections });
    setUndoStack([]); setRedoStack([]); setSelectedNodeId(null); setSelectedSectionId(null); setDirty(false); setPreview(false);
  };

  const openNewPage = () => {
    setPage(null); setPageId("");
    const fresh = newPageDraft();
    setDraft(fresh);
    setUndoStack([]); setRedoStack([]); setSelectedNodeId(null); setSelectedSectionId(null); setDirty(false); setPreview(false);
  };

  /* ------------------------------ mutations ------------------------------ */

  const addSection = (width = "full", atIndex = null) => {
    const section = { id: uid("section"), width, children: [] };
    applyDraft((current) => {
      const sections = [...current.sections];
      sections.splice(atIndex ?? sections.length, 0, section);
      return { ...current, sections };
    });
    setSelectedSectionId(section.id); setSelectedNodeId(null);
  };

  const updateSection = (sectionId, changes) => {
    applyDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === sectionId ? { ...section, ...changes } : section)),
    }));
  };

  const moveSection = (fromIndex, toIndex) => {
    applyDraft((current) => {
      const sections = [...current.sections];
      const [moved] = sections.splice(fromIndex, 1);
      sections.splice(Math.max(0, Math.min(toIndex, sections.length)), 0, moved);
      return { ...current, sections };
    });
  };

  const removeSection = (sectionId) => {
    applyDraft((current) => ({ ...current, sections: current.sections.filter((section) => section.id !== sectionId) }));
    if (selectedSectionId === sectionId) { setSelectedSectionId(null); setSelectedNodeId(null); }
  };

  const componentMeta = (componentKey) => registry.find((component) => component.key === componentKey) || { key: componentKey, label: nodeLabel({ componentKey }) };

  const newNodeFor = (componentKey) => {
    const meta = componentMeta(componentKey);
    if (componentKey === "container") return { id: uid("container"), componentKey, label: meta.label, size: "medium", columns: 2, spacing: 3, children: [] };
    if (componentKey === "multi_container") {
      return {
        id: uid("multi_container"), componentKey, label: meta.label, containerSize: "medium", spacing: 3, clickable: true,
        collection: { objectKey: "", conditions: [], conditionMatch: "all", sort: [], maxRecords: 10, pagination: false, fields: [], titleField: "", subtitleField: "" },
        interaction: { type: "none" },
      };
    }
    if (componentKey === "table") {
      /* Same Record Collection datasource as MultiContainer — configured by
         the SAME properties groups, just without card sizing. */
      return {
        id: uid("table"), componentKey, label: meta.label, clickable: true,
        collection: { objectKey: "", conditions: [], conditionMatch: "all", sort: [], maxRecords: 10, pagination: false, fields: [] },
        interaction: { type: "none" },
      };
    }
    if (componentKey === "button") return { id: uid("button"), componentKey, label: meta.label || "Button", variant: "primary", size: "medium", interaction: { type: "none" } };
    if (componentKey === "header") return { id: uid("header"), componentKey, text: meta.label || "Heading" };
    if (componentKey === "text") return { id: uid("text"), componentKey, text: meta.label || "Text" };
    if (componentKey === "divider") return { id: uid("divider"), componentKey };
    if (componentKey === "spacer") return { id: uid("spacer"), componentKey, spacing: 3 };
    if (componentKey === "field_value") return { id: uid("field_value"), componentKey, field: "" };
    if (componentKey === "related_list") return { id: uid("related_list"), componentKey, relationshipKey: "", limit: 10 };
    return { id: uid(componentKey), componentKey, label: meta.label };
  };

  const dropIntoSection = (sectionId, payload, index = null) => {
    const section = draft.sections.find((item) => item.id === sectionId);
    if (!section) return;
    if (payload.kind === "palette") {
      if (!canDropNode({ parentComponentKey: null, droppedComponentKey: payload.componentKey, droppedIsSection: false })) return;
      const node = newNodeFor(payload.componentKey);
      applyDraft((current) => ({
        ...current,
        sections: current.sections.map((item) => {
          if (item.id !== sectionId) return item;
          const children = [...item.children];
          children.splice(index ?? children.length, 0, node);
          return { ...item, children };
        }),
      }));
      setSelectedNodeId(node.id); setSelectedSectionId(null);
      return;
    }
    if (payload.kind === "section") {
      const fromIndex = draft.sections.findIndex((item) => item.id === payload.sectionId);
      if (fromIndex >= 0 && index !== null) moveSection(fromIndex, fromIndex < index ? index - 1 : index);
      return;
    }
    if (payload.kind === "node") {
      /* Cross-parent move validated against the destination parent. */
      const found = findNode(draft.sections, payload.nodeId);
      if (!found) return;
      if (!canDropNode({ parentComponentKey: null, droppedComponentKey: found.node.componentKey })) return;
      applyDraft((current) => moveNodeInSections(current.sections, { nodeId: payload.nodeId, targetParentKey: "SECTION", targetIndex: index, targetSectionId: sectionId }));
      setSelectedNodeId(payload.nodeId); setSelectedSectionId(null);
    }
  };

  const dropIntoNode = (parentNodeId, payload, index = null) => {
    const found = findNode(draft.sections, parentNodeId);
    if (!found) return;
    const parentKey = found.node.componentKey;
    if (payload.kind === "palette") {
      if (!canDropNode({ parentComponentKey: parentKey, droppedComponentKey: payload.componentKey })) return;
      const node = newNodeFor(payload.componentKey);
      applyDraft((current) => updateNodeInSections(current.sections, parentNodeId, (parent) => ({
        ...parent,
        children: (() => { const children = [...(parent.children || [])]; children.splice(index ?? children.length, 0, node); return children; })(),
      })));
      setSelectedNodeId(node.id);
      return;
    }
    if (payload.kind === "node") {
      const moving = findNode(draft.sections, payload.nodeId);
      if (!moving || payload.nodeId === parentNodeId) return;
      if (!canDropNode({ parentComponentKey: parentKey, droppedComponentKey: moving.node.componentKey })) return;
      applyDraft((current) => moveNodeInSections(current.sections, { nodeId: payload.nodeId, targetParentKey: parentNodeId, targetIndex: index, targetSectionId: null }));
      setSelectedNodeId(payload.nodeId);
    }
  };

  const updateNode = (nodeId, changes) => {
    applyDraft((current) => updateNodeInSections(current.sections, nodeId, (node) => ({ ...node, ...changes })));
  };

  const removeSelectedNode = () => {
    if (!selectedNodeId) return;
    applyDraft((current) => ({ ...current, sections: removeNodeFromSections(current.sections, selectedNodeId) }));
    setSelectedNodeId(null);
  };

  const duplicateSelectedNode = () => {
    if (!selectedNodeId) return;
    applyDraft((current) => ({ ...current, sections: duplicateNodeInSections(current.sections, selectedNodeId) }));
  };

  /* ------------------------------- save ---------------------------------- */

  const definitionForSave = () => normalizeCustomPageTree({
    device: draft.device,
    presentation_mode: draft.presentation_mode,
    sections: draft.sections.map((section) => ({
      id: section.id,
      width: section.width,
      visible: section.visible !== false,
      children: section.children,
    })),
  });

  const save = async () => {
    setSaving(true);
    try {
      const definition = definitionForSave();
      if (pageId) {
        const response = await apiRequest(`/api/platform/pages/${pageId}`, { method: "PUT", body: JSON.stringify({ definition, label: draft.label }) });
        setPage(response.data);
        const tree = normalizeCustomPageTree(response.data?.definition || {});
        setDraft({ ...draft, label: response.data?.label || draft.label, presentation_mode: tree.presentation_mode, device: tree.device, sections: tree.sections });
        onMessage?.("Custom page saved.");
      } else {
        let targetApp = appId || apps[0]?.id;
        if (!targetApp) {
          const createdApp = await apiRequest("/api/platform/apps", { method: "POST", body: JSON.stringify({ label: "Custom Pages", appKey: "custom_pages" }) });
          setApps((current) => [...current, createdApp.data]);
          targetApp = createdApp.data.id;
        }
        const pageKey = draft.pageKey?.trim() || `custom_page_${Date.now().toString(36)}`;
        const response = await apiRequest(`/api/platform/apps/${targetApp}/pages`, {
          method: "POST",
          body: JSON.stringify({ label: draft.label, pageKey, pageType: "object", definition }),
        });
        setPage(response.data); setPageId(response.data.id); setAppId(targetApp);
        setPages((current) => [...current, response.data]);
        onMessage?.("Custom page created and saved.");
      }
      setUndoStack([]); setRedoStack([]); setDirty(false);
    } catch (error) {
      onError?.(error.message || "Unable to save the page.");
    } finally {
      setSaving(false);
    }
  };

  /* ------------------------------ selection ------------------------------ */

  const selectedSection = draft.sections.find((section) => section.id === selectedSectionId) || null;
  const selected = selectedNodeId ? findNode(draft.sections, selectedNodeId) : null;
  const selectedNode = selected?.node || null;
  const selectedParentKey = selected?.parentComponentKey ?? null;

  /* Drag state via HTML5 DnD; payload through dataTransfer. */
  const onDragOver = (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; };

  const renderNode = (node, parentKey, index, parentNodeId) => {
    const isContainer = node.componentKey === "container" || node.componentKey === "multi_container";
    const acceptsChildren = isContainer && node.componentKey === "container";
    return (
      <div
        key={node.id}
        className={`${preview ? "" : "cpb-node-selected"} ${selectedNodeId === node.id && !preview ? "cpb-node-selected" : ""}`}
        style={{ minWidth: 0, position: "relative" }}
        draggable={!preview}
        onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(DRAG_MIME_NODE, JSON.stringify({ kind: "node", nodeId: node.id })); }}
        onDragOver={(event) => { if (!preview) { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.add("cpb-dropzone"); } }}
        onDragLeave={(event) => event.currentTarget.classList.remove("cpb-dropzone")}
        onDrop={(event) => {
          if (preview) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.classList.remove("cpb-dropzone");
          const paletteRaw = event.dataTransfer.getData(DRAG_MIME_PALETTE);
          const nodeRaw = event.dataTransfer.getData(DRAG_MIME_NODE);
          if (paletteRaw) {
            const payload = JSON.parse(paletteRaw);
            if (acceptsChildren) dropIntoNode(node.id, payload);
            else if (parentNodeId) dropIntoNode(parentNodeId, payload, index);
            else dropIntoSection(node.sectionId, payload, index);
          } else if (nodeRaw) {
            const payload = JSON.parse(nodeRaw);
            if (acceptsChildren) dropIntoNode(node.id, payload);
            else if (parentNodeId) dropIntoNode(parentNodeId, payload, index);
          }
        }}
        onClick={(event) => {
          if (preview) return;
          event.stopPropagation();
          setSelectedNodeId(node.id); setSelectedSectionId(null);
        }}
      >
        {!preview && selectedNodeId === node.id ? (
          <span className="cpb-chip" style={{ position: "absolute", top: -10, left: 6, zIndex: 2, background: "var(--primary-color, #176f6a)", color: "#fff" }}>
            <GripVertical size={10} /> {nodeLabel(node)}
          </span>
        ) : null}
        <CustomPageRenderer
          definition={{ sections: [{ id: node.id, width: "full", visible: true, children: [node] }] }}
          builderMode={!preview}
          device={draft.device}
        />
        {!preview && acceptsChildren && !(node.children || []).length ? (
          <div
            className="cpb-empty"
            onDragOver={onDragOver}
            onDrop={(event) => {
              event.preventDefault(); event.stopPropagation();
              const paletteRaw = event.dataTransfer.getData(DRAG_MIME_PALETTE);
              const nodeRaw = event.dataTransfer.getData(DRAG_MIME_NODE);
              if (paletteRaw) dropIntoNode(node.id, JSON.parse(paletteRaw));
              else if (nodeRaw) dropIntoNode(node.id, JSON.parse(nodeRaw));
            }}
          >
            Drop components inside {nodeLabel(node)}
          </div>
        ) : null}
        {!preview && selectedNodeId === node.id ? (
          <span className="cpb-chip" style={{ position: "absolute", top: -10, right: 6, zIndex: 2 }}>
            {nodeLabel(node)} · {describeInteraction(node.interaction)}
          </span>
        ) : null}
      </div>
    );
  };

  const renderSection = (section, index) => {
    const widthMeta = SECTION_WIDTHS[section.width] || SECTION_WIDTHS.full;
    return (
      <div
        key={section.id}
        className={`onepos-card p-4 cpb-section ${!preview && selectedSectionId === section.id ? "cpb-section-selected" : ""}`}
        style={{ flexBasis: widthMeta.basis, width: section.width === "full" ? "100%" : widthMeta.basis, minWidth: 0, position: "relative" }}
        draggable={!preview}
        onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.setData(DRAG_MIME_SECTION, JSON.stringify({ kind: "section", sectionId: section.id, index })); }}
        onDragOver={(event) => { if (!preview) { event.preventDefault(); event.currentTarget.classList.add("cpb-dropzone"); } }}
        onDragLeave={(event) => event.currentTarget.classList.remove("cpb-dropzone")}
        onDrop={(event) => {
          if (preview) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.classList.remove("cpb-dropzone");
          const paletteRaw = event.dataTransfer.getData(DRAG_MIME_PALETTE);
          const nodeRaw = event.dataTransfer.getData(DRAG_MIME_NODE);
          const sectionRaw = event.dataTransfer.getData(DRAG_MIME_SECTION);
          if (sectionRaw) {
            const payload = JSON.parse(sectionRaw);
            if (payload.sectionId !== section.id) {
              const fromIndex = draft.sections.findIndex((item) => item.id === payload.sectionId);
              moveSection(fromIndex, fromIndex < index ? index : index);
            }
            return;
          }
          const payload = paletteRaw ? JSON.parse(paletteRaw) : nodeRaw ? JSON.parse(nodeRaw) : null;
          if (payload) dropIntoSection(section.id, payload);
        }}
        onClick={(event) => { if (preview) return; event.stopPropagation(); setSelectedSectionId(section.id); setSelectedNodeId(null); }}
      >
        {!preview ? (
          <div className="mb-3 flex items-center gap-2">
            <GripVertical size={14} className="text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">{widthMeta.label}</span>
            <span className="ml-auto flex items-center gap-1">
              {(["full", "half", "third"]).map((width) => (
                <button key={width} type="button" className={`cpb-device-btn ${section.width === width ? "active" : ""}`} style={{ padding: "3px 8px", fontSize: 10.5 }} onClick={(event) => { event.stopPropagation(); updateSection(section.id, { width }); }}>{widthMetaLabel(width)}</button>
              ))}
              <button type="button" className="rounded p-1 text-slate-400 hover:text-red-600" title="Remove section" aria-label="Remove section" onClick={(event) => { event.stopPropagation(); removeSection(section.id); }}><Trash2 size={13} /></button>
            </span>
          </div>
        ) : null}
        <div
          className="cpb-section-body"
          onDragOver={onDragOver}
          onDrop={(event) => {
            event.preventDefault(); event.stopPropagation();
            const paletteRaw = event.dataTransfer.getData(DRAG_MIME_PALETTE);
            const nodeRaw = event.dataTransfer.getData(DRAG_MIME_NODE);
            const sectionRaw = event.dataTransfer.getData(DRAG_MIME_SECTION);
            if (sectionRaw) return; /* handled by the section wrapper */
            const payload = paletteRaw ? JSON.parse(paletteRaw) : nodeRaw ? JSON.parse(nodeRaw) : null;
            if (payload) {
              const targetIndex = payload.kind === "node" ? null : null;
              dropIntoSection(section.id, payload, targetIndex);
            }
          }}
        >
          {section.children.map((node, childIndex) => renderNode({ ...node, sectionId: section.id }, null, childIndex, null))}
          {!section.children.length && !preview ? <div className="cpb-empty">Drop components here</div> : null}
          {!section.children.length && preview ? null : null}
        </div>
      </div>
    );
  };

  /* ---------------------------- properties ------------------------------- */

  const boundObjectKey = selectedNode?.componentKey === "multi_container" ? selectedNode.collection?.objectKey || "" : "";

  const renderProperties = () => {
    if (selectedSection) {
      return (
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Section</p>
          <div className="space-y-1">
            <label className={labelClass}>Width</label>
            <select className={inputClass} value={selectedSection.width} onChange={(event) => updateSection(selectedSection.id, { width: event.target.value })}>
              {Object.values(SECTION_WIDTHS).map((width) => <option key={width.key} value={width.key}>{width.label}</option>)}
            </select>
          </div>
          <button type="button" className="inline-flex items-center gap-1 text-xs text-red-600" onClick={() => removeSection(selectedSection.id)}><Trash2 size={13} /> Remove section</button>
        </div>
      );
    }
    if (!selectedNode) return <p className="text-xs text-slate-400">Select a component on the canvas.</p>;
    const node = selectedNode;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{nodeLabel(node)}</p>
          <span className="flex items-center gap-1">
            <button type="button" className="rounded p-1 text-slate-400 hover:text-slate-700" title="Duplicate" aria-label="Duplicate component" onClick={duplicateSelectedNode}><Copy size={13} /></button>
            <button type="button" className="rounded p-1 text-slate-400 hover:text-red-600" title="Delete" aria-label="Delete component" onClick={removeSelectedNode}><Trash2 size={13} /></button>
          </span>
        </div>

        {node.componentKey === "multi_container" ? <MultiContainerProperties node={node} objects={objects} registry={registry} onChange={(changes) => updateNode(node.id, changes)} /> : null}
        {node.componentKey === "table" ? <TableProperties node={node} objects={objects} onChange={(changes) => updateNode(node.id, changes)} /> : null}
        {node.componentKey === "container" ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className={labelClass}>Columns</label>
              <select className={inputClass} value={node.columns || 2} onChange={(event) => updateNode(node.id, { columns: Number(event.target.value) })}>
                {[1, 2, 3].map((count) => <option key={count} value={count}>{count} column{count > 1 ? "s" : ""}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Spacing</label>
              <select className={inputClass} value={node.spacing || 3} onChange={(event) => updateNode(node.id, { spacing: Number(event.target.value) })}>
                {[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>
        ) : null}
        {node.componentKey === "button" ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <label className={labelClass}>Label</label>
              <input className={inputClass} value={node.label || ""} onChange={(event) => updateNode(node.id, { label: event.target.value })} />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Style (global onePOS design system)</label>
              <select className={inputClass} value={node.variant || "primary"} onChange={(event) => updateNode(node.id, { variant: event.target.value })}>
                <option value="primary">Primary</option><option value="secondary">Secondary</option><option value="ghost">Ghost</option><option value="danger">Destructive</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Size</label>
              <select className={inputClass} value={node.size || "medium"} onChange={(event) => updateNode(node.id, { size: event.target.value })}>
                <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
              </select>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <InteractionProperties node={node} onChange={(changes) => updateNode(node.id, changes)} />
            </div>
          </div>
        ) : null}
        {["text", "header"].includes(node.componentKey) ? (
          <div className="space-y-1">
            <label className={labelClass}>{node.componentKey === "header" ? "Heading text" : "Text"}</label>
            <input className={inputClass} value={node.text || ""} onChange={(event) => updateNode(node.id, { text: event.target.value })} />
          </div>
        ) : null}
        {node.componentKey === "spacer" ? (
          <div className="space-y-1">
            <label className={labelClass}>Spacing</label>
            <select className={inputClass} value={node.spacing || 3} onChange={(event) => updateNode(node.id, { spacing: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}</select>
          </div>
        ) : null}
        {node.componentKey === "field_value" ? (
          <div className="space-y-1">
            <label className={labelClass}>Field</label>
            <input className={inputClass} value={node.field || ""} onChange={(event) => updateNode(node.id, { field: event.target.value })} placeholder="field api name" />
          </div>
        ) : null}
        {node.componentKey === "related_list" ? (
          <div className="space-y-1">
            <label className={labelClass}>Relationship key</label>
            <input className={inputClass} value={node.relationshipKey || ""} onChange={(event) => updateNode(node.id, { relationshipKey: event.target.value })} placeholder="relationship_key" />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <style>{BUILDER_CSS}</style>

      {/* Toolbar — page name, device modes, preview, undo/redo, save. */}
      <div className="cpb-toolbar">
        <select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm" value={appId} onChange={(event) => { setAppId(event.target.value); setPageId(""); setPage(null); }} aria-label="App">
          <option value="">New page…</option>
          {apps.map((app) => <option key={app.id} value={app.id}>{app.label}</option>)}
        </select>
        <select className="max-w-52 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm" value={pageId} onChange={(event) => loadPage(pages.find((row) => row.id === event.target.value) || null)} aria-label="Page">
          <option value="">{appId ? "Select page…" : "New page…"}</option>
          {pages.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
        </select>
        <input className="w-56 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium" value={draft.label} onChange={(event) => applyDraft((current) => ({ ...current, label: event.target.value }))} aria-label="Page name" />
        <span className="ml-auto flex items-center gap-1">
          {(["desktop", "tablet", "mobile"]).map((device) => (
            <button key={device} type="button" className={`cpb-device-btn ${draft.device === device ? "active" : ""}`} onClick={() => applyDraft((current) => ({ ...current, device }), { history: false })} aria-pressed={draft.device === device}>
              {device === "desktop" ? <Monitor size={13} /> : device === "tablet" ? <Tablet size={13} /> : <Smartphone size={13} />}
              {device}
            </button>
          ))}
          <button type="button" className="cpb-device-btn" onClick={undo} disabled={!undoStack.length} title="Undo" aria-label="Undo"><Undo2 size={13} /></button>
          <button type="button" className="cpb-device-btn" onClick={redo} disabled={!redoStack.length} title="Redo" aria-label="Redo"><Redo2 size={13} /></button>
          <button type="button" className={`cpb-device-btn ${preview ? "active" : ""}`} onClick={() => setPreview((value) => !value)} aria-pressed={preview}>
            <Eye size={13} /> {preview ? "Exit Preview" : "Preview"}
          </button>
          <button type="button" className="onepos-btn onepos-btn-primary onepos-btn-sm" onClick={save} disabled={saving}>{saving ? "Saving…" : dirty || !pageId ? "Save" : "Saved"}</button>
        </span>
      </div>
      {dirty ? <p className="text-[11px] text-amber-600">Unsaved changes — drag, configure and preview freely; Save publishes.</p> : null}

      {preview ? (
        /* PREVIEW MODE — the unsaved tree rendered exactly like runtime. */
        <div className="cpb-canvas">
          <CustomPageRenderer definition={definitionForSave()} builderMode={false} device={draft.device} />
        </div>
      ) : (
        <div className="cpb-shell">
          {/* PALETTE — populated from the Component Registry. */}
          <aside className="cpb-panel p-3 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Components</p>
            {paletteGroups(registry).map((group) => (
              <div key={group.label} className="space-y-1">
                <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
                {group.items.map((component) => (
                  <button
                    key={component.key}
                    type="button"
                    className="cpb-palette-item"
                    draggable
                    onDragStart={(event) => {
                      if (component.key === "section") event.dataTransfer.setData(DRAG_MIME_PALETTE, JSON.stringify({ kind: "section-palette", componentKey: "section" }));
                      else event.dataTransfer.setData(DRAG_MIME_PALETTE, JSON.stringify({ kind: "palette", componentKey: component.key }));
                    }}
                    onClick={() => {
                      if (component.key === "section") addSection("full");
                      else if (draft.sections.length) dropIntoSection(draft.sections[draft.sections.length - 1].id, { kind: "palette", componentKey: component.key });
                      else addSection("full");
                    }}
                    title={`Drag onto the canvas${component.key === "section" ? "" : " or into a Section"}`}
                  >
                    <Plus size={12} className="text-slate-400" /> {component.label}
                  </button>
                ))}
              </div>
            ))}
            <div className="space-y-1 border-t border-slate-100 pt-2">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Sections</p>
              <div className="grid grid-cols-3 gap-1">
                {Object.values(SECTION_WIDTHS).map((width) => (
                  <button key={width.key} type="button" className="cpb-device-btn justify-center" style={{ padding: "4px 2px", fontSize: 10 }} onClick={() => addSection(width.key)}>{widthMetaShort(width.key)}</button>
                ))}
              </div>
            </div>
          </aside>

          {/* LIVE CANVAS — shared renderer with drop zones. */}
          <main
            className="cpb-canvas"
            onClick={() => { setSelectedNodeId(null); setSelectedSectionId(null); }}
            onDragOver={onDragOver}
            onDrop={(event) => {
              event.preventDefault();
              const paletteRaw = event.dataTransfer.getData(DRAG_MIME_PALETTE);
              if (paletteRaw) {
                const payload = JSON.parse(paletteRaw);
                if (payload.kind === "section-palette" || payload.componentKey === "section") addSection("full");
                else if (draft.sections.length) dropIntoSection(draft.sections[draft.sections.length - 1].id, payload);
                else addSection("full");
              }
            }}
          >
            <div className="cpb-tree">
              {draft.sections.map((section, index) => renderSection(section, index))}
              {!draft.sections.length ? (
                <div className="cpb-empty w-full py-14">
                  <strong className="mb-1 block text-sm">Blank canvas</strong>
                  Drag a <b>Section</b> from the palette to begin, then drop components inside it.
                </div>
              ) : null}
            </div>
          </main>

          {/* PROPERTIES — relevant settings for the selection only. */}
          <aside className="cpb-panel cpb-properties p-3">
            {renderProperties()}
          </aside>
        </div>
      )}
    </div>
  );
}

function widthMetaLabel(width) {
  return { full: "Full", half: "Half", third: "1/3" }[width] || width;
}
function widthMetaShort(width) {
  return { full: "Full", half: "Half", third: "Third" }[width] || width;
}

/**
 * Shared DATA group + field loading for every record-bound component
 * (MultiContainer, Table). One source of collection configuration — the exact
 * same Record Collection shape goes to the renderer and the runtime endpoint.
 */
function useCollectionFields(collection, objects) {
  const [fields, setFields] = useState([]);
  useEffect(() => {
    if (!collection.objectKey) { setFields([]); return; }
    const object = objects.find((candidate) => candidate.object_key === collection.objectKey);
    if (!object?.id) { setFields([]); return; }
    apiRequest(`/api/platform/objects/${encodeURIComponent(object.id)}/fields`)
      .then((response) => setFields((Array.isArray(response?.data) ? response.data : []).filter((field) => field.active !== false && field.readable !== false)))
      .catch(() => setFields([]));
  }, [collection.objectKey, objects]);
  return fields;
}

function RecordCollectionDataGroup({ node, objects, onChange, children }) {
  const collection = node.collection || {};
  const fields = useCollectionFields(collection, objects);
  const patchCollection = (changes) => onChange({ collection: { ...collection, ...changes } });
  return (
    <>
      <fieldset className="space-y-2 rounded-lg border border-slate-200 p-2.5">
        <legend className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Data</legend>
        <div className="space-y-1">
          <label className={labelClass}>Object</label>
          <select className={inputClass} value={collection.objectKey || ""} onChange={(event) => patchCollection({ objectKey: event.target.value, fields: [], titleField: "", subtitleField: "" })}>
            <option value="">Select object…</option>
            {objects.map((object) => <option key={object.id} value={object.object_key}>{object.label || object.object_key}</option>)}
          </select>
        </div>
        <ConditionsEditor collection={collection} fields={fields} onChange={patchCollection} />
        <SortEditor collection={collection} fields={fields} onChange={patchCollection} />
        <div className="space-y-1">
          <label className={labelClass}>Maximum Records (1–{MAX_RECORD_LIMIT})</label>
          <input className={inputClass} type="number" min={1} max={MAX_RECORD_LIMIT} value={collection.maxRecords ?? 10} onChange={(event) => patchCollection({ maxRecords: Math.min(Math.max(Number(event.target.value) || 1, 1), MAX_RECORD_LIMIT) })} />
        </div>
      </fieldset>
      {children?.({ fields, patchCollection })}
      <fieldset className="space-y-2 rounded-lg border border-slate-200 p-2.5">
        <legend className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Interaction</legend>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={node.clickable !== false} onChange={(event) => onChange({ clickable: event.target.checked })} />
          Clickable records
        </label>
        <InteractionProperties node={node} onChange={onChange} />
      </fieldset>
    </>
  );
}

/** DATA / LAYOUT / CONTENT / INTERACTION groups for MultiContainer. */
function MultiContainerProperties({ node, objects, registry, onChange }) {
  const collection = node.collection || {};
  const columns = multiContainerColumns({ sectionWidth: "full", containerSize: node.containerSize || "medium", device: "desktop" });
  return (
    <RecordCollectionDataGroup node={node} objects={objects} onChange={onChange}>
      {({ fields, patchCollection }) => (
        <>
          <fieldset className="space-y-2 rounded-lg border border-slate-200 p-2.5">
            <legend className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Layout</legend>
            <div className="space-y-1">
              <label className={labelClass}>Container Size</label>
              <select className={inputClass} value={node.containerSize || "medium"} onChange={(event) => onChange({ containerSize: event.target.value })}>
                {CONTAINER_SIZES.map((size) => <option key={size} value={size}>{size[0].toUpperCase()}{size.slice(1)}</option>)}
              </select>
              <p className="text-[11px] text-slate-400">Responsive grid ≈ {columns} card{(columns === 1 ? "" : "s")} per row at this size in a full-width section.</p>
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Spacing</label>
              <select className={inputClass} value={node.spacing || 3} onChange={(event) => onChange({ spacing: Number(event.target.value) })}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}</select>
            </div>
          </fieldset>
          <fieldset className="space-y-2 rounded-lg border border-slate-200 p-2.5">
            <legend className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Content</legend>
            <FieldSelect label="Title Field" value={collection.titleField} fields={fields} onChange={(titleField) => patchCollection({ titleField })} />
            <FieldSelect label="Subtitle Field" value={collection.subtitleField} fields={fields} onChange={(subtitleField) => patchCollection({ subtitleField })} />
            <div className="space-y-1">
              <label className={labelClass}>Displayed Fields</label>
              <div className="max-h-32 space-y-0.5 overflow-auto rounded-lg border border-slate-200 p-1.5">
                {fields.length === 0 ? <p className="px-1 text-[11px] text-slate-400">Select an object to list fields.</p> : null}
                {fields.map((field) => {
                  const apiName = field.api_name;
                  const checked = (collection.fields || []).includes(apiName);
                  return (
                    <label key={apiName} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
                      <input type="checkbox" checked={checked} onChange={() => patchCollection({ fields: checked ? (collection.fields || []).filter((name) => name !== apiName) : [...(collection.fields || []), apiName].slice(0, 12) })} />
                      {field.label || apiName}
                    </label>
                  );
                })}
              </div>
            </div>
          </fieldset>
        </>
      )}
    </RecordCollectionDataGroup>
  );
}

/** DATA / COLUMNS / INTERACTION groups for Table / List. */
function TableProperties({ node, objects, onChange }) {
  return (
    <RecordCollectionDataGroup node={node} objects={objects} onChange={onChange}>
      {({ fields, patchCollection }) => (
        <fieldset className="space-y-2 rounded-lg border border-slate-200 p-2.5">
          <legend className="px-1 text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">Columns</legend>
          <div className="max-h-40 space-y-0.5 overflow-auto rounded-lg border border-slate-200 p-1.5">
            {fields.length === 0 ? <p className="px-1 text-[11px] text-slate-400">Select an object to list fields.</p> : null}
            {fields.map((field) => {
              const apiName = field.api_name;
              const checked = (collection_fields(node).includes(apiName));
              return (
                <label key={apiName} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
                  <input type="checkbox" checked={checked} onChange={() => patchCollection({ fields: checked ? collection_fields(node).filter((name) => name !== apiName) : [...collection_fields(node), apiName].slice(0, 12) })} />
                  {field.label || apiName}
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400">Columns come from Object metadata. Row On Click is configured under Interaction.</p>
        </fieldset>
      )}
    </RecordCollectionDataGroup>
  );
}

function collection_fields(node) {
  return node?.collection?.fields || [];
}

function FieldSelect({ label, value, fields, onChange }) {
  return (
    <div className="space-y-1">
      <label className={labelClass}>{label}</label>
      <select className={inputClass} value={value || ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">None</option>
        {value && !fields.some((field) => field.api_name === value) ? <option value={value}>{value}</option> : null}
        {fields.map((field) => <option key={field.api_name} value={field.api_name}>{field.label || field.api_name}</option>)}
      </select>
    </div>
  );
}

function ConditionsEditor({ collection, fields, onChange }) {
  const conditions = collection.conditions || [];
  const setConditions = (next) => onChange({ conditions: next });
  /* The CANONICAL platform operator vocabulary — the same set workflows and
     validation rules use (conditionOperators.js mirrors the server engine). */
  const operators = CONDITION_OPERATORS;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className={labelClass}>Conditions</label>
        <select className="rounded border border-slate-200 px-1 py-0.5 text-[11px]" value={collection.conditionMatch || "all"} onChange={(event) => onChange({ conditionMatch: event.target.value })} aria-label="Condition match mode">
          <option value="all">Match ALL</option>
          <option value="any">Match ANY</option>
        </select>
      </div>
      {conditions.map((condition, index) => (
        <div key={index} className="flex items-center gap-1">
          <select className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-xs" value={condition.field} onChange={(event) => setConditions(conditions.map((item, itemIndex) => (itemIndex === index ? { ...item, field: event.target.value } : item)))}>
            <option value="">Field…</option>
            {fields.map((field) => <option key={field.api_name} value={field.api_name}>{field.label || field.api_name}</option>)}
          </select>
          <select className="rounded border border-slate-200 px-1 py-1 text-xs" value={condition.operator} onChange={(event) => setConditions(conditions.map((item, itemIndex) => (itemIndex === index ? { ...item, operator: event.target.value } : item)))}>
            {operators.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input className="w-20 rounded border border-slate-200 px-1.5 py-1 text-xs" value={condition.value ?? ""} disabled={["is_empty", "is_not_empty"].includes(condition.operator)} onChange={(event) => setConditions(conditions.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item)))} placeholder="value" />
          <button type="button" className="rounded p-1 text-slate-400 hover:text-red-600" aria-label="Remove condition" onClick={() => setConditions(conditions.filter((_, itemIndex) => itemIndex !== index))}>×</button>
        </div>
      ))}
      <button type="button" className="text-[11px] text-blue-700" disabled={conditions.length >= 20} onClick={() => setConditions([...conditions, { field: "", operator: "equals", value: "" }])}>+ Add condition</button>
    </div>
  );
}

function SortEditor({ collection, fields, onChange }) {
  const sort = collection.sort || [];
  const setSort = (next) => onChange({ sort: next });
  return (
    <div className="space-y-1">
      <label className={labelClass}>Sort</label>
      {sort.map((entry, index) => (
        <div key={index} className="flex items-center gap-1">
          <select className="min-w-0 flex-1 rounded border border-slate-200 px-1.5 py-1 text-xs" value={entry.field} onChange={(event) => setSort(sort.map((item, itemIndex) => (itemIndex === index ? { ...item, field: event.target.value } : item)))}>
            <option value="">Field…</option>
            {fields.map((field) => <option key={field.api_name} value={field.api_name}>{field.label || field.api_name}</option>)}
          </select>
          <select className="rounded border border-slate-200 px-1 py-1 text-xs" value={entry.direction} onChange={(event) => setSort(sort.map((item, itemIndex) => (itemIndex === index ? { ...item, direction: event.target.value } : item)))}>
            <option value="desc">DESC</option><option value="asc">ASC</option>
          </select>
          <button type="button" className="rounded p-1 text-slate-400 hover:text-red-600" aria-label="Remove sort" onClick={() => setSort(sort.filter((_, itemIndex) => itemIndex !== index))}>×</button>
        </div>
      ))}
      <button type="button" className="text-[11px] text-blue-700" disabled={sort.length >= 3} onClick={() => setSort([...sort, { field: "", direction: "desc" }])}>+ Add sort</button>
    </div>
  );
}

/** INTERACTION group — delegates to the generic picker. */
function InteractionProperties({ node, onChange }) {
  return (
    <div className="space-y-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">On Click</p>
      <ActionWorkflowPicker
        interaction={node.interaction || { type: "none" }}
        objectKey={node.collection?.objectKey || ""}
        onChange={(interaction) => onChange({ interaction })}
      />
    </div>
  );
}
