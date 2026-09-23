import React, { useEffect, useState } from "react";

export default function ObjectSearch({
  value = "",
  onChange,
  placeholder = "Search...",
  delay = 250,
  disabled = false,
}) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value || "");
  }, [value]);

  useEffect(() => {
    if (disabled) return;

    const timer = setTimeout(() => {
      if (typeof onChange === "function") {
        onChange(text);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [text, delay, disabled, onChange]);

  function handleChange(event) {
    setText(event.target.value);
  }

  function clearSearch() {
    setText("");

    if (typeof onChange === "function") {
      onChange("");
    }
  }

  return (
    <div className="platform-object-search">
      <span className="platform-object-search-icon" aria-hidden="true">
        ⌕
      </span>

      <input
        type="search"
        value={text}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={placeholder}
      />

      {text ? (
        <button
          type="button"
          className="platform-object-search-clear"
          onClick={clearSearch}
          disabled={disabled}
          aria-label="Clear search"
        >
          ×
        </button>
      ) : null}

      <style>{`
        .platform-object-search {
          display: flex;
          align-items: center;
          position: relative;
          width: 100%;
          min-width: 160px;
          max-width: 360px;
        }

        .platform-object-search-icon {
          position: absolute;
          left: 10px;
          top: 50%;
          transform: translateY(-52%);
          color: #6b7280;
          font-size: 17px;
          line-height: 1;
          pointer-events: none;
        }

        .platform-object-search input {
          width: 100%;
          height: 36px;
          box-sizing: border-box;
          padding: 0 32px 0 30px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #fff;
          color: #111827;
          font-family: inherit;
          font-size: 12px;
          outline: none;
        }

        .platform-object-search input::placeholder {
          color: #9ca3af;
        }

        .platform-object-search input:focus {
          border-color: #6b7280;
          box-shadow: 0 0 0 2px rgba(107, 114, 128, 0.12);
        }

        .platform-object-search input:disabled {
          background: #f3f4f6;
          cursor: not-allowed;
        }

        .platform-object-search-clear {
          position: absolute;
          right: 7px;
          top: 50%;
          transform: translateY(-50%);
          width: 22px;
          height: 22px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: #6b7280;
          font-size: 17px;
          line-height: 20px;
          cursor: pointer;
        }

        .platform-object-search-clear:hover {
          background: #f3f4f6;
          color: #111827;
        }

        .platform-object-search-clear:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}
