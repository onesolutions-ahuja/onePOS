import { useState } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../../services/api.js";

/*
 * Reset Password — standalone change-password dialog for the signed-in user.
 *
 * Opened from the "Reset Password" button in the top-right admin header
 * (next to Log out). Uses the existing POST /api/auth/change-password
 * endpoint (current password is always required by the server), so the
 * server-side rules are unchanged.
 */
export default function ChangePasswordModal({ open, onClose }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const reset = () => {
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setError("");
    setSuccess("");
  };

  if (!open) return null;

  const close = () => {
    reset();
    onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (form.newPassword !== form.confirmPassword) {
      setError("New password and confirmation do not match");
      return;
    }
    if (form.newPassword.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    try {
      setSaving(true);
      const data = await apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: form.currentPassword, newPassword: form.newPassword }),
      });
      if (!data.success) throw new Error(data.message || "Unable to change password");
      setSuccess("Password changed successfully.");
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err) {
      setError(err.message || "Unable to change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-label="Reset Password">
      <div className="bg-white rounded-xl w-[400px] max-w-full shadow-2xl">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="font-bold text-lg">Reset Password</h2>
          <button onClick={close} title="Close" aria-label="Close" className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3">
          {error && <div className="p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div>}
          {success && <div className="p-2 bg-green-50 text-green-700 rounded text-sm">{success}</div>}
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Current password</span>
            <input type="password" required value={form.currentPassword} onChange={(e) => update("currentPassword", e.target.value)} className="w-full h-9 px-2 border rounded" autoComplete="current-password" />
          </label>
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">New password</span>
            <input type="password" required value={form.newPassword} onChange={(e) => update("newPassword", e.target.value)} className="w-full h-9 px-2 border rounded" autoComplete="new-password" />
          </label>
          <label className="block text-sm text-slate-600">
            <span className="block mb-1 font-medium">Confirm new password</span>
            <input type="password" required value={form.confirmPassword} onChange={(e) => update("confirmPassword", e.target.value)} className="w-full h-9 px-2 border rounded" autoComplete="new-password" />
          </label>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="h-9 px-4 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
              {saving ? "Saving…" : "Save Password"}
            </button>
            <button type="button" onClick={close} className="h-9 px-3 border rounded text-sm">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
