import { lazy, Suspense, useEffect, useState } from "react";
import { apiRequest } from "../../services/api.js";
import ObjectList from "./Platform/ObjectList.jsx";
import ObjectEditor from "./Platform/ObjectEditor.jsx";
import RelationshipList from "./Platform/RelationshipList.jsx";
import RelationshipEditor from "./Platform/RelationshipEditor.jsx";
const LayoutList = lazy(() => import("./Platform/LayoutList.jsx"));
const LayoutEditor = lazy(() => import("./Platform/LayoutEditor.jsx"));
import RuleList from "./Platform/RuleList.jsx";
import RuleEditor from "./Platform/RuleEditor.jsx";
import ObjectPage from "./Platform/ObjectPage.jsx";
import ValueSetList from "./Platform/ValueSetList.jsx";
import PlatformStudio from "./Platform/PlatformStudio.jsx";
import WorkflowAdmin from "./Platform/WorkflowAdmin.jsx";
import WorkflowRunsAdmin from "./Platform/WorkflowRunsAdmin.jsx";
import InternalAppCatalog from "./Platform/InternalAppCatalog.jsx";

export default function PlatformAdmin({ onMessage, onError }) {
  const [modules, setModules] = useState([]);
  const [view, setView] = useState("objects");
  const [selectedObject, setSelectedObject] = useState(null);
  const [selectedRelationship, setSelectedRelationship] = useState(null);
  const [selectedLayout, setSelectedLayout] = useState(null);
  const [selectedRule, setSelectedRule] = useState(null);

  useEffect(() => {
    apiRequest("/api/platform/modules")
      .then((response) => setModules(response.data || []))
      .catch((error) => onError(error.message || "Unable to load platform modules"));
  }, []);

  const navigate = (target, object = null) => {
    if (target === "new-object") {
      setSelectedObject(null);
      setView("editor");
    } else if (target === "edit-object") {
      setSelectedObject(object);
      setView("editor");
    } else if (target === "view-object") {
      setSelectedObject(object);
      setView("object-page");
    } else if (target === "new-relationship" || target === "edit-relationship") {
      setSelectedRelationship(target === "edit-relationship" ? object : null);
      setView("relationships-editor");
    } else if (target === "relationships") {
      setView("relationships");
    } else if (target === "new-layout" || target === "edit-layout") {
      setSelectedLayout(target === "edit-layout" ? object : null);
      setView("layouts-editor");
    } else if (target === "layouts") {
      setView("layouts");
    } else if (target === "new-rule" || target === "edit-rule") {
      setSelectedRule(target === "edit-rule" ? object : null);
      setView("rules-editor");
    } else if (target === "rules") {
      setView("rules");
    } else if (target === "value-sets") {
      setView("value-sets");
    } else if (target === "studio") {
      setView("studio");
    } else if (target === "workflow") {
      setView("workflow");
    } else if (target === "app-catalog") {
      setView("app-catalog");
    } else {
      setView("objects");
    }
  };

  if (view === "editor") {
    return (
      <ObjectEditor
        object={selectedObject}
        modules={modules}
        onBack={() => setView("objects")}
        onNavigate={(target) => {
          if (target === "records") {
            setView("object-page");
          } else if (target === "relationships") {
            setView("relationships");
          } else if (target === "layouts") {
            setView("layouts");
          } else if (target === "rules") {
            setView("rules");
          }
        }}
        onSaved={(savedObject) => {
          if (savedObject?.id || savedObject?.object_id) {
            setSelectedObject(savedObject);
            setView("editor");
          } else {
            setView("objects");
          }

        }}
        onMessage={onMessage}
        onError={onError}
      />
    );
  }

  if (view === "object-page") {
    return (
      <ObjectPage
        objectKey={selectedObject?.object_key || selectedObject?.objectKey || selectedObject?.api_name}
        object={selectedObject}
        onBack={() => setView("editor")}
        onSelectRecord={(record, relatedObjectKey) => {
          if (relatedObjectKey) {
            setSelectedObject({ object_key: relatedObjectKey });
            setView("object-page");
          }
        }}
      />
    );
  }

  if (view === "relationships-editor") {
    return (
      <RelationshipEditor
        relationship={selectedRelationship}
        initialObjectId={selectedObject?.id || selectedObject?.object_id || ""}
        onCancel={() => setView("relationships")}
        onSave={() => {
          onMessage(selectedRelationship ? "Relationship updated." : "Relationship created.");
          setView("relationships");
        }}
      />
    );
  }

  if (view === "relationships") {
    return <div className="space-y-4"><button type="button" onClick={() => setView(selectedObject ? "editor" : "objects")} className="text-sm text-slate-600">← {selectedObject ? "Object configuration" : "Platform objects"}</button><RelationshipList objectId={selectedObject?.id || selectedObject?.object_id} onNavigate={navigate} onMessage={onMessage} onError={onError} /></div>;
  }

  if (view === "layouts-editor") return <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading form builder…</div>}><LayoutEditor layout={selectedLayout} initialObjectId={selectedObject?.id || selectedObject?.object_id || ""} onCancel={() => setView("layouts")} onSave={() => { onMessage(selectedLayout ? "Form updated." : "Form created."); setView("layouts"); }} /></Suspense>;
  if (view === "layouts") return <Suspense fallback={<div className="p-8 text-sm text-slate-500">Loading forms…</div>}><LayoutList objectId={selectedObject?.id || selectedObject?.object_id} onNew={() => navigate("new-layout")} onEdit={(layout) => navigate("edit-layout", layout)} onMessage={onMessage} onError={onError} onBack={() => setView(selectedObject ? "editor" : "objects")} /></Suspense>;
  if (view === "rules-editor") return <RuleEditor rule={selectedRule} initialObjectId={selectedObject?.id || selectedObject?.object_id || ""} onCancel={() => setView("rules")} onSave={() => { onMessage(selectedRule ? "Rule updated." : "Rule created."); setView("rules"); }} />;
  if (view === "rules") return <RuleList objectId={selectedObject?.id || selectedObject?.object_id} onNew={() => navigate("new-rule")} onEdit={(rule) => navigate("edit-rule", rule)} onBack={() => setView(selectedObject ? "editor" : "objects")} />;
  if (view === "value-sets") return <ValueSetList onBack={() => setView("objects")} onMessage={onMessage} onError={onError} />;
  if (view === "studio") return <div className="space-y-4"><button type="button" onClick={() => setView("objects")} className="text-sm text-slate-600">← Platform configuration</button><PlatformStudio onMessage={onMessage} onError={onError} /></div>;
  if (view === "workflow") return <div className="space-y-4"><button type="button" onClick={() => setView("objects")} className="text-sm text-slate-600">← Platform configuration</button><WorkflowAdmin onMessage={onMessage} onError={onError} /></div>;
  if (view === "workflow-runs") return <div className="space-y-4"><button type="button" onClick={() => setView("objects")} className="text-sm text-slate-600">← Platform configuration</button><WorkflowRunsAdmin onMessage={onMessage} onError={onError} /></div>;
  if (view === "app-catalog") return <div className="space-y-4"><InternalAppCatalog onMessage={onMessage} onError={onError} onBack={() => setView("objects")} /></div>;

  return <div className="space-y-4"><div className="flex gap-2 border-b border-slate-200"><button type="button" onClick={() => setView("objects")} className="px-3 py-2 text-sm text-slate-500">Objects</button><button type="button" onClick={() => setView("studio")} className="px-3 py-2 text-sm text-blue-700">Reports & Apps</button><button type="button" onClick={() => setView("app-catalog")} className="px-3 py-2 text-sm text-blue-700">Internal Apps</button><button type="button" onClick={() => setView("workflow")} className="px-3 py-2 text-sm text-blue-700">Automation & Approvals</button><button type="button" onClick={() => setView("workflow-runs")} className="px-3 py-2 text-sm text-slate-500">Workflow Runs</button><button type="button" onClick={() => setView("relationships")} className="px-3 py-2 text-sm text-slate-500">Relationships</button><button type="button" onClick={() => setView("layouts")} className="px-3 py-2 text-sm text-slate-500">Layouts</button><button type="button" onClick={() => setView("rules")} className="px-3 py-2 text-sm text-slate-500">Rules</button><button type="button" onClick={() => setView("value-sets")} className="px-3 py-2 text-sm text-slate-500">Value Sets</button></div><ObjectList onNavigate={navigate} /></div>;
}
