import React, { useMemo } from "react";
import { PencilLine } from "lucide-react";
import BooleanField from "./BooleanField.jsx";
import { formatRecordDisplayValue } from "../../utils/recordDisplay.js";

/*
 * THE global record VIEW presentation.
 *
 * Flat and section-based instead of boxed: label/value rows laid out in
 * section groups, minimal borders, read-only by default, with an optional
 * header actions area (Edit, custom actions). It renders whatever the caller
 * supplies — fields from object metadata, a configured detail layout, or a
 * plain grouped shape — so no page grows its own record detail markup.
 *
 * sections shape: [{ id, label, fields: [{ key, label, type?, value? }] }]
 * When `fields` is given without `sections`, one implicit "General" section
 * is used (matching the flat example: General → Name / SKU / Barcode rows).
 */

function fieldKeyOf(field) {
  return field?.key ?? field?.api_name ?? field?.apiName ?? field?.name ?? "";
}

function labelOf(field) {
  return field?.label ?? field?.name ?? fieldKeyOf(field) ?? "Field";
}

function booleanish(field) {
  const type = String(field?.type ?? field?.field_type ?? field?.fieldType ?? "").toLowerCase();
  return type === "boolean";
}

function FieldValue({ field }) {
  const value = field.value;

  if (value === null || value === undefined || value === "") {
    return <span className="onepos-record-value-empty">—</span>;
  }

  if (booleanish(field)) {
    return <BooleanField value={value} mode="display" label={labelOf(field)} />;
  }

  return <span>{formatRecordDisplayValue(value, field.field || field)}</span>;
}

export default function ObjectRecordView({
  title,
  subtitle,
  fields = null,
  sections: suppliedSections = null,
  actions = null,
  onEdit,
  editLabel = "Edit",
  className = "",
}) {
  const sections = useMemo(() => {
    if (Array.isArray(suppliedSections) && suppliedSections.length) return suppliedSections;
    if (Array.isArray(fields) && fields.length) {
      return [{ id: "general", label: "General", fields }];
    }
    return [];
  }, [fields, suppliedSections]);

  return (
    <section className={`onepos-record-view ${className}`}>
      {(title || actions || onEdit) && (
        <header className="onepos-record-view-header">
          <div className="onepos-record-view-heading">
            {title ? <h3>{title}</h3> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="onepos-record-view-actions">
            {actions}
            {onEdit ? (
              <button type="button" className="onepos-btn onepos-btn-secondary onepos-btn-sm" onClick={onEdit} aria-label={editLabel}>
                <PencilLine size={13} aria-hidden="true" />
                <span>{editLabel}</span>
              </button>
            ) : null}
          </div>
        </header>
      )}

      {sections.map((section) => (
        <div className="onepos-record-section" key={section.id || section.label}>
          {section.label ? <h4 className="onepos-record-section-title">{section.label}</h4> : null}
          <dl className="onepos-record-rows">
            {(section.fields || []).map((field) => {
              const key = fieldKeyOf(field);
              if (!key) return null;
              return (
                <div className="onepos-record-row" key={key}>
                  <dt>{labelOf(field)}</dt>
                  <dd>{field.render ? field.render() : <FieldValue field={field} />}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
    </section>
  );
}
