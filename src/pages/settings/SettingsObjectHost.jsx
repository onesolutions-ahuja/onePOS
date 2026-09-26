import { useState } from "react";
import ObjectPage from "./Platform/ObjectPage.jsx";

/*
 * Settings → Object route host (Pane 3).
 *
 * Renders the ONE canonical generic Object runtime inside the Settings
 * workspace so a Settings submenu item can host an existing Object / List /
 * Record route without a second Settings-specific record system. Data,
 * permissions and metadata semantics stay entirely with the platform runtime
 * endpoints — this wrapper only supplies the standard page frame and a back
 * action that returns to the Settings list.
 *
 * Deliberately no object catalogue here: enabling a section to host an Object
 * is a one-line entry in SettingsAdmin's SETTINGS_OBJECT_HOSTS map.
 */
export default function SettingsObjectHost({ objectKey, title }) {
  const [selected, setSelected] = useState(null);

  return (
    <div className="settings-object-host">
      {selected ? (
        <ObjectPage
          key={`${objectKey}-${selected.recordId || "record"}`}
          objectKey={objectKey}
          suppliedRecord={selected.record || null}
          onBack={() => setSelected(null)}
          onSelectRecord={(record) => setSelected({ record, recordId: record?.id ?? record?.record_id })}
        />
      ) : (
        <ObjectPage
          key={objectKey}
          objectKey={objectKey}
          onBack={null}
          onSelectRecord={(record) => setSelected({ record, recordId: record?.id ?? record?.record_id })}
        />
      )}
    </div>
  );
}
