import React from "react";

export default function ObjectPagination({
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);

  return (
    <div className="object-pagination">
      <span>
        {total} record{total === 1 ? "" : "s"} · Page {current} of {pages}
      </span>

      <div>
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onPageChange?.(current - 1)}
        >
          Previous
        </button>

        <button
          type="button"
          disabled={current >= pages}
          onClick={() => onPageChange?.(current + 1)}
        >
          Next
        </button>
      </div>

      <style>{`
        .object-pagination {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
          padding:10px 0;
          color:#6b7280;
          font-size:10px;
        }
        .object-pagination div {
          display:flex;
          gap:6px;
        }
        .object-pagination button {
          height:28px;
          padding:0 9px;
          border:1px solid #d1d5db;
          border-radius:5px;
          background:#fff;
          color:#374151;
          font-size:10px;
          cursor:pointer;
        }
        .object-pagination button:disabled {
          opacity:.45;
          cursor:not-allowed;
        }
      `}</style>
    </div>
  );
}