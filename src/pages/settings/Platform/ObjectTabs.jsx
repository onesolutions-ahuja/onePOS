import React, { useState } from "react";

export default function ObjectTabs({
  tabs = [],
  activeTab,
  defaultTab,
  onChange,
  children,
}) {
  const firstTab =
    activeTab ||
    defaultTab ||
    tabs[0]?.key ||
    "";

  const [internalTab, setInternalTab] =
    useState(firstTab);

  const selectedTab =
    activeTab !== undefined
      ? activeTab
      : internalTab;

  function selectTab(tabKey) {
    if (activeTab === undefined) {
      setInternalTab(tabKey);
    }

    onChange?.(tabKey);
  }

  const selected =
    tabs.find(
      (tab) => tab.key === selectedTab
    ) || tabs[0];

  return (
    <div className="platform-object-tabs">
      <div className="platform-object-tabs-bar">
        {tabs.map((tab) => {
          const disabled =
            tab.disabled === true;

          const isActive =
            selected?.key === tab.key;

          return (
            <button
              key={tab.key}
              type="button"
              className={`platform-object-tab${
                isActive
                  ? " active"
                  : ""
              }`}
              disabled={disabled}
              onClick={() =>
                !disabled &&
                selectTab(tab.key)
              }
            >
              {tab.icon ? (
                <span className="platform-object-tab-icon">
                  {tab.icon}
                </span>
              ) : null}

              <span>
                {tab.label}
              </span>

              {tab.count !== undefined &&
              tab.count !== null ? (
                <span className="platform-object-tab-count">
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="platform-object-tabs-content">
        {typeof children === "function"
          ? children(selected)
          : children}
      </div>

      <style>{`
        .platform-object-tabs {
          width: 100%;
          min-width: 0;
        }

        .platform-object-tabs-bar {
          display: flex;
          align-items: center;
          gap: 2px;
          width: 100%;
          min-height: 42px;
          overflow-x: auto;
          border-bottom: 1px solid var(
            --border-color,
            #e5e7eb
          );
        }

        .platform-object-tab {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          position: relative;
          min-height: 42px;
          padding: 0 13px;
          border: 0;
          background: transparent;
          color: var(
            --text-secondary,
            #6b7280
          );
          font-family: inherit;
          font-size: 10px;
          font-weight: 700;
          white-space: nowrap;
          cursor: pointer;
        }

        .platform-object-tab::after {
          content: "";
          position: absolute;
          right: 7px;
          bottom: -1px;
          left: 7px;
          height: 2px;
          border-radius: 2px 2px 0 0;
          background: transparent;
        }

        .platform-object-tab:hover {
          color: var(
            --text-primary,
            #374151
          );
        }

        .platform-object-tab.active {
          color: var(
            --text-primary,
            #111827
          );
        }

        .platform-object-tab.active::after {
          background: var(
            --text-primary,
            #374151
          );
        }

        .platform-object-tab:disabled {
          cursor: not-allowed;
          opacity: 0.4;
        }

        .platform-object-tab-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
        }

        .platform-object-tab-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 17px;
          height: 17px;
          padding: 0 4px;
          box-sizing: border-box;
          border-radius: 999px;
          background: var(
            --muted-background,
            #f3f4f6
          );
          color: var(
            --text-secondary,
            #6b7280
          );
          font-size: 8px;
          font-weight: 700;
        }

        .platform-object-tabs-content {
          width: 100%;
          min-width: 0;
          padding-top: 16px;
        }

        @media (max-width: 600px) {
          .platform-object-tab {
            padding: 0 10px;
          }

          .platform-object-tabs-content {
            padding-top: 12px;
          }
        }
      `}</style>
    </div>
  );
}
