import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { Toggle } from "../../components/ui.jsx";

export default function UserFormModal({ form: initial, roles, stores, onClose, onSave }) {
  const [form, setForm] = useState({ password: "", active: true, ...initial }); 
  const [error, setError] = useState(""); 
  const [saving, setSaving] = useState(false); 
  const [userStores, setUserStores] = useState([]); 
  const [loadingStores, setLoadingStores] = useState(false); 
  const [savingStores, setSavingStores] = useState(false);
  
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  
  const loadUserStores = async () => {
    if (!form.id) return;
    try {
      setLoadingStores(true);
      const data = await apiRequest(`/api/admin/users/${form.id}/stores`);
      if (data.success) setUserStores(data.data || []);
    } catch (err) {
      console.error("Load user stores error:", err);
    } finally {
      setLoadingStores(false);
    }
  };

  useEffect(() => { if (form.id) loadUserStores(); }, [form.id]);

  const toggleStore = (storeId) => {
    const isActive = userStores.find(s => s.id === storeId)?.assigned === true;
    if (isActive) {
      setUserStores(userStores.map(s => s.id === storeId ? { ...s, assigned: false } : s));
    } else {
      setUserStores(userStores.map(s => s.id === storeId ? { ...s, assigned: true } : s));
    }
  };

  const saveStoreAccess = async () => {
    if (!form.id) return;
    try {
      setSavingStores(true);
      const assignedStoreIds = userStores.filter(s => s.assigned && s.active).map(s => s.id);
      const data = await apiRequest(`/api/admin/users/${form.id}/stores`, {
        method: "PUT",
        body: JSON.stringify({ storeIds: assignedStoreIds })
      });
      if (!data.success) throw new Error(data.message);
      await loadUserStores();
    } catch (err) {
      setError(err.message || "Unable to save store access");
    } finally {
      setSavingStores(false);
    }
  };

  const submit = async (event) => { 
    event.preventDefault(); 
    setError("");
    
    if (!form.fullName) { 
      setError("Full name is required"); 
      return; 
    } 
    
    if (!form.id && !form.password) { 
      setError("Password is required for new users"); 
      return; 
    } 
    
    if (form.password && form.password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    
    try { 
      setSaving(true); 
      await onSave(form); 
    } catch (err) { 
      setError(err.message || "Unable to save user"); 
    } finally { 
      setSaving(false); 
    } 
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[560px] max-w-full shadow-2xl">
        <div className="p-4 border-b flex justify-between">
          <h2 className="font-bold text-lg">{form.id ? "Edit User" : "Add User"}</h2>
          <button onClick={onClose} title="Close"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="p-4">
          {error && <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          
          <div className="grid grid-cols-2 gap-3">
            {[
              ["fullName", "Full name"],
              ["username", "Username"],
              ["email", "Email"],
              ["password", "Password"]
            ].map(([field, label]) => (
              <label key={field} className="text-sm text-slate-600">
                <span className="block mb-1 font-medium">{label}</span>
                <input
                  disabled={field === "username" && Boolean(form.id)}
                  required={field === "fullName" || field === "username" || (!form.id && field === "password")}
                  type={field === "password" ? "password" : field === "email" ? "email" : "text"}
                  value={form[field] || ""}
                  onChange={(event) => update(field, event.target.value)}
                  className="w-full h-9 px-2 border rounded"
                />
              </label>
            ))}
          </div>

          <label className="block mt-3 text-sm text-slate-600">
            Role
            <select
              value={form.roleId}
              onChange={(event) => update("roleId", event.target.value)}
              className="block w-full h-9 mt-1 border rounded bg-white"
            >
              <option value="">Unassigned</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </label>

          <label className="block mt-3 text-sm text-slate-600">
            Primary Store
            <select
              value={form.storeId}
              onChange={(event) => update("storeId", event.target.value)}
              className="block w-full h-9 mt-1 border rounded bg-white"
            >
              <option value="">Unassigned</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </label>

          {form.id && (
            <div className="mt-4 border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium text-sm">Store Access</h3>
                <button
                  type="button"
                  onClick={saveStoreAccess}
                  disabled={savingStores}
                  className="h-8 px-3 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
                >
                  {savingStores ? "Saving..." : "Save Access"}
                </button>
              </div>
              {loadingStores ? (
                <div className="text-sm text-slate-400">Loading stores...</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {userStores.length === 0 ? (
                    <div className="text-sm text-slate-400">No stores available</div>
                  ) : (
                    userStores.map((store) => (
                      <div key={store.id} className="flex items-center justify-between p-2 border rounded bg-slate-50">
                        <div className="flex items-center gap-2">
                          <Toggle
                            checked={store.assigned === true && store.active === true}
                            onChange={() => store.active && toggleStore(store.id)}
                            disabled={!store.active}
                          />
                          <span className="text-sm">{store.name}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {store.code || "-"}
                          {!store.active && <span className="ml-2 text-orange-600">(Inactive)</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between items-center mt-5">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.active !== false}
                onChange={(e) => update("active", e.target.checked)}
                className="accent-blue-600"
              />
              Active
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="h-9 px-3 border rounded text-sm">Cancel</button>
              <button disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
                {saving ? "Saving..." : "Save User"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}