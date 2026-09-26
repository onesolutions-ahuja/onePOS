const MODE_LABELS = {
  source: "Same as source",
  custom: "Platform custom field",
  constant: "Constant value",
  override: "Per-product override",
};

function modeFor(mapping = {}) {
  if (mapping.same_as_source === false) return "override";
  if (mapping.type === "custom") return "custom";
  if (mapping.type === "constant") return "constant";
  return "source";
}

export default function UberMenuMappingEditor({ schema = [], value = {}, onChange }) {
  const fields = value?.fields || {};
  const update = (target, mapping) => {
    onChange({ fields: { ...fields, [target]: mapping } });
  };

  if (!schema.length) {
    return <p className="text-sm text-slate-500">Uber menu mapping metadata is unavailable.</p>;
  }

  return (
    <section className="col-span-2 rounded-lg border border-slate-200 p-4">
      <h3 className="font-semibold text-slate-800">Menu field mappings</h3>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        Map the Uber menu fields from product data, Platform custom values, constants, or a required per-product override.
        Product-specific values stay in the generic Platform custom-value mechanism.
      </p>
      <div className="space-y-3">
        {schema.map((field) => {
          const mapping = fields[field.target] || {
            same_as_source: true,
            type: "source",
            path: field.sourcePath,
          };
          const mode = modeFor(mapping);
          return (
            <div key={field.target} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-sm text-slate-600">
                <span className="block mb-1 font-medium">{field.label}</span>
                <select
                  aria-label={`${field.label} mapping type`}
                  className="onepos-input"
                  value={mode}
                  onChange={(event) => {
                    const nextMode = event.target.value;
                    if (nextMode === "source") {
                      update(field.target, { same_as_source: true, type: "source", path: field.sourcePath });
                    } else if (nextMode === "custom") {
                      update(field.target, { same_as_source: true, type: "custom", field: mapping.field || "" });
                    } else if (nextMode === "constant") {
                      update(field.target, { same_as_source: true, type: "constant", value: mapping.value ?? "" });
                    } else {
                      update(field.target, { same_as_source: false, override_field: mapping.override_field || "" });
                    }
                  }}
                >
                  {Object.entries(MODE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              {mode === "source" ? (
                <label className="text-sm text-slate-600 sm:col-span-2">
                  <span className="block mb-1 font-medium">Source field</span>
                  <select
                    aria-label={`${field.label} source field`}
                    className="onepos-input"
                    value={mapping.path || field.sourcePath}
                    onChange={(event) => update(field.target, { same_as_source: true, type: "source", path: event.target.value })}
                  >
                    {(field.sourceOptions || [field.sourcePath]).map((path) => <option key={path} value={path}>{path}</option>)}
                  </select>
                </label>
              ) : mode === "custom" ? (
                <label className="text-sm text-slate-600 sm:col-span-2">
                  <span className="block mb-1 font-medium">Platform custom-value API name</span>
                  <input
                    aria-label={`${field.label} custom field`}
                    className="onepos-input"
                    value={mapping.field || ""}
                    placeholder="e.g. delivery_description"
                    onChange={(event) => update(field.target, { same_as_source: true, type: "custom", field: event.target.value })}
                  />
                </label>
              ) : mode === "constant" ? (
                <label className="text-sm text-slate-600 sm:col-span-2">
                  <span className="block mb-1 font-medium">Constant value</span>
                  <input
                    aria-label={`${field.label} constant value`}
                    className="onepos-input"
                    value={mapping.value ?? ""}
                    onChange={(event) => update(field.target, { same_as_source: true, type: "constant", value: event.target.value })}
                  />
                </label>
              ) : (
                <label className="text-sm text-slate-600 sm:col-span-2">
                  <span className="block mb-1 font-medium">Required Platform custom override field</span>
                  <input
                    aria-label={`${field.label} override field`}
                    className="onepos-input"
                    required
                    value={mapping.override_field || ""}
                    placeholder="e.g. uber_menu_title"
                    onChange={(event) => update(field.target, { same_as_source: false, override_field: event.target.value })}
                  />
                  <span className="block mt-1 text-xs text-slate-500">Required. Product-specific values use the generic Platform custom-value record.</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
