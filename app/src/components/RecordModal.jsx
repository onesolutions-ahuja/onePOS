import { useCallback, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cx } from "./ui.jsx";
import { DISCARD_MESSAGE, resolveCloseIntent } from "../utils/recordModal.js";

/*
 * onePOS shared Record Modal foundation.
 *
 * ONE in-app dialog for ordinary record Create / Edit / View operations:
 *
 *   List  -> New  -> modal -> form -> Save -> close -> list refreshes
 *   Record-> Edit -> modal -> form -> Save -> close -> record refreshes
 *
 * It owns ONLY the chrome and the interaction contract — overlay, header,
 * body, footer, scrolling, focus, Escape, unsaved-change protection and the
 * desktop/mobile presentation. It deliberately knows nothing about any
 * module's fields or business logic: the caller passes the form as children
 * (and, when the form should submit natively, its `id` so the footer button
 * can submit it with the HTML `form` attribute).
 *
 * Why this exists: every module used to hand-roll `fixed inset-0 bg-black/50`
 * + its own header, padding, footer, width, radius and scroll behaviour, which
 * is why dialogs drifted. Presentation comes from the shared tokens below, so
 * the modal inherits Modern / Enterprise / Compact and Light / Dark / Accent
 * with no branching here.
 *
 * NOT for complex authoring: page-layout / report / workflow / form builders,
 * multi-stage wizards and import mapping stay full-page desktop experiences.
 */

/* The dirty-state contract lives in src/utils/recordModal.js so it can be unit
   tested without a DOM; re-exported here for callers that already import it. */
export { DISCARD_MESSAGE, resolveCloseIntent };

/** Footer label per mode; callers may override with saveLabel. */
const DEFAULT_SAVE_LABEL = { create: "Create", edit: "Save", view: "Close" };

const SIZES = { sm: "onepos-modal-sm", md: "onepos-modal-md", lg: "onepos-modal-lg", xl: "onepos-modal-xl" };

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export default function RecordModal({
  open = false,
  mode = "create",
  title,
  subtitle,
  size = "md",
  /** True when the form holds unsaved edits — enables discard protection. */
  dirty = false,
  saving = false,
  saveDisabled = false,
  saveLabel,
  cancelLabel = "Cancel",
  /** When set, the footer Save submits this form id (native validation + Enter). */
  formId,
  onClose,
  onSave,
  /** Optional per-operation cancel hook; defaults to closing. */
  onCancel,
  confirmDiscard,
  /** Optional permitted secondary actions shown at the left of the footer. */
  footerStart,
  children,
  className,
  ...rest
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);
  const titleId = useId();

  const requestClose = useCallback(() => {
    if (!resolveCloseIntent({ dirty, confirmDiscard })) return;
    onClose?.();
  }, [dirty, confirmDiscard, onClose]);

  // Keep keyboard handlers current without restarting the open/close focus lifecycle.
  const requestCloseRef = useRef(requestClose);
  useEffect(() => { requestCloseRef.current = requestClose; }, [requestClose]);

  useEffect(() => {
    if (!open) return undefined;
    if (typeof document === "undefined") return undefined;

    /* Return focus to the control that opened the modal. */
    restoreRef.current = document.activeElement;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        requestCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll(FOCUSABLE);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);

    /* The page behind the dialog must not scroll while it is open. */
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => panelRef.current?.focus?.(), 0);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      const restore = restoreRef.current;
      if (restore && typeof restore.focus === "function") restore.focus();
    };
  }, [open]);

  /* Lazy: nothing is mounted (or kept) while closed. */
  if (!open) return null;

  const save = saveLabel || DEFAULT_SAVE_LABEL[mode] || "Save";

  return (
    <div
      className="onepos-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cx("onepos-modal", SIZES[size] || SIZES.md, className)}
        {...rest}
      >
        <div className="onepos-modal-header">
          <div className="min-w-0">
            <h2 id={titleId} className="onepos-modal-title">
              {title}
            </h2>
            {subtitle ? <p className="onepos-modal-subtitle">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="onepos-sidebar-iconbtn onepos-modal-close"
            aria-label="Close"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="onepos-modal-body">{children}</div>

        <div className="onepos-modal-footer">
          {footerStart ? <div className="onepos-modal-footer-start">{footerStart}</div> : null}

          {mode === "view" ? (
            <button type="button" onClick={requestClose} className="onepos-btn onepos-btn-secondary">
              {cancelLabel === "Cancel" ? "Close" : cancelLabel}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onCancel || requestClose}
                disabled={saving}
                className="onepos-btn onepos-btn-secondary"
              >
                {cancelLabel}
              </button>
              {formId ? (
                <button
                  type="submit"
                  form={formId}
                  disabled={saving || saveDisabled}
                  className="onepos-btn onepos-btn-primary"
                >
                  {saving ? "Saving…" : save}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving || saveDisabled}
                  className="onepos-btn onepos-btn-primary"
                >
                  {saving ? "Saving…" : save}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
