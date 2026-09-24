import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { apiRequest } from "../services/api.js";
import ChangePasswordModal from "../pages/settings/ChangePasswordModal.jsx";

export default function AccountOnboardingGate() {
  const [state,setState]=useState(null); const [error,setError]=useState("");
  const load=useCallback(async()=>{try{const r=await apiRequest("/api/account/onboarding"); if(r.success)setState(r.data);}catch(e){setError(e.message||"Unable to load account setup");}},[]);
  useEffect(()=>{load();},[load]);
  const policy=state?.pendingPolicies?.[0]||null;
  const accept=async()=>{try{setError("");await apiRequest(`/api/policies/${policy.id}/accept`,{method:"POST"});await load();}catch(e){setError(e.message||"Unable to record acceptance");}};
  if(!state)return null;
  if(state.mustChangePassword) return <ChangePasswordModal open onClose={()=>{}} onChanged={load}/>;
  if(!policy)return null;
  return <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/35 backdrop-blur-md p-5" role="dialog" aria-modal="true">
    <section className="w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/60 bg-white/95 shadow-2xl animate-[oneposSurfaceIn_.22s_ease-out]">
      <header className="flex items-center gap-3 border-b border-slate-200/80 px-6 py-5"><span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100"><ShieldCheck size={20}/></span><div><h1 className="text-lg font-semibold text-slate-900">{policy.title}</h1><p className="text-xs text-slate-500">{policy.name} · version {policy.version}</p></div></header>
      <div className="max-h-[55vh] overflow-auto whitespace-pre-wrap px-6 py-5 text-sm leading-6 text-slate-700">{policy.body}</div>
      {error&&<div className="mx-6 mb-3 onepos-alert onepos-alert-error">{error}</div>}
      <footer className="flex items-center justify-between border-t border-slate-200/80 bg-slate-50/80 px-6 py-4"><span className="text-xs text-slate-500">Acceptance is recorded against this exact policy version.</span><button className="onepos-button onepos-button-primary" onClick={accept}>Agree & Continue</button></footer>
    </section>
  </div>;
}
