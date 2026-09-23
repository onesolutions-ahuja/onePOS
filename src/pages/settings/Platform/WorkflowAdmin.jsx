import { useEffect, useState } from "react";
import { apiRequest } from "../../../services/api.js";
import PlatformFieldPicker from "./PlatformFieldPicker.jsx";

const inputClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none";
const actionOptions = [
  { value: "CREATE_RECORD", label: "Create Record" },
  { value: "UPDATE_RECORD", label: "Update Record" },
  { value: "UPDATE_RELATED_RECORD", label: "Update Related Record" },
  { value: "CREATE_RELATED_RECORD", label: "Create Related Record" },
  { value: "DELETE_RECORD", label: "Delete Record" },
  { value: "ASSIGN_RECORD", label: "Assign Record" },
  { value: "ADD_RELATIONSHIP", label: "Add Relationship" },
  { value: "REMOVE_RELATIONSHIP", label: "Remove Relationship" },
  { value: "IN_APP_NOTIFICATION", label: "In-App Notification" },
  { value: "SEND_EMAIL", label: "Send Email" },
  { value: "SEND_SMS", label: "Send SMS" },
  { value: "SEND_WHATSAPP", label: "Send WhatsApp" },
  { value: "CALL_FUNCTION", label: "Call Function" },
  { value: "RUN_SUBFLOW", label: "Run Subflow" },
  { value: "WEBHOOK", label: "Webhook" },
  { value: "CONDITION", label: "Condition" },
  { value: "WAIT", label: "Wait" },
  { value: "STOP", label: "Stop" },
];

const functionOptions = ["safe_echo"];
const subflowOptions = ["Order Ready Workflow", "Customer Welcome Flow", "Stock Reorder Flow"];

function blankCondition() {
  return { id: Date.now() + Math.random(), field: "", operator: "equals", value: "" };
}

function makeStep(type = "CREATE_RECORD") {
  return {
    id: `step-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    enabled: true,
    expanded: true,
    type,
    label: actionOptions.find((option) => option.value === type)?.label || "Action",
    config: {
      object: "orders",
      recordId: "",
      fieldMappings: { status: "status" },
      template: "",
      recipient: "customer.email",
      providerStatus: "not-configured",
      functionKey: functionOptions[0],
      inputs: { value: "hello" },
      workflowId: subflowOptions[0],
      workflowInputs: { order_id: "{{id}}" },
      condition: { type: "all", rules: [blankCondition()] },
      ifBranch: [],
      elseBranch: [],
      durationSeconds: 60,
      reason: "",
      url: "",
      method: "POST",
      message: "",
      title: "",
    },
  };
}

function getActionLabel(type) {
  return actionOptions.find((option) => option.value === type)?.label || "Action";
}

function ProviderStatusPill({ available }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${available ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
      {available ? "Provider configured" : "Provider not configured"}
    </span>
  );
}

function StepConditionEditor({ value, onChange, objectKey }) {
  const config = value || { type: "all", rules: [blankCondition()] };
  const update = (patch) => onChange({ ...config, ...patch });

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-700">Condition</span>
        <select className={inputClass} value={config.type || "all"} onChange={(event) => update({ type: event.target.value })}>
          <option value="all">IF ALL</option>
          <option value="any">IF ANY</option>
        </select>
      </div>
      {(config.rules || []).map((rule, index) => (
        <div className="grid gap-2 md:grid-cols-[1.2fr_0.9fr_1fr_auto]" key={rule.id || index}>
          <PlatformFieldPicker selectedObjectKey={objectKey} value={rule.field || ""} label="Field" onChange={(field) => {
            const next = [...(config.rules || [])];
            next[index] = { ...rule, field };
            update({ rules: next });
          }} />
          <select className={inputClass} value={rule.operator || "equals"} onChange={(event) => {
            const next = [...(config.rules || [])];
            next[index] = { ...rule, operator: event.target.value };
            update({ rules: next });
          }}>
            <option value="equals">Equals</option>
            <option value="not_equals">Not equal</option>
            <option value="greater_than">Greater than</option>
            <option value="less_than">Less than</option>
            <option value="is_empty">Is empty</option>
          </select>
          <input className={inputClass} value={rule.value || ""} onChange={(event) => {
            const next = [...(config.rules || [])];
            next[index] = { ...rule, value: event.target.value };
            update({ rules: next });
          }} placeholder="Value" disabled={["is_empty"].includes(rule.operator)} />
          <button type="button" className="rounded border border-slate-200 px-2 text-sm text-slate-600" onClick={() => {
            const next = [...(config.rules || [])].filter((_, itemIndex) => itemIndex !== index);
            update({ rules: next.length ? next : [blankCondition()] });
          }}>Remove</button>
        </div>
      ))}
      <button type="button" className="text-sm text-blue-700" onClick={() => update({ rules: [...(config.rules || []), blankCondition()] })}>+ Add condition</button>
    </div>
  );
}

function StepEditor({ step, index, updateStep, moveStep, duplicateStep, deleteStep, addStepAt, providerAvailable }) {
  const updateConfig = (patch) => updateStep(index, { config: { ...(step.config || {}), ...patch } });
  const updateFieldMapping = (key, value) => {
    const fieldMappings = { ...(step.config?.fieldMappings || {}) };
    fieldMappings[key] = value;
    updateConfig({ fieldMappings });
  };

  const renderConfig = () => {
    switch (step.type) {
      case "CREATE_RECORD":
      case "UPDATE_RECORD":
      case "UPDATE_RELATED_RECORD":
      case "CREATE_RELATED_RECORD":
      case "DELETE_RECORD":
      case "ASSIGN_RECORD":
      case "ADD_RELATIONSHIP":
      case "REMOVE_RELATIONSHIP": {
        return (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Object</label>
                <PlatformFieldPicker includeObjectSelector selectedObjectKey={step.config?.object || ""} onObjectChange={(object) => updateConfig({ object })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Record source</label>
                <input className={inputClass} value={step.config?.recordId || ""} onChange={(event) => updateConfig({ recordId: event.target.value })} placeholder="record id or source" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Field mappings</label>
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                {Object.entries(step.config?.fieldMappings || { status: "status" }).map(([key, value], mappingIndex) => (
                  <div className="grid gap-2 md:grid-cols-2" key={`${key}-${mappingIndex}`}>
                    <PlatformFieldPicker selectedObjectKey={step.config?.object || ""} value={key} label="Target field" onChange={(field) => {
                      const next = { ...(step.config?.fieldMappings || {}) };
                      const currentValue = next[key];
                      delete next[key];
                      next[field] = currentValue;
                      updateConfig({ fieldMappings: next });
                    }} />
                    <input className={inputClass} value={value} onChange={(event) => updateFieldMapping(key, event.target.value)} />
                    <PlatformFieldPicker selectedObjectKey={step.config?.object || ""} value="" label="Insert source field" onInsert={(token) => updateFieldMapping(key, token.slice(2, -2))} />
                  </div>
                ))}
                <button type="button" className="text-sm text-blue-700" onClick={() => updateConfig({ fieldMappings: { ...(step.config?.fieldMappings || {}), [`field_${Object.keys(step.config?.fieldMappings || {}).length + 1}`]: "" } })}>+ Add mapping</button>
              </div>
            </div>
          </div>
        );
      }
      case "SEND_EMAIL":
      case "SEND_SMS":
      case "SEND_WHATSAPP": {
        const available = providerAvailable[step.type === "SEND_EMAIL" ? "EMAIL" : step.type === "SEND_SMS" ? "SMS" : "WHATSAPP"];
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <span className="text-sm font-medium text-slate-700">{step.type}</span>
              <ProviderStatusPill available={available} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Template</label>
              <input className={inputClass} value={step.config?.template || ""} onChange={(event) => updateConfig({ template: event.target.value })} placeholder="Template key or name" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Recipient mapping</label>
              <input className={inputClass} value={step.config?.recipient || ""} onChange={(event) => updateConfig({ recipient: event.target.value })} placeholder="customer.email / order.contact / team" />
              <PlatformFieldPicker selectedObjectKey={step.config?.object || ""} value="" label="Insert recipient field" onInsert={(token) => updateConfig({ recipient: token })} />
            </div>
          </div>
        );
      }
      case "IN_APP_NOTIFICATION":
        return (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Title</label>
              <input className={inputClass} value={step.config?.title || ""} onChange={(event) => updateConfig({ title: event.target.value })} placeholder="Notification title" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Message</label>
              <textarea className={inputClass} value={step.config?.message || ""} onChange={(event) => updateConfig({ message: event.target.value })} rows={3} placeholder="Message text or template" />
              <PlatformFieldPicker selectedObjectKey={step.config?.object || ""} value="" label="Insert message field" onInsert={(token) => updateConfig({ message: `${step.config?.message || ""}${token}` })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Recipient mapping</label>
              <input className={inputClass} value={step.config?.recipient || ""} onChange={(event) => updateConfig({ recipient: event.target.value })} placeholder="user.id / team" />
            </div>
          </div>
        );
      case "CALL_FUNCTION":
        return (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Registered function</label>
              <select className={inputClass} value={step.config?.functionKey || functionOptions[0]} onChange={(event) => updateConfig({ functionKey: event.target.value })}>
                {functionOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Inputs</label>
              <textarea className={inputClass} value={JSON.stringify(step.config?.inputs || {}, null, 2)} onChange={(event) => {
                try {
                  updateConfig({ inputs: JSON.parse(event.target.value) || {} });
                } catch {
                  updateConfig({ inputs: { value: event.target.value } });
                }
              }} rows={4} />
            </div>
          </div>
        );
      case "RUN_SUBFLOW":
        return (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Workflow</label>
              <select className={inputClass} value={step.config?.workflowId || subflowOptions[0]} onChange={(event) => updateConfig({ workflowId: event.target.value })}>
                {subflowOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Input mapping</label>
              <textarea className={inputClass} value={JSON.stringify(step.config?.workflowInputs || {}, null, 2)} onChange={(event) => {
                try {
                  updateConfig({ workflowInputs: JSON.parse(event.target.value) || {} });
                } catch {
                  updateConfig({ workflowInputs: { value: event.target.value } });
                }
              }} rows={4} />
            </div>
          </div>
        );
      case "CONDITION":
        return (
          <div className="space-y-3">
            <StepConditionEditor objectKey={step.config?.object || ""} value={step.config?.condition || { type: "all", rules: [blankCondition()] }} onChange={(condition) => updateConfig({ condition })} />
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">IF branch</label>
              <input className={inputClass} value={step.config?.ifBranch?.join(", ") || ""} onChange={(event) => updateConfig({ ifBranch: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Matching steps" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">ELSE branch</label>
              <input className={inputClass} value={step.config?.elseBranch?.join(", ") || ""} onChange={(event) => updateConfig({ elseBranch: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Fallback steps" />
            </div>
          </div>
        );
      case "WAIT":
        return (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Duration (seconds)</label>
              <input className={inputClass} type="number" min="0" value={step.config?.durationSeconds || 0} onChange={(event) => updateConfig({ durationSeconds: Number(event.target.value || 0) })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Resume at</label>
              <input className={inputClass} type="datetime-local" value={step.config?.resumeAt || ""} onChange={(event) => updateConfig({ resumeAt: event.target.value })} />
            </div>
          </div>
        );
      case "STOP":
        return (
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Optional reason</label>
            <input className={inputClass} value={step.config?.reason || ""} onChange={(event) => updateConfig({ reason: event.target.value })} placeholder="Stop reason" />
          </div>
        );
      case "WEBHOOK":
        return (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">URL</label>
              <input className={inputClass} value={step.config?.url || ""} onChange={(event) => updateConfig({ url: event.target.value })} placeholder="https://..." />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Method</label>
              <select className={inputClass} value={step.config?.method || "POST"} onChange={(event) => updateConfig({ method: event.target.value })}>
                <option value="POST">POST</option>
                <option value="GET">GET</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
              </select>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600" onClick={() => moveStep(index, -1)} title="Move up">↑</button>
          <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600" onClick={() => moveStep(index, 1)} title="Move down">↓</button>
          <span className="text-sm font-semibold text-slate-700">{index + 1}. {getActionLabel(step.type)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600" onClick={() => duplicateStep(index)} title="Duplicate">Duplicate</button>
          <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600" onClick={() => updateStep(index, { enabled: !step.enabled })}>{step.enabled ? "Disable" : "Enable"}</button>
          <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600" onClick={() => addStepAt(index)} title="Add step before">+ Add Step</button>
          <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600" onClick={() => addStepAt(index + 1)} title="Add step after">+ Add After</button>
          <button type="button" className="rounded border border-slate-200 px-2 py-1 text-xs text-red-600" onClick={() => deleteStep(index)}>Delete</button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <select className={inputClass} value={step.type} onChange={(event) => updateStep(index, { type: event.target.value, label: getActionLabel(event.target.value) })}>
            {actionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button type="button" className="rounded border border-slate-200 px-3 py-2 text-sm text-slate-600" onClick={() => updateStep(index, { expanded: !step.expanded })}>{step.expanded ? "Collapse" : "Expand"}</button>
        </div>

        {step.expanded && (
          <div className="pt-1">{renderConfig()}</div>
        )}
      </div>
    </div>
  );
}

export default function WorkflowAdmin({ onMessage, onError }) {
  const [workflow, setWorkflow] = useState(() => {
    try {
      const cached = localStorage.getItem("onepos_workflow_builder");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed.steps)) {
          return {
            ...parsed,
            steps: parsed.steps.map((step) => ({
              ...makeStep(step.type || "CREATE_RECORD"),
              ...step,
              config: {
                ...(makeStep(step.type || "CREATE_RECORD").config),
                ...(step.config || {}),
              },
            })),
          };
        }
      }
    } catch {
      // no-op: fall back to a fresh draft
    }

    return {
      name: "Order Ready Workflow",
      object: "orders",
      trigger: "after_update",
      steps: [
        { ...makeStep("WHEN"), type: "CONDITION", label: "Condition" },
        { ...makeStep("CREATE_RECORD"), config: { ...makeStep("CREATE_RECORD").config, object: "orders", fieldMappings: { status: "status" } } },
        { ...makeStep("SEND_SMS"), config: { ...makeStep("SEND_SMS").config, template: "order_status", recipient: "customer.phone" } },
      ],
    };
  });

  const [showBuilder, setShowBuilder] = useState(false);
  const [savedWorkflows, setSavedWorkflows] = useState(() => {
    try {
      const cached = localStorage.getItem("onepos_workflow_builder");
      const parsed = cached ? JSON.parse(cached) : null;
      return parsed && typeof parsed === "object" ? [parsed] : [];
    } catch {
      return [];
    }
  });
  const [providerAvailable, setProviderAvailable] = useState({ EMAIL: false, SMS: false, WHATSAPP: false });

  useEffect(() => {
    apiRequest("/api/integrations")
      .then((response) => {
        const integrations = Array.isArray(response?.data) ? response.data : [];
        const nextState = { EMAIL: false, SMS: false, WHATSAPP: false };
        for (const item of integrations) {
          const provider = String(item.provider || "").toUpperCase();
          if (provider === "EMAIL" || provider === "SMS" || provider === "WHATSAPP") {
            nextState[provider] = Boolean(item.active !== false && item.configuration && Object.keys(item.configuration || {}).length > 0);
          }
        }
        setProviderAvailable(nextState);
      })
      .catch(() => {
        setProviderAvailable({ EMAIL: false, SMS: false, WHATSAPP: false });
      });
  }, []);

  const updateStep = (index, patch) => {
    setWorkflow((current) => ({
      ...current,
      steps: current.steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)),
    }));
  };

  const addStepAt = (index, type = "CREATE_RECORD") => {
    const nextStep = makeStep(type);
    setWorkflow((current) => ({
      ...current,
      steps: [...current.steps.slice(0, index), nextStep, ...current.steps.slice(index)],
    }));
  };

  const moveStep = (index, direction) => {
    setWorkflow((current) => {
      const next = [...current.steps];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, steps: next };
    });
  };

  const duplicateStep = (index) => {
    setWorkflow((current) => ({
      ...current,
      steps: [...current.steps.slice(0, index + 1), { ...current.steps[index], id: `step-${Date.now()}-${Math.random().toString(16).slice(2)}` }, ...current.steps.slice(index + 1)],
    }));
  };

  const deleteStep = (index) => {
    setWorkflow((current) => ({
      ...current,
      steps: current.steps.filter((_, stepIndex) => stepIndex !== index),
    }));
  };

  const saveWorkflow = () => {
    try {
      localStorage.setItem("onepos_workflow_builder", JSON.stringify(workflow));
      setSavedWorkflows((current) => [workflow, ...current.filter((item) => item.name !== workflow.name)]);
      setShowBuilder(false);
      if (typeof onMessage === "function") onMessage("Workflow saved.");
    } catch (error) {
      if (typeof onError === "function") onError(error?.message || "Unable to save workflow.");
    }
  };

  if (!showBuilder) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Workflows</h2>
            <p className="text-sm text-slate-500">Create and manage workflow builder configurations.</p>
          </div>
          <button type="button" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white" onClick={() => setShowBuilder(true)}>+ New Workflow</button>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white">
          {savedWorkflows.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No workflows configured.</div>
          ) : savedWorkflows.map((item, index) => (
            <div key={`${item.name || "workflow"}-${index}`} className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 last:border-b-0">
              <div>
                <strong className="text-sm text-slate-800">{item.name || "Unnamed workflow"}</strong>
                <span className="block text-xs text-slate-500">{item.object || "No trigger object"} · {item.trigger || "Manual"}</span>
              </div>
              <button type="button" className="text-sm text-blue-700" onClick={() => { setWorkflow(item); setShowBuilder(true); }}>Edit</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Workflow name</label>
            <input className={inputClass} value={workflow.name || ""} onChange={(event) => setWorkflow((current) => ({ ...current, name: event.target.value }))} placeholder="Workflow name" />
          </div>
          <div className="min-w-[220px]">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Trigger object</label>
            <PlatformFieldPicker
              includeObjectSelector
              objectOnly
              selectedObjectKey={workflow.object || ""}
              onObjectChange={(object) => setWorkflow((current) => ({ ...current, object }))}
            />
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Trigger</label>
            <select className={inputClass} value={workflow.trigger || "after_update"} onChange={(event) => setWorkflow((current) => ({ ...current, trigger: event.target.value }))}>
              <option value="after_create">Record created</option>
              <option value="after_update">Record updated</option>
              <option value="after_save">Created or updated</option>
              <option value="manual">Manual trigger</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded border border-slate-200 px-4 py-2 text-sm text-slate-600" onClick={() => setShowBuilder(false)}>Cancel</button>
            <button type="button" className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white" onClick={saveWorkflow}>Save workflow</button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {workflow.steps.length === 0 ? (
          <button type="button" className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-blue-700" onClick={() => addStepAt(0)}>
            + Add Step
          </button>
        ) : (
          workflow.steps.map((step, index) => (
            <StepEditor
              key={step.id || `${step.type}-${index}`}
              step={step}
              index={index}
              updateStep={updateStep}
              moveStep={moveStep}
              duplicateStep={duplicateStep}
              deleteStep={deleteStep}
              addStepAt={addStepAt}
              providerAvailable={providerAvailable}
            />
          ))
        )}
        <button type="button" className="w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-blue-700" onClick={() => addStepAt(workflow.steps.length)}>
          + Add Step
        </button>
      </div>
    </div>
  );
}
