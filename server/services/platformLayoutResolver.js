export function resolvePageLayout(rows = []) {
  return rows
    .filter((layout) => layout && layout.active !== false)
    .sort((left, right) => {
      const score = (layout) => (
        layout.role_id ? 0
          : layout.is_default ? 1
            : layout.company_id ? 2
              : 3
      );
      return score(left) - score(right)
        || new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime()
        || String(left.id).localeCompare(String(right.id));
    })[0] || null;
}
