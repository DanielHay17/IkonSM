// The upload list: the files of the current batch, 3 at a time, with per-file progress, retry, a pause
// banner when the connection drops, and a summary once the batch is done.

import { memo, useMemo, useState, type RefObject } from "react";
import type { PortalView } from "../../../shared/onboarding";
import { batchSummary, canSend, countOf, formatSize, type QueueSnapshot, type UploadQueue } from "../../../shared/portal-upload";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { Icon, type IconName } from "../../components/Icon";
import { cx } from "../../lib/cx";
import type { PickedFile } from "../../lib/dropFiles";
import { PAGE_SIZE } from "./ReviewList";
import type { PortalRow } from "./useUploadQueue";

const STATUS_ICONS: Record<Exclude<PortalRow["status"], "staged">, { icon: IconName; className: string; label: string }> = {
  queued: { icon: "clock", className: "text-taupe", label: "Waiting" },
  uploading: { icon: "upload", className: "text-ink", label: "Uploading" },
  done: { icon: "check", className: "text-emerald-700", label: "Uploaded" },
  failed: { icon: "alert", className: "text-red-700", label: "Failed" },
};

/** "17 files uploaded: 16 attached to requested documents and 1 filed as another file. 1 failed." */
function finishedSummary(s: ReturnType<typeof batchSummary>): string {
  const parts = [
    s.attached ? `${s.attached} attached to requested documents` : "",
    s.extras ? `${s.extras} filed as ${s.extras === 1 ? "another file" : "other files"}` : "",
  ].filter(Boolean);
  const done = s.done ? `${countOf(s.done, "file")} uploaded${parts.length ? `: ${parts.join(" and ")}` : ""}.` : "Nothing was uploaded.";
  return s.failed ? `${done} ${countOf(s.failed, "file")} failed: retry or check the reason below.` : done;
}

const STATUS_ORDER: Record<PortalRow["status"], number> = { failed: 0, uploading: 1, queued: 2, staged: 3, done: 4 };

function destination(row: PortalRow, titles: Map<string, string>): string {
  if (row.result) {
    return row.result.itemId
      ? `Attached to “${row.result.itemTitle ?? titles.get(row.result.itemId) ?? "requested document"}” · ${row.result.file.folder}`
      : `Filed as another file · ${row.result.file.folder}`;
  }
  return row.itemId ? `To “${titles.get(row.itemId) ?? "requested document"}” · ${row.folder}` : `Other file · ${row.folder}`;
}

export function UploadProgress({
  rows,
  view,
  queue,
  snapshot,
  headingRef,
}: {
  rows: PortalRow[];
  view: PortalView;
  queue: UploadQueue<PickedFile>;
  snapshot: QueueSnapshot<PickedFile>;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState(false);
  const titles = useMemo(() => new Map(view.items.map((item) => [item.id, item.title])), [view.items]);
  const s = batchSummary(rows);
  const active = s.queued + s.uploading;
  const paused = snapshot.state === "paused";
  const percent = s.bytesTotal ? Math.round((s.bytesDone / s.bytesTotal) * 100) : 0;
  // What needs attention first: failures, then what is moving, then what is waiting, then what is done.
  const ordered = useMemo(() => [...rows].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]), [rows]);
  // A finished batch folds away to its summary (and any failures), so the requested documents come back up.
  const listed = active || expanded ? ordered : ordered.filter((row) => row.status === "failed");

  const title = active
    ? paused
      ? "Upload paused"
      : `Uploading: ${s.done} of ${s.total} done`
    : s.failed
      ? "Upload finished with problems"
      : "Upload complete";

  return (
    <Card className="animate-rise-in">
      <section aria-labelledby="portal-progress-list-title">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="portal-progress-list-title" ref={headingRef} tabIndex={-1} className="heading-display text-[15px] leading-6 text-ink focus:outline-none">
                {title}
              </h2>
              <p className="mt-0.5 text-[13px] text-muted">
                {active
                  ? `${formatSize(s.bytesDone)} of ${formatSize(s.bytesTotal)} sent · 3 files at a time. Keep this page open until it finishes.`
                  : finishedSummary(s)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {s.failed ? (
                <Button size="sm" icon="refresh" onClick={() => queue.retryFailed()}>
                  Retry {countOf(s.failed, "failed file")}
                </Button>
              ) : null}
              {s.done && !active ? (
                <Button size="sm" variant="ghost" onClick={() => queue.clearFinished()}>
                  Clear list
                </Button>
              ) : null}
            </div>
          </div>
          <div
            role="progressbar"
            aria-label="Upload progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={active ? percent : 100}
            className="mt-3 h-2 w-full overflow-hidden bg-sunken"
          >
            <div className={cx("h-full transition-[width] duration-300", s.failed && !active ? "bg-red-600" : "bg-ink")} style={{ width: `${active ? percent : 100}%` }} />
          </div>
        </div>

        {paused ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-b border-red-200 bg-red-50 px-5 py-3 text-[13px] text-red-800 sm:px-6">
            <p className="flex items-start gap-2">
              <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
              <span>
                {snapshot.message ?? "The connection dropped."} {countOf(s.queued, "file is", "files are")} waiting and will upload when the
                connection is back. Nothing has been lost.
              </span>
            </p>
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => queue.resume()}>
              Try again now
            </Button>
          </div>
        ) : null}

        {listed.length ? (
          <ul className="divide-y divide-line">
            {listed.slice(0, shown).map((row) => (
              <ProgressRow key={row.id} row={row} titles={titles} queue={queue} />
            ))}
          </ul>
        ) : null}
        {listed.length > shown ? (
          <div className="border-t border-line px-5 py-3 text-center sm:px-6">
            <Button size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, listed.length - shown)} more of {listed.length - shown}
            </Button>
          </div>
        ) : null}
        {!active && s.done ? (
          <div className={cx("px-5 py-3 sm:px-6", listed.length > 0 && "border-t border-line")}>
            <Button size="sm" variant="ghost" icon={expanded ? "close" : "eye"} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Hide the uploaded files" : `Show the ${countOf(s.done, "uploaded file")}`}
            </Button>
          </div>
        ) : null}
      </section>
    </Card>
  );
}

const ProgressRow = memo(function ProgressRow({ row, titles, queue }: { row: PortalRow; titles: Map<string, string>; queue: UploadQueue<PickedFile> }) {
  const status = row.status === "staged" ? STATUS_ICONS.queued : STATUS_ICONS[row.status];
  const retrying = row.status === "uploading" && row.error;
  return (
    <li className="flex items-start gap-3 px-5 py-3 sm:px-6">
      <Icon name={status.icon} label={status.label} className={cx("mt-0.5 size-4", status.className)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium break-words text-ink">{row.name}</p>
        <p className="mt-0.5 text-xs break-words text-muted">
          {destination(row, titles)} · {formatSize(row.size)}
        </p>
        {row.status === "uploading" ? (
          <div className="mt-2 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label={`Uploading ${row.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(row.progress * 100)}
              className="h-1.5 w-full max-w-sm overflow-hidden bg-sunken"
            >
              <div className="h-full bg-ink transition-[width] duration-200" style={{ width: `${Math.round(row.progress * 100)}%` }} />
            </div>
            <span className="text-xs text-muted tabular-nums">{retrying ? "Waiting to retry" : `${Math.round(row.progress * 100)}%`}</span>
          </div>
        ) : null}
        {row.status === "failed" && row.error ? <p className="mt-1 text-xs text-red-800">{row.error}</p> : null}
      </div>
      <div className="shrink-0 text-xs">
        {row.status === "failed" && canSend(row) ? (
          <Button size="xs" icon="refresh" onClick={() => queue.retry(row.id)}>
            Retry<span className="sr-only"> {row.name}</span>
          </Button>
        ) : row.status === "done" ? (
          <span className="font-medium text-emerald-800">Uploaded</span>
        ) : row.status === "queued" ? (
          <span className="text-muted">Waiting</span>
        ) : null}
      </div>
    </li>
  );
});
