import React from "react";

export default function ObjectListPagination({
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), pages);

  return (
    <div className="object-list-pagination">
      <span>
        {total} {total === 1 ? "record" : "records"} · Page {current} of {pages}
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
    </div>
  );
}
