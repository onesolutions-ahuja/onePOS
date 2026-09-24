/*
 * onePOS design system - shared primitives.
 *
 * Small, dependency-free wrappers so every screen renders identical controls.
 * They accept standard input/button props (className merges) and keep native
 * elements underneath so forms, labels and keyboard behaviour all work.
 */
export function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------- Button --------------------------------- */

/**
 * variant: "primary" | "secondary" | "danger" | "ghost"
 * size: "md" (default) | "sm"
 */
export function Button({ variant = "primary", size = "md", className, type = "button", ...props }) {
  const variantClass = {
    primary: "onepos-btn-primary",
    secondary: "onepos-btn-secondary",
    danger: "onepos-btn-danger",
    ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-800 focus-visible:ring-blue-500",
  }[variant];
  return (
    <button
      type={type}
      className={cx("onepos-btn", size === "sm" && "onepos-btn-sm", variantClass, className)}
      {...props}
    />
  );
}

/* ------------------------------- Toggle --------------------------------- */

/**
 * The one consistent ON/OFF switch for binary settings (enabled, active,
 * auto-send, VAT on/off...). Backed by a native checkbox; wrap it in a <label>
 * or pass aria-label so it stays accessible.
 */
export function Toggle({ checked, onChange, disabled = false, className, ...props }) {
  return (
    <span className={cx("onepos-toggle", className)}>
      <input
        type="checkbox"
        role="switch"
        checked={Boolean(checked)}
        onChange={onChange}
        disabled={disabled}
        {...props}
      />
      <span className="onepos-toggle-track" aria-hidden="true" />
    </span>
  );
}

/* ------------------------- Input / Select / Label ----------------------- */

export function Input({ className, invalid = false, ...props }) {
  return <input className={cx("onepos-input", invalid && "onepos-input-error", className)} {...props} />;
}

export function Select({ className, invalid = false, children, ...props }) {
  return (
    <select className={cx("onepos-input", invalid && "onepos-input-error", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({ className, children, ...props }) {
  return (
    <label className={cx("onepos-label", className)} {...props}>
      {children}
    </label>
  );
}

/* -------------------------------- Card ---------------------------------- */

export function Card({ className, children, ...props }) {
  return (
    <div className={cx("onepos-card", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, actions, className }) {
  return (
    <div className={cx("onepos-card-header", className)}>
      <h2 className="onepos-card-title">{title}</h2>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/* -------------------------------- Badge --------------------------------- */

/** tone: "neutral" | "success" | "warning" | "danger" | "info" */
export function Badge({ tone = "neutral", className, children }) {
  return <span className={cx("onepos-badge", `onepos-badge-${tone}`, className)}>{children}</span>;
}

/* -------------------------------- Alert --------------------------------- */

/** tone: "success" | "error" | "warning" | "info" */
export function Alert({ tone = "info", className, children }) {
  return <div className={cx("onepos-alert", `onepos-alert-${tone}`, className)}>{children}</div>;
}

/* ----------------------------- Empty state ------------------------------ */

export function EmptyState({ title, hint, children, className }) {
  return (
    <div className={cx("onepos-empty", className)}>
      {children}
      {title ? <p className="onepos-empty-title">{title}</p> : null}
      {hint ? <p className="text-xs mt-1">{hint}</p> : null}
    </div>
  );
}

/* ----------------------------- Page header ------------------------------ */

export function PageHeader({ title, subtitle, actions, className }) {
  return (
    <div className={cx("flex items-start justify-between gap-3 mb-4", className)}>
      <div>
        <h1 className="onepos-page-title">{title}</h1>
        {subtitle ? <p className="onepos-page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}

/* -------------------------------- Tabs ---------------------------------- */

/**
 * items: [{ key, label }] - active item gets the teal underline.
 */
export function Tabs({ items, active, onChange, className }) {
  return (
    <div className={cx("flex gap-1 border-b border-slate-200 mb-4 overflow-x-auto", className)}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key)}
          aria-current={active === item.key ? "page" : undefined}
          className={cx("onepos-tab", active === item.key && "onepos-tab-active")}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
