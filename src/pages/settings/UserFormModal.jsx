import PlatformExtensionFields from "../../components/platform/PlatformExtensionFields.jsx";
import { useState, useEffect, useRef } from "react";
import { apiRequest } from "../../services/api.js";
import { Toggle } from "../../components/ui.jsx";
import RecordModal from "../../components/RecordModal.jsx";

const FORM_ID = "onepos-user-form";

/**
 * The user's fields, with NO dialog chrome.
 *
 * Split out so the same body can be hosted by the shared RecordModal today and
 * by a full-page host later without copying a single field or handler.
 */
export function UserFormFields({
  form,
  update,
  roles,
  stores,
  userStores,
  loadingStores,
  toggleStore,
  saveStoreAccess,
  savingStores,
  canViewDivisions,
  canManageDivisions,
  userDivisions,
  toggleDivision,
  divisions,
  loadingDivisions,
  saveDivisionAccess,
  savingDivisions,
  onReady,
  onChange,
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {[
          ["fullName", "Full name"],
          ["username", "Username"],
          ["email", "Email"],
          ["password", "Password"],
        ].map(([field, label]) => (
          <label key={field} className="onepos-label">
            <span className="block mb-1 font-medium">{label}</span>
            <input
              disabled={field === "username" && Boolean(form.id)}
              required={field === "fullName" || field === "username" || (!form.id && field === "password")}
              type={field === "password" ? "password" : field === "email" ? "email" : "text"}
              value={form[field] || ""}
              onChange={(event) => update(field, event.target.value)}
              className="onepos-input"
            />
          </label>
        ))}
      </div>

      <label className="onepos-label mt-3">
        Role
        <select
          value={form.roleId}
          onChange={(event) => update("roleId", event.target.value)}
          className="onepos-input mt-1"
        >
          <option value="">Unassigned</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>{role.name}</option>
          ))}
        </select>
      </label>

      <label className="onepos-label mt-3">
        Primary Store
        <select
          value={form.storeId}
          onChange={(event) => update("storeId", event.target.value)}
          className="onepos-input mt-1"
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
            <h3 className="onepos-section-title">Store Access</h3>
            <button
              type="button"
              onClick={saveStoreAccess}
              disabled={savingStores}
              className="onepos-btn onepos-btn-sm onepos-btn-secondary"
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
                  <div key={store.id} className="flex items-center justify-between p-2 border rounded-md bg-slate-50">
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

          {form.id && canViewDivisions && (
            <div className="mt-4 border-t pt-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="onepos-section-title">Business Division Access</h3>
                {canManageDivisions && (
                  <button
                    type="button"
                    onClick={saveDivisionAccess}
                    disabled={savingDivisions || loadingDivisions}
                    className="onepos-btn onepos-btn-sm onepos-btn-secondary"
                  >
                    {savingDivisions ? "Saving..." : "Save Access"}
                  </button>
                )}
              </div>
              {loadingDivisions ? (
                <div className="text-sm text-slate-400">Loading business divisions...</div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {divisions.length === 0 ? (
                    <div className="text-sm text-slate-400">No business divisions available</div>
                  ) : (
                    divisions.map((division) => (
                      <label key={division.id} className="flex items-center gap-2 p-2 border rounded-md bg-slate-50 text-sm">
                        <input
                          type="checkbox"
                          checked={userDivisions.includes(division.id)}
                          onChange={() => toggleDivision(division.id)}
                          disabled={!canManageDivisions || !division.active}
                          className="accent-blue-600"
                        />
                        <span>{division.code} — {division.name}</span>
                        {!division.active && <span className="text-xs text-orange-600">(Inactive)</span>}
                      </label>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-600 mt-5">
        <input
          type="checkbox"
          checked={form.active !== false}
          onChange={(event) => update("active", event.target.checked)}
          className="accent-blue-600"
        />
        Active
      </label>

      <PlatformExtensionFields
        objectKey="employee"
        recordId={form.id}
        coreValues={{ full_name: form.fullName, username: form.username, email: form.email, active: form.active }}
        onChange={onChange}
        onReady={onReady}
      />
    </>
  );
}

/**
 * User Create / Edit, hosted by the shared RecordModal.
 *
 * Same props and same server calls as before — the previous hand-rolled
 * overlay/header/footer were replaced by the shared foundation, and the store /
 * business-division access sub-forms keep their own explicit Save Access
 * actions (unchanged).
 */
export default function UserFormModal({ form: initial, roles, stores, onClose, onSave, canViewDivisions = false, canManageDivisions = false }) {
  const [platform, setPlatform] = useState(null);
  const [platformReady, setPlatformReady] = useState(false);
  const [form, setForm] = useState({ password: "", active: true, ...initial });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [userStores, setUserStores] = useState([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [savingStores, setSavingStores] = useState(false);
  const [divisions, setDivisions] = useState([]);
  const [userDivisions, setUserDivisions] = useState([]);
  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [savingDivisions, setSavingDivisions] = useState(false);

  /* Snapshot of the opened record, so "dirty" only means the user changed
     something (a clean form must close without prompting). */
  const initialRef = useRef(null);
  if (initialRef.current === null) {
    initialRef.current = JSON.stringify({ password: "", active: true, ...initial });
  }
  const dirty = JSON.stringify(form) !== initialRef.current;

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

  useEffect(() => {
    if (!form.id || !canViewDivisions) return undefined;
    let active = true;
    setLoadingDivisions(true);
    Promise.all([
      apiRequest("/api/business-divisions"),
      apiRequest(`/api/users/${form.id}/business-divisions`),
    ]).then(([all, assigned]) => {
      if (!active) return;
      setDivisions(all.success ? (all.data || []) : []);
      setUserDivisions(assigned.success ? (assigned.data || []).map((division) => division.id) : []);
    }).catch((err) => setError(err.message || "Unable to load business divisions"))
      .finally(() => { if (active) setLoadingDivisions(false); });
    return () => { active = false; };
  }, [form.id, canViewDivisions]);

  const toggleDivision = (divisionId) => {
    setUserDivisions((current) => current.includes(divisionId)
      ? current.filter((id) => id !== divisionId)
      : [...current, divisionId]);
  };

  const saveDivisionAccess = async () => {
    if (!form.id) return;
    try {
      setSavingDivisions(true);
      const response = await apiRequest(`/api/users/${form.id}/business-divisions`, {
        method: "PUT",
        body: JSON.stringify({ divisionIds: userDivisions }),
      });
      if (!response.success) throw new Error(response.message);
    } catch (err) {
      setError(err.message || "Unable to save business division access");
    } finally {
      setSavingDivisions(false);
    }
  };

  const toggleStore = (storeId) => {
    const isActive = userStores.find((s) => s.id === storeId)?.assigned === true;
    if (isActive) {
      setUserStores(userStores.map((s) => (s.id === storeId ? { ...s, assigned: false } : s)));
    } else {
      setUserStores(userStores.map((s) => (s.id === storeId ? { ...s, assigned: true } : s)));
    }
  };

  const saveStoreAccess = async () => {
    if (!form.id) return;
    try {
      setSavingStores(true);
      const assignedStoreIds = userStores.filter((s) => s.assigned && s.active).map((s) => s.id);
      const data = await apiRequest(`/api/admin/users/${form.id}/stores`, {
        method: "PUT",
        body: JSON.stringify({ storeIds: assignedStoreIds }),
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
      if (!platformReady) return;
      await onSave({ ...form, platform });
    } catch (err) {
      /* Server-authoritative: stay open with the backend message. */
      setError(err.message || "Unable to save user");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RecordModal
      open
      mode={form.id ? "edit" : "create"}
      title={form.id ? "Edit User" : "Add User"}
      subtitle={form.id ? form.username : "Create a staff account and assign access."}
      size="md"
      dirty={dirty}
      saving={saving}
      formId={FORM_ID}
      saveLabel={form.id ? "Save User" : "Create User"}
      onClose={onClose}
    >
      <form id={FORM_ID} onSubmit={submit}>
        {error && <div className="onepos-alert onepos-alert-error mb-3">{error}</div>}
        <UserFormFields
          form={form}
          update={update}
          roles={roles}
          stores={stores}
          userStores={userStores}
          loadingStores={loadingStores}
          toggleStore={toggleStore}
          saveStoreAccess={saveStoreAccess}
          savingStores={savingStores}
          canViewDivisions={canViewDivisions}
          canManageDivisions={canManageDivisions}
          userDivisions={userDivisions}
          toggleDivision={toggleDivision}
          divisions={divisions}
          loadingDivisions={loadingDivisions}
          saveDivisionAccess={saveDivisionAccess}
          savingDivisions={savingDivisions}
          onReady={setPlatformReady}
          onChange={setPlatform}
        />
      </form>
    </RecordModal>
  );
}
