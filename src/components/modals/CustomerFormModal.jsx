import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { Alert, Button, Input, Label } from "../ui.jsx";

export default function CustomerFormModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    postcode: "",
    notes: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const update = (field, value) =>
    setForm((current) => ({ ...current, [field]: value }));

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Customer name is required");
      return;
    }
    try {
      setSaving(true);
      const data = await apiRequest("/api/customers", {
        method: "POST",
        body: JSON.stringify(form),
      });
      if (!data.success) throw new Error(data.message || "Unable to save customer");
      onSaved(data.data.customer);
    } catch (err) {
      setError(err.message || "Unable to save customer");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[540px] max-w-full shadow-lg flex flex-col max-h-[90vh]">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <UserPlus size={18} />
            </div>
            <div>
              <h2 className="onepos-card-title">New Customer</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Add a new customer record
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 overflow-auto">
          {error && (
            <div className="mb-3">
              <Alert tone="error">{error}</Alert>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label htmlFor="cfm-name">Name *</Label>
              <Input
                id="cfm-name"
                required
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="Customer full name"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="cfm-phone">Phone</Label>
              <Input
                id="cfm-phone"
                value={form.phone}
                onChange={(event) => update("phone", event.target.value)}
                placeholder="Phone number"
              />
            </div>

            <div>
              <Label htmlFor="cfm-email">Email</Label>
              <Input
                id="cfm-email"
                type="email"
                value={form.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="Email address"
              />
            </div>

            <div>
              <Label htmlFor="cfm-postcode">Postcode</Label>
              <Input
                id="cfm-postcode"
                value={form.postcode}
                onChange={(event) => update("postcode", event.target.value)}
                placeholder="Postal code"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="cfm-address">Address</Label>
              <textarea
                id="cfm-address"
                rows="2"
                value={form.address}
                onChange={(event) => update("address", event.target.value)}
                className="onepos-input"
                placeholder="Street address"
              />
            </div>

            <div className="col-span-2">
              <Label htmlFor="cfm-notes">Notes</Label>
              <textarea
                id="cfm-notes"
                rows="2"
                value={form.notes}
                onChange={(event) => update("notes", event.target.value)}
                className="onepos-input"
                placeholder="Additional notes"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={saving}
            >
              {saving ? "Saving..." : "Save customer"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
