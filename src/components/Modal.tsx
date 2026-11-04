import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Button, IconButton } from "./Button";
import { FormError } from "./EmptyState";

type ModalPlacement = "center" | "right" | "left";
type ModalSize = "sm" | "md" | "lg" | "xl";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  placement?: ModalPlacement;
  size?: ModalSize;
  /** Hide the standard header (e.g. the mobile nav drawer renders its own). */
  bare?: boolean;
  /**
   * The title shows data (a file name, a person's name): set it in the body face, as written,
   * instead of the display caps used for fixed labels like "NEW WORK ORDER".
   */
  plainTitle?: boolean;
}

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

const PLACEMENTS: Record<ModalPlacement, string> = {
  center: "m-auto w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] rounded-2xl animate-rise-in",
  right: "my-0 mr-0 ml-auto h-dvh max-h-dvh w-full animate-slide-in-right",
  left: "my-0 ml-0 mr-auto h-dvh max-h-dvh w-[min(20rem,88vw)] animate-slide-in-left",
};

/**
 * Accessible dialog built on the native <dialog> element: focus is trapped, the page behind is
 * inert, Escape closes it. Content only renders while open so forms reset on every open.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  placement = "center",
  size = "md",
  bare = false,
  plainTitle = false,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={bare ? undefined : titleId}
      aria-label={bare && typeof title === "string" ? title : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        // A press on the backdrop targets the <dialog> itself (the inner panel fills it).
        if (event.target === event.currentTarget) onClose();
      }}
      className={cx(
        "overflow-hidden border-0 bg-transparent p-0 text-ink shadow-pop backdrop:animate-fade-in",
        PLACEMENTS[placement],
        placement === "left" ? "" : SIZES[size],
      )}
    >
      {open ? (
        <div className={cx("flex max-h-[inherit] flex-col bg-surface", placement === "center" ? "rounded-2xl" : "h-full")}>
          {bare ? (
            children
          ) : (
            <>
              <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
                <div className="min-w-0">
                  <h2
                    id={titleId}
                    className={cx("text-ink", plainTitle ? "text-base leading-6 font-semibold break-words" : "heading-display text-[15px] leading-6")}
                  >
                    {title}
                  </h2>
                  {description ? <div className="mt-0.5 text-[13px] text-muted">{description}</div> : null}
                </div>
                <IconButton icon="close" label="Close" onClick={onClose} className="-mr-2 -mt-1" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 scrollbar-thin sm:px-6">{children}</div>
              {footer ? (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-subtle px-5 py-3.5 sm:px-6">
                  {footer}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
}

/** Yes/no confirmation that keeps itself open (with the error shown) if the action fails. */
export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel, destructive = true }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink-soft">
        <div>{description}</div>
        <FormError error={error} />
      </div>
    </Modal>
  );
}
