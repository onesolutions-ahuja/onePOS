import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";

export default function ModuleInstaller({
  onBack,
  onInstall,
  onActivate,
  onDeactivate,
}) {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState("");
  const [error, setError] = useState("");
  const [installPlan, setInstallPlan] = useState(null);
  const [selectedFeatures, setSelectedFeatures] = useState([]);

  useEffect(() => {
    loadModules();
  }, []);

  async function loadModules() {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/api/platform/packages");

      const loaded = data?.data?.packages || data?.data || [];

      setModules(Array.isArray(loaded) ? loaded : []);
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load platform modules."
      );
    } finally {
      setLoading(false);
    }
  }

  function getKey(module) {
    return (
      module?.packageKey ||
      module?.package_key ||
      module?.moduleKey ||
      module?.module_key ||
      module?.key ||
      ""
    );
  }

  function getName(module) {
    return (
      module?.name ||
      module?.label ||
      module?.moduleName ||
      module?.module_name ||
      getKey(module) ||
      "Unnamed Module"
    );
  }

  function getVersion(module) {
    return (
      module?.version ||
      module?.moduleVersion ||
      module?.module_version ||
      "-"
    );
  }

  function getDescription(module) {
    return (
      module?.description ||
      "No description available."
    );
  }

  function isInstalled(module) {
    if (module?.company_installation) {
      return true;
    }
    if (typeof module?.installed === "boolean") {
      return module.installed;
    }

    if (typeof module?.is_installed === "boolean") {
      return module.is_installed;
    }

    return Boolean(
      module?.installed_at ||
        module?.installation_id
    );
  }

  function isActive(module) {
    if (module?.company_installation) {
      return module.company_installation.status === "active";
    }
    if (typeof module?.active === "boolean") {
      return module.active;
    }

    if (typeof module?.is_active === "boolean") {
      return module.is_active;
    }

    return isInstalled(module);
  }

  async function runAction(action, module) {
    const key = getKey(module);

    if (!key || !action) {
      return;
    }

    setWorkingKey(key);
    setError("");

    try {
      if (action === "install") {
        const plan = await apiRequest(`/api/platform/packages/${encodeURIComponent(key)}/plan`);
        const planData = plan?.data || plan || {};
        const featureDefinitions = getOptionalFeatures(module, planData);
        setInstallPlan({ module, packages: Array.isArray(planData.packages) ? planData.packages : [], features: featureDefinitions });
        setSelectedFeatures(
          featureDefinitions.filter((feature) => feature.default === true).map(getFeatureKey)
        );
        return;
      }

      function getOptionalFeatures(module, planData = {}) {
        const root = Array.isArray(planData?.packages)
          ? planData.packages[planData.packages.length - 1]
          : null;
        const manifest = module?.manifest || root?.manifest || planData?.manifest || {};
        const features = manifest.optionalFeatures || manifest.optional_features || module?.optionalFeatures || [];
        return Array.isArray(features) ? features : [];
      }

      function getFeatureKey(feature) {
        return feature?.key || feature?.featureKey || feature?.feature_key || "";
      }

      function getFeatureName(feature) {
        return feature?.name || feature?.label || getFeatureKey(feature) || "Optional feature";
      }

      function packagePlanState(item) {
        const key = getKey(item);
        const installedModule = modules.find((module) => getKey(module) === key);
        if (!installedModule) return "missing";
        if (isInstalled(installedModule)) return "already-installed";
        return "will-install";
      }

      function packagePlanRole(item, packages) {
        if (item?.optional === true) return "optional";
        const key = getKey(item);
        if (packages.some((pkg) =>
          (pkg.dependencies || []).some((dependency) =>
            typeof dependency === "object" &&
            dependency.optional === true &&
            getKey(dependency) === key
          )
        )) {
          return "optional";
        }
        return "required";
      }

      async function confirmInstallPlan() {
        if (!installPlan) return;
        const module = installPlan.module;
        const key = getKey(module);
        setInstallPlan(null);
        try {
          if (onInstall) {
            await onInstall(module, {
              features: selectedFeatures,
              packages: installPlan.packages,
            });
          } else {
            await apiRequest(`/api/platform/packages/${encodeURIComponent(key)}/install`, {
              method: "POST",
              body: JSON.stringify({ features: selectedFeatures }),
            });
          }
          await loadModules();
        } catch (err) {
          setError(err?.message || "Unable to install module.");
        } finally {
          setWorkingKey("");
        }
      }

      if (action === "activate") {
        if (onActivate) {
          await onActivate(module);
        }
      }

      if (action === "deactivate") {
        if (onDeactivate) {
          await onDeactivate(module);
        } else {
          await apiRequest(`/api/platform/packages/${encodeURIComponent(key)}/deactivate`, { method: "POST", body: JSON.stringify({}) });
        }
      }

      await loadModules();
    } catch (err) {
      setError(
        err?.message ||
          `Unable to ${action} module.`
      );
    } finally {
      setWorkingKey("");
    }
  }

  async function handleDeactivate(module) {
    const name = getName(module);

    if (
      !window.confirm(
        `Deactivate "${name}"?`
      )
    ) {
      return;
    }

    await runAction("deactivate", module);
  }

  function statusLabel(module) {
    if (!isInstalled(module)) {
      return "Not installed";
    }

    return isActive(module)
      ? "Active"
      : "Inactive";
  }

  function statusClass(module) {
    if (!isInstalled(module)) {
      return "not-installed";
    }

    return isActive(module)
      ? "active"
      : "inactive";
  }

  return (
    <div className="platform-module-installer">
      <div className="platform-module-header">
        <div>
          <div className="platform-eyebrow">
            PLATFORM / MODULES
          </div>

          <h2>Modules</h2>

          <p>
            Manage the predefined applications installed
            in this onePOS environment.
          </p>
        </div>

        {onBack ? (
          <button
            type="button"
            className="platform-secondary-button"
            onClick={onBack}
          >
            Back
          </button>
        ) : null}
      </div>

      <div className="platform-module-notice">
        <strong>Module configuration</strong>

        <span>
          Modules are predefined applications. Installation
          and activation are controlled by the platform and
          do not modify existing business data.
        </span>
      </div>

      {error ? (
        <div className="platform-alert">
          {error}
        </div>
      ) : null}

      {installPlan ? (
        <div className="platform-install-plan" role="dialog" aria-modal="true" aria-labelledby="platform-install-plan-title">
          <div className="platform-install-plan-header">
            <div>
              <div className="platform-eyebrow">INSTALLATION PLAN</div>
              <h2 id="platform-install-plan-title">
                Install {getName(installPlan.module)}
              </h2>
              <p>Review what will be installed before confirming.</p>
            </div>
            <button
              type="button"
              className="platform-secondary-button"
              onClick={() => setInstallPlan(null)}
              disabled={workingKey === getKey(installPlan.module)}
            >
              Cancel
            </button>
          </div>

          <div className="platform-install-plan-list">
            {installPlan.packages.length ? installPlan.packages.map((item) => {
              const state = packagePlanState(item);
              const role = packagePlanRole(item, installPlan.packages);
              return (
                <div className="platform-install-plan-row" key={getKey(item) || item.id}>
                  <div>
                    <strong>{item.name || getKey(item)}</strong>
                    <span>{getKey(item)}{item.version ? ` · ${item.version}` : ""}</span>
                  </div>
                  <div className="platform-install-plan-badges">
                    <span className={`platform-plan-badge ${role}`}>{role}</span>
                    <span className={`platform-plan-badge ${state}`}>{state}</span>
                  </div>
                </div>
              );
            }) : (
              <div className="platform-empty">No package details were returned.</div>
            )}
          </div>

          {installPlan.features.length ? (
            <fieldset className="platform-install-features">
              <legend>Optional features</legend>
              <p>Select any additional features to install with this module.</p>
              {installPlan.features.map((feature) => {
                const featureKey = getFeatureKey(feature);
                const checked = selectedFeatures.includes(featureKey);
                return (
                  <label className="platform-install-feature" key={featureKey}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedFeatures((current) =>
                          checked
                            ? current.filter((key) => key !== featureKey)
                            : [...current, featureKey]
                        )
                      }
                    />
                    <span>
                      <strong>{getFeatureName(feature)}</strong>
                      {feature.description ? <small>{feature.description}</small> : null}
                    </span>
                    <span className="platform-plan-badge optional">optional</span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}

          <div className="platform-install-plan-actions">
            <button
              type="button"
              className="platform-secondary-button"
              onClick={() => setInstallPlan(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="platform-primary-button"
              onClick={confirmInstallPlan}
            >
              Confirm installation
            </button>
          </div>
        </div>
      ) : null}

      <div className="platform-module-card">
        {loading ? (
          <div className="platform-empty">
            Loading modules...
          </div>
        ) : modules.length === 0 ? (
          <div className="platform-empty">
            <strong>No modules available</strong>

            <span>
              No platform modules are currently registered.
            </span>
          </div>
        ) : (
          <div className="platform-module-grid">
            {modules.map((module) => {
              const key = getKey(module);
              const installed = isInstalled(module);
              const active = isActive(module);
              const working = workingKey === key;

              return (
                <div
                  className="platform-module-item"
                  key={
                    key ||
                    module?.id ||
                    module?.module_id
                  }
                >
                  <div className="platform-module-item-top">
                    <div>
                      <h3>{getName(module)}</h3>

                      <div className="platform-module-key">
                        {key || "-"}
                      </div>
                    </div>

                    <span
                      className={`platform-module-status ${statusClass(
                        module
                      )}`}
                    >
                      {statusLabel(module)}
                    </span>
                  </div>

                  <p className="platform-module-description">
                    {getDescription(module)}
                  </p>

                  <div className="platform-module-meta">
                    <span>
                      <strong>Version</strong>
                      {getVersion(module)}
                    </span>

                    <span>
                      <strong>API Key</strong>
                      {key || "-"}
                    </span>
                  </div>

                  <div className="platform-module-actions">
                    {!installed ? (
                      <button
                        type="button"
                        className="platform-primary-button"
                        disabled={working}
                        onClick={() =>
                          runAction(
                            "install",
                            module
                          )
                        }
                      >
                        {working
                          ? "Working..."
                          : "Install"}
                      </button>
                    ) : active ? (
                      <button
                        type="button"
                        className="platform-danger-button"
                        disabled={working}
                        onClick={() =>
                          handleDeactivate(module)
                        }
                      >
                        {working
                          ? "Working..."
                          : "Deactivate"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="platform-primary-button"
                        disabled={working}
                        onClick={() =>
                          runAction(
                            "activate",
                            module
                          )
                        }
                      >
                        {working
                          ? "Working..."
                          : "Activate"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .platform-module-installer {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          color: var(--text-primary, #1f2937);
        }

        .platform-module-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 18px;
        }

        .platform-eyebrow {
          margin-bottom: 5px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          opacity: 0.6;
        }

        .platform-module-header h2 {
          margin: 0;
          font-size: 24px;
        }

        .platform-module-header p {
          margin: 6px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
        }

        .platform-module-notice {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
          padding: 11px 13px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 8px;
          background: var(--muted-background, #f9fafb);
          font-size: 11px;
        }

        .platform-module-notice span {
          color: var(--text-secondary, #6b7280);
        }

        .platform-alert {
          margin-bottom: 15px;
          padding: 11px 13px;
          border: 1px solid #fecaca;
          border-radius: 8px;
          background: #fff7f7;
          color: #991b1b;
          font-size: 12px;
        }

        .platform-install-plan {
          margin-bottom: 16px;
          padding: 16px;
          border: 1px solid var(--primary-color, #2563eb);
          border-radius: 12px;
          background: var(--card-background, #fff);
          box-shadow: 0 8px 24px rgba(31, 41, 55, 0.08);
        }

        .platform-install-plan-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 14px;
        }

        .platform-install-plan-header h2 {
          margin: 0;
          font-size: 18px;
        }

        .platform-install-plan-header p,
        .platform-install-features p {
          margin: 5px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
        }

        .platform-install-plan-list {
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .platform-install-plan-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 8px;
        }

        .platform-install-plan-row > div:first-child {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }

        .platform-install-plan-row strong {
          font-size: 12px;
        }

        .platform-install-plan-row span:not(.platform-plan-badge) {
          color: var(--text-secondary, #6b7280);
          font-family: monospace;
          font-size: 10px;
          overflow-wrap: anywhere;
        }

        .platform-install-plan-badges {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 5px;
        }

        .platform-plan-badge {
          display: inline-block;
          padding: 4px 7px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 700;
          white-space: nowrap;
        }

        .platform-plan-badge.required,
        .platform-plan-badge.will-install {
          background: #eff6ff;
          color: #1d4ed8;
        }

        .platform-plan-badge.optional {
          background: #fef3c7;
          color: #92400e;
        }

        .platform-plan-badge.already-installed {
          background: #ecfdf5;
          color: #047857;
        }

        .platform-plan-badge.missing {
          background: #fef2f2;
          color: #b91c1c;
        }

        .platform-install-features {
          margin: 16px 0 0;
          padding: 12px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 8px;
        }

        .platform-install-features legend {
          padding: 0 5px;
          font-size: 12px;
          font-weight: 700;
        }

        .platform-install-feature {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-top: 10px;
          cursor: pointer;
          font-size: 11px;
        }

        .platform-install-feature > span:nth-child(2) {
          display: flex;
          flex: 1;
          flex-direction: column;
          gap: 2px;
        }

        .platform-install-feature small {
          color: var(--text-secondary, #6b7280);
        }

        .platform-install-plan-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 16px;
        }

        .platform-module-card {
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #fff);
          padding: 16px;
        }

        .platform-module-grid {
          display: grid;
          grid-template-columns:
            repeat(
              auto-fill,
              minmax(280px, 1fr)
            );
          gap: 14px;
        }

        .platform-module-item {
          display: flex;
          flex-direction: column;
          min-height: 210px;
          padding: 16px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 10px;
          background: var(--card-background, #fff);
        }

        .platform-module-item-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
        }

        .platform-module-item h3 {
          margin: 0;
          font-size: 15px;
        }

        .platform-module-key {
          margin-top: 4px;
          color: var(--text-secondary, #6b7280);
          font-family: monospace;
          font-size: 9px;
        }

        .platform-module-status {
          flex-shrink: 0;
          padding: 4px 7px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 700;
          white-space: nowrap;
        }

        .platform-module-status.active {
          background: #ecfdf5;
          color: #047857;
        }

        .platform-module-status.inactive {
          background: #f3f4f6;
          color: #6b7280;
        }

        .platform-module-status.not-installed {
          background: #fff7ed;
          color: #c2410c;
        }

        .platform-module-description {
          min-height: 40px;
          margin: 15px 0;
          color: var(--text-secondary, #6b7280);
          font-size: 11px;
          line-height: 1.5;
        }

        .platform-module-meta {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-bottom: 15px;
          padding-top: 11px;
          border-top: 1px solid var(--border-color, #f0f0f0);
        }

        .platform-module-meta span {
          display: flex;
          flex-direction: column;
          gap: 3px;
          color: var(--text-secondary, #6b7280);
          font-size: 10px;
          overflow-wrap: anywhere;
        }

        .platform-module-meta strong {
          color: var(--text-primary, #374151);
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .platform-module-actions {
          display: flex;
          gap: 8px;
          margin-top: auto;
        }

        .platform-primary-button,
        .platform-secondary-button,
        .platform-danger-button {
          border-radius: 8px;
          padding: 9px 14px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }

        .platform-primary-button {
          border: 1px solid var(--primary-color, #2563eb);
          background: var(--primary-color, #2563eb);
          color: #fff;
        }

        .platform-secondary-button {
          border: 1px solid var(--border-color, #d1d5db);
          background: var(--card-background, #fff);
          color: inherit;
        }

        .platform-danger-button {
          border: 1px solid #fecaca;
          background: #fff;
          color: #b91c1c;
        }

        .platform-primary-button:disabled,
        .platform-secondary-button:disabled,
        .platform-danger-button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .platform-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          padding: 55px 20px;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
          text-align: center;
        }

        .platform-empty strong {
          color: inherit;
          font-size: 14px;
        }

        @media (max-width: 700px) {
          .platform-module-header {
            flex-direction: column;
          }

          .platform-module-header > button {
            width: 100%;
          }

          .platform-module-grid {
            grid-template-columns: 1fr;
          }

          .platform-install-plan-header,
          .platform-install-plan-row {
            align-items: stretch;
            flex-direction: column;
          }

          .platform-install-plan-badges {
            justify-content: flex-start;
          }
        }
      `}</style>
    </div>
  );
}
