import React, { useEffect, useMemo, useState } from "react";
import { Zap } from "lucide-react";
import { apiRequest } from "../../../services/api.js";

/*
 * ACTIONS — management screen over the EXISTING platform Action Registry.
 *
 * The catalogue is the one already served by /api/platform/workflow-actions
 * (services/platformWorkflow.js getWorkflowActionRegistry) — the same registry
 * the Flow Builder's step type picker uses. This screen adds nothing to the
 * registry: it presents what exists and, for communication actions, reflects
 * whether the company's integration provider is configured (the same readiness
 * signal the save-time activation check in routes/platform.js enforces).
 *
 * Registration functions and subflows come from the same Workflow Builder data
 * (platform_rules with action.type === "workflow"); subflows are the reusable
 * flows an admin has already published.
 */

const PROVIDER_ACTION_KIND = {
  SEND_EMAIL: "EMAIL",
  SEND_SMS: "SMS",
  SEND_WHATSAPP: "WHATSAPP",
};

/** Registry keys with no server executor/validation yet. Shown clearly as
 *  unavailable instead of being hidden, per the capability-first audit. */
const NOT_IMPLEMENTED = new Set();

function actionKindLabel(item) {
  if (item.key.startsWith("SEND_")) return "Communication";
  if (["CREATE_RECORD", "UPDATE_RECORD", "UPDATE_RELATED_RECORD", "CREATE_RELATED_RECORD", "DELETE_RECORD", "ASSIGN_RECORD"].includes(item.key)) {
    return "Record";
  }
  if (["ADD_RELATIONSHIP", "REMOVE_RELATIONSHIP"].includes(item.key)) return "Relationship";
  if (item.key === "IN_APP_NOTIFICATION") return "Notification";
  if (item.key === "CALL_FUNCTION") return "Registered function";
  if (item.key === "RUN_SUBFLOW") return "Subflow";
  if (item.key === "WEBHOOK") return "Webhook";
  if (item.key === "CONDITION") return "Logic";
  if (item.key === "WAIT") return "Timing";
  if (item.key === "STOP") return "Logic";
  return "Other";
}

function providerPill(available) {
  return (
    <span
      className={"onepos-badge " + (available ? "onepos-badge-success" : "onepos-badge-warning")}
    >
      {available ? "Provider configured" : "Provider not configured"}
    </span>
  );
}

export default function ActionsAdmin({ onError }) {
  const [actions, setActions] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const [registryResponse, integrationsResponse] = await Promise.all([
          apiRequest("/api/platform/workflow-actions"),
          apiRequest("/api/integrations").catch(() => ({ data: [] })),
        ]);

        if (cancelled) return;

        setActions(Array.isArray(registryResponse?.data) ? registryResponse.data : []);
        setIntegrations(Array.isArray(integrationsResponse?.data) ? integrationsResponse.data : []);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || "Unable to load the action registry.");
          onError?.(err?.message || "Unable to load the action registry.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [onError]);

  const providerAvailability = useMemo(() => {
    const state = { EMAIL: false, SMS: false, WHATSAPP: false };

    for (const item of integrations) {
      const provider = String(item.provider || "").toUpperCase();
      if (provider in state) {
        state[provider] = Boolean(
          item.active !== false &&
          item.configuration &&
          Object.keys(item.configuration || {}).length > 0
        );
      }
    }

    return state;
  }, [integrations]);

  const filtered = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return actions;

    return actions.filter((item) =>
      [item.key, item.displayName, item.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }, [actions, search]);

  const executable = (item) => !NOT_IMPLEMENTED.has(item.key);

  return (
    <div className="platform-surface-body">
      <div className="onepos-page-header">
        <div>
          <h1 className="onepos-page-title">Actions</h1>
          <p className="onepos-page-subtitle">
            The registered actions available to Flows, Validation Rules and
            record buttons. Configure communication providers under Settings →
            Connections before using Send actions.
          </p>
        </div>

        <div className="onepos-page-header-actions">
          <div className="pobj-search">
            <input
              type="search"
              className="onepos-input pobj-search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search actions..."
              aria-label="Search actions"
            />
          </div>
        </div>
      </div>

      {error ? (
        <div className="pobj-alert-wrap">
          <div className="onepos-alert onepos-alert-error">
            <strong>Unable to load the action registry.</strong> {error}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="onepos-empty">
          <span>Loading actions…</span>
        </div>
      ) : (
        <div className="onepos-card">
          <div className="pobj-table-wrap">
            <table className="onepos-table pobj-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>API Key</th>
                  <th>Category</th>
                  <th>Runs async</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const providerKind = PROVIDER_ACTION_KIND[item.key];
                  const available = executable(item) && (!providerKind || providerAvailability[providerKind]);

                  return (
                    <tr key={item.key}>
                      <td>
                        <span className="pobj-object-name">
                          <Zap size={13} aria-hidden="true" />
                          <strong>{item.displayName || item.key}</strong>
                        </span>
                        {item.description ? (
                          <small className="pobj-empty-hint">{item.description}</small>
                        ) : null}
                      </td>
                      <td>
                        <code className="pobj-code">{item.key}</code>
                      </td>
                      <td>{actionKindLabel(item)}</td>
                      <td>{item.async ? "Yes" : "No"}</td>
                      <td>
                        {item.key === "RUN_SUBFLOW" ? (
                          <span className="onepos-badge onepos-badge-info">Reusable flows</span>
                        ) : providerKind ? (
                          providerPill(available)
                        ) : available ? (
                          <span className="onepos-badge onepos-badge-success">Available</span>
                        ) : (
                          <span className="onepos-badge onepos-badge-warning">Not implemented</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
