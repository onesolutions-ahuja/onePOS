import { useEffect, useState } from "react";
import { Edit, Plus, RefreshCw, Save, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import WhatsAppSettings from "./whatsapp/WhatsAppSettings.jsx";
import InvoiceDeliverySettings from "./invoiceDeliverySettings.jsx";
import { Toggle } from "../../components/ui.jsx";
/*
 * Settings navigation - compact grouped tabs.
 *
 * Thirteen sections in one flat row overflow a 15-inch screen, so they are
 * grouped into six short groups; the active group's sections render as a
 * compact second row. Every section keeps its exact name and content -
 * grouping is navigation only.
 */
const SETTING_GROUPS = [
  { label: "General", sections: ["General", "Company", "Store & Till"] },
  { label: "Sales & Tax", sections: ["Tax / VAT", "Receipts", "Payment Terminals"] },
  { label: "Hardware", sections: ["Hardware"] },
  { label: "Users", sections: ["Users & Permissions"] },
  { label: "Integrations", sections: ["Integrations", "Online Platforms", "WhatsApp"] },
  { label: "Delivery", sections: ["SMS Delivery", "Email Delivery"] },
];

function SettingsAdmin({ initialTab = "General" }) {
  const tabs = SETTING_GROUPS.flatMap((group) => group.sections);
  const [tab, setTab] = useState(
    tabs.includes(initialTab) ? initialTab : "General"
  );
  const activeGroup =
    SETTING_GROUPS.find((group) => group.sections.includes(tab)) || SETTING_GROUPS[0];
  const [settings, setSettings] = useState(null);
  const [terminals, setTerminals] = useState([]);
  const [hardware, setHardware] = useState([]);
  const [health, setHealth] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [settingsResponse, terminalsResponse, hardwareResponse, healthResponse] = await Promise.all([
        apiRequest("/api/settings"),
        apiRequest("/api/payment-terminals"),
        apiRequest("/api/hardware"),
        apiRequest("/api/health/integrations"),
      ]);
      if (settingsResponse.success) {
        setSettings(settingsResponse.data);
setForm({
          companyName: settingsResponse.data.company.name,
          legalName: settingsResponse.data.company.legalName || "",
          companyEmail: settingsResponse.data.company.email || "",
          companyPhone: settingsResponse.data.company.phone || "",
          currency: settingsResponse.data.company.currency,
          timezone: settingsResponse.data.company.timezone,
          logoUrl: settingsResponse.data.company.logoUrl || "",
          dateFormat: settingsResponse.data.general.dateFormat,
          vatEnabled: settingsResponse.data.tax.vatEnabled,
          defaultVatRate: settingsResponse.data.tax.defaultVatRate,
        });
      }
      if (terminalsResponse.success) setTerminals(terminalsResponse.data || []);
      if (hardwareResponse.success) setHardware(hardwareResponse.data || []);
      if (healthResponse.success) setHealth(healthResponse.data);
    } catch (err) {
      setError(err.message || "Unable to load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const saveSettings = async (event) => {
    event.preventDefault();
    try {
      const data = await apiRequest("/api/settings", { method: "PUT", body: JSON.stringify(form) });
      if (!data.success) throw new Error(data.message || "Unable to save settings");
      setMessage("Settings saved.");
      await load();
    } catch (err) { setError(err.message || "Unable to save settings"); }
  };

  const saveHardware = async (device) => {
    try {
      const data = await apiRequest("/api/hardware", { method: "PUT", body: JSON.stringify(device) });
      if (!data.success) throw new Error(data.message || "Unable to save hardware");
      setMessage("Hardware configuration saved.");
      await load();
    } catch (err) { setError(err.message || "Unable to save hardware"); }
  };

  const testHardware = async (type) => {
    try {
      const data = await apiRequest(`/api/hardware/${type}/test`, { method: "POST" });
      setMessage(data.data?.message || "Hardware test completed.");
      await load();
    } catch (err) { setError(err.message || "Unable to test hardware"); }
  };

  if (loading) return <div className="p-10 text-center text-slate-400">Loading settings...</div>;

  if (error) return <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-2xl"><h2 className="font-semibold text-red-700">Unable to load settings</h2><p className="text-sm text-slate-600 mt-2">{error}</p><button onClick={load} className="mt-5 h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"><RefreshCw size={16} /> Retry</button></div>;

  if (!settings || !form) return <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-2xl"><h2 className="font-semibold text-red-700">Settings are unavailable</h2><p className="text-sm text-slate-600 mt-2">No settings data was returned by the server.</p><button onClick={load} className="mt-5 h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2"><RefreshCw size={16} /> Retry</button></div>;

  return <div><div className="mb-5"><h1 className="text-2xl font-bold">Settings</h1><p className="text-sm text-slate-500 mt-1">Company, till, tax, hardware and integration configuration.</p></div><div className="mb-3"><div className="flex gap-1 overflow-x-auto">{SETTING_GROUPS.map((group) => { const groupActive = group === activeGroup; return <button key={group.label} onClick={() => { setTab(group.sections[0]); setMessage(""); setError(""); }} className={`px-3 h-8 text-sm whitespace-nowrap rounded-md transition-colors ${groupActive ? "bg-blue-600 text-white font-medium" : "text-slate-600 hover:bg-slate-100"}`}>{group.label}</button>; })}</div><div className="flex gap-1 border-b border-slate-200 overflow-x-auto">{activeGroup.sections.map((item) => <button key={item} onClick={() => { setTab(item); setMessage(""); setError(""); }} className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === item ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{item}</button>)}</div></div>{message && <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{message}</div>}{error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}{["General", "Company", "Tax / VAT"].includes(tab) && <SettingsForm tab={tab} form={form} setForm={setForm} onSave={saveSettings} />}{tab === "Store & Till" && <StoreTillSettings settings={settings} onMessage={setMessage} onError={setError} />}{tab === "Payment Terminals" && <PaymentTerminalSettings terminals={terminals} onSaved={load} onMessage={setMessage} onError={setError} />}{tab === "Hardware" && <HardwareSettings hardware={hardware} onSave={saveHardware} onTest={testHardware} />}{tab === "Integrations" && <IntegrationHealth health={health} />}{tab === "Online Platforms" && <OnlinePlatformSettings onMessage={setMessage} onError={setError} />}{tab === "WhatsApp" && <WhatsAppSettings onMessage={setMessage} onError={setError} />}{tab === "SMS Delivery" && <InvoiceDeliverySettings channel="sms" onMessage={setMessage} onError={setError} />}{tab === "Email Delivery" && <InvoiceDeliverySettings channel="email" onMessage={setMessage} onError={setError} />}{tab === "Users & Permissions" && <UsersPermissionsSettings onMessage={setMessage} onError={setError} />}{tab === "Receipts" && <ReceiptSettings settings={settings} form={form} setForm={setForm} onSave={saveSettings} />}</div>;
}

function UsersPermissionsSettings({ onMessage, onError }) {
  const [users, setUsers] = useState([]); const [roles, setRoles] = useState([]); const [stores, setStores] = useState([]); const [form, setForm] = useState(null); const [loading, setLoading] = useState(true);
  const load = async () => { try { setLoading(true); const [u, r, s] = await Promise.all([apiRequest("/api/admin/users"), apiRequest("/api/admin/roles"), apiRequest("/api/admin/stores")]); if (!u.success) throw new Error(u.message); setUsers(u.data || []); setRoles(r.data || []); setStores(s.data || []); } catch (err) { onError(err.message || "Unable to load users"); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const save = async (value) => { const data = await apiRequest(value.id ? `/api/admin/users/${value.id}` : "/api/admin/users", { method: value.id ? "PUT" : "POST", body: JSON.stringify(value) }); if (!data.success) throw new Error(data.message); await load(); setForm(null); onMessage("User saved."); };
  const toggle = async (user) => { try { await save({ id: user.id, fullName: user.full_name, email: user.email, roleId: user.role_id, storeId: user.store_id, active: !user.active }); } catch (err) { onError(err.message || "Unable to update user"); } };
  if (loading) return <div className="p-8 text-center text-slate-400">Loading users...</div>;
  return <div className="space-y-6"><ChangePasswordCard /><div className="bg-white border rounded-xl overflow-hidden"><div className="p-4 border-b flex justify-between items-center"><h2 className="font-semibold">Users & Permissions</h2><button onClick={() => setForm({})} className="h-9 px-3 bg-blue-600 text-white rounded text-sm"><Plus size={15} className="inline mr-1" />Add user</button></div><table className="w-full"><thead><tr className="bg-slate-50">{["Name", "Username / Email", "Role", "Store", "Status", "Actions"].map((heading) => <th key={heading} className="text-left px-4 py-3 text-xs uppercase text-slate-500">{heading}</th>)}</tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-t"><td className="px-4 py-3 text-sm font-medium">{user.full_name}</td><td className="px-4 py-3 text-sm">{user.username}<div className="text-xs text-slate-500">{user.email || "-"}</div></td><td className="px-4 py-3 text-sm">{user.role_name || "-"}</td><td className="px-4 py-3 text-sm">{user.store_name || "Unassigned"}</td><td className="px-4 py-3 text-sm">{user.active ? "Active" : "Inactive"}</td><td className="px-4 py-3"><button onClick={() => setForm({ id:user.id, username:user.username, fullName:user.full_name, email:user.email || "", roleId:user.role_id || "", storeId:user.store_id || "", active:user.active })} className="p-2 text-slate-500" title="Edit user"><Edit size={16} /></button><button onClick={() => toggle(user)} className="ml-1 px-2 py-1 text-sm border rounded">{user.active ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody></table>{form && <UserFormModal form={form} roles={roles} stores={stores} onClose={() => setForm(null)} onSave={save} />}<RolePermissionsManager roles={roles} onMessage={onMessage} onError={onError} /></div></div>;
}

function ChangePasswordCard() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const reset = () => { setForm({ currentPassword: "", newPassword: "", confirmPassword: "" }); setError(""); setSuccess(""); };
  const submit = async (event) => {
    event.preventDefault();
    setError(""); setSuccess("");
    if (form.newPassword !== form.confirmPassword) { setError("New password and confirmation do not match"); return; }
    if (form.newPassword.length < 8) { setError("New password must be at least 8 characters"); return; }
    try {
      setSaving(true);
      const data = await apiRequest("/api/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }) });
      if (!data.success) throw new Error(data.message || "Unable to change password");
      setSuccess("Password changed successfully.");
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) { setError(err.message || "Unable to change password"); } finally { setSaving(false); }
  };
  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="p-4 border-b"><h2 className="font-semibold">Change Password</h2></div>
      <form onSubmit={submit} className="p-4 max-w-md space-y-3">
        {error && <div className="p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
        {success && <div className="p-2 bg-green-50 text-green-700 rounded text-sm">{success}</div>}
        <label className="block text-sm text-slate-600"><span className="block mb-1 font-medium">Current password</span><input type="password" required value={form.currentPassword} onChange={(e) => update("currentPassword", e.target.value)} className="w-full h-9 px-2 border rounded" autoComplete="current-password" /></label>
        <label className="block text-sm text-slate-600"><span className="block mb-1 font-medium">New password</span><input type="password" required value={form.newPassword} onChange={(e) => update("newPassword", e.target.value)} className="w-full h-9 px-2 border rounded" autoComplete="new-password" /></label>
        <label className="block text-sm text-slate-600"><span className="block mb-1 font-medium">Confirm new password</span><input type="password" required value={form.confirmPassword} onChange={(e) => update("confirmPassword", e.target.value)} className="w-full h-9 px-2 border rounded" autoComplete="new-password" /></label>
        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-50">{saving ? "Saving…" : "Save Password"}</button>
          <button type="button" onClick={reset} className="h-9 px-3 border rounded text-sm">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function UserFormModal({ form: initial, roles, stores, onClose, onSave }) {
  const [form, setForm] = useState({ password: "", ...initial }); const [error, setError] = useState(""); const [saving, setSaving] = useState(false); const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => { event.preventDefault(); if (!form.fullName || (!form.id && !form.password)) { setError("Full name and a password for new users are required"); return; } try { setSaving(true); await onSave(form); } catch (err) { setError(err.message || "Unable to save user"); } finally { setSaving(false); } };
  return <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"><div className="bg-white rounded-xl w-[560px] max-w-full shadow-2xl"><div className="p-4 border-b flex justify-between"><h2 className="font-bold text-lg">{form.id ? "Edit User" : "Add User"}</h2><button onClick={onClose} title="Close"><X size={18} /></button></div><form onSubmit={submit} className="p-4">{error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}<div className="grid grid-cols-2 gap-3">{[["fullName","Full name"],["username","Username"],["email","Email"],["password","Password"]].map(([field,label]) => <label key={field} className="text-sm text-slate-600"><span className="block mb-1 font-medium">{label}</span><input disabled={field === "username" && Boolean(form.id)} required={field === "fullName" || field === "username" || (!form.id && field === "password")} type={field === "password" ? "password" : field === "email" ? "email" : "text"} value={form[field] || ""} onChange={(event) => update(field,event.target.value)} className="w-full h-9 px-2 border rounded" /></label>)}</div><label className="block mt-3 text-sm text-slate-600">Role<select value={form.roleId} onChange={(event) => update("roleId",event.target.value)} className="block w-full h-9 mt-1 border rounded bg-white"><option value="">Unassigned</option>{roles.map((role)=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label className="block mt-3 text-sm text-slate-600">Store<select value={form.storeId} onChange={(event) => update("storeId",event.target.value)} className="block w-full h-9 mt-1 border rounded bg-white"><option value="">Unassigned</option>{stores.map((store)=><option key={store.id} value={store.id}>{store.name}</option>)}</select></label><div className="flex justify-end gap-2 mt-5"><button type="button" onClick={onClose} className="h-9 px-3 border rounded text-sm">Cancel</button><button disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded text-sm">{saving ? "Saving..." : "Save user"}</button></div></form></div></div>;
}

const PERMISSION_GROUPS = [
  {
    label: "Sales",
    codes: [
      "sale.view",
      "sale.create",
      "sale.edit",
      "sale.delete",
      "sale.invoice.view",
      "sale.invoice.reprint",
      "sale.discount",
      "sale.void_item",
      "sale.void",
      "sale.refund",
      "sale.refund_without_receipt",
      "sale.price_change",
      "sale.hold",
    ],
  },
  { label: "Cash Management", codes: ["cash.open_drawer", "cash.payout", "cash.adjustment"] },
  { label: "Till", codes: ["till.open", "till.close"] },
  {
    label: "Customers",
    codes: [
      "customer.view",
      "customer.create",
      "customer.edit",
      "customer.delete",
    ],
  },
  {
    label: "Products",
    codes: [
      "product.view",
      "product.create",
      "product.edit",
      "product.delete",
    ],
  },
  {
    label: "Purchases",
    codes: [
      "purchase.view",
      "purchase.create",
      "purchase.edit",
      "purchase.delete",
    ],
  },
  {
    label: "Inventory",
    codes: [
      "inventory.view",
      "inventory.movements.view",
      "inventory.adjust",
    ],
  },
  {
    label: "Sales Returns",
    codes: [
      "returns.view",
      "returns.create",
      "returns.approve",
    ],
  },
  {
    label: "Reports",
    codes: [
      "reports.summary.view",
      "reports.sales.view",
      "reports.products.view",
      "reports.customers.view",
      "reports.inventory.view",
      "reports.inventory_movements.view",
      "reports.low_stock.view",
      "reports.payments.view",
      "reports.purchases.view",
      "reports.returns.view",
      "reports.profit.view",
      "reports.till.view",
      "reports.vat.view",
      "report.export",
    ],
  },
  {
    label: "Administration",
    codes: ["user.manage", "role.manage", "payment.manage", "integration.manage", "settings.manage"],
  },
];

function RolePermissionsManager({ roles, onMessage, onError }) {
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [allPermissions, setAllPermissions] = useState([]);
  const [rolePermissions, setRolePermissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadRolePermissions = async (roleId) => {
    if (!roleId) { setSelectedRoleId(""); setRolePermissions([]); return; }
    try {
      setLoading(true);
      const permResp = await apiRequest("/api/admin/permissions");
      if (permResp.success) setAllPermissions(permResp.data || []);
      const roleResp = await apiRequest(`/api/admin/roles/${roleId}/permissions`);
      if (roleResp.success) setRolePermissions(roleResp.data || []);
      setSelectedRoleId(roleId);
    } catch (err) {
      onError(err.message || "Unable to load permissions");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!selectedRoleId) return;
    try {
      setSaving(true);
      const data = await apiRequest(`/api/admin/roles/${selectedRoleId}/permissions`, {
        method: "PUT",
        body: JSON.stringify({ permissions: rolePermissions }),
      });
      if (!data.success) throw new Error(data.message);
      setRolePermissions(data.data);
      onMessage("Permissions saved.");
      /* Reload permissions from the server so the saved state is confirmed and
         any codes filtered out server-side (e.g. invalid / missing permission
         rows) are reflected back in the UI before the user reopens the panel.
         This prevents the "Saved → reopen → unchecked" phantom from showing
         even though the DB row was in fact persisted. */
      const verifyResp = await apiRequest(`/api/admin/roles/${selectedRoleId}/permissions`);
      if (verifyResp.success) setRolePermissions(verifyResp.data || []);
    } catch (err) {
      onError(err.message || "Unable to save permissions");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (code) => {
    if (rolePermissions.includes(code)) setRolePermissions(rolePermissions.filter((c) => c !== code));
    else setRolePermissions([...rolePermissions, code]);
  };

  /* If the permission code doesn't exist yet in allPermissions (the catalogue
     returned by /api/admin/permissions), show it with a neutral "Not synced
     to permission catalogue" hint so the user knows the checkbox is present
     but the seed rows may not have been run. */
  const permLabels = {};
  allPermissions.forEach((p) => { permLabels[p.code] = p.name; });
  const permTooltip = (code) => {
    const match = allPermissions.find((p) => p.code === code);
    if (!match) return `${code} — permission not registered in catalogue; seed DB to persist.`;
    return match.description ? `${match.name} — ${match.description}` : match.name;
  };

  /* When the user changes role, re-run loadRolePermissions AFTER the state
     setter applies so the load reads the newly-selected option and, critically,
     overwrites any leftover state from the PREVIOUS role. This prevents "role
     A's checkboxes" from flashing on role B when B was opened earlier. */
  const handleRoleChange = async (roleId) => {
    if (!roleId) {
      setSelectedRoleId("");
      setRolePermissions([]);
      setAllPermissions([]);
      return;
    }
    try {
      setLoading(true);
      const permResp = await apiRequest("/api/admin/permissions");
      if (permResp.success) setAllPermissions(permResp.data || []);
      const roleResp = await apiRequest(`/api/admin/roles/${roleId}/permissions`);
      if (roleResp.success) setRolePermissions(roleResp.data || []);
      setSelectedRoleId(roleId);
    } catch (err) {
      onError(err.message || "Unable to load permissions");
    } finally {
      setLoading(false);
    }
  };

  const selectedRoleName = roles.find((r) => r.id === selectedRoleId)?.name || "";

  return (
    <div className="mt-8">
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
        <h3 className="font-semibold text-slate-800 mb-1">Role Permissions</h3>
        <p className="text-sm text-slate-500">Select a role to manage its permissions. Only administrators or owners can modify permissions.</p>
      </div>
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-600 mb-1">Select role</label>
        <select
          value={selectedRoleId}
          onChange={(e) => handleRoleChange(e.target.value)}
          className="w-full max-w-xs h-9 px-3 border border-slate-200 rounded-lg bg-white text-sm"
        >
          <option value="">Choose a role…</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>
      </div>
      {selectedRoleId && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <h4 className="font-medium text-slate-700">Permissions for {selectedRoleName}</h4>
            <button onClick={save} disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
              <Save size={16} /> {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
          {loading ? (
            <div className="p-8 text-center text-slate-400">Loading permissions…</div>
          ) : (
            <div className="space-y-4">
              {PERMISSION_GROUPS.map((group) => (
                <div key={group.label} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 border-b px-4 py-2 font-medium text-sm text-slate-700">{group.label}</div>
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                    {group.codes.map((code) => (
                      <label key={code} className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer" title={permTooltip(code)}>
                        <input
                          type="checkbox"
                          checked={rolePermissions.includes(code)}
                          onChange={() => toggle(code)}
                          className="accent-blue-600"
                        />
                        <span className={allPermissions.some((p) => p.code === code) ? "" : "text-orange-600"}>
                          {permLabels[code] || code}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StoreTillSettings({ settings, onMessage, onError }) {
  const [stores, setStores] = useState([]); const [loading, setLoading] = useState(true);
  const load = async () => { try { setLoading(true); const data = await apiRequest("/api/admin/stores"); if (!data.success) throw new Error(data.message); setStores(data.data || []); } catch (err) { onError(err.message || "Unable to load stores"); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);
  const updateStore = async (store) => { try { const data = await apiRequest(`/api/admin/stores/${store.id}`, { method:"PUT", body:JSON.stringify(store) }); if (!data.success) throw new Error(data.message); await load(); onMessage("Store updated."); } catch (err) { onError(err.message || "Unable to update store"); } };
  const updateTill = async (till) => { try { const data = await apiRequest(`/api/admin/tills/${till.id}`, { method:"PUT", body:JSON.stringify(till) }); if (!data.success) throw new Error(data.message); await load(); onMessage("Till updated."); } catch (err) { onError(err.message || "Unable to update till"); } };
  if (loading) return <div className="p-8 text-center text-slate-400">Loading stores and tills...</div>;
  return <div className="space-y-4"><div className="text-sm text-slate-500 mb-3">Current user store: {settings.store.name || "Unassigned"} · Current till: {settings.till.name || "Unassigned"}</div>{stores.map((store) => <div key={store.id} className="bg-white border rounded-xl p-4"><StoreEditRow store={store} onSave={updateStore} />{(store.tills || []).map((till) => <TillEditRow key={till.id} till={till} onSave={updateTill} />)}</div>)}</div>;
}

function StoreEditRow({ store, onSave }) { const [form,setForm]=useState({name:store.name,code:store.code||"",addressLine1:store.address_line1||"",city:store.city||"",postcode:store.postcode||"",phone:store.phone||"",active:store.active}); return <div><div className="font-semibold mb-3">Store</div><div className="grid grid-cols-3 gap-2"><input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} className="h-9 border rounded px-2 text-sm" /><input value={form.code} onChange={(e)=>setForm({...form,code:e.target.value})} className="h-9 border rounded px-2 text-sm" placeholder="Code" /><input value={form.city} onChange={(e)=>setForm({...form,city:e.target.value})} className="h-9 border rounded px-2 text-sm" placeholder="City" /></div><label className="inline-flex items-center gap-2 mt-3 text-sm text-slate-600"><Toggle checked={form.active} onChange={(e)=>setForm({...form,active:e.target.checked})} /> Active</label><button onClick={()=>onSave({id:store.id,...form})} className="ml-3 h-8 px-3 bg-blue-600 text-white rounded text-sm">Save store</button></div>; }
function TillEditRow({ till, onSave }) { const [form,setForm]=useState({name:till.name,terminalNumber:till.terminalNumber||"",active:till.active}); return <div className="mt-4 pl-4 border-l-2 border-slate-200"><div className="font-medium text-sm mb-2">Till</div><div className="flex gap-2 items-center"><input value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} className="h-9 border rounded px-2 text-sm" /><input value={form.terminalNumber} onChange={(e)=>setForm({...form,terminalNumber:e.target.value})} className="h-9 border rounded px-2 text-sm" placeholder="Terminal number" /><label className="inline-flex items-center gap-2 text-sm text-slate-600"><Toggle checked={form.active} onChange={(e)=>setForm({...form,active:e.target.checked})} /> Active</label><button onClick={()=>onSave({id:till.id,...form})} className="h-9 px-3 bg-blue-600 text-white rounded text-sm">Save till</button></div></div>; }

function LogoUploader({ logoUrl, onChange }) {
  const [preview, setPreview] = useState(logoUrl);

  const compressImage = (file, callback) => {
    const img = new Image();
    img.onload = () => {
      const maxSize = 200;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      let { width, height } = img;
      if (width > height) {
        if (width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
      } else {
        if (height > maxSize) { width = Math.round((width * maxSize) / height); height = maxSize; }
      }
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, width, height);
      callback(canvas.toDataURL("image/png", 0.85));
    };
    img.src = URL.createObjectURL(file);
  };

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    compressImage(file, (dataUrl) => {
      setPreview(dataUrl);
      onChange(dataUrl);
    });
  };

  const handleRemove = () => {
    setPreview("");
    onChange("");
  };

  return (
    <div className="col-span-2">
      <label className="block text-sm font-medium text-slate-600 mb-1">Company logo</label>
      <div className="flex items-center gap-4">
        {preview ? (
          <div className="w-20 h-20 border border-slate-200 rounded-lg overflow-hidden flex items-center justify-center bg-slate-50">
            <img src={preview} alt="Logo preview" className="max-w-full max-h-full object-contain" />
          </div>
        ) : (
          <div className="w-20 h-20 border border-slate-200 rounded-lg flex items-center justify-center text-slate-400 text-xs">No logo</div>
        )}
        <div className="flex flex-col gap-2">
          <label className="h-9 px-3 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium flex items-center gap-2 cursor-pointer">
            <input type="file" accept="image/*" hidden onChange={handleFileChange} />
            Choose file
          </label>
          {preview && (
            <button type="button" onClick={handleRemove} className="h-8 px-3 border border-slate-200 rounded text-sm text-slate-600">
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsForm({ tab, form, setForm, onSave }) {
  const field = (name, label, type = "text") => <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">{label}</span><input type={type} value={form[name] ?? ""} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label>;
const companyFields = <>{field("companyName", "Company name")}{field("legalName", "Legal / business name")}{field("companyEmail", "Email", "email")}{field("companyPhone", "Phone")}{field("currency", "Currency")}{field("timezone", "Timezone")}<LogoUploader logoUrl={form.logoUrl || ""} onChange={(value) => setForm((current) => ({ ...current, logoUrl: value }))} /></>;

  return <form onSubmit={onSave} className="bg-white border border-slate-200 rounded-xl p-5 max-w-2xl"><h2 className="font-semibold mb-4">{tab}</h2><div className="grid grid-cols-2 gap-4">{tab === "Company" ? companyFields : <>{field("dateFormat", "Date format")}{field("currency", "Currency")}{field("timezone", "Timezone")}{tab === "Tax / VAT" && <><label className="flex items-center gap-2 text-sm text-slate-600 pt-6"><Toggle checked={form.vatEnabled} onChange={(event) => setForm((current) => ({ ...current, vatEnabled: event.target.checked }))} /> VAT enabled</label>{field("defaultVatRate", "Default VAT rate %", "number")}</>}</>}</div><button type="submit" className="mt-5 h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium">Save settings</button></form>;
}

function ReceiptSettings({ settings, form, setForm, onSave }) {
  return <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-2xl"><h2 className="font-semibold mb-4">Receipt settings</h2><p className="text-sm text-slate-500 mb-4">Receipts use the existing company and tax settings. Printer configuration is managed under Hardware.</p><div className="grid grid-cols-2 gap-4 text-sm"><div><span className="text-slate-500">Header company</span><div className="font-medium mt-1">{settings.company.name}</div></div><div><span className="text-slate-500">VAT display</span><div className="font-medium mt-1">{form.vatEnabled ? `Enabled (${form.defaultVatRate}%)` : "Disabled"}</div></div><div><span className="text-slate-500">Date format</span><div className="font-medium mt-1">{form.dateFormat}</div></div><div><span className="text-slate-500">Paper width</span><div className="font-medium mt-1">Configure under Hardware</div></div></div><button onClick={onSave} className="mt-5 h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium">Save receipt settings</button></div>;
}

function SettingsInfo({ settings }) {
  return <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-2xl"><h2 className="font-semibold mb-4">Current store and till</h2><div className="grid grid-cols-2 gap-5 text-sm"><div><span className="text-slate-500">Store</span><div className="font-medium mt-1">{settings.store.name || "-"}</div></div><div><span className="text-slate-500">Till name</span><div className="font-medium mt-1">{settings.till.name || "-"}</div></div><div><span className="text-slate-500">Terminal number</span><div className="font-medium mt-1">{settings.till.terminalNumber || "-"}</div></div><div><span className="text-slate-500">Current store context</span><div className="font-medium mt-1">{settings.store.id ? "Authenticated store" : "Not configured"}</div></div></div></div>;
}

function PaymentTerminalSettings({ terminals, onSaved, onMessage, onError }) {
  const [form, setForm] = useState({ provider: "", name: "", terminalIdentifier: "", connectionUrl: "", apiCredentials: "" });
  const save = async (event) => { event.preventDefault(); try { const data = await apiRequest(form.id ? `/api/payment-terminals/${form.id}` : "/api/payment-terminals", { method: form.id ? "PUT" : "POST", body: JSON.stringify(form) }); if (!data.success) throw new Error(data.message); onMessage("Payment terminal saved."); setForm({ provider: "", name: "", terminalIdentifier: "", connectionUrl: "", apiCredentials: "" }); await onSaved(); } catch (err) { onError(err.message || "Unable to save payment terminal"); } };
  const test = async (id) => { try { const data = await apiRequest(`/api/payment-terminals/${id}/test`, { method: "POST" }); onMessage(data.data?.message || "Test completed"); await onSaved(); } catch (err) { onError(err.message || "Unable to test payment terminal"); } };
  return <div className="space-y-5"><form onSubmit={save} className="bg-white border border-slate-200 rounded-xl p-5 max-w-2xl"><h2 className="font-semibold mb-4">Payment terminal configuration</h2><div className="grid grid-cols-2 gap-4">{[["provider", "Provider"], ["name", "Terminal name"], ["terminalIdentifier", "Terminal ID"], ["connectionUrl", "Connection/API URL"]].map(([name, label]) => <label key={name} className="text-sm text-slate-600"><span className="block mb-1 font-medium">{label}</span><input required={name !== "connectionUrl"} value={form[name]} onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label>)}<label className="text-sm text-slate-600 col-span-2"><span className="block mb-1 font-medium">API credentials</span><input type="password" value={form.apiCredentials} onChange={(event) => setForm((current) => ({ ...current, apiCredentials: event.target.value }))} placeholder={form.has_credentials ? "Leave blank to keep existing credentials" : "Stored securely on the server"} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label></div><button className="mt-5 h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium">Save terminal</button></form><div className="bg-white border border-slate-200 rounded-xl overflow-hidden"><table className="w-full"><thead><tr className="bg-slate-50">{["Provider", "Name", "Terminal ID", "Credentials", "Status", "Actions"].map((heading) => <th key={heading} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">{heading}</th>)}</tr></thead><tbody>{terminals.map((terminal) => <tr key={terminal.id} className="border-t border-slate-100"><td className="px-4 py-3 text-sm">{terminal.provider}</td><td className="px-4 py-3 text-sm">{terminal.name}</td><td className="px-4 py-3 text-sm">{terminal.terminal_identifier || "-"}</td><td className="px-4 py-3 text-sm">{terminal.has_credentials ? "Configured (masked)" : "Not configured"}</td><td className="px-4 py-3 text-sm">{terminal.active ? "Active" : "Inactive"}</td><td className="px-4 py-3 whitespace-nowrap"><button onClick={() => setForm({ id: terminal.id, provider: terminal.provider, name: terminal.name, terminalIdentifier: terminal.terminal_identifier || "", connectionUrl: terminal.connection_url || "", apiCredentials: "", has_credentials: terminal.has_credentials })} className="px-3 py-2 text-slate-600 bg-slate-100 rounded-lg text-sm mr-1">Edit</button><button onClick={() => test(terminal.id)} className="px-3 py-2 bg-slate-100 rounded-lg text-sm">Test Connection</button></td></tr>)}</tbody></table></div></div>;
}

function HardwareSettings({ hardware, onSave, onTest }) {
  const definitions = [["BARCODE_SCANNER", "Barcode Scanner"], ["CASH_DRAWER", "Cash Drawer"], ["RECEIPT_PRINTER", "Receipt Printer"]];
  return <div className="grid gap-4 max-w-3xl">{definitions.map(([type, label]) => { const current = hardware.find((device) => device.device_type === type) || { deviceType: type, deviceName: "", connectionType: "", connectionAddress: "", paperWidth: "", active: false }; return <HardwareCard key={type} type={type} label={label} current={current} onSave={onSave} onTest={onTest} />; })}</div>;
}

function HardwareCard({ type, label, current, onSave, onTest }) {
  const [form, setForm] = useState({ deviceType: type, deviceName: current.device_name || "", connectionType: current.connection_type || "", connectionAddress: current.connection_address || "", paperWidth: current.paper_width || "", active: current.active || false });
  const scanner = type === "BARCODE_SCANNER";
  const [scan, setScan] = useState("");
  const [scanTime, setScanTime] = useState("");
  useEffect(() => { if (!scanner) return undefined; let value = ""; let timer; const handler = (event) => { if (event.key === "Enter") { if (value) { setScan(value); setScanTime(new Date().toLocaleString()); } value = ""; return; } if (event.key.length === 1) { value += event.key; clearTimeout(timer); timer = setTimeout(() => { value = ""; }, 100); } }; window.addEventListener("keydown", handler); return () => { window.removeEventListener("keydown", handler); clearTimeout(timer); }; }, [scanner]);
  return <div className="bg-white border border-slate-200 rounded-xl p-5"><div className="flex items-center justify-between mb-4"><div><h2 className="font-semibold">{label}</h2><p className="text-xs text-slate-500 mt-1">{current.last_test_result || (current.active ? "Configured" : "Not configured")}</p></div><button onClick={() => onTest(type)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm">{type === "CASH_DRAWER" ? "Test Open Drawer" : type === "RECEIPT_PRINTER" ? "Test Print" : "Test"}</button></div><div className="grid grid-cols-2 gap-4"><label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Device name</span><input value={form.deviceName} onChange={(event) => setForm((currentForm) => ({ ...currentForm, deviceName: event.target.value }))} className="w-full h-10 px-3 border border-slate-200 rounded-lg" /></label><label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Connection type</span><select value={form.connectionType} onChange={(event) => setForm((currentForm) => ({ ...currentForm, connectionType: event.target.value }))} className="w-full h-10 px-3 border border-slate-200 rounded-lg bg-white"><option value="">Not configured</option><option>Keyboard / HID</option><option>Local service</option><option>Network</option><option>USB / Serial</option></select></label></div>{type === "RECEIPT_PRINTER" && <label className="block mt-4 text-sm text-slate-600"><span className="block mb-1 font-medium">Paper width</span><select value={form.paperWidth} onChange={(event) => setForm((currentForm) => ({ ...currentForm, paperWidth: event.target.value }))} className="w-40 h-10 px-3 border border-slate-200 rounded-lg bg-white"><option value="">Not set</option><option>58mm</option><option>80mm</option></select></label>}{scanner && <div className="mt-4 p-3 bg-slate-50 rounded-lg text-sm"><div className="font-medium">Scanner test area</div><div className="text-slate-500 mt-1">Last scanned barcode: <span className="font-semibold text-slate-800">{scan || "-"}</span></div><div className="text-slate-500">Scan time: {scanTime || "-"}</div><div className="text-slate-500">Scanner status: {scan ? "Scan received" : "Waiting for keyboard/HID scan"}</div></div>}<label className="flex items-center gap-2 mt-4 text-sm text-slate-600"><Toggle checked={form.active} onChange={(event) => setForm((currentForm) => ({ ...currentForm, active: event.target.checked }))} /> Configured and active</label><button onClick={() => onSave(form)} className="mt-4 h-9 px-4 bg-blue-600 text-white rounded-lg text-sm">Save configuration</button></div>;
}

function IntegrationHealth({ health }) {
  return <div className="bg-white border border-slate-200 rounded-xl overflow-hidden max-w-2xl"><div className="p-4 border-b font-semibold">Device and integration health</div>{Object.entries(health || {}).map(([name, value]) => <div key={name} className="flex justify-between px-4 py-3 border-b border-slate-100 text-sm"><span className="capitalize">{name.replace(/([A-Z])/g, " $1")}</span><span className={value === "Connected" || value === "Configured" ? "text-emerald-700" : "text-slate-500"}>{value}</span></div>)}</div>;
}

function OnlinePlatformSettings({ onMessage, onError }) {
  const [platforms, setPlatforms] = useState([]);
  const [forms, setForms] = useState({});
  const [saving, setSaving] = useState("");
  const [loading, setLoading] = useState(true);
  const [uberTest, setUberTest] = useState({ busy: false, result: null });
  const runUberConnectionTest = async () => {
    setUberTest({ busy: true, result: null });
    try {
      const data = await apiRequest("/api/online/uber/test-connection");
      setUberTest({ busy: false, result: data });
    } catch (err) {
      setUberTest({ busy: false, result: { success: false, message: err.message || "Test connection failed" } });
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await apiRequest("/api/settings/online-platforms");
      if (!data.success) throw new Error(data.message || "Unable to load online platform settings");
      const list = data.data || [];
      setPlatforms(list);
      setForms(Object.fromEntries(list.map((platform) => [platform.platform, {
        enabled: platform.enabled === true,
        environment: platform.environment || "sandbox",
        clientId: platform.client_id || "",
        clientSecret: "",
        storeLocationId: platform.store_location_id || "",
        storeId: platform.store_id || "",
        brandId: platform.brand_id || "",
        orderAcceptance: platform.order_acceptance === "auto" ? "auto" : "manual",
        requireOtpOnCompletion: platform.require_otp_on_completion === true,
        apiKey: "",
        webhookSecret: "",
        notes: platform.notes || "",
      }])));
    } catch (err) { onError(err.message || "Unable to load online platform settings"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const update = (platform, field, value) => setForms((current) => ({ ...current, [platform]: { ...current[platform], [field]: value } }));

  const save = async (platform, overrides = {}) => {
    try {
      setSaving(platform);
      const body = { ...forms[platform], ...overrides };
      for (const secretField of ["clientSecret", "apiKey", "webhookSecret"]) {
        if (!body[secretField]) delete body[secretField];
      }
      body.clientId = body.clientId || null;
      body.storeLocationId = body.storeLocationId || null;
      body.storeId = body.storeId || null;
      body.brandId = body.brandId || null;
      body.orderAcceptance = body.orderAcceptance === "auto" ? "auto" : "manual";
      body.requireOtpOnCompletion = body.requireOtpOnCompletion === true;
      body.notes = body.notes || null;
      const data = await apiRequest(`/api/settings/online-platforms/${platform}`, { method: "PUT", body: JSON.stringify(body) });
      if (!data.success) throw new Error(data.message || "Unable to save configuration");
      onMessage(data.message || "Configuration saved.");
      await load();
    } catch (err) { onError(err.message || "Unable to save configuration"); }
    finally { setSaving(""); }
  };

  if (loading) return <div className="p-8 text-center text-slate-400">Loading online platform settings...</div>;

  const fields = [
    ["clientId", "API / Client ID", "text", "client_id", null],
    ["clientSecret", "Client secret", "password", "client_secret_configured", "client_secret_masked"],
    ["storeLocationId", "Store / location ID", "text", "store_location_id", null],
    ["storeId", "Store ID", "text", "store_id", null],
    ["brandId", "Brand ID", "text", "brand_id", null],
    ["apiKey", "API key / access token", "password", "api_key_configured", "api_key_masked"],
    ["webhookSecret", "Webhook secret", "password", "webhook_secret_configured", "webhook_secret_masked"],
  ];

  return <div className="space-y-4">{platforms.map((platform) => {
    const form = forms[platform.platform] || {};
    const configured = platform.client_id || platform.client_secret_configured || platform.api_key_configured;
    return <div key={platform.platform} className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="font-semibold">{platform.name}</h2>
        <div className="flex items-center gap-3">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${platform.enabled ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{platform.enabled ? "Enabled" : "Disabled"}</span>
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${configured ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>{configured ? "Stub (credentials ready)" : "Not configured"}</span>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <Toggle checked={Boolean(form.enabled)} onChange={(event) => update(platform.platform, "enabled", event.target.checked)} />
            Enabled
          </label>
        </div>
      </div>
      <p className="text-xs text-slate-500 mb-4">Credentials are stored encrypted and never leave the server. Order actions use the real {platform.name} API once credentials are configured (stub mode until then); menu sync and webhooks are not yet connected.</p>
      {platform.platform === "uber" && (platform.store_id || platform.brand_id) && (
        <p className="text-xs text-slate-600 mb-4">
          Saved Store ID: <span className="font-mono">{platform.store_id || "not set"}</span>
          {platform.brand_id ? <> &nbsp;|&nbsp; Saved Brand ID: <span className="font-mono">{platform.brand_id}</span></> : null}
        </p>
      )}
      {platform.platform === "deliveroo" && (
        <div className="mt-4 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p>
            <span className="font-medium">Webhook URL (configure in the Deliveroo developer portal):</span>{" "}
            <span className="font-mono select-all">{String(window.location.origin)}/api/online/deliveroo/webhook</span>
          </p>
          <p className="mt-1">
            Deliveroo signs each webhook with HMAC-SHA256 using your webhook secret - store the same secret in the
            &quot;Webhook secret&quot; field above. Events are signature-verified when the secret is configured; until
            then they are stored and marked unverified. Every webhook request/response is recorded in the platform API
            audit log.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-600"><span className="block mb-1 font-medium">Environment</span>
          <select value={form.environment || "sandbox"} onChange={(event) => update(platform.platform, "environment", event.target.value)} className="w-full h-10 px-2 border border-slate-200 rounded-lg bg-white"><option value="sandbox">Sandbox</option><option value="production">Production</option></select>
        </label>
        {fields.map(([field, label, type, configuredKey, maskedKey]) => (
          <label key={field} className="text-sm text-slate-600">
            <span className="block mb-1 font-medium">{label}{platform[configuredKey] ? <span className="ml-2 text-xs text-emerald-600 font-normal">{(maskedKey && platform[maskedKey]) || "stored"}</span> : null}</span>
            <input type={type} autoComplete="new-password" value={form[field] || ""} placeholder={platform[configuredKey] ? "Leave blank to keep current value" : "Not set"} onChange={(event) => update(platform.platform, field, event.target.value)} className="w-full h-10 px-3 border border-slate-200 rounded-lg" />
          </label>
        ))}
        {platform.platform === "uber" && (
        <label className="text-sm text-slate-600 col-span-2">
          <span className="block mb-1 font-medium">Order acceptance</span>
          <select
            value={form.orderAcceptance || "manual"}
            onChange={(event) => update(platform.platform, "orderAcceptance", event.target.value)}
            className="w-full h-10 px-2 border border-slate-200 rounded-lg bg-white"
          >
            <option value="manual">Manual acceptance</option>
            <option value="auto">Auto-accept orders</option>
          </select>
          <span className="block mt-1 text-xs text-slate-400">Auto-accept immediately accepts new {platform.name} orders after they are received. Stored locally; synced to the platform when Uber supports it via API.</span>
        </label>
      )}
      <label className="text-sm text-slate-600 col-span-2">
        <span className="block mb-1 font-medium">Require customer OTP on completion</span>
        <select
          value={form.requireOtpOnCompletion ? "yes" : "no"}
          onChange={(event) => update(platform.platform, "requireOtpOnCompletion", event.target.value === "yes")}
          className="w-full h-10 px-2 border border-slate-200 rounded-lg bg-white"
        >
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
        <span className="block mt-1 text-xs text-slate-400">When Yes, the Online Orders page asks for the customer OTP before an order can be marked complete for {platform.name}. Default is No.</span>
      </label>
      <label className="text-sm text-slate-600 col-span-2"><span className="block mb-1 font-medium">Notes</span>
          <textarea rows="2" value={form.notes || ""} onChange={(event) => update(platform.platform, "notes", event.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg" />
        </label>
      </div>
      <button onClick={() => save(platform.platform)} disabled={saving === platform.platform} className="mt-4 h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{saving === platform.platform ? "Saving..." : `Save ${platform.name} configuration`}</button>
      {platform.platform === "uber" && (
        <div className="mt-4 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={runUberConnectionTest} disabled={uberTest.busy} className="h-9 px-4 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50">
              {uberTest.busy ? "Testing connection..." : "Test connection / Get sandbox IDs"}
            </button>
            <button onClick={runUberConnectionTest} disabled={uberTest.busy} className="h-9 px-4 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50">
              {uberTest.busy ? "Refreshing..." : "Refresh stores"}
            </button>
            <span className="text-xs text-slate-400">Calls the official Uber Get Stores endpoint (GET /v1/eats/stores) with the stored credentials and returns the real store/brand IDs.</span>
          </div>
          {uberTest.result && (
            <div className={`mt-3 rounded-lg border p-3 text-sm ${uberTest.result.success ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
              <p className={`font-medium ${uberTest.result.success ? "text-emerald-800" : "text-amber-800"}`}>{uberTest.result.message || (uberTest.result.success ? "Connection OK" : "Connection failed")}</p>
              {(uberTest.result.data?.attempts || []).map((attempt, index) => (
                <div key={index} className="mt-2 bg-white rounded-lg border border-slate-200 p-2">
                  <p className="text-xs font-medium text-slate-700">
                    {String(attempt.environment).toUpperCase()} attempt - {attempt.success ? "OK" : "FAILED"}{attempt.httpStatus ? ` - HTTP ${attempt.httpStatus}` : ""}{attempt.code ? ` - ${attempt.code}` : ""}
                  </p>
                  {attempt.message && <p className="text-xs text-slate-500 mt-1">{attempt.message}</p>}
                  {attempt.success && (attempt.stores || []).length === 0 && (
                    <p className="text-xs mt-1 font-medium text-amber-800">No Sandbox stores are currently provisioned for this application.</p>
                  )}
                  {(attempt.stores || []).length > 0 && (
                    <ul className="mt-2 space-y-2">
                      {attempt.stores.map((store, storeIndex) => (
                        <li key={storeIndex} className="text-xs font-mono text-slate-700 flex items-center justify-between gap-2 flex-wrap">
                          <span>
                            Store ID: {store.storeId}{store.name ? ` (${store.name})` : ""}{store.brandId ? ` | Brand ID: ${store.brandId}${store.brandName ? ` (${store.brandName})` : ""}` : ""}{store.status ? ` | Status: ${store.status}` : ""}{store.integrationEnabled !== null && store.integrationEnabled !== undefined ? ` | Integration: ${store.integrationEnabled ? "enabled" : "disabled"}` : ""}
                          </span>
                          {store.storeId && (
                            <button onClick={() => save("uber", { storeId: store.storeId, brandId: store.brandId || null })} disabled={saving === "uber"} className="h-7 px-2 border border-slate-300 rounded text-xs hover:bg-slate-50 disabled:opacity-50 shrink-0">
                              {saving === "uber" ? "Saving..." : "Save this Store ID"}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {attempt.uberResponse != null && (
                    <pre className="mt-2 max-h-56 overflow-auto bg-slate-50 rounded p-2 text-xs whitespace-pre-wrap text-slate-600">{JSON.stringify(attempt.uberResponse, null, 2)}</pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>;
  })}</div>;
}

export default SettingsAdmin;

