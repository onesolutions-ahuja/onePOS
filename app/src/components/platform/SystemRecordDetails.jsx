import { useState } from "react";
import { apiRequest } from "../../services/api.js";
import PlatformExtensionFields from "./PlatformExtensionFields.jsx";

export default function SystemRecordDetails({ objectKey, recordId, coreValues }) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  if (!recordId) return null;
  return <section className="my-3 border rounded-lg p-3">
    <button type="button" className="text-sm font-medium" onClick={() => setOpen(value => !value)}>{open ? "Hide" : "Show"} configured details</button>
    {open && <div>
      <PlatformExtensionFields objectKey={objectKey} recordId={recordId} coreValues={coreValues} onChange={setPlatform} onReady={setReady} />
      {message && <p role="status" className="my-2 text-sm">{message}</p>}
      <button type="button" disabled={!ready || saving} className="border rounded px-3 py-2 text-sm disabled:opacity-50" onClick={async () => {
        setSaving(true); setMessage("");
        try {
          await apiRequest(`/api/platform/system/${objectKey}/records/${recordId}/extensions`, { method: "PUT", body: JSON.stringify({ platform }) });
          setMessage("Additional details saved.");
        } catch (error) { setMessage(error.message); }
        finally { setSaving(false); }
      }}>{saving ? "Saving…" : "Save additional details"}</button>
    </div>}
  </section>;
}
