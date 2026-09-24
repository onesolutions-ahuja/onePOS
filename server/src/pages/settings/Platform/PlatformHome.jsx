import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";

function StatCard({ label, value, description }) {
  return (
    <div className="platform-stat-card">
      <div className="platform-stat-label">{label}</div>
      <div className="platform-stat-value">{value}</div>
      {description ? (
        <div className="platform-stat-description">{description}</div>
      ) : null}
    </div>
  );
}

function SectionCard({ title, description, children }) {
  return (
    <section className="platform-section-card">
      <div className="platform-section-header">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export default function PlatformHome({ onNavigate }) {
  const [metadata, setMetadata] = useState(null);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPlatform() {
      setLoading(true);
      setError("");

      try {
        const [metadataData, modulesData] = await Promise.all([
          apiRequest("/api/platform/metadata"),
          apiRequest("/api/platform/modules"),
        ]);

        if (!cancelled) {
          setMetadata(metadataData);
          setModules(
            modulesData?.data ||
            modulesData?.modules ||
            (Array.isArray(modulesData) ? modulesData : [])
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Unable to load platform information.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadPlatform();

    return () => {
      cancelled = true;
    };
  }, []);

  const objects =
    metadata?.objects ||
    metadata?.data?.objects ||
    metadata?.metadata?.objects ||
    [];

  const fields =
    metadata?.fields ||
    metadata?.data?.fields ||
    metadata?.metadata?.fields ||
    [];

  const relationships =
    metadata?.relationships ||
    metadata?.data?.relationships ||
    metadata?.metadata?.relationships ||
    [];

  const layouts =
    metadata?.layouts ||
    metadata?.data?.layouts ||
    metadata?.metadata?.layouts ||
    [];

  const rules =
    metadata?.rules ||
    metadata?.data?.rules ||
    metadata?.metadata?.rules ||
    [];

  const objectCount = Array.isArray(objects) ? objects.length : 0;
  const fieldCount = Array.isArray(fields) ? fields.length : 0;
  const relationshipCount = Array.isArray(relationships)
    ? relationships.length
    : 0;
  const layoutCount = Array.isArray(layouts) ? layouts.length : 0;
  const ruleCount = Array.isArray(rules) ? rules.length : 0;

  const installedModules = Array.isArray(modules) ? modules : [];

  function navigate(target) {
    if (typeof onNavigate === "function") {
      onNavigate(target);
    }
  }

  return (
    <div className="platform-page">
      <div className="platform-page-header">
        <div>
          <div className="platform-eyebrow">ONEPOS PLATFORM</div>
          <h1>Platform</h1>
          <p>
            Configure business objects, fields, relationships, pages and
            applications without changing the underlying business logic.
          </p>
        </div>
      </div>

      {error ? (
        <div className="platform-alert platform-alert-error">
          <strong>Unable to load platform data.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <div className="platform-stat-grid">
        <StatCard
          label="Objects"
          value={loading ? "-" : objectCount}
          description="Business objects available to the platform"
        />

        <StatCard
          label="Fields"
          value={loading ? "-" : fieldCount}
          description="Configured object fields"
        />

        <StatCard
          label="Relationships"
          value={loading ? "-" : relationshipCount}
          description="Connections between objects"
        />

        <StatCard
          label="Pages"
          value={loading ? "-" : layoutCount}
          description="Configured layouts and pages"
        />

        <StatCard
          label="Rules"
          value={loading ? "-" : ruleCount}
          description="Configured business rules"
        />

        <StatCard
          label="Modules"
          value={loading ? "-" : installedModules.length}
          description="Installed applications"
        />
      </div>

      <div className="platform-content-grid">
        <SectionCard
          title="Objects"
          description="Define the business objects used by your applications."
        >
          <div className="platform-action-list">
            <button
              type="button"
              className="platform-action-row"
              onClick={() => navigate("objects")}
            >
              <span>
                <strong>Manage Objects</strong>
                <small>
                  Create and configure objects such as Customer, Product or
                  any future business object.
                </small>
              </span>
              <span className="platform-action-arrow">-></span>
            </button>

            <button
              type="button"
              className="platform-action-row"
              onClick={() => navigate("fields")}
            >
              <span>
                <strong>Manage Fields</strong>
                <small>
                  Configure fields, types, labels, required status and
                  visibility.
                </small>
              </span>
              <span className="platform-action-arrow">-></span>
            </button>

            <button
              type="button"
              className="platform-action-row"
              onClick={() => navigate("relationships")}
            >
              <span>
                <strong>Relationships</strong>
                <small>
                  Define how objects connect to one another.
                </small>
              </span>
              <span className="platform-action-arrow">-></span>
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title="Pages & Automation"
          description="Control how applications behave and appear to users."
        >
          <div className="platform-action-list">
            <button
              type="button"
              className="platform-action-row"
              onClick={() => navigate("pages")}
            >
              <span>
                <strong>Pages & Layouts</strong>
                <small>
                  Configure different layouts for different users and
                  business requirements.
                </small>
              </span>
              <span className="platform-action-arrow">-></span>
            </button>

            <button
              type="button"
              className="platform-action-row"
              onClick={() => navigate("rules")}
            >
              <span>
                <strong>Rules</strong>
                <small>
                  Define future validation and workflow behaviour from the
                  platform.
                </small>
              </span>
              <span className="platform-action-arrow">-></span>
            </button>

            <button
              type="button"
              className="platform-action-row"
              onClick={() => navigate("modules")}
            >
              <span>
                <strong>Applications / Modules</strong>
                <small>
                  View the applications installed on this onePOS system.
                </small>
              </span>
              <span className="platform-action-arrow">-></span>
            </button>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Installed Applications"
        description="Applications provide predefined business functionality on top of the platform."
      >
        {loading ? (
          <div className="platform-empty-state">Loading applications...</div>
        ) : installedModules.length === 0 ? (
          <div className="platform-empty-state">
            No applications are currently registered.
          </div>
        ) : (
          <div className="platform-module-grid">
            {installedModules.map((module) => (
              <div
                className="platform-module-card"
                key={module.id || module.module_key || module.key}
              >
                <div className="platform-module-icon">*</div>

                <div className="platform-module-body">
                  <h3>
                    {module.name ||
                      module.display_name ||
                      module.module_key ||
                      module.key ||
                      "Unnamed Module"}
                  </h3>

                  <p>
                    {module.description ||
                      "Installed onePOS application/module."}
                  </p>

                  <div className="platform-module-meta">
                    <span>
                      {module.version ? `v${module.version}` : "Installed"}
                    </span>

                    {module.active === false || module.enabled === false ? (
                      <span className="platform-status-disabled">
                        Disabled
                      </span>
                    ) : (
                      <span className="platform-status-active">Active</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <style>{`
        .platform-page {
          padding: 24px;
          max-width: 1500px;
          margin: 0 auto;
          color: var(--text-primary, #1f2937);
        }

        .platform-page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
        }

        .platform-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.12em;
          opacity: 0.6;
          margin-bottom: 6px;
        }

        .platform-page-header h1 {
          margin: 0;
          font-size: 30px;
          line-height: 1.2;
        }

        .platform-page-header p {
          margin: 8px 0 0;
          max-width: 760px;
          color: var(--text-secondary, #6b7280);
          line-height: 1.5;
        }

        .platform-stat-grid {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 20px;
        }

        .platform-stat-card {
          min-height: 118px;
          padding: 18px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #ffffff);
          box-sizing: border-box;
        }

        .platform-stat-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--text-secondary, #6b7280);
        }

        .platform-stat-value {
          margin-top: 10px;
          font-size: 30px;
          line-height: 1;
          font-weight: 700;
        }

        .platform-stat-description {
          margin-top: 10px;
          font-size: 11px;
          line-height: 1.4;
          color: var(--text-secondary, #6b7280);
        }

        .platform-content-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 20px;
          margin-bottom: 20px;
        }

        .platform-section-card {
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 14px;
          background: var(--card-background, #ffffff);
          overflow: hidden;
        }

        .platform-section-header {
          padding: 20px 20px 14px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .platform-section-header h2 {
          margin: 0;
          font-size: 17px;
        }

        .platform-section-header p {
          margin: 5px 0 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-secondary, #6b7280);
        }

        .platform-action-list {
          padding: 6px 0;
        }

        .platform-action-row {
          width: 100%;
          border: 0;
          border-bottom: 1px solid var(--border-color, #f0f0f0);
          background: transparent;
          padding: 15px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          text-align: left;
          cursor: pointer;
          color: inherit;
        }

        .platform-action-row:last-child {
          border-bottom: 0;
        }

        .platform-action-row:hover {
          background: var(--hover-background, #f8fafc);
        }

        .platform-action-row strong {
          display: block;
          font-size: 14px;
        }

        .platform-action-row small {
          display: block;
          margin-top: 4px;
          max-width: 560px;
          font-size: 12px;
          line-height: 1.4;
          color: var(--text-secondary, #6b7280);
        }

        .platform-action-arrow {
          font-size: 20px;
          opacity: 0.5;
          margin-left: 15px;
        }

        .platform-module-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          padding: 18px;
        }

        .platform-module-card {
          display: flex;
          gap: 12px;
          padding: 16px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #ffffff);
        }

        .platform-module-icon {
          width: 38px;
          height: 38px;
          border-radius: 9px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          background: var(--muted-background, #f3f4f6);
          font-size: 18px;
        }

        .platform-module-body {
          min-width: 0;
        }

        .platform-module-body h3 {
          margin: 0;
          font-size: 14px;
        }

        .platform-module-body p {
          margin: 5px 0 8px;
          font-size: 12px;
          line-height: 1.4;
          color: var(--text-secondary, #6b7280);
        }

        .platform-module-meta {
          display: flex;
          gap: 8px;
          align-items: center;
          font-size: 11px;
          color: var(--text-secondary, #6b7280);
        }

        .platform-status-active,
        .platform-status-disabled {
          padding: 3px 7px;
          border-radius: 999px;
          background: var(--muted-background, #f3f4f6);
        }

        .platform-status-active {
          color: #166534;
        }

        .platform-status-disabled {
          color: #991b1b;
        }

        .platform-empty-state {
          padding: 30px 20px;
          text-align: center;
          color: var(--text-secondary, #6b7280);
          font-size: 13px;
        }

        .platform-alert {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 20px;
          padding: 14px 16px;
          border-radius: 10px;
          border: 1px solid var(--border-color, #e5e7eb);
          font-size: 13px;
        }

        .platform-alert-error {
          background: #fff7f7;
          border-color: #fecaca;
          color: #991b1b;
        }

        @media (max-width: 1200px) {
          .platform-stat-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .platform-module-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 800px) {
          .platform-page {
            padding: 16px;
          }

          .platform-stat-grid,
          .platform-content-grid,
          .platform-module-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}
