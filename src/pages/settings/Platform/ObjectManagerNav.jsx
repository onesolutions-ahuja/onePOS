import React from "react";

const GROUPS = [
  {
    label: "Object",
    items: [
      { key: "details", label: "Details" },
      { key: "fields", label: "Fields" },
      { key: "relationships", label: "Relationships" },
      { key: "record-types", label: "Record Types" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { key: "records", label: "Records" },
      { key: "layouts", label: "Forms" },
      { key: "page-layouts", label: "Record Pages" },
      { key: "rules", label: "Validation Rules" },
    ],
  },
];

const ITEMS = GROUPS.flatMap((group) => group.items);

export default function ObjectManagerNav({
  activeKey,
  onSelect,
  disabled = false,
}) {
  const activeItem = ITEMS.find((item) => item.key === activeKey) || ITEMS[0];

  return (
    <nav className="object-manager-nav" aria-label="Object configuration">
      <div className="object-manager-nav-desktop">
        {GROUPS.map((group) => (
          <div className="object-manager-nav-group" key={group.label}>
            <h2>{group.label}</h2>
            {group.items.map((item) => (
              <button
                type="button"
                key={item.key}
                className={`object-manager-nav-item${activeKey === item.key ? " is-active" : ""}`}
                aria-current={activeKey === item.key ? "page" : undefined}
                onClick={() => onSelect(item.key)}
                disabled={disabled && item.key !== "details" && item.key !== "fields"}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <label className="object-manager-nav-mobile">
        <span>Object workspace</span>
        <select
          className="onepos-input"
          value={activeItem.key}
          onChange={(event) => onSelect(event.target.value)}
        >
          {GROUPS.map((group) => (
            <optgroup label={group.label} key={group.label}>
              {group.items.map((item) => (
                <option
                  key={item.key}
                  value={item.key}
                  disabled={disabled && item.key !== "details" && item.key !== "fields"}
                >
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <style>{`
        .object-manager-nav {
          min-width: 0;
          padding: 10px;
          border: 1px solid var(--border-color);
          border-radius: var(--onepos-radius, 12px);
          background: var(--onepos-surface-raised);
        }

        .object-manager-nav-desktop {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .object-manager-nav-group {
          display: flex;
          flex-direction: column;
          gap: 3px;
          min-width: 0;
        }

        .object-manager-nav-group h2,
        .object-manager-nav-mobile > span {
          margin: 0 8px 4px;
          color: var(--text-secondary);
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.07em;
          text-transform: uppercase;
        }

        .object-manager-nav-item {
          display: flex;
          align-items: center;
          width: 100%;
          min-height: 38px;
          padding: 7px 9px;
          border: 0;
          border-left: 3px solid transparent;
          border-radius: var(--onepos-radius-sm, 8px);
          background: transparent;
          color: var(--text-secondary);
          font: inherit;
          font-size: 12px;
          text-align: left;
          cursor: pointer;
        }

        .object-manager-nav-item:hover:not(:disabled) {
          background: var(--muted-background);
          color: var(--primary-color);
        }

        .object-manager-nav-item.is-active {
          border-left-color: var(--primary-color);
          background: var(--muted-background);
          color: var(--primary-color);
          font-weight: 700;
        }

        .object-manager-nav-item:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .object-manager-nav-mobile { display: none; }

        @media (max-width: 900px) {
          .object-manager-nav-desktop {
            flex-direction: row;
            flex-wrap: wrap;
            gap: 12px;
          }
          .object-manager-nav-group {
            flex: 1 1 230px;
          }
        }

        @media (max-width: 620px) {
          .object-manager-nav-desktop { display: none; }
          .object-manager-nav-mobile {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .object-manager-nav-mobile > span { margin: 0; }
        }
      `}</style>
    </nav>
  );
}
