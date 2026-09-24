import React from "react";

export default function ObjectPageHeader({
  object = null,
  objectLabel = "",
  objectKey = "",
  description = "",
  recordCount,
  readOnly = true,
  onBack,
  onConfigure,
  onRefresh,
  loading = false,
}) {
  const label =
    objectLabel ||
    object?.label ||
    object?.name ||
    objectKey ||
    "Object";

  const apiKey =
    objectKey ||
    object?.objectKey ||
    object?.object_key ||
    "";

  const objectDescription =
    description ||
    object?.description ||
    "";

  const hasRecordCount =
    recordCount !== undefined &&
    recordCount !== null;

  return (
    <header className="platform-object-page-header">
      <div className="platform-object-page-header-main">
        <div className="platform-object-page-header-navigation">
          {onBack ? (
            <button
              type="button"
              className="platform-object-page-back"
              onClick={onBack}
              disabled={loading}
              aria-label="Back"
            >
              ←
            </button>
          ) : null}

          <div className="platform-object-page-icon">
            {label.charAt(0).toUpperCase()}
          </div>
        </div>

        <div className="platform-object-page-heading">
          <div className="platform-object-page-title-row">
            <h2>{label}</h2>

            {readOnly ? (
              <span className="platform-object-page-badge">
                Read only
              </span>
            ) : null}
          </div>

          <div className="platform-object-page-meta">
            {apiKey ? (
              <span className="platform-object-page-api-key">
                {apiKey}
              </span>
            ) : null}

            {hasRecordCount ? (
              <span>
                {recordCount}{" "}
                {recordCount === 1
                  ? "record"
                  : "records"}
              </span>
            ) : null}
          </div>

          {objectDescription ? (
            <p className="platform-object-page-description">
              {objectDescription}
            </p>
          ) : null}
        </div>
      </div>

      <div className="platform-object-page-actions">
        {onRefresh ? (
          <button
            type="button"
            className="platform-object-page-button secondary"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        ) : null}

        {onConfigure ? (
          <button
            type="button"
            className="platform-object-page-button secondary"
            onClick={onConfigure}
            disabled={loading}
          >
            Configure
          </button>
        ) : null}
      </div>

      <style>{`
        .platform-object-page-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          width: 100%;
          min-width: 0;
          padding: 16px 18px;
          box-sizing: border-box;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #fff);
        }

        .platform-object-page-header-main {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          min-width: 0;
        }

        .platform-object-page-header-navigation {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 0 0 auto;
        }

        .platform-object-page-back {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          padding: 0;
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 7px;
          background: var(--card-background, #fff);
          color: var(--text-primary, #374151);
          font-size: 15px;
          line-height: 1;
          cursor: pointer;
        }

        .platform-object-page-back:hover {
          background: var(--muted-background, #f9fafb);
        }

        .platform-object-page-back:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .platform-object-page-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border-radius: 7px;
          background: var(--muted-background, #f3f4f6);
          color: var(--text-primary, #374151);
          font-size: 12px;
          font-weight: 800;
        }

        .platform-object-page-heading {
          min-width: 0;
        }

        .platform-object-page-title-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }

        .platform-object-page-title-row h2 {
          margin: 0;
          color: var(--text-primary, #1f2937);
          font-size: 17px;
          line-height: 1.25;
        }

        .platform-object-page-badge {
          display: inline-flex;
          align-items: center;
          padding: 3px 7px;
          border-radius: 999px;
          background: var(--muted-background, #f3f4f6);
          color: var(--text-secondary, #6b7280);
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }

        .platform-object-page-meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 4px;
          color: var(--text-secondary, #6b7280);
          font-size: 9px;
        }

        .platform-object-page-api-key {
          color: var(--text-secondary, #6b7280);
          font-family: monospace;
        }

        .platform-object-page-api-key::after {
          content: "•";
          margin-left: 7px;
          color: var(--text-secondary, #9ca3af);
        }

        .platform-object-page-description {
          max-width: 700px;
          margin: 6px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 10px;
          line-height: 1.45;
        }

        .platform-object-page-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 7px;
          flex: 0 0 auto;
        }

        .platform-object-page-button {
          border-radius: 7px;
          padding: 8px 11px;
          font-family: inherit;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }

        .platform-object-page-button.secondary {
          border: 1px solid var(--border-color, #d1d5db);
          background: var(--card-background, #fff);
          color: var(--text-primary, #374151);
        }

        .platform-object-page-button.secondary:hover {
          background: var(--muted-background, #f9fafb);
        }

        .platform-object-page-button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        @media (max-width: 700px) {
          .platform-object-page-header {
            flex-direction: column;
          }

          .platform-object-page-header-main {
            width: 100%;
          }

          .platform-object-page-actions {
            width: 100%;
            justify-content: flex-start;
          }
        }
      `}</style>
    </header>
  );
}
