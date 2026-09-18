import { useEffect, useState } from "react";
import { Store, Plus, Edit, Trash2, RotateCcw, Archive, Loader2, AlertCircle, Check, MapPin, Phone } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { Button, Input, Label, Card, CardHeader, Badge, EmptyState, Alert, Toggle, PageHeader } from "../../components/ui.jsx";

/*
 * Stores / multi-store administration (T10A + T10A-SMALL).
 *
 * Visual reference: the marketing `MultiStoreScreen` mockup — store cards with
 * today's sales, transaction count and low-stock indicator, plus the company
 * store count in the page header.
 *
 * Data is real: GET /api/admin/stores (stores table, company-scoped by the
 * session) and GET /api/admin/stores/:id/stats (existing sales + products).
 * Statistics stay at 0 / "—" when the API cannot compute them — nothing is
 * fabricated.
 *
 * Store ownership always comes from the authenticated session. The browser
 * never sends a company id; every call is scoped server-side.
 *
 * Deletion (T10A-SMALL): business records are never physically deleted. The
 * archive action only sets the existing `stores.active` flag to false, so the
 * row — and every historical sale/stock reference to it — stays intact. The
 * archived store leaves the active list and can be restored.
 */

const EMPTY_FORM = { name: "", code: "", addressLine1: "", city: "", postcode: "", phone: "" };

export default function StoresAdmin() {
  const [stores, setStores] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  /* Page-level error (loading) vs form-level error (saving) are separate so a
     failed save can never replace the modal or the empty state. */
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  /* Set when the backend refuses access (401/403) — that is a permission
     answer, not a network failure, so it must not offer a Retry loop. */
  const [forbidden, setForbidden] = useState(false);
  /*
   * Mirrors the server-side gate for this module using the EXISTING
   * granular permission codes (T10B/T10G): store.view / store.create /
   * store.edit / store.delete. The Administrator/Admin/Owner bypass
   * reported by /api/auth/me/permissions (the same session data the
   * sidebar and Reports menu use) keeps working unchanged. The backend
   * stays the final authority — this only hides controls.
   */
  const [perm, setPerm] = useState({
    isAdmin: false,
    canCreate: false,
    canEdit: false,
    canDelete: false,
  });
  const canManage = perm.canEdit || perm.canDelete || perm.canCreate;

  useEffect(() => {
    let active = true;
    apiRequest("/api/auth/me/permissions")
      .then((data) => {
        if (!active || !data.success) return;
        const isAdmin = data.data?.isAdmin === true;
        const codes = Array.isArray(data.data?.permissions) ? data.data.permissions : [];
        setPerm({
          isAdmin,
          canCreate: isAdmin || codes.includes("store.create"),
          canEdit: isAdmin || codes.includes("store.edit"),
          canDelete: isAdmin || codes.includes("store.delete"),
        });
      })
      .catch(() => { /* Controls stay hidden; the API still enforces access. */ });
    return () => { active = false; };
  }, []);

  const loadStores = async () => {
    try {
      setLoading(true);
      setError("");
      setForbidden(false);
      const data = await apiRequest("/api/admin/stores");
      if (!data.success) throw new Error(data.message);
      const list = Array.isArray(data.data) ? data.data : [];
      setStores(list);
      /* Statistics are computed per store from the existing sales/inventory
         data. A failed stats call leaves that card's numbers unknown (null)
         instead of inventing values. */
      const results = await Promise.all(
        list.map((store) =>
          apiRequest(`/api/admin/stores/${store.id}/stats`)
            .then((stat) => ({ id: store.id, stats: stat.success ? stat.data : null }))
            .catch(() => ({ id: store.id, stats: null }))
        )
      );
      const map = {};
      results.forEach((entry) => { map[entry.id] = entry.stats; });
      setStats(map);
    } catch (err) {
      if (err.status === 401 || err.status === 403) setForbidden(true);
      setError(err.message || "Unable to load stores");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStores(); }, []);

  const isActive = (store) => store.active !== false;

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError("");
    setAdding(true);
  };

  const openEdit = (store) => {
    setForm({
      name: store.name || "",
      code: store.code || "",
      addressLine1: store.address_line1 || "",
      city: store.city || "",
      postcode: store.postcode || "",
      phone: store.phone || "",
    });
    setEditingId(store.id);
    setFormError("");
    setAdding(false);
  };

  const closeForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormError("");
    setAdding(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setFormError("Store name is required");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code,
        addressLine1: form.addressLine1,
        city: form.city,
        postcode: form.postcode,
        phone: form.phone,
      };
      let result;
      if (editingId) {
        /* Editing preserves the current active/inactive state (the PUT route
           only keeps `active` when it is not explicitly false). */
        const current = stores.find((store) => String(store.id) === String(editingId));
        result = await apiRequest(`/api/admin/stores/${editingId}`, {
          method: "PUT",
          body: JSON.stringify({ ...payload, active: current ? isActive(current) : true }),
        });
      } else {
        result = await apiRequest("/api/admin/stores", { method: "POST", body: JSON.stringify(payload) });
      }
      if (!result.success) throw new Error(result.message);
      closeForm();
      await loadStores();
    } catch (err) {
      setFormError(err.message || "Unable to save store");
    } finally {
      setSaving(false);
    }
  };

  /*
   * Activate / deactivate using the existing `stores.active` column.
   * Deactivating is also the archive action: the row stays in the database
   * (soft delete only) and simply drops out of the active list.
   */
  const setStoreActive = async (store, active) => {
    setError("");
    try {
      const result = await apiRequest(`/api/admin/stores/${store.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: store.name || "",
          code: store.code || "",
          addressLine1: store.address_line1 || "",
          city: store.city || "",
          postcode: store.postcode || "",
          phone: store.phone || "",
          active,
        }),
      });
      if (!result.success) throw new Error(result.message);
      await loadStores();
    } catch (err) {
      setError(err.message || "Unable to update store");
    }
  };

  /* Soft delete: never a SQL DELETE — the store is deactivated
     (active = false) and every historical sale/stock row stays intact. */
  const handleArchive = async (store) => {
    const confirmed = window.confirm(
      `Deactivate "${store.name}"?\n\nThe store is switched off and leaves the active list — it is NOT permanently deleted. All historical sales, stock movements and reports remain intact, and the store can be reactivated at any time.`
    );
    if (!confirmed) return;
    await setStoreActive(store, false);
  };

  const activeStores = stores.filter(isActive);
  const archivedStores = stores.filter((store) => !isActive(store));
  const visibleStores = showArchived ? stores : activeStores;
  const editingStore = editingId ? stores.find((store) => String(store.id) === String(editingId)) : null;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-32 bg-slate-200 rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-48 bg-white border rounded-xl animate-pulse" />)}
        </div>
      </div>
    );
  }

  /* API / network failure — never a blank page. */
  if (error && stores.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 max-w-2xl">
        <h1 className="text-xl font-bold text-red-700">
          {forbidden ? "Stores are not available for your role" : "Unable to load stores"}
        </h1>
        <p className="text-sm text-slate-600 mt-2">
          {forbidden
            ? "Store administration requires administrator permissions. Ask a company administrator for access."
            : error}
        </p>
        {forbidden ? null : (
          <Button onClick={loadStores} className="mt-5">Retry</Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stores"
        subtitle={`${stores.length} store${stores.length === 1 ? "" : "s"} configured · ${activeStores.length} active`}
        actions={
          <>
            <label className="inline-flex items-center gap-2 text-sm text-slate-600 mr-2" title="Show every store, including deactivated ones">
              <Toggle
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Show all
            </label>
            {canManage && perm.canCreate ? (
              <Button onClick={openAdd}><Plus size={16} /> Add store</Button>
            ) : null}
          </>
        }
      />
      {archivedStores.length > 0 && !showArchived ? (
        <Button variant="secondary" size="sm" onClick={() => setShowArchived(true)}>
          <Archive size={14} /> Show archived ({archivedStores.length})
        </Button>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {canManage && perm.canCreate && (adding || editingStore) ? (
        <Card>
          <CardHeader title={editingStore ? "Edit store" : "Add new store"} />
          <form onSubmit={handleSubmit} className="p-4 space-y-3 max-w-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Store name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. High Street Shop" />
              </div>
              <div>
                <Label>Code</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="ST01" />
              </div>
              <div>
                <Label>Address line 1</Label>
                <Input value={form.addressLine1} onChange={(e) => setForm({ ...form, addressLine1: e.target.value })} />
              </div>
              <div>
                <Label>City</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div>
                <Label>Postcode</Label>
                <Input value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : <Check size={14} className="mr-1" />}
                {saving ? "Saving..." : editingStore ? "Update store" : "Create store"}
              </Button>
              <Button variant="secondary" type="button" onClick={closeForm}>Cancel</Button>
            </div>
            {formError ? (
              <div className="text-red-600 text-sm flex items-center gap-1"><AlertCircle size={14} />{formError}</div>
            ) : null}
          </form>
        </Card>
      ) : null}

      {/* Zero stores returned successfully: keep the CRUD entry points —
          never a blank page. */}
      {stores.length === 0 ? (
        <EmptyState title="No stores yet" hint="Create your first store to start managing your locations.">
          {canManage && perm.canCreate ? (
            <Button onClick={openAdd}><Plus size={16} /> + Add Store</Button>
          ) : (
            <p className="text-xs">Ask a company administrator to add the first store.</p>
          )}
        </EmptyState>
      ) : visibleStores.length === 0 ? (
        <EmptyState title="No active stores" hint="Every store is deactivated. Turn on Show all above to view and restore one." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleStores.map((store) => {
            const storeStats = stats[store.id] || {};
            const statsLoaded = Boolean(stats[store.id]);
            const todaySales = Number(storeStats.today_sales || 0);
            const todayTransactions = Number(storeStats.today_transactions || 0);
            const lowStockCount = Number(storeStats.low_stock_count || 0);
            const active = isActive(store);
            return (
              <Card key={store.id} className="overflow-hidden">
                <div className="flex items-start justify-between p-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className={"p-2 rounded-lg " + (active ? "bg-blue-50 text-blue-600" : "bg-slate-100 text-slate-400")}>
                      <Store size={18} />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800">{store.name}</div>
                      {store.code ? <div className="text-xs text-slate-400">{store.code}</div> : null}
                    </div>
                  </div>
                  <Badge tone={active ? "success" : "neutral"}>{active ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="p-4 grid grid-cols-3 gap-4">
                  <div>
                    <div className="text-lg font-bold text-slate-800">{statsLoaded ? `\u00a3${todaySales.toFixed(2)}` : "\u2014"}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Today&apos;s sales</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-slate-800">{statsLoaded ? todayTransactions : "\u2014"}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Transactions</div>
                  </div>
                  <div>
                    <div className="text-lg font-bold text-slate-800">{statsLoaded ? lowStockCount : "\u2014"}</div>
                    <div className="text-xs text-slate-400 mt-0.5">Low stock</div>
                  </div>
                </div>
                {/* Contact / location details (T10S) — only when present. */}
                {(store.address_line1 || store.city || store.postcode || store.phone) ? (
                  <div className="px-4 pb-3 space-y-1 text-xs text-slate-500">
                    {store.address_line1 || store.city || store.postcode ? (
                      <div className="flex items-start gap-1.5">
                        <MapPin size={13} className="mt-0.5 shrink-0 text-slate-400" />
                        <span>
                          {[store.address_line1, store.city, store.postcode].filter(Boolean).join(", ")}
                        </span>
                      </div>
                    ) : null}
                    {store.phone ? (
                      <div className="flex items-center gap-1.5">
                        <Phone size={13} className="shrink-0 text-slate-400" />
                        <span>{store.phone}</span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {canManage ? (
                  <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2">
                    {perm.canEdit ? (
                      <Button size="sm" variant="secondary" onClick={() => openEdit(store)} className="flex-1">
                        <Edit size={14} /> Edit
                      </Button>
                    ) : null}
                    {perm.canDelete ? (
                      active ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Deactivate store (kept in the database, hidden from the active list)"
                          onClick={() => handleArchive(store)}
                          className="text-slate-400 hover:text-red-600"
                        >
                          <Trash2 size={14} />
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setStoreActive(store, true)}>
                          <RotateCcw size={14} /> Restore
                        </Button>
                      )
                    ) : null}
                    {!perm.canEdit && !perm.canDelete ? (
                      <span className="text-xs text-slate-400">View only</span>
                    ) : null}
                  </div>
                ) : null}
                {perm.canDelete ? (
                  <label className="px-4 pb-3 -mt-1 flex items-center gap-2 text-xs text-slate-500" title={active ? "Turn OFF to deactivate — the store and its history are kept" : "Turn ON to reactivate this store"}>
                    <Toggle
                      checked={active}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setStoreActive(store, true);
                        } else {
                          handleArchive(store);
                        }
                      }}
                    />
                    {active ? "Active" : "Inactive"}
                  </label>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
