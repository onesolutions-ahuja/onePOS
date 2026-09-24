import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../services/api.js";
import PlatformFieldPicker from "./Platform/PlatformFieldPicker.jsx";
import RecordModal from "../../components/RecordModal.jsx";

const FORM_ID = "onepos-message-template-form";
const EMPTY_TEMPLATE = { name: "", channel: "EMAIL", subject: "", body: "", description: "", objectId: "", objectKey: "" };

export default function MessageTemplatesAdmin({ onMessage, onError }) {
  const [templates, setTemplates] = useState([]);
  const [objects, setObjects] = useState([]);
  const [form, setForm] = useState({ name: "", channel: "EMAIL", subject: "", body: "", description: "", objectId: "", objectKey: "" });
  const [editing, setEditing] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [search, setSearch] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [baseline, setBaseline] = useState("");
  const subjectRef = useRef(null);
  const bodyRef = useRef(null);

  async function load() {
    try {
      const [response, objectResponse] = await Promise.all([
        apiRequest("/api/platform/message-templates"),
        apiRequest("/api/platform/objects"),
      ]);
      setTemplates(Array.isArray(response?.data) ? response.data : []);
      setObjects(Array.isArray(objectResponse?.data) ? objectResponse.data : []);
    } catch (error) { onError(error.message); }
  }
  useEffect(() => { load(); }, []);
  function reset() { setEditing(null); setShowEditor(false); setForm(EMPTY_TEMPLATE); setBaseline(""); }
  /* Shared open path for the Create/Edit dialog — keeps the opened record as
     the dirty-state baseline so a clean form closes without prompting. */
  function openTemplate(template) {
    const objectId = template.object_id || template.objectId || "";
    const object = objects.find((item) => String(item.id || item.object_id) === String(objectId));
    const next = { name: template.name, channel: template.channel, subject: template.subject || "", body: template.body || "", description: template.description || "", objectId, objectKey: template.object_key || template.objectKey || object?.object_key || object?.objectKey || "" };
    setEditing(template);
    setShowEditor(true);
    setForm(next);
    setBaseline(JSON.stringify(next));
  }
  function startCreate() { setEditing(null); setShowEditor(true); setForm(EMPTY_TEMPLATE); setBaseline(JSON.stringify(EMPTY_TEMPLATE)); }
  function insertToken(token, targetRef, field) {
    const element = targetRef.current;
    const current = form[field] || "";
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? start;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    setForm((value) => ({ ...value, [field]: next }));
    requestAnimationFrame(() => {
      if (!element) return;
      element.focus();
      const cursor = start + token.length;
      element.setSelectionRange(cursor, cursor);
    });
  }
  async function save(event) {
    event.preventDefault();
    setSavingTemplate(true);
    try {
      const response = await apiRequest(editing ? `/api/platform/message-templates/${editing.id}` : "/api/platform/message-templates", {
        method: editing ? "PUT" : "POST", body: JSON.stringify(form),
      });
      onMessage("Message template saved."); setTemplates((current) => editing ? current.map((item) => item.id === editing.id ? { ...item, ...response.data, object_key: response.data?.object_key || form.objectKey } : item) : [{ ...response.data, object_key: response.data?.object_key || form.objectKey }, ...current]); reset(); await load();
    } catch (error) { onError(error.message); }
    finally { setSavingTemplate(false); }
  }
  async function deactivate(template) {
    if (!window.confirm(`Deactivate "${template.name}"?`)) return;
    try { await apiRequest(`/api/platform/message-templates/${template.id}`, { method: "DELETE" }); onMessage("Message template deactivated."); load(); }
    catch (error) { onError(error.message); }
  }
  const filteredTemplates = templates.filter((template) => `${template.name || ""} ${template.channel || ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const templateDirty = showEditor && JSON.stringify(form) !== baseline;
  return <div className="space-y-4">
    <section className="onepos-card onepos-card-body space-y-2">
      <div className="flex flex-wrap justify-between items-center gap-3"><strong className="onepos-card-title">Message Templates</strong><button type="button" onClick={startCreate} className="onepos-btn onepos-btn-primary">+ New Template</button></div>
      <input className="onepos-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates..." />
      {filteredTemplates.length ? filteredTemplates.map((template) => <div className="flex items-center justify-between gap-3 border-t py-2 text-sm" key={template.id}><button type="button" className="text-left" onClick={() => openTemplate(template)}>{template.name}<span className="block text-xs text-slate-500">{template.channel} · {template.active ? "active" : "inactive"}</span></button><button type="button" className="onepos-btn onepos-btn-sm onepos-btn-secondary" onClick={() => openTemplate(template)}>Edit</button></div>) : <div className="onepos-empty"><span className="onepos-empty-title">{search ? "No matching templates." : "No message templates configured."}</span></div>}
    </section>
    {showEditor ? <RecordModal
      open
      mode={editing ? "edit" : "create"}
      title={editing ? "Edit message template" : "New message template"}
      subtitle={editing ? editing.name : "Email, SMS or WhatsApp template with merge fields."}
      size="md"
      dirty={templateDirty}
      saving={savingTemplate}
      formId={FORM_ID}
      saveLabel="Save template"
      onClose={reset}
      footerStart={editing ? <button className="onepos-btn onepos-btn-sm onepos-btn-secondary" type="button" onClick={() => deactivate(editing)}>Deactivate</button> : null}
    >
      <form id={FORM_ID} className="space-y-3" onSubmit={save}>
      <input className="onepos-input" placeholder="Template name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      <select className="onepos-input" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })}><option>EMAIL</option><option>SMS</option><option>WHATSAPP</option></select>
      <PlatformFieldPicker includeObjectSelector selectedObjectKey={form.objectKey} onObjectChange={(objectKey, objectId) => setForm((value) => ({ ...value, objectKey, objectId }))} />
      {form.channel === "EMAIL" ? <>
        <input className="onepos-input" placeholder="Subject" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} ref={subjectRef} required />
        <PlatformFieldPicker selectedObjectKey={form.objectKey} value="" label="Insert field into subject" onInsert={(token) => insertToken(token, subjectRef, "subject")} />
      </> : null}
      <textarea className="onepos-input min-h-32" placeholder="Message body. Select a field to insert a merge token." value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} ref={bodyRef} required />
      <PlatformFieldPicker selectedObjectKey={form.objectKey} value="" label="Insert field into body" onInsert={(token) => insertToken(token, bodyRef, "body")} />
      <input className="onepos-input" placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      </form>
    </RecordModal> : null}
  </div>;
}
