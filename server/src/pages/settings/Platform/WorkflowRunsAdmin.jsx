import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../services/api.js";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusBadge(status) {
  const normalized = String(status || "").toUpperCase();
  const palette = {
    COMPLETED: "bg-emerald-100 text-emerald-700",
    FAILED: "bg-red-100 text-red-700",
    WAITING: "bg-amber-100 text-amber-700",
    RUNNING: "bg-sky-100 text-sky-700",
    PENDING: "bg-slate-200 text-slate-700",
    STOPPED: "bg-slate-200 text-slate-700",
    SKIPPED: "bg-slate-200 text-slate-700",
  };
  return `inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${palette[normalized] || "bg-slate-200 text-slate-700"}`;
}

export default function WorkflowRunsAdmin({ onMessage, onError }) {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadRuns = async () => {
    try {
      setLoading(true);
      const response = await apiRequest("/api/platform/workflow-runs?limit=50");
      const nextRuns = Array.isArray(response?.data) ? response.data : [];
      setRuns(nextRuns);
      if (!selectedRunId && nextRuns[0]?.id) {
        setSelectedRunId(nextRuns[0].id);
      }
    } catch (error) {
      onError(error.message || "Unable to load workflow runs");
    } finally {
      setLoading(false);
    }
  };

  const loadRun = async (runId) => {
    if (!runId) return;
    try {
      setLoadingDetail(true);
      const response = await apiRequest(`/api/platform/workflow-runs/${runId}`);
      setDetails(response?.data || null);
      setSelectedRunId(runId);
    } catch (error) {
      onError(error.message || "Unable to load workflow run details");
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadRuns();
  }, []);

  useEffect(() => {
    if (selectedRunId) {
      loadRun(selectedRunId);
    }
  }, [selectedRunId]);

  const run = useMemo(() => details?.run || null, [details]);

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <strong>Workflow Runs</strong>
          <button type="button" onClick={loadRuns} className="text-xs text-blue-700">Refresh</button>
        </div>
        <div className="max-h-[72vh] overflow-auto">
          {loading ? (
            <div className="p-4 text-sm text-slate-500">Loading runs…</div>
          ) : runs.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No workflow runs yet.</div>
          ) : (
            runs.map((currentRun) => (
              <button
                key={currentRun.id}
                type="button"
                onClick={() => setSelectedRunId(currentRun.id)}
                className={`block w-full border-b border-slate-100 px-4 py-3 text-left ${selectedRunId === currentRun.id ? "bg-blue-50" : "bg-white"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm text-slate-700">{currentRun.workflow_name || "Workflow"}</span>
                  {statusBadge(currentRun.status)}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">Run #{currentRun.id?.slice(0, 8) || ""}</div>
                <div className="mt-2 text-[11px] text-slate-500">{currentRun.trigger_key || "trigger"} • {currentRun.record_id ? "record" : "object"}</div>
                <div className="mt-1 text-[11px] text-slate-500">{formatDate(currentRun.started_at)}</div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        {loadingDetail ? (
          <div className="text-sm text-slate-500">Loading run details…</div>
        ) : !run ? (
          <div className="text-sm text-slate-500">Select a run to view details.</div>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">Workflow</div>
              <h3 className="mt-1 text-xl font-semibold text-slate-800">{run.workflow_name || "Workflow"}</h3>
              <div className="mt-2 text-sm text-slate-600">Run #{run.id?.slice(0, 8) || ""}</div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-slate-500">Status</div><div className="mt-2">{statusBadge(run.status)}</div></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-slate-500">Started</div><div className="mt-2">{formatDate(run.started_at)}</div></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-slate-500">Completed</div><div className="mt-2">{formatDate(run.completed_at)}</div></div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-slate-500">Trigger</div><div className="mt-2">{run.trigger_key || "—"}</div></div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs uppercase tracking-wide text-slate-500">Trigger record</div>
              <div className="mt-2 text-sm text-slate-700">{run.record_id || run.object_id || "—"}</div>
            </div>

            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-700">Step history</div>
              {(details?.steps || []).length === 0 ? (
                <div className="text-sm text-slate-500">No step history recorded.</div>
              ) : (
                <div className="space-y-2">
                  {(details.steps || []).map((step) => (
                    <div key={step.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-sm text-slate-700">{step.step_order}. {step.action_type || "Step"}</div>
                        {statusBadge(step.status)}
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs text-slate-600">
                        <div><span className="text-slate-500">Started:</span> {formatDate(step.started_at)}</div>
                        <div><span className="text-slate-500">Completed:</span> {formatDate(step.completed_at)}</div>
                      </div>
                      {step.error_text ? <div className="mt-2 rounded bg-red-50 border border-red-200 px-2 py-2 text-xs text-red-700">{step.error_text}</div> : null}
                      {step.durable_job_id ? <div className="mt-2 text-xs text-slate-600">Durable job: {step.durable_job_id}</div> : null}
                      {step.child_run_id ? <div className="mt-2 text-xs text-slate-600">Child run: {step.child_run_id}</div> : null}
                      {step.job?.status ? <div className="mt-2 text-xs text-slate-600">Job: {step.job.status} • attempts {step.job.attempts || 0}</div> : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
