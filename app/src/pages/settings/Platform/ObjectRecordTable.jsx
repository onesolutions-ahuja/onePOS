import React from "react";

export default function ObjectRecordTable({
  records = [],
  fields = [],
  onOpen,
}) {
  return (
    <div className="object-record-table-wrap">
      <table className="object-record-table">
        <thead>
          <tr>
            {fields.map((field) => {
              const key = field.apiName ?? field.key ?? field.name;
              return (
                <th key={String(key)}>
                  {field.label ?? field.name ?? key}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {records.map((record, rowIndex) => (
            <tr
              key={record.id ?? record._id ?? rowIndex}
              onClick={() => onOpen?.(record)}
              className={onOpen ? "clickable" : ""}
            >
              {fields.map((field) => {
                const key = field.apiName ?? field.key ?? field.name;

                return (
                  <td key={String(key)}>
                    {String(record[key] ?? "—")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <style>{`
        .object-record-table-wrap {
          width:100%;
          overflow-x:auto;
          border:1px solid #e5e7eb;
          border-radius:7px;
        }
        .object-record-table {
          width:100%;
          border-collapse:collapse;
          font-size:10px;
        }
        .object-record-table th {
          padding:9px;
          text-align:left;
          background:#f9fafb;
          color:#6b7280;
          font-size:9px;
          font-weight:700;
          white-space:nowrap;
        }
        .object-record-table td {
          padding:9px;
          border-top:1px solid #f3f4f6;
          color:#374151;
          white-space:nowrap;
        }
        .object-record-table tr.clickable {
          cursor:pointer;
        }
        .object-record-table tr.clickable:hover td {
          background:#f9fafb;
        }
      `}</style>
    </div>
  );
}