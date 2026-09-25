/*
 * Dashboard Builder layout canvas.
 *
 * This is the EDITING surface for the existing 12-column dashboard layout, not
 * a second layout model: it renders through `DashboardGrid` and therefore
 * through the same `dashboardSpanClass` / `dashboardHeightClass` the runtime
 * uses. Dragging reorders the component array and resizing changes `layout.w`
 * / `layout.h`; `applyLayout()` then recomputes `x`/`y` so the persisted
 * definition is the single source of truth and reloads exactly as saved.
 *
 * Input handling uses Pointer Events, so mouse, pen and touch all work with one
 * implementation, and native HTML5 drag-and-drop is used for mouse reordering.
 */
import { useCallback, useRef, useState } from "react";
import { GripVertical, Maximize2 } from "lucide-react";
import DashboardGrid from "./DashboardGrid.jsx";
import { applyLayout, clampHeight, clampWidth, dashboardSpanClass, DASHBOARD_COLUMNS } from "./platformDashboard.js";

const moveItem = (list, from, to) => {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

export function reorderComponents(components, from, to) {
  return applyLayout(moveItem(components, from, to));
}

export function resizeComponent(components, id, patch) {
  return applyLayout(components.map((component) => (component.id === id
    ? { ...component, layout: { ...component.layout, w: clampWidth(patch.w ?? component.layout?.w), h: clampHeight(patch.h ?? component.layout?.h) } }
    : component)));
}

export default function DashboardLayoutCanvas({ components = [], results = [], loading = false, selectedId, onSelect, onChange, readOnly = false }) {
  const gridRef = useRef(null);
  const dragIndex = useRef(null);
  const [overIndex, setOverIndex] = useState(null);
  const [resizing, setResizing] = useState(null);

  const commitOrder = useCallback((from, to) => {
    if (onChange) onChange(reorderComponents(components, from, to));
  }, [components, onChange]);

  /* ---- Resize: pointer-driven, so it works with mouse, pen and touch. ---- */
  const beginResize = (event, id) => {
    if (readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    const grid = gridRef.current;
    if (!grid) return;
    const gap = 16;
    const rect = grid.getBoundingClientRect();
    const columnWidth = (rect.width - gap * (DASHBOARD_COLUMNS - 1)) / DASHBOARD_COLUMNS;
    const component = components.find((entry) => entry.id === id);
    const startW = component?.layout?.w || 4;
    const startH = component?.layout?.h || 3;
    setResizing({ id, startX: event.clientX, startY: event.clientY });

    const onMove = (moveEvent) => {
      const deltaColumns = Math.round((moveEvent.clientX - event.clientX) / (columnWidth + gap));
      const deltaRows = Math.round((moveEvent.clientY - event.clientY) / 60);
      if (onChange) onChange(resizeComponent(components, id, { w: startW + deltaColumns, h: startH + deltaRows }));
    };
    const onUp = () => {
      setResizing(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return <div className="min-w-0">
    <div ref={gridRef} className="relative touch-pan-y select-none" data-testid="dashboard-layout-canvas">
      <DashboardGrid components={components} results={results} loading={loading} testId="dashboard-layout-grid" />
      {/* Interaction overlay: one absolutely-positioned layer aligned to the
          same 12-column grid, so handles never disturb the rendered output. */}
      {!loading && components.length ? <div className="absolute inset-0 grid grid-cols-4 gap-4" data-testid="dashboard-layout-overlay" style={{ pointerEvents: "none" }}>
        {components.map((component, index) => {
          const active = selectedId === component.id;
          const dragging = overIndex === index;
          return <div
            key={component.id}
            data-layout-slot={component.id}
            className={`${dashboardSpanClass(component.layout?.w)} relative min-w-0`}
            style={{ pointerEvents: readOnly ? "none" : "auto" }}
            onClick={() => onSelect?.(component.id)}
            onDragOver={(event) => { if (readOnly) return; event.preventDefault(); setOverIndex(index); }}
            onDragLeave={() => setOverIndex((current) => (current === index ? null : current))}
            onDrop={(event) => {
              if (readOnly) return;
              event.preventDefault();
              const from = dragIndex.current;
              setOverIndex(null);
              dragIndex.current = null;
              if (from !== null) commitOrder(from, index);
            }}
          >
            <div
              draggable={!readOnly}
              data-testid={`drag-handle-${component.id}`}
              onDragStart={(event) => { dragIndex.current = index; event.dataTransfer.effectAllowed = "move"; }}
              onDragEnd={() => { dragIndex.current = null; setOverIndex(null); }}
              className="absolute -top-1 left-1 z-10 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold shadow-sm"
              style={{ pointerEvents: "auto", cursor: readOnly ? "default" : "grab", background: active ? "var(--onepos-accent-600)" : "var(--onepos-surface-raised)", color: active ? "#fff" : "var(--onepos-text-secondary)", border: "1px solid var(--onepos-border)", opacity: active || dragging ? 1 : 0.55 }}
              title={readOnly ? component.title : `Drag to reorder · ${component.title || ""}`}
            >
              <GripVertical size={12} />
              <span className="max-w-[120px] truncate">{component.title || component.type}</span>
            </div>
            <button
              type="button"
              data-testid={`resize-handle-${component.id}`}
              onPointerDown={(event) => beginResize(event, component.id)}
              className="absolute -bottom-1 -right-1 z-10 grid h-6 w-6 place-items-center rounded-md shadow-sm"
              style={{ pointerEvents: "auto", cursor: "nwse-resize", background: "var(--onepos-surface-raised)", color: "var(--onepos-accent-700)", border: "1px solid var(--onepos-border)" }}
              title={`Resize (currently ${component.layout?.w || 4} of ${DASHBOARD_COLUMNS} columns)`}
              aria-label={`Resize ${component.title || component.type}`}
            >
              <Maximize2 size={12} />
            </button>
            {dragging ? <div className="absolute inset-0" style={{ pointerEvents: "none", boxShadow: "inset 0 0 0 2px var(--onepos-accent-400)", borderRadius: "var(--onepos-card-radius, 16px)" }} /> : null}
          </div>;
        })}
      </div> : null}
    </div>
    {resizing ? <p className="text-xs mt-2" style={{ color: "var(--onepos-text-muted)" }}>Resizing — release to keep the new size.</p> : null}
    {!readOnly ? <p className="text-xs mt-2" style={{ color: "var(--onepos-text-muted)" }}>
      Drag a component by its handle to reorder it, or drag the corner handle to resize it. Positions and sizes are saved with the dashboard.
    </p> : null}
  </div>;
}
