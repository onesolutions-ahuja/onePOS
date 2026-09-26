import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import { databaseConfigurationPayload } from "../../services/tenantDatabaseForm.js";

const DEFAULT_KEYS = ["pos", "inventory", "purchasing", "customers", "reports", "loyalty", "jarvis"];

export default function LicensingAdmin() {
  const [licences, setLicences] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [marketplacePackages, setMarketplacePackages] = useState([]);
  const [marketplaceBundles, setMarketplaceBundles] = useState([]);
  const [marketplaceTiers, setMarketplaceTiers] = useState([]);
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
      const [licenceData, companyData, packageData, bundleData, tierData] = await Promise.all([
        apiRequest("/api/superadmin/licences"),
        apiRequest("/api/superadmin/companies"),
        apiRequest("/api/superadmin/packages"),
        apiRequest("/api/superadmin/bundles"),
        apiRequest("/api/superadmin/tiers"),
      ]);
      if (!licenceData.success || !companyData.success || !packageData.success || !bundleData.success || !tierData.success) {
        throw new Error("Unable to load licensing and marketplace data");
      }
      setLicences(licenceData.data || []);
      setCompanies(companyData.data || []);
      setMarketplacePackages(packageData.data || []);
      setMarketplaceBundles(bundleData.data || []);
      setMarketplaceTiers(tierData.data || []);
    } catch (err) {
      setError(err.message || "Unable to load licensing data");
    }
  };

  useEffect(() => { load(); }, []);

  const updateMarketplaceItem = (setter, id, field, value) => {
    setter((items) => items.map((item) => item.id === id ? { ...item, [field]: value } : item));
  };

  const csvList = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);

  const saveMarketplaceSettings = async (path, payload, successMessage) => {
    setError(""); setMessage("");
    try {
      const result = await apiRequest(path, { method: "PUT", body: JSON.stringify(payload) });
      if (!result.success) throw new Error(result.message || "Unable to save marketplace settings");
      setMessage(successMessage);
      await load();
    } catch (err) {
      setError(err.message || "Unable to save marketplace settings");
    }
  };

  const savePackageSettings = (item) => saveMarketplaceSettings(
    `/api/superadmin/packages/${item.id}/marketplace`,
    {
      active: item.active,
      visible: item.visible,
      installable: item.installable,
      billable: item.billable,
      system_only: item.system_only,
      category: item.category || "",
      display_order: Number(item.display_order) || 0,
      licence_mode: item.licence_mode,
      allowed_bundles: item.allowed_bundles || [],
      allowed_companies: item.allowed_companies || [],
      available_tiers: item.available_tiers || [],
    },
    `${item.name} marketplace settings saved.`
  );

  const saveBundleSettings = (item) => saveMarketplaceSettings(
    `/api/superadmin/bundles/${item.id}/marketplace`,
    {
      active: item.active,
      visible: item.visible,
      installable: item.installable,
      display_order: Number(item.display_order) || 0,
      allowed_companies: item.allowed_companies || [],
      available_tiers: item.available_tiers || [],
    },
    `${item.name} marketplace settings saved.`
  );

  const saveTierSettings = (item) => saveMarketplaceSettings(
    `/api/superadmin/tiers/${item.id}/marketplace`,
    {
      active: item.active,
      visible: item.visible,
      installable: item.installable,
      display_order: Number(item.display_order) || 0,
      allowed_companies: item.allowed_companies || [],
    },
    `${item.name} marketplace settings saved.`
  );

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
          <h2 className="onepos-card-title">OneApps marketplace packages</h2>
          <p className="text-sm text-slate-600 mt-1">Control package availability and commercial treatment independently from installation state.</p>
        </div>
        {marketplacePackages.map((item) => (
          <div className="border-t border-slate-200 pt-4 space-y-3" key={item.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><strong>{item.name}</strong><span className="ml-2 text-sm text-slate-500">{item.package_key}</span></div>
              <button type="button" className="onepos-btn onepos-btn-secondary" onClick={() => savePackageSettings(item)}>Save package policy</button>
            </div>
            <div className="flex flex-wrap gap-4">
              {[
                ["active", "Active"], ["visible", "Visible"], ["installable", "Installable"],
                ["billable", "Billable"], ["system_only", "Internal/system-only"],
              ].map(([field, label]) => (
                <label className="text-sm flex gap-2 items-center" key={field}>
                  <input type="checkbox" checked={item[field] === true} onChange={(event) => updateMarketplaceItem(setMarketplacePackages, item.id, field, event.target.checked)} />{label}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-sm">Category<input className="onepos-input mt-1 w-full" value={item.category || ""} onChange={(event) => updateMarketplaceItem(setMarketplacePackages, item.id, "category", event.target.value)} /></label>
              <label className="text-sm">Display order<input type="number" className="onepos-input mt-1 w-full" value={item.display_order ?? 0} onChange={(event) => updateMarketplaceItem(setMarketplacePackages, item.id, "display_order", event.target.value)} /></label>
              <label className="text-sm">Licence mode<select className="onepos-input mt-1 w-full" value={item.licence_mode || "COMMERCIAL"} onChange={(event) => updateMarketplaceItem(setMarketplacePackages, item.id, "licence_mode", event.target.value)}><option value="COMMERCIAL">Commercial</option><option value="TECHNICAL">Technical</option></select></label>
              {[
                ["allowed_bundles", "Allowed bundle keys"],
                ["available_tiers", "Allowed tier keys"],
                ["allowed_companies", "Allowed company IDs"],
              ].map(([field, label]) => (
                <label className="text-sm" key={field}>{label}
                  <input className="onepos-input mt-1 w-full" value={(item[field] || []).join(", ")} onChange={(event) => updateMarketplaceItem(setMarketplacePackages, item.id, field, csvList(event.target.value))} />
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>
      <section className="onepos-card onepos-card-body space-y-4">
        <div><h2 className="onepos-card-title">Bundle marketplace visibility</h2><p className="text-sm text-slate-600 mt-1">Bundle assignment and entitlement calculation continue through the shared reconciliation service.</p></div>
        {marketplaceBundles.map((item) => (
          <div className="border-t border-slate-200 pt-4 space-y-3" key={item.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <strong>{item.name} <span className="text-sm text-slate-500">{item.bundle_key}</span></strong>
              <button type="button" className="onepos-btn onepos-btn-secondary" onClick={() => saveBundleSettings(item)}>Save bundle policy</button>
            </div>
            <div className="flex flex-wrap gap-4">
              {["active", "visible", "installable"].map((field) => <label className="text-sm flex gap-2 items-center" key={field}><input type="checkbox" checked={item[field] === true} onChange={(event) => updateMarketplaceItem(setMarketplaceBundles, item.id, field, event.target.checked)} />{field}</label>)}
              <label className="text-sm">Display order<input type="number" className="onepos-input ml-2 w-24" value={item.display_order ?? 0} onChange={(event) => updateMarketplaceItem(setMarketplaceBundles, item.id, "display_order", event.target.value)} /></label>
            </div>
            <label className="text-sm block">Allowed company IDs<input className="onepos-input mt-1 w-full" value={(item.allowed_companies || []).join(", ")} onChange={(event) => updateMarketplaceItem(setMarketplaceBundles, item.id, "allowed_companies", csvList(event.target.value))} /></label>
            <label className="text-sm block">Allowed tier keys<input className="onepos-input mt-1 w-full" value={(item.available_tiers || []).join(", ")} onChange={(event) => updateMarketplaceItem(setMarketplaceBundles, item.id, "available_tiers", csvList(event.target.value))} /></label>
          </div>
        ))}
      </section>
      <section className="onepos-card onepos-card-body space-y-4">
        <div><h2 className="onepos-card-title">Tier marketplace visibility</h2><p className="text-sm text-slate-600 mt-1">Tier assignments reconcile package and feature entitlements using the same source-aware service.</p></div>
        {marketplaceTiers.map((item) => (
          <div className="border-t border-slate-200 pt-4 space-y-3" key={item.id}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <strong>{item.name} <span className="text-sm text-slate-500">{item.tier_key}</span></strong>
              <button type="button" className="onepos-btn onepos-btn-secondary" onClick={() => saveTierSettings(item)}>Save tier policy</button>
            </div>
            <div className="flex flex-wrap gap-4">
              {["active", "visible", "installable"].map((field) => <label className="text-sm flex gap-2 items-center" key={field}><input type="checkbox" checked={item[field] === true} onChange={(event) => updateMarketplaceItem(setMarketplaceTiers, item.id, field, event.target.checked)} />{field}</label>)}
              <label className="text-sm">Display order<input type="number" className="onepos-input ml-2 w-24" value={item.display_order ?? 0} onChange={(event) => updateMarketplaceItem(setMarketplaceTiers, item.id, "display_order", event.target.value)} /></label>
            </div>
            <label className="text-sm block">Allowed company IDs<input className="onepos-input mt-1 w-full" value={(item.allowed_companies || []).join(", ")} onChange={(event) => updateMarketplaceItem(setMarketplaceTiers, item.id, "allowed_companies", csvList(event.target.value))} /></label>
          </div>
        ))}
      </section>
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
