import { useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import RecordModal from "../RecordModal.jsx";
import ObjectRecordDetail from "../../pages/settings/Platform/ObjectRecordDetail.jsx";
import { getRecordDisplayTitle } from "../../utils/recordDisplay.js";

export default function StandardObjectViewModal({ objectKey, record, onClose, onEdit, title, children }) {
  const [runtime, setRuntime] = useState(null);
  const [error, setError] = useState("");
  const objectLabel = String(objectKey || "Record")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase());
  useEffect(() => {
    let cancelled = false;
    apiRequest(`/api/platform/runtime-forms/${encodeURIComponent(objectKey)}?pageType=detail`)
      .then((response) => { if (!cancelled) setRuntime(response?.data || null); })
      .catch((err) => { if (!cancelled) setError(err.message || "Unable to load platform detail form"); });
    return () => { cancelled = true; };
  }, [objectKey]);
  return (
    <RecordModal
      open={true}
      mode="view"
      title={getRecordDisplayTitle(record, title || "Details")}
      subtitle={`${objectLabel} · View`}
      size="lg"
      onClose={onClose}
      onCancel={onClose}
      footerStart={onEdit ? (
        <button type="button" className="onepos-btn onepos-btn-secondary" onClick={onEdit}>
          Edit
        </button>
      ) : null}
    >
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {runtime && (
        <ObjectRecordDetail
          record={record}
          fields={runtime.fields || []}
          objectLabel={objectLabel}
          objectKey={objectKey}
          definition={runtime.layout?.definition || null}
          embedded
          showHeader={false}
        />
      )}
      {children}
    </RecordModal>
  );
}
