import { useCallback, useEffect, useState } from "react";
import { SETTINGS_TAB_SLUGS } from "../../utils/adminRoutes.js";
import { ArrowDown, ArrowUp, Edit, LayoutGrid, Plus, RefreshCw, Save, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import ServerApiSettings from "./ServerApiSettings.jsx";
import WhatsAppSettings from "./whatsapp/WhatsAppSettings.jsx";
import InvoiceDeliverySettings from "./invoiceDeliverySettings.jsx";
import { Toggle } from "../../components/ui.jsx";
import UserFormModal from "./UserFormModal.jsx";
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
  { label: "Sales & Tax", sections: ["Tax / VAT", "Receipts", "Payment Terminals", "Customer Loyalty"] },
  { label: "Hardware", sections: ["Hardware"] },
  { label: "Users", sections: ["Users", "Roles & Permissions"] },
  { label: "Integrations", sections: ["Connections", "Uber Eats", "Deliveroo", "WhatsApp"] },
  { label: "Communications", sections: ["SMS Delivery", "Email Delivery"] },
  { label: "System", sections: ["Server / API Configuration"] },
];

/*
 * Legacy section names (pre left-panel navigation) still arrive via deep
 * links and the profile menu; each is redirected to its new section.
 */
const LEGACY_TAB_REDIRECT = {
  "Users & Permissions": "Users",
  "Online Platforms": "Uber Eats",
  Integrations: "Connections",
};

function SettingsAdmin({ initialTab = "General", isAdmin = false }) {
  const tabs = SETTING_GROUPS.flatMap((group) => group.sections);
  /* Legacy deep links/profile-menu tabs redirect to their new sections. */
  const resolveInitialTab = (rawTab) => {
    const legacy = LEGACY_TAB_REDIRECT[rawTab];
    const mapped = legacy || rawTab;
    /* Deep-link support (legacy tabs included). */
    return tabs.includes(initialTab) || tabs.includes(mapped) ? mapped : "General";
  };
  const [tab, setTab] = useState(resolveInitialTab(initialTab));
  /*
   * T10V: the active section is mirrored into the URL
   * (/app/settings/<section-slug>) so refresh, direct links and
   * Back/Forward keep the exact section. One-way sync only — the URL is a
   * reflection of the section, never a second source of state.
   */
  useEffect(() => {
    const slug = SETTINGS_TAB_SLUGS[tab];
    if (!slug) return;
    /* The General tab is the plain /app/settings page. */
    const target = slug === "general" ? "/app/settings" : `/app/settings/${slug}`;
    if (window.location.pathname !== target) {
      window.history.replaceState({}, "", target);
    }
  }, [tab]);
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
          loyaltyEnabled: settingsResponse.data.loyalty?.enabled || false,
          loyaltyEarningRate: settingsResponse.data.loyalty?.earningRate || 0.01,
          scanGoEnabled: settingsResponse.data.scanGo?.enabled || false,
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

  return (
    <div className="flex gap-6 items-start">
      {/* Left settings navigation: groups with sub-items; each section opens
          separately in the content pane. */}
            <aside className="w-52 shrink-0 bg-white border border-slate-200 rounded-xl p-3 space-y-4">
        {SETTING_GROUPS.map((group) => {
          const sections = group.sections.filter(
            (item) => item !== "Server / API Configuration" || isAdmin
          );
          return (
            <div key={group.label}>
              <p className="px-2 mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.label}</p>
              <div className="space-y-0.5">
                {sections.map((item) => (
                  <button
                    key={item}
                    onClick={() => { setTab(item); setMessage(""); setError(""); }}
                    className={`w-full text-left px-2 h-8 rounded-md text-sm transition-colors ${tab === item ? "bg-blue-600 text-white font-medium" : "text-slate-600 hover:bg-slate-100"}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </aside>

      <div className="flex-1 min-w-0">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-sm text-slate-500 mt-1">{tab}</p>
        </div>
        {message && <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm">{message}</div>}
        {error && <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        {["General", "Company", "Tax / VAT"].includes(tab) && <SettingsForm tab={tab} form={form} setForm={setForm} onSave={saveSettings} />}
        {tab === "Store & Till" && <StoreTillSettings settings={settings} onMessage={setMessage} onError={setError} />}
        {tab === "Store & Till" && <InvoicePrefixesSetting form={form} onMessage={setMessage} onError={setError} />}
        {tab === "Store & Till" && <NegativeInventoryBillingSetting onError={setError} />}
        {tab === "Store & Till" && <DockQuickAccessSetting form={form} onMessage={setMessage} onError={setError} />}
        {tab === "Store & Till" && <CustomerDisplaySetting form={form} onMessage={setMessage} onError={setError} />}
        {tab === "Store & Till" && <SelfCheckoutKeysSetting onMessage={setMessage} onError={setError} />}
        {tab === "Payment Terminals" && <PaymentTerminalSettings terminals={terminals} onSaved={load} onMessage={setMessage} onError={setError} />}
        {tab === "Hardware" && <HardwareSettings hardware={hardware} onSave={saveHardware} onTest={testHardware} />}
        {tab === "Connections" && <IntegrationHealth health={health} />}
        {tab === "Integrations" && <IntegrationHealth health={health} />}
        {tab === "Uber Eats" && <OnlinePlatformSettings onMessage={setMessage} onError={setError} onlyPlatform="uber" />}
        {tab === "Deliveroo" && <OnlinePlatformSettings onMessage={setMessage} onError={setError} onlyPlatform="deliveroo" />}
        {tab === "Online Platforms" && <OnlinePlatformSettings onMessage={setMessage} onError={setError} />}
        {tab === "WhatsApp" && <WhatsAppSettings onMessage={setMessage} onError={setError} />}
        {tab === "Customer Loyalty" && <LoyaltySettings settings={settings} form={form} setForm={setForm} onSave={saveSettings} />}
        {tab === "SMS Delivery" && <InvoiceDeliverySettings channel="sms" onMessage={setMessage} onError={setError} />}
        {tab === "Email Delivery" && <InvoiceDeliverySettings channel="email" onMessage={setMessage} onError={setError} />}
        {tab === "Users" && <UsersSettings onMessage={setMessage} onError={setError} />}
        {tab === "Roles & Permissions" && <RolesSettings onMessage={setMessage} onError={setError} />}
        {tab === "Users & Permissions" && <UsersPermissionsSettings onMessage={setMessage} onError={setError} />}
        {tab === "Receipts" && <ReceiptSettings settings={settings} form={form} setForm={setForm} onSave={saveSettings} />}
        {tab === "Server / API Configuration" && isAdmin && <ServerApiSettings onMessage={setMessage} onError={setError} />}
      </div>
    </div>
  );
}

/*
 * Users section (left-panel navigation): user list only. Roles and the
 * permission matrix live in the separate "Roles & Permissions" section.
 */
function UsersSettings({ onMessage, onError }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [stores, setStores] = useState([]);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState("");
  const [permissions, setPermissions] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [u, r, s, p] = await Promise.all([
        apiRequest("/api/admin/users"),
        apiRequest("/api/admin/roles"),
        apiRequest("/api/admin/stores"),
        apiRequest("/api/auth/me/permissions")
      ]);
      if (!u.success) throw new Error(u.message);
      setUsers(u.data || []);
      setRoles(r.data || []);
      setStores(s.data || []);
      if (p.success) {
        setPermissions(p.data.permissions || []);
        setIsAdmin(p.data.isAdmin || false);
      }
    } catch (err) {
      setError(err.message || "Unable to load users");
      onError(err.message || "Unable to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (value) => {
    const data = await apiRequest(value.id ? `/api/admin/users/${value.id}` : "/api/admin/users", { method: value.id ? "PUT" : "POST", body: JSON.stringify(value) });
    if (!data.success) throw new Error(data.message);
    await load();
    setForm(null);
    onMessage("User saved.");
  };

  const toggle = async (user) => {
    try {
      await save({ id: user.id, fullName: user.full_name, email: user.email, roleId: user.role_id, storeId: user.store_id, active: !user.active });
    } catch (err) {
      onError(err.message || "Unable to update user");
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch =
      user.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.username?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "all" ||
                          (statusFilter === "active" && user.active) ||
                          (statusFilter === "inactive" && !user.active);

    return matchesSearch && matchesStatus;
  });

  const canViewUsers = isAdmin || permissions.includes("user.view");
  const canCreateUsers = isAdmin || permissions.includes("user.create");
  const canEditUsers = isAdmin || permissions.includes("user.edit");
  const canDeleteUsers = isAdmin || permissions.includes("user.delete");

  if (loading) return <div className="p-8 text-center text-slate-400">Loading users...</div>;

  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  if (!canViewUsers) return <div className="p-8 text-center text-slate-400">You don't have permission to view users</div>;

  return (
    <div className="space-y-6">
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="p-4 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <h2 className="font-semibold">Users</h2>
          {canCreateUsers && (
            <button onClick={() => setForm({})} className="h-9 px-3 bg-blue-600 text-white rounded text-sm">
              <Plus size={15} className="inline mr-1" />Add user
            </button>
          )}
        </div>
        <div className="p-4 border-b flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input 
              type="text" 
              placeholder="Search by name, username, or email..." 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              className="w-full h-9 px-3 border rounded text-sm" 
            />
          </div>
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)} 
            className="h-9 px-3 border rounded bg-white text-sm"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-slate-400">No users found matching your criteria</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50">
                {["Name", "Username / Email", "Role", "Primary Store", "Status", "Actions"].map((heading) => (
                  <th key={heading} className="text-left px-4 py-3 text-xs uppercase text-slate-500">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id} className="border-t">
                  <td className="px-4 py-3 text-sm font-medium">{user.full_name}</td>
                  <td className="px-4 py-3 text-sm">
                    {user.username}
                    <div className="text-xs text-slate-500">{user.email || "-"}</div>
                  </td>
                  <td className="px-4 py-3 text-sm">{user.role_name || "-"}</td>
                  <td className="px-4 py-3 text-sm">{user.store_name || "Unassigned"}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-1 rounded text-xs ${user.active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                      {user.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canEditUsers && (
                      <button 
                        onClick={() => setForm({ 
                          id: user.id, 
                          username: user.username, 
                          fullName: user.full_name, 
                          email: user.email || "", 
                          roleId: user.role_id || "", 
                          storeId: user.store_id || "", 
                          active: user.active 
                        })} 
                        className="p-2 text-slate-500" 
                        title="Edit user"
                      >
                        <Edit size={16} />
                      </button>
                    )}
                    {canDeleteUsers && (
                      <button 
                        onClick={() => toggle(user)} 
                        className="ml-1 px-2 py-1 text-sm border rounded"
                      >
                        {user.active ? "Deactivate" : "Activate"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {form && <UserFormModal form={form} roles={roles} stores={stores} onClose={() => setForm(null)} onSave={save} />}
      </div>
    </div>
  );
}

/*
 * Roles & Permissions section (left-panel navigation): role list plus the
 * per-role permission matrix, each previously stacked under the users list.
 */
function RolesSettings({ onMessage, onError }) {
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const r = await apiRequest("/api/admin/roles");
      if (!r.success) throw new Error(r.message || "Unable to load roles");
      setRoles(r.data || []);
    } catch (err) {
      onError(err.message || "Unable to load roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-8 text-center text-slate-400">Loading roles...</div>;

  return (
    <div className="space-y-6">
      <RoleListManager roles={roles} onChanged={load} onMessage={onMessage} onError={onError} />
      <RolePermissionsManager roles={roles} onMessage={onMessage} onError={onError} onChanged={load} />
    </div>
  );
}

/*
 * Legacy combined view (users + roles on one page). No longer linked from
 * the left navigation, but kept for the legacy "Users & Permissions"
 * deep link / render contract.
 */
function UsersPermissionsSettings({ onMessage, onError }) {
  return (
    <div className="space-y-6">
      <UsersSettings onMessage={onMessage} onError={onError} />
      <RolesSettings onMessage={onMessage} onError={onError} />
    </div>
  );
}

/*
 * T10U — Negative Inventory Billing safety setting (Admin/Owner only).
 *
 * OFF by default: the till rejects sales where recorded stock is
 * insufficient. Enabling it is a deliberate business decision, so the UI
 * shows a strong warning and the request carries an explicit
 * acknowledgement — the backend rejects an enabling call without it.
 * Turning it OFF needs no confirmation and never deletes anything; the
 * setting is company-wide and every change is audited server-side.
 */
function NegativeInventoryBillingSetting({ onError }) {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settingsData, permData] = await Promise.all([
        apiRequest("/api/settings"),
        apiRequest("/api/auth/me/permissions"),
      ]);
      if (settingsData.success) {
        setEnabled(settingsData.data?.inventory?.allowNegativeInventoryBilling === true);
      }
      if (permData.success) setIsAdmin(permData.data?.isAdmin === true || (permData.data?.permissions || []).includes("settings.manage"));
      setLoaded(true);
    } catch (err) {
      onError(err.message || "Unable to load the negative-inventory setting");
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const changeSetting = async (nextEnabled) => {
    if (saving) return;

    if (nextEnabled) {
      const confirmed = window.confirm(
        "WARNING — Allow Negative Inventory Billing?\n\n" +
        "The till will be allowed to complete sales even when recorded stock is insufficient.\n\n" +
        "• Stock balances may go NEGATIVE.\n" +
        "• Every such sale is recorded in the audit trail.\n" +
        "• Later deliveries, sales returns or stock adjustments will correct the balance.\n\n" +
        "Only continue if you accept responsibility for negative stock balances."
      );
      if (!confirmed) return;
    }

    try {
      setSaving(true);
      const data = await apiRequest("/api/settings/negative-inventory-billing", {
        method: "PUT",
        body: JSON.stringify({ enabled: nextEnabled, acknowledged: nextEnabled }),
      });
      if (!data.success) throw new Error(data.message || "Unable to update the setting");
      setEnabled(nextEnabled);
    } catch (err) {
      onError(err.message || "Unable to update the setting");
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin || !loaded) return null;

  return (
    <div className="bg-white border rounded-xl overflow-hidden" data-testid="negative-inventory-setting">
      <div className="p-4 border-b flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h2 className="font-semibold">Allow Negative Inventory Billing</h2>
          <p className="text-xs text-slate-500 mt-0.5">Company-wide. Admin/Owner control only — every change and every affected sale is audited.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-slate-600 shrink-0">
          <Toggle
            checked={enabled}
            disabled={saving}
            onChange={(event) => changeSetting(event.target.checked)}
          />
          {enabled ? "ON" : "OFF"}
        </label>
      </div>
      {enabled ? (
        <div className="px-4 py-3 bg-amber-50 border-t border-amber-200 text-amber-800 text-xs">
          ON — the till may sell beyond recorded stock; balances can go negative and are corrected by later deliveries, returns or adjustments. Every such sale is audited.
        </div>
      ) : (
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 text-slate-500 text-xs">
          OFF — the till blocks sales where recorded stock is insufficient (default, recommended).
        </div>
      )}
    </div>
  );
}

const PERMISSION_GROUPS = [
  {
    label: "Cash Management",
    codes: ["cash.open_drawer", "cash.payout", "cash.adjustment"],
  },
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
      "sale.refund",
      "sale.refund_without_receipt",
      "sale.price_change",
      "sale.hold",
    ],
  },
  {
    label: "Users/Employees",
    codes: [
      "user.view",
      "user.create",
      "user.edit",
      "user.delete",
      "user.manage",
    ],
  },
  { label: "Cash/Till", codes: ["cash.open_drawer", "cash.payout", "cash.adjustment", "till.open", "till.close"] },
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
    label: "Global Products",
    codes: [
      "global_product.view",
      "global_product.create",
      "global_product.edit",
      "global_product.delete",
    ],
  },
  {
    label: "Categories",
    codes: [
      "category.view",
      "category.create",
      "category.edit",
      "category.delete",
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
    label: "Stores",
    codes: [
      "store.view",
      "store.create",
      "store.edit",
      "store.delete",
    ],
  },
  {
    label: "Inventory",
    codes: [
      "inventory.view",
      "inventory.movements.view",
      "inventory.replenishment.view",
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

/*
 * T10J — Role list + create/edit/rename. Kept beside the permission matrix
 * so "Role Management" is one coherent page: pick a role, toggle its
 * permissions (persisted via the existing PUT role-permissions API),
 * create/edit roles via the existing role.manage authorization.
 */
function RoleListManager({ roles, onChanged, onMessage, onError }) {
  const [form, setForm] = useState(null); // null | { id?, name, description }
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      onError("Role name is required");
      return;
    }
    try {
      setBusy(true);
      const data = await apiRequest(
        form.id ? `/api/admin/roles/${form.id}` : "/api/admin/roles",
        {
          method: form.id ? "PUT" : "POST",
          body: JSON.stringify({ name: form.name.trim(), description: form.description || "" }),
        }
      );
      if (!data.success) throw new Error(data.message || "Unable to save role");
      setForm(null);
      await onChanged();
      onMessage(form.id ? "Role updated." : "Role created.");
    } catch (err) {
      onError(err.message || "Unable to save role");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="p-4 border-b border-slate-200 flex justify-between items-center">
        <div>
          <h3 className="font-semibold text-slate-800">Roles</h3>
          <p className="text-xs text-slate-500 mt-0.5">Create and name roles, then assign permissions per role below.</p>
        </div>
        <button
          onClick={() => setForm({ name: "", description: "" })}
          className="h-9 px-3 bg-blue-600 text-white rounded-lg text-sm font-medium"
        >
          <Plus size={15} className="inline mr-1" />
          Add role
        </button>
      </div>
      {form && (
        <form onSubmit={submit} className="p-4 bg-slate-50 border-b border-slate-200">
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-sm text-slate-600 flex-1 min-w-[180px]">
              <span className="block mb-1 font-medium">Role name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Store Manager"
                maxLength={100}
                className="w-full h-9 px-2 border border-slate-200 rounded"
                autoFocus
              />
            </label>
            <label className="text-sm text-slate-600 flex-1 min-w-[220px]">
              <span className="block mb-1 font-medium">Description (optional)</span>
              <input
                value={form.description || ""}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full h-9 px-2 border border-slate-200 rounded"
              />
            </label>
            <button type="submit" disabled={busy} className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
              {busy ? "Saving…" : form.id ? "Save role" : "Create role"}
            </button>
            <button type="button" onClick={() => setForm(null)} className="h-9 px-3 border border-slate-200 rounded text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
      <table className="w-full">
        <thead>
          <tr className="bg-slate-50">
            {["Role", "Description", "", ""].map((heading, index) => (
              <th key={index} className="text-left px-4 py-2 text-xs uppercase text-slate-500">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((role) => (
            <tr key={role.id} className="border-t border-slate-100">
              <td className="px-4 py-2 text-sm font-medium text-slate-800">
                {role.name}
                {role.is_system_role && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 align-middle">System</span>
                )}
              </td>
              <td className="px-4 py-2 text-sm text-slate-500">{role.description || "—"}</td>
              <td className="px-4 py-2 text-right">
                <button
                  onClick={() => setForm({ id: role.id, name: role.name, description: role.description || "" })}
                  disabled={role.is_system_role}
                  title={role.is_system_role ? "The Administrator role is protected" : "Rename role"}
                  className="p-2 text-slate-500 hover:text-slate-700 disabled:opacity-30"
                >
                  <Edit size={15} />
                </button>
              </td>
              <td className="px-4 py-2 text-right text-xs text-slate-400">{role.is_system_role ? "Protected" : ""}</td>
            </tr>
          ))}
          {roles.length === 0 && (
            <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No roles yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RolePermissionsManager({ roles, onMessage, onError, onChanged }) {
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
      /* T10J: role holder counts may change nothing, but keep the list fresh. */
      if (onChanged) await onChanged();
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
  const selectedRole = roles.find((r) => r.id === selectedRoleId) || null;
  /*
   * T10J activation semantics: a role is "inactive" when no active user
   * holds it AND it has no assigned permissions (the existing roles table
   * has no active column — users hold roles, not the reverse). System
   * roles (Administrator) are always active and protected.
   */
  const selectedRoleActive = selectedRole
    ? selectedRole.is_system_role || (selectedRole.user_count || 0) > 0
    : false;

  const setRoleActive = async (active) => {
    if (!selectedRoleId || !selectedRole) return;
    if (selectedRole.is_system_role) {
      onError("The Administrator role is protected and cannot be deactivated.");
      return;
    }
    if (!active) {
      const holders = selectedRole.user_count || 0;
      const confirmed = window.confirm(
        holders > 0
          ? `Deactivate "${selectedRole.name}"? ${holders} active user${holders === 1 ? "" : "s"} will be detached from this role.`
          : `Deactivate "${selectedRole.name}"?`
      );
      if (!confirmed) return;
    }
    try {
      const data = await apiRequest(`/api/admin/roles/${selectedRoleId}/active`, {
        method: "PUT",
        body: JSON.stringify({ active }),
      });
      if (!data.success) throw new Error(data.message || "Unable to update role");
      onMessage(data.message || (active ? "Role activated." : "Role deactivated."));
      if (onChanged) await onChanged();
    } catch (err) {
      onError(err.message || "Unable to update role");
    }
  };

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
          <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h4 className="font-medium text-slate-700">Permissions for {selectedRoleName}</h4>
              {selectedRole && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedRole.is_system_role
                    ? "System role — protected, always active."
                    : selectedRoleActive
                      ? `Active — ${selectedRole.user_count} active user${selectedRole.user_count === 1 ? "" : "s"} hold this role.`
                      : "Inactive — no active users hold this role."}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {!selectedRole?.is_system_role && (
                <label className="inline-flex items-center gap-2 text-sm text-slate-600" title="Active means at least one active user holds this role">
                  <Toggle
                    checked={selectedRoleActive}
                    onChange={(event) => setRoleActive(event.target.checked)}
                  />
                  Role active
                </label>
              )}
              <button onClick={save} disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                <Save size={16} /> {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
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
                        <Toggle
                          checked={rolePermissions.includes(code)}
                          onChange={() => toggle(code)}
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

/*
 * Invoice Prefixes (Store & Till): configurable receipt prefixes per sale
 * source — Till (TO), Delivery/online orders (DEL), Self-Checkout (SC).
 * Self-saving through the existing whole-form settings PUT; blank/unchanged
 * fields keep the stored value. Numbering sequences are untouched: the
 * prefix is presentation only.
 */
function InvoicePrefixesSetting({ form, onMessage, onError }) {
  const [prefixes, setPrefixes] = useState({ till: "TO", delivery: "DEL", selfCheckout: "SC" });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/api/settings");
      if (data.success && data.data?.invoicePrefixes) {
        setPrefixes({
          till: data.data.invoicePrefixes.till || "TO",
          delivery: data.data.invoicePrefixes.delivery || "DEL",
          selfCheckout: data.data.invoicePrefixes.selfCheckout || "SC",
        });
      }
      setLoaded(true);
    } catch (err) {
      onError(err.message || "Unable to load the invoice prefixes");
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form || !form.companyName) return; /* parent form not ready yet */
    try {
      setSaving(true);
      const data = await apiRequest("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...form, invoicePrefixes: prefixes }),
      });
      if (!data.success) throw new Error(data.message || "Unable to save the invoice prefixes");
      onMessage("Invoice prefixes saved. New sales use the updated prefixes; existing receipt numbers are unchanged.");
    } catch (err) {
      onError(err.message || "Unable to save the invoice prefixes");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded || !form) return null;

  const fields = [
    { key: "till", label: "Till invoice prefix", hint: "e.g. TO-20260919-0001" },
    { key: "delivery", label: "Delivery invoice prefix", hint: "e.g. DEL-<order ref>" },
    { key: "selfCheckout", label: "Self-checkout invoice prefix", hint: "e.g. SC-20260919-0001" },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4" data-testid="invoice-prefixes-setting">
      <div className="font-semibold mb-1">Invoice Prefixes</div>
      <div className="text-xs text-slate-500 mb-3">
        Receipt number prefixes per sale source. Existing sale numbers keep their original prefix and sequence.
      </div>
      <div className="grid grid-cols-3 gap-3">
        {fields.map((field) => (
          <div key={field.key}>
            <label className="text-sm text-slate-600" htmlFor={`invoice-prefix-${field.key}`}>{field.label}</label>
            <input
              id={`invoice-prefix-${field.key}`}
              type="text"
              data-testid={`invoice-prefix-${field.key}`}
              value={prefixes[field.key]}
              maxLength={10}
              onChange={(e) => setPrefixes((current) => ({ ...current, [field.key]: e.target.value.toUpperCase() }))}
              className="w-full h-10 px-3 border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <div className="text-[11px] text-slate-400 mt-1">{field.hint}</div>
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-3">
        <button
          type="button"
          data-testid="invoice-prefixes-save"
          onClick={save}
          disabled={saving}
          className="h-10 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded text-sm font-medium"
        >
          {saving ? "Saving…" : "Save Prefixes"}
        </button>
      </div>
    </div>
  );
}

function TillProductViewSetting({ form, onMessage, onError }) {
  const [view, setView] = useState("image");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/api/settings");
      if (data.success) {
        setView(data.data?.till?.productView === "compact" ? "compact" : "image");
      }
      setLoaded(true);
    } catch (err) {
      onError(err.message || "Unable to load the till product view setting");
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async (next) => {
    if (!form || !form.companyName) return; // parent form not ready yet
    try {
      setSaving(true);
      const previous = view;
      setView(next);
      /* The settings PUT is whole-form (companyName required): send the
         parent's currently-loaded form values plus the changed productView. */
      const data = await apiRequest("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...form, productView: next }),
      });
      if (!data.success) throw new Error(data.message || "Unable to save the till product view");
      onMessage(next === "compact" ? "Till switched to Compact View. Reload the Till to apply." : "Till switched to Image View. Reload the Till to apply.");
    } catch (err) {
      onError(err.message || "Unable to save the till product view");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded || !form) return null;

  return (
    <div className="bg-white border rounded-xl p-4 mt-4">
      <div className="font-semibold mb-1">Till Product View</div>
      <p className="text-xs text-slate-500 mb-3">
        Choose how products are displayed on the Till. Image View shows photo cards; Compact View is a dense list without images.
      </p>
      <div className="flex flex-col gap-2 max-w-md">
        {[
          { value: "image", label: "Image View", hint: "Visual product cards with photos (default)" },
          { value: "compact", label: "Compact View", hint: "Dense list, no images — fits many more products" },
        ].map((option) => (
          <label
            key={option.value}
            className={`flex items-center gap-3 border rounded-lg px-3 py-2.5 cursor-pointer transition ${
              view === option.value ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
            }`}
          >
            <input
              type="radio"
              name="till-product-view"
              value={option.value}
              checked={view === option.value}
              onChange={() => save(option.value)}
              disabled={saving}
              className="w-4 h-4 accent-blue-600"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">{option.label}</span>
              <span className="block text-xs text-slate-500">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {saving && <div className="text-xs text-slate-400 mt-2">Saving…</div>}
    </div>
  );
}

/*
 * T10W — Dock Quick Access picker.
 *
 * Lets the store choose which admin pages sit directly on the bottom dock
 * (in order), alongside the always-centred launcher and permanent Open Till
 * button. Up to 8 pages; saves through the existing whole-form settings PUT.
 * Changes apply after the admin page is reloaded.
 */
const DOCK_PAGE_OPTIONS = [
  "Dashboard", "Sales", "Returns", "Supplier Returns", "Order Prep", "Payments",
  "Products", "Global Products", "Categories", "Purchases", "Suppliers", "Inventory",
  "Replenishment", "Customers", "Employees", "Stores", "Reports", "Integrations",
  "Accounting", "Settings",
];
const DOCK_MAX = 8;

function DockQuickAccessSetting({ form, onMessage, onError }) {
  const [selected, setSelected] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/api/settings");
      if (data.success && Array.isArray(data.data?.dock?.quickAccess)) {
        setSelected(data.data.dock.quickAccess.slice(0, DOCK_MAX));
      }
      setLoaded(true);
    } catch (err) {
      onError(err.message || "Unable to load the dock quick access setting");
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const save = async (next) => {
    if (!form || !form.companyName) return; /* parent form not ready yet */
    try {
      setSaving(true);
      /* Whole-form contract: parent's loaded values + the changed dock list. */
      const data = await apiRequest("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...form, dockQuickAccess: next }),
      });
      if (!data.success) throw new Error(data.message || "Unable to save the dock quick access");
      setSelected(next);
      onMessage("Dock updated. Reload the admin page (F5) to apply the new bottom bar.");
    } catch (err) {
      onError(err.message || "Unable to save the dock quick access");
    } finally {
      setSaving(false);
    }
  };

  const move = (index, dir) => {
    const next = [...selected];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item);
    save(next);
  };

  const toggle = (page) => {
    if (selected.includes(page)) {
      save(selected.filter((p) => p !== page));
    } else if (selected.length < DOCK_MAX) {
      save([...selected, page]);
    }
  };

  if (!loaded || !form) return null;

  return (
    <div className="bg-white border rounded-xl p-4 mt-4">
      <div className="flex items-center gap-2 font-semibold mb-1">
        <LayoutGrid size={16} className="text-teal-700" />
        Dock Quick Access
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Choose which pages sit directly on the bottom navigation bar (max {DOCK_MAX}).
        The “All pages” launcher in the middle always gives access to everything, and Open Till stays fixed at the end.
      </p>

      {/* currently on the dock — ordered, removable, reorderable */}
      <div className="text-xs font-semibold text-slate-600 mb-1.5">On the dock ({selected.length}/{DOCK_MAX})</div>
      {selected.length === 0 ? (
        <div className="text-xs text-slate-400 border border-dashed rounded-lg px-3 py-2.5 mb-3">
          Nothing pinned — the dock shows its default layout.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {selected.map((page, i) => (
            <span key={page} className="inline-flex items-center gap-1 border rounded-lg pl-2.5 pr-1 py-1 text-sm bg-slate-50">
              {page}
              <button
                onClick={() => move(i, -1)}
                disabled={saving || i === 0}
                aria-label={`Move ${page} earlier`}
                className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"
              >
                <ArrowUp size={13} />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={saving || i === selected.length - 1}
                aria-label={`Move ${page} later`}
                className="p-1 rounded hover:bg-slate-200 disabled:opacity-30"
              >
                <ArrowDown size={13} />
              </button>
              <button
                onClick={() => toggle(page)}
                disabled={saving}
                aria-label={`Remove ${page} from the dock`}
                className="p-1 rounded hover:bg-red-100 text-slate-400 hover:text-red-600"
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* available pages — one-tap add */}
      <div className="text-xs font-semibold text-slate-600 mb-1.5">Available pages</div>
      <div className="flex flex-wrap gap-1.5">
        {DOCK_PAGE_OPTIONS.filter((p) => !selected.includes(p)).map((page) => (
          <button
            key={page}
            onClick={() => toggle(page)}
            disabled={saving || selected.length >= DOCK_MAX}
            className="px-2.5 py-1 border rounded-lg text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            + {page}
          </button>
        ))}
      </div>
      {saving && <div className="text-xs text-slate-400 mt-2">Saving…</div>}
    </div>
  );
}

/*
 * Customer Display (second monitor) — company-level switch plus the
 * open/close action for the cashier. The till header has no button; this
 * card is the only entry point.
 */
function CustomerDisplaySetting({ form, onMessage, onError }) {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false); /* is a display window broadcasting? */

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/api/settings");
      if (data.success) {
        setEnabled(data.data?.customerDisplay?.enabled === true);
      }
      setLoaded(true);
    } catch (err) {
      onError(err.message || "Unable to load the customer display setting");
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  /* Is a customer-display window already open on this browser? The till
   * broadcasts its bill continuously, so "BILL" traffic means the mirror
   * is live; a silent channel for 3s means no active till/window. */
  useEffect(() => {
    if (typeof BroadcastChannel !== "function") return undefined;
    const channel = new BroadcastChannel("onepos-customer-display");
    let timer = null;
    channel.onmessage = () => {
      setOpen(true);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setOpen(false), 3000);
    };
    return () => {
      if (timer) window.clearTimeout(timer);
      try { channel.close(); } catch { /* ignore */ }
    };
  }, []);

  const save = async (next) => {
    if (!form || !form.companyName) return; /* parent form not ready yet */
    try {
      setSaving(true);
      const previous = enabled;
      setEnabled(next);
      const data = await apiRequest("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ ...form, customerDisplayEnabled: next }),
      });
      if (!data.success) throw new Error(data.message || "Unable to save the customer display setting");
      onMessage(next
        ? "Customer Display is ON — open it below and place the window on the second monitor."
        : "Customer Display is OFF — any open display window will show the standby screen.");
    } catch (err) {
      setEnabled(previous);
      onError(err.message || "Unable to save the customer display setting");
    } finally {
      setSaving(false);
    }
  };

  /* Opens /customer-display in its own window (drag onto the second
     monitor). The window itself is read-only and needs no login. */
  const openDisplay = () => {
    const win = window.open(
      "/customer-display",
      "onepos-customer-display-window",
      "popup=yes,width=720,height=1080"
    );
    if (!win) {
      onError("The browser blocked the window — allow pop-ups for this site and try again.");
    }
  };

  if (!loaded || !form) return null;

  return (
    <div className="bg-white border rounded-xl p-4 mt-4">
      <div className="font-semibold mb-1">Customer Display</div>
      <p className="text-xs text-slate-500 mb-3">
        Shows the current bill on a second monitor for the customer. The till is
        always the source of truth; the customer window is read-only.
      </p>
      <div className="flex items-center gap-3">
        <Toggle checked={enabled} onChange={(v) => save(v)} disabled={saving} />
        <span className="text-sm text-slate-700">
          {enabled ? "ON — the till offers the Open Customer Display action" : "OFF — Customer Display is disabled"}
        </span>
      </div>
      {enabled && (
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={openDisplay}
            className="h-9 px-4 bg-teal-700 text-white rounded-lg text-sm font-medium hover:bg-teal-800"
          >
            Open Customer Display
          </button>
          <span className="text-xs text-slate-500">
            {open
              ? "The till is mirroring its bill — a display window shows it live (offline too)."
              : "No till is mirroring yet — open the till; a display window picks up its bill automatically."}
          </span>
        </div>
      )}
    </div>
  );
}

/*
 * Self-Checkout device pairing — per store. Generate/clear the device key
 * that the login screen's Self-Checkout entry asks for. Only a bcrypt hash
 * is stored; the raw key is displayed once.
 */
function SelfCheckoutKeysSetting({ onMessage, onError }) {
  const [stores, setStores] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(""); /* store id being worked on */
  const [keys, setKeys] = useState({}); /* store id -> raw key (shown once) */
  const [revealed, setRevealed] = useState({});

  const load = useCallback(async () => {
    try {
      const data = await apiRequest("/api/admin/stores");
      if (data.success) setStores(data.data || []);
      setLoaded(true);
    } catch (err) {
      onError(err.message || "Unable to load stores");
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const generate = async (store) => {
    try {
      setBusy(store.id);
      const data = await apiRequest(`/api/admin/stores/${store.id}/self-checkout-key`, { method: "POST", body: JSON.stringify({}) });
      if (!data.success) throw new Error(data.message || "Unable to generate the device key");
      setKeys((k) => ({ ...k, [store.id]: data.data.deviceKey }));
      setRevealed((r) => ({ ...r, [store.id]: true }));
      onMessage("Device key generated — copy it now, it is shown only once.");
    } catch (err) {
      onError(err.message || "Unable to generate the device key");
    } finally {
      setBusy("");
    }
  };

  const clear = async (store) => {
    try {
      setBusy(store.id);
      const data = await apiRequest(`/api/admin/stores/${store.id}/self-checkout-key`, { method: "POST", body: JSON.stringify({ clear: true }) });
      if (!data.success) throw new Error(data.message || "Unable to clear the device key");
      setKeys((k) => ({ ...k, [store.id]: null }));
      onMessage("Self-Checkout pairing cleared — existing device sessions end when their token expires.");
    } catch (err) {
      onError(err.message || "Unable to clear the device key");
    } finally {
      setBusy("");
    }
  };

  if (!loaded) return null;

  return (
    <div className="bg-white border rounded-xl p-4 mt-4">
      <div className="font-semibold mb-1">Self-Checkout device pairing</div>
      <p className="text-xs text-slate-500 mb-3">
        Self-Checkout is started from the login screen (no staff login needed on
        that device). Generate a key per store, enter it once on the device's
        login screen, and customers get the card-only till with Guest / Sign-in
        options. The key is stored hashed and shown only once.
      </p>
      {stores.map((store) => (
        <div key={store.id} className="flex items-center gap-3 py-2 border-t border-slate-100 first:border-t-0">
          <span className="text-sm font-medium text-slate-700 flex-1 truncate">{store.name}</span>
          {keys[store.id] ? (
            <code className="text-xs bg-slate-100 border rounded px-2 py-1 tracking-wider">
              {revealed[store.id] ? keys[store.id] : "•••• •••• •••• ••••"}
            </code>
          ) : null}
          <button
            onClick={() => generate(store)}
            disabled={busy === store.id}
            className="h-8 px-3 bg-teal-700 text-white rounded-lg text-sm hover:bg-teal-800 disabled:opacity-50"
          >
            {busy === store.id ? "Generating…" : keys[store.id] ? "Regenerate" : "Generate key"}
          </button>
          {keys[store.id] ? (
            <button
              onClick={() => clear(store)}
              disabled={busy === store.id}
              className="h-8 px-3 border rounded-lg text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Clear pairing
            </button>
          ) : null}
        </div>
      ))}
      {stores.length === 0 && <div className="text-sm text-slate-400">No stores found.</div>}
    </div>
  );
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

  return <form onSubmit={onSave} className="bg-white border border-slate-200 rounded-xl p-5 max-w-2xl"><h2 className="font-semibold mb-4">{tab}</h2><div className="grid grid-cols-2 gap-4">{tab === "Company" ? companyFields : <>{field("dateFormat", "Date format")}{field("currency", "Currency")}{field("timezone", "Timezone")}{tab === "Tax / VAT" && <><label className="flex items-center gap-2 text-sm text-slate-600 pt-6"><Toggle checked={form.vatEnabled} onChange={(event) => setForm((current) => ({ ...current, vatEnabled: event.target.checked }))} /> VAT enabled</label>{field("defaultVatRate", "Default VAT rate %", "number")}</>}{tab === "General" && <label className="flex items-center gap-2 text-sm text-slate-600 pt-6"><Toggle checked={form.scanGoEnabled === true} onChange={(event) => setForm((current) => ({ ...current, scanGoEnabled: event.target.checked }))} /> Scan &amp; Go — customers scan products on their phone</label>}</>}</div><button type="submit" className="mt-5 h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium">Save settings</button></form>;
}

function ReceiptSettings({ settings, form, setForm, onSave }) {
  return <div className="bg-white border border-slate-200 rounded-xl p-5 max-w-2xl"><h2 className="font-semibold mb-4">Receipt settings</h2><p className="text-sm text-slate-500 mb-4">Receipts use the existing company and tax settings. Printer configuration is managed under Hardware.</p><div className="grid grid-cols-2 gap-4 text-sm"><div><span className="text-slate-500">Header company</span><div className="font-medium mt-1">{settings.company.name}</div></div><div><span className="text-slate-500">VAT display</span><div className="font-medium mt-1">{form.vatEnabled ? `Enabled (${form.defaultVatRate}%)` : "Disabled"}</div></div><div><span className="text-slate-500">Date format</span><div className="font-medium mt-1">{form.dateFormat}</div></div><div><span className="text-slate-500">Paper width</span><div className="font-medium mt-1">Configure under Hardware</div></div></div><button onClick={onSave} className="mt-5 h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium">Save receipt settings</button></div>;
}

function LoyaltySettings({ settings, form, setForm, onSave }) {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async (event) => {
    event.preventDefault();
    setError("");

    const rate = Number(form.loyaltyEarningRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      setError("Earning rate must be between 0% and 100%");
      return;
    }

    try {
      setSaving(true);
      await onSave(event);
      setMessage("Loyalty settings saved.");
    } catch (err) {
      setError(err.message || "Unable to save loyalty settings");
    } finally {
      setSaving(false);
    }
  };

  const formatRate = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "0.00";
    return (num * 100).toFixed(2);
  };

  const handleRateChange = (event) => {
    const val = event.target.value;
    setForm((current) => ({ ...current, loyaltyEarningRate: val }));
  };

  return (
    <form onSubmit={handleSave} className="bg-white border border-slate-200 rounded-xl p-5 max-w-2xl">
      <h2 className="font-semibold mb-4">Customer Loyalty</h2>
      <p className="text-sm text-slate-500 mb-5">Configure the customer loyalty programme. Customers earn points on purchases when enabled.</p>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

      <div className="space-y-5">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-slate-800">Enable Loyalty Programme</h3>
              <p className="text-sm text-slate-500 mt-1">When enabled, customers earn points on eligible purchases based on the earning rate.</p>
            </div>
            <label className="inline-flex items-center gap-2">
              <Toggle
                checked={form.loyaltyEnabled !== false}
                onChange={(event) => setForm((current) => ({ ...current, loyaltyEnabled: event.target.checked }))}
              />
            </label>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <h3 className="font-medium text-slate-800 mb-3">Earning Rate</h3>
          <p className="text-sm text-slate-500 mb-3">Customers earn this percentage of their purchase total as loyalty points (e.g., 1% = 1 point per £1 spent).</p>
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-600">
              <span className="block mb-1 font-medium">Earning rate %</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={formatRate(form.loyaltyEarningRate)}
                onChange={handleRateChange}
                className="w-24 h-10 px-3 border border-slate-200 rounded-lg text-right"
                aria-describedby="rate-hint"
              />
            </label>
            <span className="text-slate-400 text-sm" id="rate-hint">Maximum 100%</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-6">
        <button type="submit" disabled={saving} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          {saving ? "Saving…" : "Save loyalty settings"}
        </button>
      </div>
    </form>
  );
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

function OnlinePlatformSettings({ onMessage, onError, onlyPlatform = null }) {
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

  /* T10-UBER-MENU: OnePOS -> Uber Eats menu synchronisation. */
  const [uberMenuSync, setUberMenuSync] = useState({ busy: false, result: null });
  const runUberMenuSync = async () => {
    setUberMenuSync({ busy: true, result: null });
    try {
      const data = await apiRequest("/api/online/uber/sync-menu", { method: "POST" });
      setUberMenuSync({ busy: false, result: data });
      if (data.success) await load();
    } catch (err) {
      setUberMenuSync({ busy: false, result: { success: false, message: err.message || "Menu sync failed" } });
    }
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await apiRequest("/api/settings/online-platforms");
      if (!data.success) throw new Error(data.message || "Unable to load online platform settings");
      /* When a specific platform section is open (Uber Eats / Deliveroo),
         show only that platform. */
      const list = onlyPlatform
        ? (data.data || []).filter((platform) => platform.platform === onlyPlatform)
        : data.data || [];
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
      <p className="text-xs text-slate-500 mb-4">Credentials are stored encrypted and never leave the server. Order actions use the real {platform.name} API once credentials are configured (stub mode until then); webhook events are received at the URL below and every exchange is recorded in the platform API audit log.</p>
      {platform.platform === "uber" && (platform.store_id || platform.brand_id) && (
        <p className="text-xs text-slate-600 mb-4">
          Saved Store ID: <span className="font-mono">{platform.store_id || "not set"}</span>
          {platform.brand_id ? <> &nbsp;|&nbsp; Saved Brand ID: <span className="font-mono">{platform.brand_id}</span></> : null}
        </p>
      )}
      {platform.platform === "uber" && (
        <div className="mt-4 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p>
            <span className="font-medium">Primary Webhook URL (configure in the Uber Developer Dashboard for this Client ID):</span>{" "}
            <span className="font-mono select-all">{String(window.location.origin)}/api/online/uber/webhook</span>
          </p>
          <p className="mt-1">
            Uber signs each delivery with <span className="font-mono">X-Uber-Signature</span> (HMAC-SHA256 over the raw
            body using your Client Secret). Keep the Client Secret stored above - it is used to verify every webhook;
            no extra entry is required. Events handled: <span className="font-mono">store.provisioned</span>,{" "}
            <span className="font-mono">store.deprovisioned</span>, <span className="font-mono">orders.notification</span>.
            Each delivery is acknowledged with HTTP 200 (empty body) and recorded in the platform API audit log.
          </p>
        </div>
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
            <button onClick={runUberConnectionTest} disabled={uberTest.busy || uberMenuSync.busy} className="h-9 px-4 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50">
              {uberTest.busy ? "Testing connection..." : "Test connection / Get sandbox IDs"}
            </button>
            <button onClick={runUberMenuSync} disabled={uberMenuSync.busy || uberTest.busy} className="h-9 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {uberMenuSync.busy ? "Syncing menu..." : "Sync Menu to Uber"}
            </button>
            <button onClick={runUberConnectionTest} disabled={uberTest.busy} className="h-9 px-4 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 disabled:opacity-50">
              {uberTest.busy ? "Refreshing..." : "Refresh stores"}
            </button>
            <span className="text-xs text-slate-400">Calls the official Uber Get Stores endpoint (GET /v1/eats/stores) with the stored credentials and returns the real store/brand IDs. Sync Menu publishes products marked "Available on Uber Eats" to the configured Uber store (sandbox or production per the Environment above) - onePOS data is never modified.</span>
          </div>
          {uberMenuSync.result && (
            <div className={`mt-3 rounded-lg border p-3 text-sm ${uberMenuSync.result.success ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
              <p className={`font-medium ${uberMenuSync.result.success ? "text-emerald-800" : "text-amber-800"}`}>{uberMenuSync.result.message || (uberMenuSync.result.success ? "Menu synced" : "Menu sync failed")}</p>
              {uberMenuSync.result.data && (
                <p className="text-xs text-slate-500 mt-1">
                  {uberMenuSync.result.data.published} item(s) published across {uberMenuSync.result.data.categories} category/categories
                  {uberMenuSync.result.data.skippedInactive ? `; ${uberMenuSync.result.data.skippedInactive} inactive product(s) skipped` : ""}
                  {uberMenuSync.result.data.httpStatus ? ` - HTTP ${uberMenuSync.result.data.httpStatus}` : ""}
                </p>
              )}
            </div>
          )}
          {(platform.menu_sync_last_success || platform.menu_sync_last_error) && (
            <p className="text-xs text-slate-500 mt-2">
              {platform.menu_sync_last_success ? `Last successful sync: ${new Date(platform.menu_sync_last_success).toLocaleString()}` : `Last sync error: ${platform.menu_sync_last_error}`}
            </p>
          )}
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



