import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import {
  componentCategories,
  componentCategoryLabel,
  componentIcon,
  normalizedRegistry,
  useComponentRegistry,
} from "./componentRegistry.js";

/*
 * COMPONENT REGISTRY — the ONE browsable catalogue of the platform's
 * metadata-driven UI components.
 *
 * Every builder (Form & Page Builder, Custom Page Builder, Form Builder
 * palette, Dashboard Builder) composes pages from the same server registry
 * (/api/platform/component-registry). This screen is the read-only map of
 * that vocabulary: search, category navigation, cards and a detail panel.
 * It changes no registration and stores nothing — presentation only.
 *
 * Loosely coupled by design: entries arrive through normalizeComponent(), so
 * server-side additions/renames cannot break this screen while the contract
 * evolves elsewhere.
 */

const CATEGORY_BLURBS = {
  layout: "Structure for a page: sections, containers and spacing.",
  content: "Static content blocks: headings and information text.",
  field: "Input controls a form field can render as.",
  record: "Components bound to object records and relationships.",
  dashboard: "Analytics components configured by the Dashboard Builder.",
  action: "Interactive triggers wired to registered actions and workflows.",
};

export default function ComponentRegistryAdmin() {
  const registry = useComponentRegistry();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedKey, setSelectedKey] = useState("");

  const components = useMemo(() => normalizedRegistry(registry), [registry]);
  const categories = useMemo(() => componentCategories(registry), [registry]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return components.filter((component) => {
      if (category !== "all" && component.category !== category) return false;
      if (!needle) return true;
      return (
        component.label.toLowerCase().includes(needle) ||
        component.key.toLowerCase().includes(needle) ||
        componentCategoryLabel(component.category).toLowerCase().includes(needle)
      );
    });
  }, [components, category, query]);

  /* Keep the detail panel on a real entry when filters change. */
  const selected =
    filtered.find((component) => component.key === selectedKey) ||
    filtered[0] ||
    components.find((component) => component.key === selectedKey) ||
    null;

  return (
    <div className="onepos-creg" data-testid="component-registry">
      <header className="onepos-creg-head">
        <div className="min-w-0">
          <h2 className="onepos-section-title">Component Registry</h2>
          <p className="onepos-creg-sub">
            The shared component vocabulary every builder composes pages from —{" "}
            {components.length} registered.
          </p>
        </div>
        <div className="settings-search-wrap onepos-creg-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search components"
            aria-label="Search components"
          />
          {query ? (
            <button type="button" className="onepos-creg-clear" onClick={() => setQuery("")} aria-label="Clear search">
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="onepos-creg-body">
        {/* CATEGORY NAV — the single filter dimension. "All" first. */}
        <nav className="onepos-creg-nav" aria-label="Component categories">
          {categories.map((key) => {
            const count = key === "all" ? components.length : components.filter((component) => component.category === key).length;
            const active = category === key;
            return (
              <button
                key={key}
                type="button"
                className={`onepos-creg-nav-item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => setCategory(key)}
              >
                <span>{key === "all" ? "All" : componentCategoryLabel(key)}</span>
                <span className="onepos-creg-count">{count}</span>
              </button>
            );
          })}
        </nav>

        <div className="onepos-creg-main">
          {/* CARDS — consistent icon + friendly label + category. */}
          {filtered.length ? (
            <div className="onepos-creg-grid" role="list">
              {filtered.map((component) => {
                const Icon = componentIcon(component);
                const active = selected?.key === component.key;
                return (
                  <button
                    key={component.key}
                    type="button"
                    role="listitem"
                    className={`onepos-creg-card${active ? " is-active" : ""}`}
                    aria-pressed={active}
                    onClick={() => setSelectedKey(component.key)}
                  >
                    <span className="onepos-creg-card-icon" aria-hidden="true">
                      <Icon size={17} />
                    </span>
                    <span className="onepos-creg-card-name">{component.label}</span>
                    <span className="onepos-creg-card-cat">{componentCategoryLabel(component.category)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="onepos-empty">
              <span className="onepos-empty-title">No components match “{query}”.</span>
              <span className="text-xs" style={{ color: "var(--onepos-text-muted)" }}>
                Try another search, or pick a different category.
              </span>
            </div>
          )}

          {/* DETAIL — the selected component's registry metadata. */}
          {selected ? (
            <section className="onepos-card onepos-creg-detail" aria-label={`${selected.label} details`}>
              <div className="onepos-creg-detail-head">
                <span className="onepos-creg-card-icon" aria-hidden="true">
                  {(() => { const Icon = componentIcon(selected); return <Icon size={19} />; })()}
                </span>
                <div className="min-w-0">
                  <h3 className="onepos-creg-detail-title">{selected.label}</h3>
                  <p className="onepos-creg-detail-sub">
                    {componentCategoryLabel(selected.category)}
                    {CATEGORY_BLURBS[selected.category] ? ` — ${CATEGORY_BLURBS[selected.category]}` : ""}
                  </p>
                </div>
              </div>
              <dl className="onepos-creg-facts">
                <div>
                  <dt>API name</dt>
                  <dd><code>{selected.key}</code></dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{selected.kind}</dd>
                </div>
                <div>
                  <dt>Record binding</dt>
                  <dd>{selected.bindable ? "Supported" : "Not applicable"}</dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>
                    {selected.reserved ? (
                      <span className="onepos-badge onepos-badge-warning">Reserved</span>
                    ) : (
                      <span className="onepos-badge onepos-badge-success">Available</span>
                    )}
                  </dd>
                </div>
              </dl>
              {selected.description ? (
                <p className="onepos-creg-note">{selected.description}</p>
              ) : null}
              {selected.fieldTypes?.length ? (
                <p className="onepos-creg-note">
                  Rendered for fields of type: {selected.fieldTypes.join(", ")}.
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>

      <style>{CREG_CSS}</style>
    </div>
  );
}

/* Layout-only styles; every colour comes from the shared design tokens so the
   screen follows the preset, appearance and accent like the rest of Platform. */
const CREG_CSS = `
  .onepos-creg { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .onepos-creg-head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 10px; }
  .onepos-creg-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--onepos-text-muted); }
  .onepos-creg-search { width: min(280px, 100%); margin-bottom: 0; }

  .onepos-creg-body { display: grid; grid-template-columns: 172px minmax(0, 1fr); align-items: start; gap: 14px; min-width: 0; }
  .onepos-creg-nav { display: flex; flex-direction: column; gap: 3px; }
  .onepos-creg-nav-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--onepos-text-secondary); font-size: 13px; text-align: left; }
  .onepos-creg-nav-item:hover { background: var(--onepos-surface-muted); color: var(--onepos-text-primary); }
  .onepos-creg-nav-item.is-active { background: var(--onepos-surface-raised); border-color: var(--onepos-border); color: var(--onepos-text-primary); font-weight: 600; }
  .onepos-creg-count { font-size: 11px; color: var(--onepos-text-muted); }

  .onepos-creg-main { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .onepos-creg-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(158px, 1fr)); gap: 10px; min-width: 0; }
  .onepos-creg-card { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 12px; border: 1px solid var(--onepos-border); border-radius: var(--onepos-radius, 12px); background: var(--onepos-surface-raised); text-align: left; min-width: 0; }
  .onepos-creg-card:hover { border-color: var(--onepos-accent-600); }
  .onepos-creg-card.is-active { border-color: var(--onepos-accent-600); box-shadow: 0 0 0 1px var(--onepos-accent-600); }
  .onepos-creg-card-icon { display: grid; place-items: center; width: 30px; height: 30px; margin-bottom: 3px; border-radius: 9px; background: var(--onepos-surface-muted); color: var(--onepos-text-secondary); }
  .onepos-creg-card.is-active .onepos-creg-card-icon { background: var(--onepos-accent-600); color: var(--onepos-accent-contrast, #fff); }
  .onepos-creg-card-name { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; color: var(--onepos-text-primary); }
  .onepos-creg-card-cat { font-size: 11px; color: var(--onepos-text-muted); }

  .onepos-creg-clear { display: grid; place-items: center; border: 0; background: transparent; color: var(--onepos-text-muted); cursor: pointer; padding: 2px; }
  .onepos-creg-detail { padding: 16px 18px; }
  .onepos-creg-detail-head { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .onepos-creg-detail-title { margin: 0; font-size: 15px; font-weight: 700; color: var(--onepos-text-primary); }
  .onepos-creg-detail-sub { margin: 2px 0 0; font-size: 12px; color: var(--onepos-text-muted); }
  .onepos-creg-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 18px; margin: 14px 0 0; }
  .onepos-creg-facts dt { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--onepos-text-muted); }
  .onepos-creg-facts dd { margin: 3px 0 0; font-size: 13px; color: var(--onepos-text-primary); overflow-wrap: anywhere; }
  .onepos-creg-note { margin: 12px 0 0; font-size: 12.5px; color: var(--onepos-text-secondary); }

  @media (max-width: 768px) {
    .onepos-creg-body { grid-template-columns: minmax(0, 1fr); }
    .onepos-creg-nav { flex-direction: row; flex-wrap: wrap; }
    .onepos-creg-nav-item { padding: 5px 9px; }
  }
`;
