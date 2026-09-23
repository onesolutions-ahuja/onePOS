import React, { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";

export default function RuleList({
  onNew,
  onEdit,
  onBack,
  objectId = null,
}) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadRules();
  }, [objectId]);

  async function loadRules() {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest("/api/platform/rules");

      const loaded =
        data?.data || [];

      const rules = Array.isArray(loaded) ? loaded : [];
      setRules(objectId
        ? rules.filter((rule) => String(rule.object_id) === String(objectId))
        : rules);
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load rules."
      );
    } finally {
      setLoading(false);
    }
  }

  async function deactivateRule(rule) {
    const ruleId =
      rule?.id ||
      rule?.rule_id;

    if (!ruleId) {
      return;
    }

    if (
      !window.confirm(
        `Deactivate "${rule.name || rule.rule_key || "this rule"}"?`
      )
    ) {
      return;
    }

    setError("");

    try {
      await apiRequest(`/api/platform/rules/${ruleId}`, {
        method: "DELETE",
      });

      await loadRules();
    } catch (err) {
      setError(
        err?.message ||
          "Unable to deactivate rule."
      );
    }
  }

  function ruleName(rule) {
    return (
      rule?.name ||
      rule?.label ||
      rule?.rule_key ||
      "Unnamed Rule"
    );
  }

  function ruleKey(rule) {
    return (
      rule?.rule_key ||
      rule?.api_key ||
      rule?.key ||
      "—"
    );
  }

  function objectName(rule) {
    return (
      rule?.object_label ||
      rule?.object_name ||
      rule?.objectKey ||
      rule?.object_key ||
      rule?.object_id ||
      "—"
    );
  }

  function triggerName(trigger) {
    if (!trigger) {
      return "—";
    }

    return trigger
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) =>
        letter.toUpperCase()
      );
  }

  function actionName(action) {
    if (!action) {
      return "—";
    }
    if (typeof action === "object") {
      return action.type || action.name || "Configured action";
    }

    return action
      .replaceAll("_", " ")
      .replace(/\b\w/g, (letter) =>
        letter.toUpperCase()
      );
  }

  return (
    <div className="platform-rule-list">
      <div className="platform-rule-list-header">
        <div>
          <div className="platform-eyebrow">
            PLATFORM / RULES
          </div>

          <h2>Rules</h2>

          <p>
            Configure validation and workflow metadata
            for platform objects.
          </p>
        </div>

        <div className="platform-rule-list-actions">
          {onBack ? (
            <button
              type="button"
              className="platform-secondary-button"
              onClick={onBack}
            >
              Back
            </button>
          ) : null}

          <button
            type="button"
            className="platform-primary-button"
            onClick={onNew}
          >
            + New Rule
          </button>
        </div>
      </div>

      <div className="platform-rule-notice">
        <strong>Validation rules</strong>

        <span>
          Active validation rules run before Platform record saves.
          Other workflow actions remain configuration only.
        </span>
      </div>

      {error ? (
        <div className="platform-alert">
          {error}
        </div>
      ) : null}

      <div className="platform-rule-table-card">
        {loading ? (
          <div className="platform-empty">
            Loading rules…
          </div>
        ) : rules.length === 0 ? (
          <div className="platform-empty">
            <strong>No rules configured</strong>

            <span>
              Create your first rule to configure
              metadata-driven validation.
            </span>
          </div>
        ) : (
          <div className="platform-table-wrapper">
            <table className="platform-rule-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Object</th>
                  <th>Trigger</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {rules.map((rule) => {
                  const id =
                    rule?.id ||
                    rule?.rule_id ||
                    ruleKey(rule);

                  const active =
                    rule?.active !== false;

                  return (
                    <tr key={id}>
                      <td>
                        <div className="platform-rule-name">
                          <strong>
                            {ruleName(rule)}
                          </strong>

                          <small>
                            {ruleKey(rule)}
                          </small>
                        </div>
                      </td>

                      <td>
                        {objectName(rule)}
                      </td>

                      <td>
                        {triggerName(
                          rule?.trigger_key || rule?.trigger
                        )}
                      </td>

                      <td>
                        {actionName(
                          rule?.action
                        )}
                      </td>

                      <td>
                        <span
                          className={
                            active
                              ? "platform-status active"
                              : "platform-status inactive"
                          }
                        >
                          {active
                            ? "Active"
                            : "Inactive"}
                        </span>
                      </td>

                      <td>
                        <div className="platform-row-actions">
                          <button
                            type="button"
                            onClick={() =>
                              onEdit?.(rule)
                            }
                          >
                            Edit
                          </button>

                          {active ? (
                            <button
                              type="button"
                              className="danger"
                              onClick={() =>
                                deactivateRule(
                                  rule
                                )
                              }
                            >
                              Deactivate
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        .platform-rule-list {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
          color: var(--text-primary, #1f2937);
        }

        .platform-rule-list-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
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

        .platform-rule-list-header h2 {
          margin: 0;
          font-size: 24px;
        }

        .platform-rule-list-header p {
          margin: 6px 0 0;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
        }

        .platform-rule-list-actions {
          display: flex;
          gap: 8px;
        }

        .platform-primary-button,
        .platform-secondary-button {
          border-radius: 8px;
          padding: 9px 14px;
          font-size: 12px;
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

        .platform-rule-notice {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-bottom: 15px;
          padding: 11px 13px;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 8px;
          background: var(--muted-background, #f9fafb);
          font-size: 11px;
        }

        .platform-rule-notice span {
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

        .platform-rule-table-card {
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #fff);
          overflow: hidden;
        }

        .platform-table-wrapper {
          overflow-x: auto;
        }

        .platform-rule-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        .platform-rule-table th {
          padding: 11px 14px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
          background: var(--muted-background, #f9fafb);
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          white-space: nowrap;
        }

        .platform-rule-table td {
          padding: 13px 14px;
          border-bottom: 1px solid var(--border-color, #f0f0f0);
          vertical-align: middle;
        }

        .platform-rule-table tbody tr:last-child td {
          border-bottom: 0;
        }

        .platform-rule-name strong,
        .platform-rule-name small {
          display: block;
        }

        .platform-rule-name strong {
          font-size: 12px;
        }

        .platform-rule-name small {
          margin-top: 3px;
          color: var(--text-secondary, #6b7280);
          font-size: 9px;
        }

        .platform-status {
          display: inline-flex;
          padding: 4px 7px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 700;
        }

        .platform-status.active {
          background: #ecfdf5;
          color: #047857;
        }

        .platform-status.inactive {
          background: #f3f4f6;
          color: #6b7280;
        }

        .platform-row-actions {
          display: flex;
          justify-content: flex-end;
          gap: 5px;
        }

        .platform-row-actions button {
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 6px;
          background: var(--card-background, #fff);
          color: inherit;
          padding: 5px 8px;
          font-size: 10px;
          cursor: pointer;
        }

        .platform-row-actions button.danger {
          color: #b91c1c;
        }

        .platform-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          padding: 50px 20px;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
          text-align: center;
        }

        .platform-empty strong {
          color: inherit;
          font-size: 14px;
        }

        @media (max-width: 750px) {
          .platform-rule-list-header {
            flex-direction: column;
          }

          .platform-rule-list-actions {
            width: 100%;
          }

          .platform-rule-list-actions button {
            flex: 1;
          }
        }
      `}</style>
    </div>
  );
}
