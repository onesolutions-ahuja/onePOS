import { Edit, X } from "lucide-react";
import { useState } from "react";

export function SettingsField({ label, value }) {
  return (
    <div className="settings-detail-field">
      <dt>{label}</dt>
      <dd>{value === null || value === undefined || value === "" ? "Not configured" : value}</dd>
    </div>
  );
}

export function SettingsDetails({ title, description, fields = [], onEdit, children }) {
  return (
    <section className="onepos-card settings-detail-card">
      <header className="settings-detail-header">
        <div>
          <h2 className="onepos-card-title">{title}</h2>
          {description ? <p className="settings-detail-description">{description}</p> : null}
        </div>
        {onEdit ? <button type="button" className="onepos-btn onepos-btn-ghost onepos-btn-sm" onClick={onEdit} aria-label={`Edit ${title}`}><Edit size={15} /> Edit</button> : null}
      </header>
      {fields.length ? <dl className="settings-detail-grid">{fields.map((field) => <SettingsField key={field.label} {...field} />)}</dl> : null}
      {children}
    </section>
  );
}

export function SettingsEditDialog({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div className="settings-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <header className="settings-dialog-header"><h2>{title}</h2><button type="button" className="onepos-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        <div className="settings-dialog-body">{children}</div>
      </section>
    </div>
  );
}

export function useSettingsEditDialog() {
  const [open, setOpen] = useState(false);
  return { open, openEdit: () => setOpen(true), closeEdit: () => setOpen(false) };
}
