import React, { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../../services/api.js";
import ObjectSearch from "./ObjectSearch.jsx";
import FormRenderer from "./FormRenderer.jsx";
import RecordModal from "../../../components/RecordModal.jsx";
import ObjectHistory from "./ObjectHistory.jsx";
import ObjectRecordDetail from "./ObjectRecordDetail.jsx";

function getObjectKey(object) {
  return (
    object?.objectKey ||
    object?.object_key ||
    object?.apiName ||
    object?.api_name ||
    object?.key ||
    ""
  );
}

function getSearchValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return (
      value.label ||
      value.name ||
      value.title ||
      value.value ||
      value.id ||
      JSON.stringify(value)
    );
  }

  return String(value);
}

function getObjectLabel(object) {
  return (
    object?.label ||
    object?.name ||
    object?.objectName ||
    object?.object_name ||
    getObjectKey(object) ||
    "Object"
  );
}

function getFieldKey(field) {
  return (
    field?.apiName ||
    field?.api_name ||
    field?.fieldKey ||
    field?.field_key ||
    field?.name ||
    ""
  );
}

function getFieldLabel(field) {
  return (
    field?.label ||
    field?.name ||
    getFieldKey(field) ||
    "Field"
  );
}

function getFieldType(field) {
  if ((field?.fieldType || field?.field_type) === "formula") return field?.config?.resultType || "text";
  return (
    field?.fieldType ||
    field?.field_type ||
    field?.type ||
    "text"
  );
}

function getFieldValue(record, field) {
  const key = getFieldKey(field);

  if (!key) {
    return undefined;
  }

  if (
    record &&
    Object.prototype.hasOwnProperty.call(record, key)
  ) {
    return record[key];
  }

  const sourceColumn =
    field?.sourceColumn ||
    field?.source_column ||
    field?.databaseColumn ||
    field?.database_column;

  if (
    sourceColumn &&
    record &&
    Object.prototype.hasOwnProperty.call(
      record,
      sourceColumn
    )
  ) {
    return record[sourceColumn];
  }

  return undefined;
}

function formatValue(value, field) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  function layoutPresentationClass(layout) {
    const mode = layout?.definition?.presentation_mode || "inline";
    return mode === "overlay_square"
      ? "platform-record-modal-compact"
      : mode === "overlay_rectangle"
        ? "platform-record-modal-rectangle"
        : "platform-record-modal-inline";
  }

  const type = getFieldType(field);

  if (type === "boolean") {
    return value ? "Yes" : "No";
  }

  if (type === "date") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString();
    }
  }

  if (type === "datetime") {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export default function ObjectPage({
  objectKey,
  objectId,
  object: suppliedObject,
  recordId,
  suppliedRecord,
  onBack,
  onSelectRecord,
}) {
  const [objectMetadata, setObjectMetadata] =
    useState(suppliedObject || null);

  const [fields, setFields] = useState([]);
  const [recordTypes, setRecordTypes] = useState([]);
  const [creating, setCreating] = useState(false);
  const [quickCreating, setQuickCreating] = useState(false);
  const [selectedRecordTypeId, setSelectedRecordTypeId] = useState("");
  const [records, setRecords] = useState(
    suppliedRecord
      ? [suppliedRecord]
      : []
  );

  const [selectedRecord, setSelectedRecord] =
    useState(suppliedRecord || null);
  const [history, setHistory] = useState([]);
  const [detailLayout, setDetailLayout] = useState(null);
  const [createLayout, setCreateLayout] = useState(null);
  const [editLayout, setEditLayout] = useState(null);
  const [quickCreateLayout, setQuickCreateLayout] = useState(null);
  const [relatedLists, setRelatedLists] = useState({});
  const [editingRecord, setEditingRecord] = useState(false);
  const [executingAction, setExecutingAction] = useState("");
  const [recordButtons, setRecordButtons] = useState([]);

  const [loading, setLoading] = useState(
    !suppliedObject
  );

  const [recordsLoading, setRecordsLoading] =
    useState(false);

  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const activeFields = useMemo(
    () => fields.filter((field) => field?.active !== false),
    [fields]
  );
  // Every Platform Object uses the same metadata record command surface.
  const canWriteRecords = true;
  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      activeFields.some((field) =>
        getSearchValue(getFieldValue(record, field))
          .toLowerCase()
          .includes(query)
      )
    );
  }, [records, activeFields, search]);

  const resolvedObjectKey = useMemo(
    () =>
      objectKey ||
      getObjectKey(suppliedObject),
    [objectKey, suppliedObject]
  );

  useEffect(() => {
    if (!suppliedObject && resolvedObjectKey) {
      loadObject();
    }
  }, [resolvedObjectKey, suppliedObject]);

  useEffect(() => {
    if (objectMetadata) {
      loadFields();
      loadDetailLayout();
      loadRecordButtons();
    }
  }, [objectMetadata]);

  useEffect(() => {
    if (
      objectMetadata &&
      !suppliedRecord
    ) {
      loadRecords();
    }
  }, [
    objectMetadata,
    recordId,
    suppliedRecord,
  ]);

  useEffect(() => {
    const key = getObjectKey(objectMetadata);
    const id = selectedRecord?.id || selectedRecord?.record_id;
    if (!key || !id) {
      setHistory([]);
      return;
    }
    apiRequest(`/api/platform/objects/${encodeURIComponent(key)}/records/${id}/history`)
      .then((response) => setHistory(Array.isArray(response?.data) ? response.data : []))
      .catch((err) => setError(err?.message || "Unable to load record history."));
  }, [objectMetadata, selectedRecord]);

  useEffect(() => {
    const components = detailLayout?.definition?.components || [];
    setRelatedLists({});
    if (!selectedRecord || !components.length) return;
    components
      .filter((component) => component.type === "related_list" && component.visible !== false)
      .filter((component) => !relatedLists[component.relationship_key])
      .forEach((component) => {
        loadRelatedList(component).catch((err) => setError(err?.message || "Unable to load related records."));
      });
  }, [detailLayout, selectedRecord]);

  async function loadObject() {
    setLoading(true);
    setError("");

    try {
      const data = await apiRequest(
        `/api/platform/objects/${encodeURIComponent(resolvedObjectKey)}`
      );

      const object =
        data?.object ||
        data?.data?.object ||
        data?.data ||
        data;

      setObjectMetadata(object);
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load object metadata."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadFields() {
    const id =
      objectMetadata?.id ||
      objectMetadata?.object_id;

    if (!id) {
      return;
    }

    try {
      const data = await apiRequest(
        `/api/platform/objects/${id}/fields`
      );

      const loaded =
        data?.fields ||
        data?.data?.fields ||
        (Array.isArray(data?.data) ? data.data : null) ||
        (Array.isArray(data) ? data : []);

      setFields(
        Array.isArray(loaded)
          ? loaded.filter(
              (field) =>
                field?.active !== false
            )
          : []
      );
      const typesData = await apiRequest(`/api/platform/objects/${id}/record-types`);
      const loadedTypes = Array.isArray(typesData?.data) ? typesData.data : [];
      setRecordTypes(loadedTypes);
      setSelectedRecordTypeId((current) =>
        current || loadedTypes.find((type) => type.is_default)?.id || ""
      );
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load object fields."
      );
    }
  }

  async function loadRecordButtons() {
    const objectId = objectMetadata?.id || objectMetadata?.object_id;
    if (!objectId) return;
    try {
      const response = await apiRequest(`/api/platform/objects/${encodeURIComponent(objectId)}/buttons`);
      const buttons = Array.isArray(response?.data) ? response.data : [];
      setRecordButtons(buttons.filter((button) => button.active !== false && (!button.placement || ["record", "detail", "view"].includes(button.placement))));
    } catch {
      setRecordButtons([]);
    }
  }

  async function loadDetailLayout() {
    const objectId = objectMetadata?.id;
    if (!objectId) return;
    try {
      const response = await apiRequest(`/api/platform/layouts/effective?objectId=${encodeURIComponent(objectId)}&pageType=detail`);
      setDetailLayout(response?.data || null);
      const [createResponse, editResponse, quickResponse] = await Promise.all([
        apiRequest(`/api/platform/layouts/effective?objectId=${encodeURIComponent(objectId)}&pageType=create`),
        apiRequest(`/api/platform/layouts/effective?objectId=${encodeURIComponent(objectId)}&pageType=edit`),
        apiRequest(`/api/platform/layouts/effective?objectId=${encodeURIComponent(objectId)}&pageType=quick_create`),
      ]);
      setCreateLayout(createResponse?.data || null);
      setEditLayout(editResponse?.data || null);
      setQuickCreateLayout(quickResponse?.data || null);
    } catch {
      setDetailLayout(null);
    }
  }

  async function loadRelatedList(component) {
    const relationshipKey = component?.relationship_key;
    const parentId = selectedRecord?.id || selectedRecord?.record_id;
    if (!relationshipKey || !parentId || !objectMetadata?.object_key) return;
    setRelatedLists((current) => ({
      ...current,
      [relationshipKey]: { ...(current[relationshipKey] || {}), loading: true, error: "" },
    }));
    try {
      const response = await apiRequest(
        `/api/platform/objects/${encodeURIComponent(getObjectKey(objectMetadata))}/records/${parentId}/related/${encodeURIComponent(relationshipKey)}?limit=${Math.min(Number(component.limit) || 25, 100)}${component.sort_field ? `&sortField=${encodeURIComponent(component.sort_field)}&sortDirection=${encodeURIComponent(component.sort_direction || "asc")}` : ""}`
      );
      const records = response?.records || response?.data || [];
      const relationship = response?.relationship || {};
      const childFieldsResponse = await apiRequest(`/api/platform/objects/${relationship.child_object_id}/fields`);
      const childFields = childFieldsResponse?.data || [];
      setRelatedLists((current) => ({ ...current, [relationshipKey]: { records: Array.isArray(records) ? records : [], fields: childFields, relationship, loading: false, error: "" } }));
    } catch (error) {
      setRelatedLists((current) => ({ ...current, [relationshipKey]: { ...(current[relationshipKey] || {}), loading: false, error: error?.message || "Unable to load related records." } }));
      throw error;
    }
  }

  async function saveEditedRecord(values) {
    const id = selectedRecord?.id || selectedRecord?.record_id;
    await apiRequest(`/api/platform/objects/${encodeURIComponent(resolvedObjectKey)}/records/${id}`, {
      method: "PUT",
      body: JSON.stringify({ data: values }),
    });
    setEditingRecord(false);
    await loadRecords();
  }

  async function deleteSelectedRecord() {
    const id = selectedRecord?.id || selectedRecord?.record_id;
    if (!window.confirm("Delete this record?")) return;
    await apiRequest(`/api/platform/objects/${encodeURIComponent(resolvedObjectKey)}/records/${id}`, { method: "DELETE" });
    setSelectedRecord(null);
    await loadRecords();
  }

  async function createRelatedRecord(component) {
    const relationshipKey = component?.relationship_key;
    const relationship = (await apiRequest("/api/platform/relationships")).data?.find(
      (item) => item.relationship_key === relationshipKey && String(item.parent_object_id) === String(objectMetadata?.id)
    );
    if (!relationship) throw new Error("Relationship not found");
    const childObject = await apiRequest(`/api/platform/objects/${relationship.child_object_id}`);
    const child = childObject?.data || childObject?.object || childObject;
    const childKey = getObjectKey(child);
    const childFields = (await apiRequest(`/api/platform/objects/${relationship.child_object_id}/fields`)).data || [];
    const childField = childFields.find((field) => String(field.id) === String(relationship.child_field_id));
    const parentId = selectedRecord?.id || selectedRecord?.record_id;
    if (!childKey || !childField || !parentId) throw new Error("Related record configuration is incomplete");
    const initialValues = { [childField.api_name || childField.source_column]: parentId };
    setCreating({ childKey, fields: childFields, initialValues, relationship });
  }

  async function createRecord(values) {
    const key = creating?.childKey || getObjectKey(objectMetadata);
    const initialValues = creating?.initialValues || {};
    const payload = { ...initialValues, ...values };
    await apiRequest(`/api/platform/objects/${encodeURIComponent(key)}/records`, {
      method: "POST",
      body: JSON.stringify({ data: payload, recordTypeId: creating?.childKey ? null : selectedRecordTypeId || null }),
    });
    setCreating(false);
    setQuickCreating(false);
    await loadRecords();
    if (creating?.relationship) {
      const component = (detailLayout?.definition?.components || []).find((item) => item.relationship_key === creating.relationship.relationship_key);
      if (component) await loadRelatedList(component);
    }
  }

  async function handleMetadataButton(button) {
    const targetType = button?.target_type || "action";
    const targetKey = button?.target_key || button?.action_key;
    if (targetType === "action" && targetKey === "RECORD_SAVE") return setEditingRecord(true);
    if (targetType === "action" && targetKey === "RECORD_DELETE") return deleteSelectedRecord();
    const recordKey = selectedRecord?.id || selectedRecord?.record_id;
    if (!recordKey || !button?.button_key) return setError("A record and registered button are required.");
    setExecutingAction(button.button_key);
    try {
      await apiRequest(`/api/platform/objects/${encodeURIComponent(getObjectKey(objectMetadata))}/records/${encodeURIComponent(recordKey)}/buttons/${encodeURIComponent(button.button_key)}/execute`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setError("");
      await loadRecords();
    } catch (err) {
      setError(err?.message || "Unable to execute the configured button.");
    } finally {
      setExecutingAction("");
    }
  }

  async function handleConfiguredAction(component) {
    if (component.action === "edit") return setEditingRecord(true);
    if (component.action === "delete") return deleteSelectedRecord();
    if (component.action === "create_related") return createRelatedRecord(component);
    if (component.action === "open_related") {
      const related = relatedLists[component.relationship_key];
      const first = related?.records?.[0];
      if (first && onSelectRecord) return onSelectRecord(first, related.relationship?.child_object_key);
      return setError("Open Related List requires a related-record navigation handler.");
    }
    if (component.action === "run_workflow" || component.action === "call_function") {
      const components = detailLayout?.definition?.components || [];
      const index = components.indexOf(component);
      const actionKey = component.id || component.key || `${component.action}:${index}`;
      const recordKey = selectedRecord?.id || selectedRecord?.record_id;
      if (!recordKey) return setError("A record is required to execute this action.");
      setExecutingAction(actionKey);
      try {
        const response = await apiRequest(
          `/api/platform/objects/${encodeURIComponent(getObjectKey(objectMetadata))}/records/${encodeURIComponent(recordKey)}/actions/${encodeURIComponent(actionKey)}/execute`,
          { method: "POST", body: JSON.stringify({}) }
        );
        setError("");
        if (response?.data?.runId) {
          await loadRecords();
        }
      } catch (err) {
        setError(err?.message || "Unable to execute the configured action.");
      } finally {
        setExecutingAction("");
      }
      return;
    }
    return setError(`${component.label || component.action} is configured, but no safe executor is available for this action.`);
  }

  async function loadRecords() {
    const key = getObjectKey(objectMetadata);

    if (!key) {
      return;
    }

    setRecordsLoading(true);

    try {
      const data = await apiRequest(
        `/api/platform/objects/${encodeURIComponent(key)}/records`
      );

      const loaded =
        data?.records ||
        data?.data?.records ||
        (Array.isArray(data?.data) ? data.data : null) ||
        (Array.isArray(data) ? data : []);

      const safeRecords = Array.isArray(loaded)
        ? loaded
        : [];

      setRecords(safeRecords);

      if (recordId) {
        const matching = safeRecords.find(
          (record) =>
            String(
              record?.id ??
                record?.record_id
            ) === String(recordId)
        );

        if (matching) {
          setSelectedRecord(matching);
        }
      }
    } catch (err) {
      setError(
        err?.message ||
          "Unable to load records."
      );
    } finally {
      setRecordsLoading(false);
    }
  }

  function handleRecordSelect(record) {
    setSelectedRecord(record);

    if (onSelectRecord) {
      onSelectRecord(record);
    }
  }

  if (loading) {
    return (
      <div className="platform-object-page">
        <div className="platform-object-empty">
          Loading object…
        </div>

        <ObjectSearch
          value={search}
          onChange={setSearch}
          placeholder="Search records..."
          disabled={recordsLoading}
        />
      </div>
    );
  }

  if (!objectMetadata) {
    return (
      <div className="platform-object-page">
        <div className="platform-object-header">
          {onBack ? (
            <button
              type="button"
              className="platform-secondary-button"
              onClick={onBack}
            >
              Back
            </button>
          ) : null}
        </div>

        <div className="platform-object-empty">
          <strong>Object not found</strong>
          <span>
            The requested object metadata could not be
            loaded.
          </span>
        </div>
      </div>
    );
  }

  const objectLabel =
    getObjectLabel(objectMetadata);

  const hasSelectedRecord =
    Boolean(selectedRecord);

  return (
    <div className="platform-object-page">
      <div className="platform-object-header">
        <div className="platform-object-header-left">
          {onBack ? (
            <button
              type="button"
              className="platform-secondary-button"
              onClick={onBack}
            >
              Back
            </button>
          ) : null}

          <div>
            <div className="platform-eyebrow">
              PLATFORM / OBJECT
            </div>

            <h2>{objectLabel}</h2>

            <p>
              {getObjectKey(objectMetadata)}
            </p>
          </div>
        </div>

        <span
          className={
            "onepos-badge " +
            (objectMetadata?.active === false
              ? "onepos-badge-neutral"
              : "onepos-badge-success")
          }
        >
          {objectMetadata?.active === false
            ? "Inactive"
            : "Active"}
        </span>
      </div>

      {error ? (
        <div className="onepos-alert onepos-alert-error">
          {error}
        </div>
      ) : null}


      <div className="platform-object-layout">
        <section className="platform-object-records">
          <div className="platform-section-header">
            <div>
              <h3>Records</h3>
              <span>Metadata-driven records</span>
            </div>
            {canWriteRecords ? (
              <div className="flex gap-2">
                <button type="button" className="platform-secondary-button" onClick={() => setQuickCreating(true)}>Quick Create</button>
                <button type="button" className="platform-secondary-button" onClick={() => setCreating((value) => !value)}>+ New Record</button>
              </div>
            ) : null}

            {recordsLoading ? (
              <span className="platform-loading-label">
                Loading…
              </span>
            ) : null}
          </div>
          {creating ? (
            <RecordModal open={Boolean(creating)} mode="create" title="Create record" size="lg" className={layoutPresentationClass(createLayout || detailLayout)} onClose={() => setCreating(false)} formId="platform-create-record-form">
            <div className="platform-create-record">
              {recordTypes.length ? <label className="platform-form-field"><span>Record Type</span><select value={selectedRecordTypeId} onChange={(event) => setSelectedRecordTypeId(event.target.value)}><option value="">No record type</option>{recordTypes.map((type) => <option key={type.id} value={type.id}>{type.label}{type.is_default ? " (default)" : ""}</option>)}</select></label> : null}
              <FormRenderer
                formId="platform-create-record-form"
                definition={createLayout?.definition || detailLayout?.definition}
                fields={creating?.fields || activeFields}
                initialValues={creating?.initialValues || {}}
                mode="create"
                onSubmit={createRecord}
              />
            </div>
            </RecordModal>
          ) : null}
          {quickCreating ? (
            <RecordModal open mode="create" title="Quick Create" subtitle="Uses the active Quick Create form for this object." size="md" className={layoutPresentationClass(quickCreateLayout || createLayout || detailLayout)} onClose={() => setQuickCreating(false)} formId="platform-quick-create-form">
              <FormRenderer
                formId="platform-quick-create-form"
                definition={quickCreateLayout?.definition || createLayout?.definition || detailLayout?.definition}
                fields={activeFields}
                initialValues={{}}
                mode="quick_create"
                onSubmit={createRecord}
              />
            </RecordModal>
          ) : null}

          {records.length === 0 ? (
            <div className="platform-object-empty compact">
              <strong>No records available</strong>

              <span>
                This object currently has no records
                available through the platform API.
              </span>
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="platform-object-empty compact">
              <strong>No matching records</strong>
              <span>Try a different search.</span>
            </div>
          ) : (
            <div className="platform-record-table-wrapper">
              <table className="platform-record-table">
                <thead>
                  <tr>
                    {activeFields.map((field) => (
                      <th
                        key={
                          field?.id ||
                          getFieldKey(field)
                        }
                      >
                        {getFieldLabel(field)}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {filteredRecords.map(
                    (record, index) => {
                      const recordKey =
                        record?.id ??
                        record?.record_id ??
                        index;

                      const selected =
                        selectedRecord ===
                        record;

                      return (
                        <tr
                          key={recordKey}
                          className={
                            selected
                              ? "selected"
                              : ""
                          }
                          onClick={() =>
                            handleRecordSelect(
                              record
                            )
                          }
                        >
                          {activeFields.map(
                            (field) => (
                              <td
                                key={
                                  field?.id ||
                                  getFieldKey(
                                    field
                                  )
                                }
                              >
                                {formatValue(
                                  getFieldValue(
                                    record,
                                    field
                                  ),
                                  field
                                )}
                              </td>
                            )
                          )}
                        </tr>
                      );
                    }
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="platform-object-detail">
          <div className="platform-section-header">
            <div>
              <h3>Record</h3>

              <span>
                Read-only object detail
              </span>
            </div>
          </div>

          {!hasSelectedRecord ? (
            <div className="platform-object-empty compact">
              <strong>
                Select a record
              </strong>

              <span>
                Select a record from the list to view
                its fields.
              </span>
            </div>
          ) : (
            <div className="platform-field-list">
              {recordButtons.map((button) => (
                <button
                  key={button.id || button.button_key}
                  type="button"
                  className={`platform-secondary-button platform-button-${button.variant || "secondary"}`}
                  disabled={executingAction !== ""}
                  onClick={() => handleMetadataButton(button)}
                >
                  {executingAction === button.button_key ? "Executing..." : button.label}
                </button>
              ))}
              {detailLayout?.definition?.components?.filter((component) => component.type === "action" && component.visible !== false).map((component, index) => (
                <button key={`${component.action}-${index}`} type="button" className="platform-secondary-button" disabled={executingAction !== ""} onClick={() => handleConfiguredAction(component)}>
                  {executingAction === (component.id || component.key || `${component.action}:${detailLayout.definition.components.indexOf(component)}`) ? "Executing..." : component.label || component.action}
                </button>
              ))}
              {editingRecord ? (
                <RecordModal open mode="edit" title="Edit record" size="lg" className={layoutPresentationClass(editLayout || createLayout || detailLayout)} onClose={() => setEditingRecord(false)} formId="platform-edit-record-form">
                  <FormRenderer formId="platform-edit-record-form" definition={editLayout?.definition || createLayout?.definition || detailLayout?.definition} fields={activeFields} initialValues={selectedRecord} mode="edit" onSubmit={saveEditedRecord} />
                </RecordModal>
              ) : null}
              <ObjectRecordDetail
                record={selectedRecord}
                fields={activeFields}
                objectLabel={getObjectLabel(objectMetadata)}
                objectKey={getObjectKey(objectMetadata)}
                definition={detailLayout?.definition || null}
              />
              {detailLayout?.definition?.components?.filter((component) => component.type === "related_list" && component.visible !== false).map((component) => {
                const related = relatedLists[component.relationship_key];
                const columns = (component.columns || []).length
                  ? related?.fields?.filter((field) => component.columns.includes(field.api_name))
                  : related?.fields?.slice(0, 3);
                return (
                  <section key={component.relationship_key} className="platform-related-list">
                    <div className="platform-related-list-heading">
                      <h4>{component.label || component.relationship_key} ({related?.records?.length || 0})</h4>
                      <button type="button" className="platform-secondary-button" onClick={() => createRelatedRecord(component)}>+ New</button>
                    </div>
                    {related?.loading ? <span>Loading related records...</span> : null}
                    {related?.error ? <span className="platform-field-error">{related.error}</span> : null}
                    {!related?.loading && !related?.error && (related?.records || []).map((record, index) => (
                      <button type="button" className="platform-related-record-row" key={record.id || index} onClick={() => onSelectRecord?.(record, related.relationship?.child_object_key)}>
                        {(columns || []).map((field) => `${getFieldLabel(field)}: ${formatValue(getFieldValue(record, field), field)}`).join(" · ")}
                      </button>
                    ))}
                    {!related?.loading && !related?.error && related && !related.records.length ? <span>No related records.</span> : null}
                  </section>
                );
              })}
            </div>
          )}
          {hasSelectedRecord ? (
            <ObjectHistory
              items={history.map((item) => ({
                id: item.id,
                title: `${item.action} ${item.field_api_name || "record"}`,
                description: `${item.old_value ?? "—"} → ${item.new_value ?? "—"}`,
                createdAt: item.created_at,
              }))}
              title="Record History"
            />
          ) : null}
        </aside>
      </div>

      <style>{`
        .platform-record-modal-rectangle { width: min(860px, calc(100vw - 32px)); }
        .platform-record-modal-compact { width: min(540px, calc(100vw - 32px)); }

        /* Every host of this screen (the admin shell content frame, the
           Platform shell, the Platform Studio overlay) already provides the
           outer inset and the page frame, so this screen adds none of its own
           — previously shell padding + this 20px stacked into a 42px inset
           that no other Platform screen had. The records workspace also uses
           all remaining width instead of being centred at 1400px, which left
           exterior gutters inside a full-bleed shell on wide monitors. */
        .platform-object-page {
          color: var(--text-primary, #1f2937);
        }

        .platform-object-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 18px;
        }

        .platform-object-header-left {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .platform-eyebrow {
          margin-bottom: 5px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.12em;
          opacity: 0.6;
        }

        .platform-object-header h2 {
          margin: 0;
          font-size: 24px;
        }

        .platform-object-header p {
          margin: 5px 0 0;
          color: var(--text-secondary, #6b7280);
          font-family: monospace;
          font-size: 10px;
        }

        .platform-secondary-button {
          border: 1px solid var(--border-color, #d1d5db);
          border-radius: 8px;
          background: var(--card-background, #fff);
          color: inherit;
          padding: 9px 14px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }

        .platform-secondary-button:hover {
          background: var(--hover-background, var(--muted-background, #f9fafb));
        }

        .platform-secondary-button:focus-visible {
          outline: 2px solid var(--primary-color, #176f6a);
          outline-offset: 2px;
        }

        /* Object state and errors use the shared badge/alert primitives, so
           they follow the preset, the appearance and the accent instead of
           pinning Light-only colours that broke in Dark. */
        .platform-object-header .onepos-badge,
        .platform-object-page > .onepos-alert {
          margin-bottom: 15px;
        }

        .platform-managed-notice {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }

        .platform-managed-notice strong {
          display: block;
          font-size: 12.5px;
        }

        .platform-managed-notice span {
          display: block;
          margin-top: 3px;
          font-size: 12px;
        }

        .platform-managed-notice .platform-secondary-button {
          flex: none;
        }

        .platform-object-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.65fr) minmax(320px, 0.8fr);
          gap: 15px;
          align-items: start;
        }

        .platform-object-records,
        .platform-object-detail {
          min-width: 0;
          border: 1px solid var(--border-color, #e5e7eb);
          border-radius: 12px;
          background: var(--card-background, #fff);
          overflow: hidden;
        }

        .platform-section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
        }

        .platform-section-header h3 {
          margin: 0;
          font-size: 14px;
        }

        .platform-section-header span {
          display: block;
          margin-top: 3px;
          color: var(--text-secondary, #6b7280);
          font-size: 10px;
        }

        .platform-loading-label {
          color: var(--text-secondary, #6b7280) !important;
          font-size: 10px !important;
        }

        .platform-record-table-wrapper {
          overflow: auto;
          max-height: 620px;
        }

        .platform-record-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }

        .platform-record-table th {
          position: sticky;
          top: 0;
          z-index: 1;
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-color, #e5e7eb);
          background: var(--muted-background, #f9fafb);
          text-align: left;
          font-size: 10px;
          font-weight: 700;
          white-space: nowrap;
        }

        .platform-record-table td {
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-color, #f0f0f0);
          white-space: nowrap;
          max-width: 260px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .platform-record-table tbody tr {
          cursor: pointer;
        }

        .platform-record-table tbody tr:hover {
          background: var(--muted-background, #f9fafb);
        }

        .platform-record-table tbody tr.selected {
          background: var(--onepos-accent-50, var(--muted-background, #f9fafb));
        }

        .platform-field-list {
          padding: 8px 16px 16px;
        }

        .platform-field-row {
          padding: 11px 0;
          border-bottom: 1px solid var(--border-color, #f0f0f0);
        }

        .platform-field-row:last-child {
          border-bottom: 0;
        }

        .platform-field-label {
          margin-bottom: 4px;
          color: var(--text-secondary, #6b7280);
          font-size: 10px;
          font-weight: 600;
        }

        .platform-field-label span {
          margin-left: 3px;
        }

        .platform-field-value {
          min-height: 18px;
          font-size: 12px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }

        .platform-object-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          padding: 55px 20px;
          color: var(--text-secondary, #6b7280);
          font-size: 12px;
          text-align: center;
        }

        .platform-object-empty strong {
          color: inherit;
          font-size: 14px;
        }

        .platform-object-empty.compact {
          padding: 35px 20px;
        }

        @media (max-width: 950px) {
          .platform-object-layout {
            grid-template-columns: 1fr;
          }

          .platform-object-detail {
            order: -1;
          }
        }

        @media (max-width: 650px) {
          .platform-object-header {
            flex-direction: column;
          }

          .platform-object-header-left {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
