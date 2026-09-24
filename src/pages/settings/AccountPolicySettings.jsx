import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import { Toggle } from "../../components/ui.jsx";

export default function AccountPolicySettings({onMessage,onError}){
 const [cfg,setCfg]=useState(null); const [policies,setPolicies]=useState([]); const [draft,setDraft]=useState({apiKey:"terms",name:"Terms of Service",title:"Terms of Service",body:""});
 const load=async()=>{try{const [a,p]=await Promise.all([apiRequest("/api/settings/account-policy"),apiRequest("/api/policies")]);if(a.success)setCfg({userEmailDomain:a.data.user_email_domain||"",domainUsersOnly:a.data.domain_users_only===true,emailRegistrationEnabled:a.data.email_registration_enabled===true,passwordResetEmailEnabled:a.data.password_reset_email_enabled!==false,registrationLinkExpiryMinutes:a.data.registration_link_expiry_minutes||1440,passwordResetExpiryMinutes:a.data.password_reset_expiry_minutes||60});if(p.success)setPolicies(p.data||[]);}catch(e){onError?.(e.message);}};
 useEffect(()=>{load();},[]);
 if(!cfg)return <div className="text-sm text-slate-500">Loading account policies…</div>;
 const save=async()=>{try{await apiRequest("/api/settings/account-policy",{method:"PUT",body:JSON.stringify(cfg)});onMessage?.("Account policy settings saved.");}catch(e){onError?.(e.message);}};
 const create=async()=>{try{await apiRequest("/api/policies",{method:"POST",body:JSON.stringify(draft)});setDraft({...draft,body:""});await load();onMessage?.("New policy version created as Draft.");}catch(e){onError?.(e.message);}};
 const activate=async(id)=>{try{await apiRequest(`/api/policies/${id}/activate`,{method:"POST"});await load();onMessage?.("Policy version activated.");}catch(e){onError?.(e.message);}};
 return <div className="space-y-5">
  <section className="onepos-card max-w-3xl"><h2 className="font-semibold">Account & registration policy</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">
   <label className="onepos-label">Allowed email domain<input className="onepos-input mt-1" value={cfg.userEmailDomain} onChange={e=>setCfg({...cfg,userEmailDomain:e.target.value})} placeholder="onepos.com"/></label>
   <label className="flex items-center justify-between gap-3 onepos-label">Domain users only<Toggle checked={cfg.domainUsersOnly} onChange={v=>setCfg({...cfg,domainUsersOnly:v})}/></label>
   <label className="flex items-center justify-between gap-3 onepos-label">Email registration link<Toggle checked={cfg.emailRegistrationEnabled} onChange={v=>setCfg({...cfg,emailRegistrationEnabled:v})}/></label>
   <label className="flex items-center justify-between gap-3 onepos-label">Password reset by email<Toggle checked={cfg.passwordResetEmailEnabled} onChange={v=>setCfg({...cfg,passwordResetEmailEnabled:v})}/></label>
  </div><button className="onepos-button onepos-button-primary mt-4" onClick={save}>Save settings</button></section>
  <section className="onepos-card max-w-3xl"><h2 className="font-semibold">Global policies & agreements</h2><p className="mt-1 text-sm text-slate-500">Create a new immutable version, review it, then activate it. Activation makes the previous version inactive.</p>
   <div className="mt-4 grid gap-3"><input className="onepos-input" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/><input className="onepos-input" value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})}/><textarea className="onepos-input min-h-32" value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})} placeholder="Approved agreement/policy content"/><button className="onepos-button onepos-button-secondary w-fit" onClick={create} disabled={!draft.body.trim()}>Create draft version</button></div>
   <div className="mt-5 divide-y divide-slate-200">{policies.map(p=><div key={p.id} className="flex items-center justify-between gap-4 py-3"><div><div className="font-medium">{p.name} <span className="text-xs text-slate-500">v{p.version}</span></div><div className="text-xs text-slate-500">{p.status}</div></div>{p.status!=="ACTIVE"&&<button className="onepos-button onepos-button-secondary" onClick={()=>activate(p.id)}>Activate</button>}</div>)}</div>
  </section>
 </div>;
}
