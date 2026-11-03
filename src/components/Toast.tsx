import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../api";
import { cx } from "../lib/cx";
import { IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

export interface ToastApi {
  success: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  /** Accepts a thrown error directly: `toast.error(err)` or `toast.error("Couldn't save", err)`. */
  error: (titleOrError: unknown, detail?: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DURATION: Record<ToastTone, number> = { success: 4500, info: 4500, error: 8000 };
const ICONS: Record<ToastTone, IconName> = { success: "approve", info: "sparkles", error: "alert" };
const ICON_TONES: Record<ToastTone, string> = {
  success: "text-emerald-600",
  info: "text-accent",
  error: "text-red-600",
};
const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (tone: ToastTone, title: string, description?: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-(MAX_VISIBLE - 1)), { id, tone, title, description }]);
      window.setTimeout(() => dismiss(id), DURATION[tone]);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, description) => push("success", title, description),
      info: (title, description) => push("info", title, description),
      error: (titleOrError, detail) => {
        if (typeof titleOrError === "string" && detail === undefined) push("error", titleOrError);
        else if (typeof titleOrError === "string") push("error", titleOrError, errorMessage(detail));
        else push("error", errorMessage(titleOrError));
      },
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-relevant="additions"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-stretch gap-2 sm:left-auto sm:w-96"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === "error" ? "alert" : "status"}
            className={cx(
              "pointer-events-auto flex animate-rise-in items-start gap-3 rounded-xl border bg-surface px-4 py-3 shadow-pop",
              toast.tone === "error" ? "border-red-200" : "border-line",
            )}
          >
            <Icon name={ICONS[toast.tone]} className={cx("mt-0.5 size-[18px]", ICON_TONES[toast.tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{toast.title}</p>
              {toast.description ? <p className="mt-0.5 text-[13px] break-words text-muted">{toast.description}</p> : null}
            </div>
            <IconButton icon="close" label="Dismiss notification" size="xs" onClick={() => dismiss(toast.id)} className="-mr-1" />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}
