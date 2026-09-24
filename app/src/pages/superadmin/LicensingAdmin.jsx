import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import { databaseConfigurationPayload } from "../../services/tenantDatabaseForm.js";

const DEFAULT_KEYS = ["pos", "inventory", "purchasing", "customers", "reports", "loyalty", "jarvis"];

export default function LicensingAdmin() {
  const [licences, setLicences] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [name, setName] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [selectedLicence, setSelectedLicence] = useState("");
  const [entitlements, setEntitlements] = useState(Object.fromEntries(DEFAULT_KEYS.map((key) => [key, false])));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [databaseCompany, setDatabaseCompany] = useState("");
  const [databaseConfig, setDatabaseConfig] = useState(null);
  const [databaseForm, setDatabaseForm] = useState({
    databaseMode: "ONEPOS_MANAGED",
    host: "",
    port: "5432",
    database: "",
    username: "",
    password: "",
    sslMode: "require",
  });
  const [databaseBusy, setDatabaseBusy] = useState(false);
  const [clientAdminEmail, setClientAdminEmail] = useState("");

  const load = async () => {
    try {
      const [licenceData, companyData] = await Promise.all([
        apiRequest("/api/superadmin/licences"),
        apiRequest("/api/superadmin/companies"),
      ]);
      if (!licenceData.success || !companyData.success) throw new Error("Unable to load licensing data");
      setLicences(licenceData.data || []);
      setCompanies(companyData.data || []);
    } catch (err) {
      setError(err.message || "Unable to load licensing data");
    }
  };

  useEffect(() => { load(); }, []);

  const createLicence = async () => {
    setError(""); setMessage("");
    try {
      const result = await apiRequest("/api/superadmin/licences", {
        method: "POST",
        body: JSON.stringify({ name, entitlements }),
      });
      if (!result.success) throw new Error(result.message);
      setName(""); setMessage("Licence created."); await load();
    } catch (err) { setError(err.message || "Unable to create licence"); }
  };

  const assignLicence = async () => {
    setError(""); setMessage("");
    try {
      const result = await apiRequest(`/api/superadmin/companies/${selectedCompany}/licence`, {
        method: "PUT",
        body: JSON.stringify({ licenceId: selectedLicence || null }),
      });
      if (!result.success) throw new Error(result.message);
      setMessage("Company licence updated."); await load();
    } catch (err) { setError(err.message || "Unable to assign licence"); }
  };

  const loadDatabaseConfig = async (companyId) => {
    setDatabaseCompany(companyId);
    setDatabaseConfig(null);
    setDatabaseForm((current) => ({ ...current, password: "" }));
    if (!companyId) return;
    try {
      const result = await apiRequest(`/api/superadmin/companies/${companyId}/database`);
      if (!result.success) throw new Error(result.message || "Unable to load database configuration");
      const data = result.data || {};
      setDatabaseConfig(data);
      setDatabaseForm({
        databaseMode: data.databaseMode || "ONEPOS_MANAGED",
        host: data.host || "",
        port: String(data.port || 5432),
        database: data.database || "",
        username: data.username || "",
        password: "",
        sslMode: data.sslMode || "require",
      });
      setClientAdminEmail(data.initialAdminEmail || "");
    } catch (err) {
      setError(err.message || "Unable to load database configuration");
    }
  };

  const provisionClientAdmin = async () => {
    if (!databaseCompany || !clientAdminEmail.trim()) {
      setError("Select a company and enter the client admin email.");
      return;
    }
    setDatabaseBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest(`/api/superadmin/companies/${databaseCompany}/provision-admin`, {
        method: "POST",
        body: JSON.stringify({ email: clientAdminEmail }),
        signal: AbortSignal.timeout(30000),
      });
      if (!result.success) throw new Error(result.message || "Unable to provision Company Admin");
      const normalizedEmail = clientAdminEmail.trim().toLowerCase();
      setClientAdminEmail(normalizedEmail);
      setDatabaseConfig((current) => ({ ...current, initialAdminEmail: normalizedEmail }));
      setMessage("Initial Company Admin saved. Initial password is marvel. You can change it from the account menu.");
    } catch (err) { setError(err.message || "Unable to provision Company Admin"); }
    finally { setDatabaseBusy(false); }
  };

  const saveDatabaseConfig = async () => {
    setDatabaseBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest(`/api/superadmin/companies/${databaseCompany}/database`, {
        method: "PUT",
        body: JSON.stringify(databaseConfigurationPayload(databaseForm)),
        signal: AbortSignal.timeout(30000),
      });
      if (!result.success) throw new Error(result.message || "Unable to save database configuration");
      setDatabaseConfig((current) => ({ ...current, ...result.data }));
      setDatabaseForm((current) => ({ ...current, password: "" }));
      setMessage("Database configuration saved. Test and validate it before activation.");
    } catch (err) { setError(err.message || "Unable to save database configuration"); }
    finally { setDatabaseBusy(false); }
  };

  const runDatabaseAction = async (action, successMessage) => {
    if (!databaseCompany) {
      setError("Select a company before running this database action.");
      return;
    }
    setDatabaseBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest(`/api/superadmin/companies/${databaseCompany}/database/${action}`, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
      });
      if (!result.success) throw new Error(result.message || `Unable to ${action.replace("-", " ")}`);
      setDatabaseConfig((current) => ({ ...current, ...(result.data || {}), schemaState: result.data?.schemaState || current?.schemaState }));
      setMessage(successMessage(result.data) || `${action.replace("-", " ")} completed successfully.`);
    } catch (err) {
      setError(err.message || `Unable to ${action.replace("-", " ")}`);
    }
    finally { setDatabaseBusy(false); }
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="onepos-page-header"><div><h1 className="onepos-page-title">Platform licensing</h1><p className="onepos-page-subtitle">Manage company entitlements without changing user permissions.</p></div></div>
      {message && <div className="onepos-alert onepos-alert-success" role="status">{message}</div>}
      {error && <div className="onepos-alert onepos-alert-error" role="alert">{error}</div>}
      <section className="onepos-card onepos-card-body space-y-4">
        <h2 className="onepos-card-title">Create licence</h2>
        <div className="flex gap-3">
          <input className="onepos-input flex-1" value={name} onChange={(event) => setName(event.target.value)} placeholder="Licence name" />
          <button className="onepos-btn onepos-btn-primary" onClick={createLicence} disabled={!name.trim()}>Create</button>
        </div>
        <div className="flex flex-wrap gap-4">
          {DEFAULT_KEYS.map((key) => <label key={key} className="text-sm flex gap-2 items-center"><input type="checkbox" checked={entitlements[key] === true} onChange={(event) => setEntitlements((current) => ({ ...current, [key]: event.target.checked }))} />{key}</label>)}
        </div>
      </section>
      <section className="onepos-card onepos-card-body space-y-4">
        <h2 className="onepos-card-title">Assign company licence</h2>
        <div className="flex gap-3">
          <select className="onepos-input flex-1" value={selectedCompany} onChange={(event) => setSelectedCompany(event.target.value)}><option value="">Select company</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name} ({company.licence_name || "unlicensed"})</option>)}</select>
          <select className="onepos-input flex-1" value={selectedLicence} onChange={(event) => setSelectedLicence(event.target.value)}><option value="">No licence</option>{licences.map((licence) => <option key={licence.id} value={licence.id}>{licence.name}</option>)}</select>
          <button className="onepos-btn onepos-btn-primary" onClick={assignLicence} disabled={!selectedCompany}>Assign</button>
        </div>
      </section>
      <section className="onepos-card overflow-hidden"><table className="onepos-table"><thead><tr><th>Licence</th><th>Status</th><th>Companies</th></tr></thead><tbody>{licences.map((licence) => <tr key={licence.id}><td className="font-medium">{licence.name}</td><td>{licence.active ? <span className="onepos-badge onepos-badge-success">Active</span> : <span className="onepos-badge onepos-badge-neutral">Inactive</span>}</td><td>{licence.company_count}</td></tr>)}</tbody></table></section>
      <section className="onepos-card onepos-card-body space-y-4">
        <div>
          <h2 className="onepos-card-title">Company database routing</h2>
          <p className="text-sm text-slate-600 mt-1">Platform Developer Superadmin only. Passwords are write-only and are never displayed after saving.</p>
        </div>
        <select className="onepos-input w-full" value={databaseCompany} onChange={(event) => loadDatabaseConfig(event.target.value)}>
          <option value="">Select company</option>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
        {databaseCompany && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-4">
              {["ONEPOS_MANAGED", "CUSTOMER_MANAGED"].map((mode) => (
                <label key={mode} className="text-sm flex gap-2 items-center">
                  <input type="radio" name="databaseMode" checked={databaseForm.databaseMode === mode} onChange={() => setDatabaseForm((current) => ({ ...current, databaseMode: mode }))} />
                  {mode === "ONEPOS_MANAGED" ? "onePOS Managed" : "Customer Managed"}
                </label>
              ))}
            </div>
            {databaseForm.databaseMode === "CUSTOMER_MANAGED" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  ["host", "Host"], ["port", "Port"], ["database", "Database"], ["username", "Username"],
                ].map(([key, label]) => (
                  <label key={key} className="text-sm text-slate-700">{label}
                    <input className="onepos-input mt-1 w-full" value={databaseForm[key]} onChange={(event) => setDatabaseForm((current) => ({ ...current, [key]: event.target.value }))} />
                  </label>
                ))}
                <label className="text-sm text-slate-700">Password
                  <input type="password" autoComplete="new-password" className="onepos-input mt-1 w-full" value={databaseForm.password} onChange={(event) => setDatabaseForm((current) => ({ ...current, password: event.target.value }))} placeholder={databaseConfig?.credentialsConfigured ? "Configured — leave blank to keep" : ""} />
                </label>
                <label className="text-sm text-slate-700">SSL
                  <select className="onepos-input mt-1 w-full" value={databaseForm.sslMode} onChange={(event) => setDatabaseForm((current) => ({ ...current, sslMode: event.target.value }))}>
                    <option value="require">Require</option><option value="verify-full">Verify full</option><option value="disable">Disable</option>
                  </select>
                </label>
              </div>
            )}
            {databaseConfig && (
              <div className="text-sm text-slate-600">
                <span>Credentials: {databaseConfig.credentialsConfigured ? "Configured" : "Not configured"}</span>
                <span className="ml-4">Schema: {databaseConfig.schemaState || "Unknown"}</span>
                <span className="ml-4">Active: {databaseConfig.active ? "Yes" : "No"}</span>
              </div>
            )}
            <div className="border-t border-slate-200 pt-4" data-testid="client-admin-provisioning">
              {databaseConfig?.initialAdminEmail ? (
                <div className="space-y-2">
                  <p role="status">Company Admin saved: <strong>{databaseConfig.initialAdminEmail}</strong></p>
                  <a className="onepos-btn onepos-btn-secondary" href={`/app/settings/users?companyId=${encodeURIComponent(databaseCompany)}`}>View in Users</a>
                </div>
              ) : <>
              <label className="text-sm text-slate-700" htmlFor="client-admin-email">Client Admin Email
                <input id="client-admin-email" type="email" autoComplete="email" className="onepos-input mt-1 w-full" value={clientAdminEmail} onChange={(event) => setClientAdminEmail(event.target.value)} placeholder="client-admin@example.com" />
              </label>
              <p className="text-xs text-slate-500 mt-1">Creates one Company Admin in the central identity database. Platform Superadmin access is never granted.</p>
              <button id="provision-client-admin" type="button" className="onepos-btn onepos-btn-secondary mt-3" onClick={provisionClientAdmin} disabled={databaseBusy || !clientAdminEmail.trim() || Boolean(databaseConfig?.initialAdminEmail)}>
                {databaseConfig?.initialAdminEmail ? "Initial Company Admin configured" : "Provision initial Company Admin"}
              </button>
              </>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="onepos-btn onepos-btn-primary" onClick={saveDatabaseConfig} disabled={databaseBusy}>{databaseBusy ? "Saving..." : "Save configuration"}</button>
              {databaseForm.databaseMode === "CUSTOMER_MANAGED" && <>
                <button type="button" className="onepos-btn onepos-btn-secondary" onClick={() => runDatabaseAction("test", () => "Connection successful.")} disabled={databaseBusy}>Test Connection</button>
                <button type="button" className="onepos-btn onepos-btn-secondary" onClick={() => runDatabaseAction("validate-schema", (data) => `Schema: ${data?.schemaState || "unknown"}.`)} disabled={databaseBusy}>Validate Schema</button>
                <button type="button" className="onepos-btn onepos-btn-secondary" onClick={() => runDatabaseAction("initialize", (data) => `Initialization result: ${data?.schemaState || "unknown"}.`)} disabled={databaseBusy}>Initialize Database</button>
                <button type="button" className="onepos-btn onepos-btn-primary" onClick={() => runDatabaseAction("activate", () => "Customer database activated.")} disabled={databaseBusy || databaseConfig?.schemaState !== "COMPATIBLE"}>Activate</button>
              </>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
