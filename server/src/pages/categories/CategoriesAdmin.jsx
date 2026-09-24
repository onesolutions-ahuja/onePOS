import { useEffect, useState } from "react";
import { Edit, Plus, RefreshCw, Save, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

function CategoriesAdmin() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editOrder, setEditOrder] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOrder, setNewOrder] = useState(0);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiRequest("/api/categories?all=true");
      if (!data.success) throw new Error(data.message || "Unable to load categories");
      setCategories(data.data || []);
    } catch (err) {
      setError(err.message || "Unable to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const startEdit = (category) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditOrder(category.display_order || 0);
    setSaveError("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditOrder(0);
    setSaveError("");
  };

  const saveEdit = async () => {
    if (!editName.trim()) {
      setSaveError("Category name is required");
      return;
    }
    try {
      setSaving(true);
      setSaveError("");
      const res = await apiRequest(`/api/categories/${editingId}`, {
        method: "PUT",
        body: JSON.stringify({ name: editName.trim(), displayOrder: Number(editOrder) || 0, active: true }),
      });
      if (!res.success) throw new Error(res.message || "Unable to update category");
      await load();
      cancelEdit();
    } catch (err) {
      setSaveError(err.message || "Unable to update category");
    } finally {
      setSaving(false);
    }
  };

  const deleteCategory = async (category) => {
    if (!window.confirm(`Deactivate "${category.name}"? Products will be uncategorised.`)) return;
    try {
      setSaving(true);
      const res = await apiRequest(`/api/categories/${category.id}`, { method: "DELETE" });
      if (!res.success) throw new Error(res.message || "Unable to deactivate category");
      await load();
    } catch (err) {
      setSaveError(err.message || "Unable to deactivate category");
    } finally {
      setSaving(false);
    }
  };

  const createCategory = async () => {
    if (!newName.trim()) return;
    try {
      setSaving(true);
      setSaveError("");
      const res = await apiRequest("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), displayOrder: Number(newOrder) || 0 }),
      });
      if (!res.success) throw new Error(res.message || "Unable to create category");
      await load();
      setShowNewForm(false);
      setNewName("");
      setNewOrder(0);
    } catch (err) {
      setSaveError(err.message || "Unable to create category");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-10 text-center text-slate-400">Loading categories...</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex justify-between items-end mb-5">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="text-sm text-slate-500 mt-1">Manage product categories for your store.</p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-blue-700"
        >
          <Plus size={16} />
          Add Category
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {saveError && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center justify-between">
          <span>{saveError}</span>
          <button onClick={() => setSaveError("")} className="p-1 hover:bg-red-100 rounded" title="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {categories.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Tag size={42} className="mx-auto mb-3 text-slate-300" />
          <h2 className="font-semibold text-slate-600">No categories</h2>
          <p className="text-sm text-slate-400 mt-1">Create your first product category.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Name</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Display order</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Products</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">
                    {editingId === category.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full h-9 px-2 border border-slate-200 rounded text-sm focus:ring-2 focus:ring-blue-500"
                        disabled={saving}
                      />
                    ) : (
                      <div className="font-medium text-sm">{category.name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingId === category.id ? (
                      <input
                        type="number"
                        value={editOrder}
                        onChange={(e) => setEditOrder(Number(e.target.value))}
                        className="w-20 h-9 px-2 border border-slate-200 rounded text-sm text-right focus:ring-2 focus:ring-blue-500"
                        min="0"
                        disabled={saving}
                      />
                    ) : (
                      <span className="text-sm text-slate-600">{category.display_order}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm text-slate-600">{category.product_count || 0}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        category.active
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      {category.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {editingId === category.id ? (
                      <>
                        <button
                          onClick={saveEdit}
                          disabled={saving || !editName.trim()}
                          className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded"
                          title="Save"
                        >
                          <Save size={16} />
                        </button>
                        <button
                          onClick={cancelEdit}
                          disabled={saving}
                          className="p-1.5 text-slate-500 hover:bg-slate-100 rounded"
                          title="Cancel"
                        >
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => startEdit(category)}
                          className="p-1.5 text-slate-500 hover:bg-slate-100 rounded"
                          title="Edit category"
                          disabled={saving}
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => deleteCategory(category)}
                          disabled={saving}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded"
                          title="Deactivate category"
                        >
                          <X size={16} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNewForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-[400px] max-w-full shadow-2xl">
            <div className="p-5 border-b flex justify-between items-center">
              <h2 className="font-bold text-xl">New Category</h2>
              <button onClick={() => { setShowNewForm(false); setNewName(""); setNewOrder(0); setSaveError(""); }} className="p-2 hover:bg-slate-100 rounded" title="Close">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {saveError && (
                <div className="p-3 bg-red-50 text-red-700 rounded text-sm">{saveError}</div>
              )}
              <div>
                <label className="text-sm font-medium text-slate-600">Name</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Seasonal"
                  className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm mt-1 focus:ring-2 focus:ring-blue-500"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600">Display order</label>
                <input
                  type="number"
                  value={newOrder}
                  onChange={(e) => setNewOrder(Number(e.target.value))}
                  min="0"
                  className="w-full h-10 px-3 border border-slate-200 rounded-lg text-sm mt-1 focus:ring-2 focus:ring-blue-500"
                  disabled={saving}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t">
              <button onClick={() => { setShowNewForm(false); setNewName(""); setNewOrder(0); setSaveError(""); }} className="h-9 px-3 border border-slate-200 rounded text-sm" disabled={saving}>Cancel</button>
              <button onClick={createCategory} disabled={saving || !newName.trim()} className="h-9 px-4 bg-blue-600 text-white rounded text-sm font-medium">Create</button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4">
        <button
          onClick={load}
          className="h-9 px-3 bg-white border border-slate-200 rounded-lg text-sm flex items-center gap-2 hover:bg-slate-50"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>
    </div>
  );
}

export default CategoriesAdmin;
