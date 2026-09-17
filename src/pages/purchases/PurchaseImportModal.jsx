/* eslint-disable react/no-unescaped-entities */
import { useState } from "react";
import { Upload, X, Check, AlertCircle } from "lucide-react";
import { apiRequest } from "../../services/api.js";
import { parsePurchaseImport } from "../../services/purchaseImport.js";
import { buildPurchaseImportPreview } from "../../services/purchaseImportPreview.js";
import { mapPurchaseImport } from "../../services/purchaseImportMapper.js";

function PurchaseImportModal({ products, suppliers, onClose }) {
  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapped, setMapped] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const handleFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFile(f);
    f.text().then((raw) => {
      const lines = raw.split(/\r?\n/);
      const rows = [];
      for (const line of lines) {
        if (line.trim() === "") continue;
        const cells = [];
        let cur = "";
        let inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (inQ) {
            if (ch === '"') {
              if (i + 1 < line.length && line[i + 1] === '"') {
                cur += '"';
                i++;
              } else {
                inQ = false;
              }
            } else {
              cur += ch;
            }
          } else if (ch === '"') {
            inQ = true;
          } else if (ch === ",") {
            cells.push(cur.trim());
            cur = "";
          } else {
            cur += ch;
          }
      }
      if (cells.some(c => c !== "")) rows.push(cells);
    }
    if (rows.length === 0) {
      setParsed({ validRows: [], errors: [{ row: null, errors: ["File is empty."] }], purchases: [] });
    } else {
      const p = parsePurchaseImport(rows);
      setParsed(p);
      if (p.errors && p.errors.length === 0) {
        const pv = buildPurchaseImportPreview(p);
        setPreview(pv);
        if (!pv.errorsByRow || Object.keys(pv.errorsByRow).length === 0) {
          const mr = mapPurchaseImport(p.validRows, {
            products,
            suppliers,
            companyId: suppliers[0] ? suppliers[0].company_id : null,
            storeId: null,
          });
          setMapped(mr);
        } else {
          setMapped(null);
        }
      }
    }
    setImportError("");
  });
  };

  const doPreview = () => {
    if (!parsed) return;
    const pv = buildPurchaseImportPreview(parsed);
    setPreview(pv);
    if (!pv.errorsByRow || Object.keys(pv.errorsByRow).length === 0) {
      const mr = mapPurchaseImport(parsed.validRows, {
        products,
        suppliers,
        companyId: suppliers[0] ? suppliers[0].company_id : null,
        storeId: null,
      });
      setMapped(mr);
    } else {
      setMapped(null);
    }
  };

  const doImport = async () => {
    if (!mapped || mapped.purchases.length === 0) return;
    setImporting(true);
    setImportError("");
    try {
      for (const purchase of mapped.purchases) {
        const res = await apiRequest("/api/purchases", {
          method: "POST",
          body: JSON.stringify({ ...purchase, receiveNow: true }),
        });
        if (!res.success) throw new Error(res.message || "Import failed");
      }
      onClose();
    } catch (err) {
      setImportError(err.message || "Import failed");
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-[900px] max-w-full max-h-[90vh] shadow-2xl flex flex-col">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-xl">Import Purchases</h2>
            <p className="text-sm text-slate-500 mt-1">Upload a CSV or TSV of purchase lines.</p>
          </div>
          <button onClick={onClose} disabled={importing} className="p-2 hover:bg-slate-100 rounded"><X size={20} /></button>
        </div>
        <div className="p-5 overflow-auto">
          {!file && (
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center">
              <p className="text-sm text-slate-500 mb-3">Drop a file here or click to browse</p>
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={handleFile} className="hidden" id="purchase-import-file" />
              <label htmlFor="purchase-import-file" className="cursor-pointer h-10 px-4 bg-blue-600 text-white rounded-lg text-sm font-medium inline-flex items-center gap-2 hover:bg-blue-700">
                <Upload size={16} /> Choose file
              </label>
              <p className="text-xs text-slate-400 mt-2">Columns: EAN/SKU, Quantity, Unit Cost, Supplier, Reference, Date</p>
            </div>
          )}
          {file && parsed && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-slate-400">{parsed.validRows.length + (preview ? preview.invalidRows : 0)} rows parsed</p>
                </div>
                <button onClick={doPreview} className="h-9 px-3 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200">Re-preview</button>
              <button onClick={() => { setFile(null); setParsed(null); setPreview(null); setMapped(null); setImportError(""); }} className="h-9 px-3 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">Change file</button>
              </div>
              {parsed.errors.filter(e => !e || e.row === null).map((err, i) => (
                <div key={i} className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm flex items-start gap-2"><AlertCircle size={14} className="mt-0.5 flex-shrink-0" />{err.errors.join("; ")}</div>
              ))}
              {preview && (
                <div className="mb-4 bg-slate-50 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Preview</h3>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div><span className="text-slate-500">Input rows:</span> <span className="font-medium">{preview.totalInputRows}</span></div>
                    <div><span className="text-slate-500">Valid rows:</span> <span className="font-medium text-emerald-600">{preview.validRows}</span></div>
                    <div><span className="text-slate-500">Invalid rows:</span> <span className="font-medium text-red-600">{preview.invalidRows}</span></div>
                    <div><span className="text-slate-500">Purchases:</span> <span className="font-medium">{preview.totalPurchases}</span></div>
                    <div><span className="text-slate-500">Item lines:</span> <span className="font-medium">{preview.totalItemLines}</span></div>
                    <div><span className="text-slate-500">Total qty:</span> <span className="font-medium">{preview.totalQuantity}</span></div>
                    <div className="col-span-2"><span className="text-slate-500">Total value:</span> <span className="font-medium">${preview.totalValue.toFixed(2)}</span></div>
                  </div>
                </div>
              )}
              {preview && Object.keys(preview.errorsByRow).length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Invalid rows</h3>
                  <div className="space-y-1">
                    {Object.entries(preview.errorsByRow).map(([row, msgs]) => (
                      <div key={row} className="flex items-start gap-2 text-sm"><AlertCircle size={14} className="mt-0.5 text-red-500 flex-shrink-0" /><span className="text-slate-500">Row {row}: </span><span className="text-red-700">{msgs.join("; ")}</span></div>
                    ))}
                  </div>
                </div>
              )}
              {mapped && mapped.errors.length === 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Check size={14} className="text-emerald-600" /> Supplier &amp; product resolution</h3>
                  <div className="space-y-2 max-h-48 overflow-auto rounded-lg border border-slate-200">
                    {mapped.purchases.map((p) => (
                      <div key={p.referenceNumber || p.supplierId} className="px-3 py-2 border-b border-slate-100 last:border-0 bg-white text-sm">
                        <div className="flex justify-between">
                          <span><span className="text-slate-500">Reference:</span> {p.referenceNumber || "-"}</span>
                          <span><span className="text-slate-500">Supplier:</span> {p.supplierName} (ID {p.supplierId})</span>
                        </div>
                        <div className="mt-1 space-y-1">
                          {p.lines.map((line) => (
                            <div key={line.productId} className="flex items-center gap-2 text-xs text-slate-500">
                              <span>{line.productName || line.ean}</span>
                              <span className="text-slate-300">·</span>
                              <span>{line.quantity} x ${(line.unitCost).toFixed(2)}</span>
                              <span className="text-slate-300">·</span>
                              <span className="text-emerald-600">via {line.resolvedVia} (product {line.productId})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {mapped && mapped.errors.length > 0 && (
                <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
                  <strong className="block mb-1">Resolution errors:</strong>
                  {mapped.errors.map((e, i) => <div key={i}>{e.row != null ? `Row ${e.row}: ` : ""}{e.errors.join("; ")}</div>)}
                </div>
              )}
              {importError && <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{importError}</div>}
              <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-200">
                <button onClick={onClose} disabled={importing} className="h-10 px-4 border border-slate-200 rounded-lg text-sm">Cancel</button>
                {mapped && mapped.purchases.length > 0 && mapped.errors.length === 0 && (
                  <button onClick={doImport} disabled={importing} className="h-10 px-5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {importing ? "Importing..." : `Import ${mapped.purchases.length} purchase${mapped.purchases.length !== 1 ? "s" : ""}`}
                  </button>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default PurchaseImportModal;
