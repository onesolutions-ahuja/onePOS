import { useState } from "react";
import { BarChart3, Check, LayoutGrid, Package, Settings } from "lucide-react";
import {
  ACCENT_OPTIONS,
  APPEARANCE_OPTIONS,
  LAYOUT_PRESETS,
  isDarkAppearance,
  tokensForPreferences,
} from "../../utils/adminPreferences.js";

/*
 * Settings → Appearance — the Admin presentation preference editor.
 *
 * Chooses are saved through the dedicated user-preference service (PUT
 * /api/auth/me/preferences) the moment a control changes — no form submit,
 * no reload, no business data rebuild.
 *
 * The preview renders REAL shared component classes (.onepos-shell,
 * .onepos-sidebar-item, .onepos-card, .onepos-input, .onepos-table,
 * .onepos-btn) with the draft tokens applied to its own subtree, so the
 * selected design language is demonstrated live: navigation, card, metric,
 * form control, table row and buttons all change together.
 */

function PreviewFrame({ prefs }) {
  const tokens = tokensForPreferences(prefs);
  const dark = isDarkAppearance(prefs);
  const preset = prefs.preset;

  return (
    <div
      data-testid="appearance-preview"
      aria-hidden="true"
      data-onepos-preset={preset}
      data-onepos-dark={dark ? "true" : "false"}
      style={{
        ...tokens,
        borderRadius: 14,
        border: "1px solid var(--onepos-border)",
        overflow: "hidden",
        backgroundColor: "var(--onepos-surface)",
      }}
    >
      <div className="onepos-shell" style={{ height: 268, minHeight: 0 }}>
        {/* mini navigation rail */}
        <aside className="onepos-sidebar" style={{ width: preset === "compact" ? 132 : 158 }}>
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="onepos-sidebar-brand text-[11px] font-bold uppercase tracking-[0.14em]">onePOS</span>
          </div>
          <nav className="flex flex-col gap-0.5 px-1.5" aria-hidden="true">
            <span className="onepos-sidebar-group-label">Workspace</span>
            {[
              ["Overview", LayoutGrid, true],
              ["Products", Package, false],
              ["Reports", BarChart3, false],
            ].map(([label, Icon, active]) => (
              <span key={label} className="onepos-sidebar-item" aria-current={active ? "page" : undefined}>
                <span className="onepos-nav-icon">
                  <Icon size={18} />
                </span>
                <span className="truncate">{label}</span>
              </span>
            ))}
          </nav>
        </aside>

        <div className="onepos-shell-main">
          {/* mini header */}
          <div className="onepos-shell-header" style={{ paddingLeft: 10, paddingRight: 10 }}>
            <span className="text-[11px] font-semibold" style={{ color: "var(--onepos-text-heading)" }}>
              Products
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: "var(--onepos-accent-600)", borderRadius: "var(--onepos-radius-sm)" }}
              >
                New
              </span>
              <Settings size={13} style={{ color: "var(--onepos-text-muted)" }} />
            </span>
          </div>

          <div className="onepos-shell-content" style={{ padding: 12, paddingBottom: 12 }}>
            {/* metric cards */}
            <div className="grid grid-cols-2 gap-2">
              {[
                ["Revenue", "£4,250"],
                ["Orders", "182"],
              ].map(([label, value]) => (
                <div key={label} className="onepos-card">
                  <div className="onepos-card-body" style={{ paddingTop: 10, paddingBottom: 10 }}>
                    <div className="flex items-center gap-2">
                      <span className="onepos-nav-icon">
                        <BarChart3 size={14} />
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--onepos-text-muted)" }}>{label}</span>
                    </div>
                    <div className="mt-1 text-[15px] font-bold" style={{ color: "var(--onepos-text-heading)" }}>{value}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* form control */}
            <div className="mt-3" style={{ display: "grid", gap: "var(--onepos-form-gap)" }}>
              <label className="onepos-label" htmlFor="appearance-preview-search">Product name</label>
              <input id="appearance-preview-search" className="onepos-input" readOnly value="Cola 330ml" />
              <div className="flex gap-2">
                <span className="onepos-btn onepos-btn-primary onepos-btn-sm">Save</span>
                <span className="onepos-btn onepos-btn-secondary onepos-btn-sm">Cancel</span>
              </div>
            </div>

            {/* table rows */}
            <table className="onepos-table mt-3">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {[["Cola 330ml", "12"], ["Bread", "3"]].map(([name, stock]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionCard({ selected, title, description, onClick, testId, hint }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      data-testid={testId}
      className="relative rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      style={{
        borderColor: selected ? "var(--onepos-accent-600)" : "var(--onepos-border)",
        borderWidth: selected ? "2px" : "1px",
        padding: selected ? "11px" : "12px",
        backgroundColor: selected ? "var(--onepos-accent-soft)" : "var(--onepos-surface-raised)",
      }}
    >
      {selected && (
        <span
          className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-white"
          style={{ backgroundColor: "var(--onepos-accent-600)" }}
        >
          <Check size={12} />
        </span>
      )}
      <div className="pr-6 text-[13.5px] font-semibold" style={{ color: "var(--onepos-text-heading)" }}>{title}</div>
      {description && (
        <div className="mt-1 text-xs leading-relaxed" style={{ color: "var(--onepos-text-secondary)" }}>
          {description}
        </div>
      )}
      {hint && (
        <div className="mt-1.5 text-[11px] font-medium" style={{ color: "var(--onepos-accent-700)" }}>
          {hint}
        </div>
      )}
    </button>
  );
}

export default function AppearancePreferences({ preferences, onChange }) {
  const [draft, setDraft] = useState(preferences);

  const current = { ...preferences, ...draft };
  const set = (patch) => {
    const next = { ...current, ...patch };
    setDraft(next);
    onChange?.(next); /* persists through the user-preference service */
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-5">
        <section>
          <h2 className="text-sm font-semibold" style={{ color: "var(--onepos-text-heading)" }}>Layout</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--onepos-text-muted)" }}>
            Three complete design languages — same pages, same data, different presentation.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Layout preset">
            {LAYOUT_PRESETS.map((preset) => (
              <OptionCard
                key={preset.key}
                selected={current.preset === preset.key}
                title={preset.label}
                description={preset.description}
                onClick={() => set({ preset: preset.key })}
                testId={`settings-preset-${preset.key}`}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold" style={{ color: "var(--onepos-text-heading)" }}>Appearance</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--onepos-text-muted)" }}>
            Light, Dark, or follow your device setting — independent of the layout preset.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Appearance">
            {APPEARANCE_OPTIONS.map((option) => (
              <OptionCard
                key={option.key}
                selected={current.appearance === option.key}
                title={option.label}
                onClick={() => set({ appearance: option.key })}
                testId={`settings-appearance-${option.key}`}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold" style={{ color: "var(--onepos-text-heading)" }}>Accent</h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--onepos-text-muted)" }}>
            The highlight colour used for selected states and primary actions.
          </p>
          <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Accent colour">
            {ACCENT_OPTIONS.map((accent) => (
              <button
                key={accent.key}
                type="button"
                role="radio"
                aria-checked={current.accent === accent.key}
                aria-label={accent.label}
                title={accent.label}
                onClick={() => set({ accent: accent.key })}
                data-testid={`settings-accent-${accent.key}`}
                className="h-8 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                style={{
                  borderColor: current.accent === accent.key ? "var(--onepos-accent-600)" : "var(--onepos-border)",
                  backgroundColor: current.accent === accent.key ? "var(--onepos-accent-soft)" : "var(--onepos-surface-raised)",
                  color: "var(--onepos-text-body)",
                }}
              >
                <span className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: `hsl(${accent.hue} 55% 42%)` }} />
                {accent.label}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div>
        <h2 className="text-sm font-semibold" style={{ color: "var(--onepos-text-heading)" }}>Preview</h2>
        <p className="mt-0.5 mb-3 text-xs" style={{ color: "var(--onepos-text-muted)" }}>
          Navigation, cards, controls, tables and buttons in the selected combination.
        </p>
        <PreviewFrame prefs={current} />
      </div>
    </div>
  );
}
