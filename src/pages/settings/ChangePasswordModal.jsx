import { useState } from "react";
import { apiRequest } from "../../services/api.js";
import RecordModal from "../../components/RecordModal.jsx";

/*
 * Reset Password — change-password dialog for the signed-in user.
 *
 * Opened from the "Reset Password" button in the admin header (next to Log
 * out). Uses the existing POST /api/auth/change-password endpoint (the server
 * always requires the current password), so the server-side rules are
 * unchanged — this file only supplies the form body.
 *
 * Chrome (overlay, header, footer, focus, Escape, unsaved-change protection,
 * desktop dialog vs mobile sheet) now comes from the shared RecordModal.
 */
export default function ChangePasswordModal({ open, onClose }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  const close = () => {
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setError("");
    setSuccess("");
    onClose();
  };

  /* Dirty = anything typed. Nothing is lost silently on Escape/overlay/close. */
  const dirty = Boolean(form.currentPassword || form.newPassword || form.confirmPassword);

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
      /* Server-authoritative: stay open and surface the backend message. */
      setError(err.message || "Unable to change password");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RecordModal
      open={open}
      mode="edit"
      title="Reset Password"
      subtitle="Update the password for your signed-in account."
      size="sm"
      dirty={dirty}
      saving={saving}
      formId="onepos-change-password-form"
      saveLabel="Save Password"
      onClose={close}
    >
      <form id="onepos-change-password-form" onSubmit={submit} className="space-y-3">
        {error && <div className="onepos-alert onepos-alert-error">{error}</div>}
        {success && <div className="onepos-alert onepos-alert-success">{success}</div>}

        <label className="onepos-label">
          Current password
          <input
            type="password"
            required
            value={form.currentPassword}
            onChange={(event) => update("currentPassword", event.target.value)}
            className="onepos-input mt-1"
            autoComplete="current-password"
          />
        </label>
        <label className="onepos-label">
          New password
          <input
            type="password"
            required
            value={form.newPassword}
            onChange={(event) => update("newPassword", event.target.value)}
            className="onepos-input mt-1"
            autoComplete="new-password"
          />
        </label>
        <label className="onepos-label">
          Confirm new password
          <input
            type="password"
            required
            value={form.confirmPassword}
            onChange={(event) => update("confirmPassword", event.target.value)}
            className="onepos-input mt-1"
            autoComplete="new-password"
          />
        </label>
      </form>
    </RecordModal>
  );
}
