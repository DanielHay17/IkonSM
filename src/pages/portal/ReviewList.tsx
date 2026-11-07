// The review list: one row per file from the drop, with the requested document it was matched to (and how
// sure the match is) and the Master File Structure folder, both changeable, before anything is sent.

import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { HandoverMatchTarget, PortalView, VaultFolderName } from "../../../shared/onboarding";
import {
  canSend,
  chooseFolder,
  chooseItem,
  confidenceLevel,
  countOf,
  formatConfidence,
  formatSize,
  groupByFolder,
  matchReason,
  stagedSummary,
  type UploadQueue,
} from "../../../shared/portal-upload";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { selectClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { cx } from "../../lib/cx";
import type { PickedFile } from "../../lib/dropFiles";
import type { PortalRow } from "./useUploadQueue";

export const PAGE_SIZE = 50;

/** Where the files under review came from, and what was left out. */
export interface ReviewSession {
  sources: string[];
  skipped: number;
  repeated: number;
}

type ReviewFilter = "all" | "matched" | "other" | "flagged";

function reviewFilterMatches(row: PortalRow, filter: ReviewFilter): boolean {
  if (filter === "matched") return row.itemId !== null && canSend(row);
  if (filter === "other") return row.itemId === null && canSend(row);
  if (filter === "flagged") return row.flag !== null;
  return true;
}

const STATUS_SUFFIX: Partial<Record<PortalView["items"][number]["status"], string>> = {
  verified: " (verified)",
  rejected: " (needs replacing)",
  not_applicable: " (not applicable)",
};

export function ReviewList({
  rows,
  view,
  targets,
  queue,
  session,
  headingRef,
  onUpload,
  onClear,
}: {
  rows: PortalRow[];
  view: PortalView;
  targets: HandoverMatchTarget[];
  queue: UploadQueue<PickedFile>;
  session: ReviewSession;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onUpload: () => void;
  onClear: () => void;
}) {
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [shown, setShown] = useState(PAGE_SIZE);
  const tickAll = useRef<HTMLInputElement>(null);
  const summary = stagedSummary(rows);
  const titles = useMemo(() => new Map(view.items.map((item) => [item.id, item.title])), [view.items]);
  const verified = useMemo(() => new Set(view.items.filter((item) => item.status === "verified").map((item) => item.id)), [view.items]);
  const itemOptions = useMemo(
    () =>
      groupByFolder(view.items, view.folders)
        .filter((group) => group.items.length)
        .map((group) => (
          <optgroup key={group.folder} label={group.folder}>
            {group.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
                {STATUS_SUFFIX[item.status] ?? ""}
              </option>
            ))}
          </optgroup>
        )),
    [view.items, view.folders],
  );

  const counts: Record<ReviewFilter, number> = {
    all: rows.length,
    matched: rows.filter((row) => reviewFilterMatches(row, "matched")).length,
    other: rows.filter((row) => reviewFilterMatches(row, "other")).length,
    flagged: rows.filter((row) => reviewFilterMatches(row, "flagged")).length,
  };
  const visible = rows.filter((row) => reviewFilterMatches(row, filter));
  const sendable = rows.filter(canSend);
  const allTicked = sendable.length > 0 && sendable.every((row) => row.include);
  const someTicked = sendable.some((row) => row.include);

  useEffect(() => {
    if (tickAll.current) tickAll.current.indeterminate = someTicked && !allTicked;
  }, [someTicked, allTicked]);

  const filters: { key: ReviewFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "matched", label: "Requested documents" },
    { key: "other", label: "Other files" },
    { key: "flagged", label: "Flagged" },
  ];

  const description = [
    session.sources.length ? `From ${session.sources.join(", ")}` : "",
    formatSize(rows.reduce((sum, row) => sum + row.size, 0)),
    session.skipped ? `${countOf(session.skipped, "system file")} skipped` : "",
    session.repeated ? `${countOf(session.repeated, "file")} already in the list` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card className="animate-rise-in">
      <section aria-labelledby="portal-review-title">
        <div className="border-b border-line px-5 py-4 sm:px-6">
          <h2 id="portal-review-title" ref={headingRef} tabIndex={-1} className="heading-display text-[15px] leading-6 text-ink focus:outline-none">
            Review {countOf(rows.length, "file")}
          </h2>
          <p className="mt-0.5 text-[13px] break-words text-muted">{description}</p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            Each file has been matched to the requested document it most likely is. Check the matches, change any that are wrong, and choose
            “No requested document” for anything else: it is still filed in the folder shown.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-subtle px-5 py-3 sm:px-6">
          <div role="group" aria-label="Show files" className="flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => {
                  setFilter(f.key);
                  setShown(PAGE_SIZE);
                }}
                className={cx(
                  "inline-flex h-8 items-center gap-1.5 border px-3 text-[13px] font-medium transition-colors",
                  filter === f.key ? "border-ink bg-ink text-white" : "border-line-input bg-surface text-ink-soft hover:border-ink hover:text-ink",
                )}
              >
                {f.label}
                <span className={cx("tabular-nums", filter === f.key ? "text-white/80" : "text-muted")}>{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px] font-medium text-ink-soft">
            <input
              ref={tickAll}
              type="checkbox"
              className="size-4 accent-[#292929]"
              checked={allTicked}
              disabled={!sendable.length}
              onChange={(e) => {
                const include = e.currentTarget.checked;
                queue.updateStaged((row) => (canSend(row) ? { ...row, include } : row));
              }}
            />
            Upload all
          </label>
        </div>

        {summary.oversize || summary.empty ? (
          <p role="note" className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-5 py-3 text-[13px] text-red-800 sm:px-6">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <span>
              {[
                summary.oversize ? `${countOf(summary.oversize, "file is", "files are")} over ${formatSize(view.limits.maxFileBytes)} and can't be uploaded here` : "",
                summary.empty ? `${countOf(summary.empty, "file is", "files are")} empty` : "",
              ]
                .filter(Boolean)
                .join("; ")}
              . Split or compress large files, or ask {view.incomingManager.name} how to send them.
            </span>
          </p>
        ) : null}

        <div
          aria-hidden="true"
          className="hidden border-b border-line px-5 py-2 text-[11px] font-medium tracking-[0.12em] text-muted uppercase sm:px-6 lg:grid lg:grid-cols-[1.25rem_minmax(0,1.25fr)_minmax(0,1.15fr)_minmax(0,0.75fr)] lg:gap-4"
        >
          <span />
          <span>File</span>
          <span>Requested document</span>
          <span>Folder</span>
        </div>
        {visible.length ? (
          <ul className="divide-y divide-line">
            {visible.slice(0, shown).map((row) => (
              <ReviewRow
                key={row.id}
                row={row}
                itemOptions={itemOptions}
                targets={targets}
                titles={titles}
                verified={verified}
                folders={view.folders}
                maxFileBytes={view.limits.maxFileBytes}
                queue={queue}
              />
            ))}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-[13px] text-muted sm:px-6">No files in this view.</p>
        )}
        {visible.length > shown ? (
          <div className="border-t border-line px-5 py-3 text-center sm:px-6">
            <Button size="sm" onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Show {Math.min(PAGE_SIZE, visible.length - shown)} more of {visible.length - shown}
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-subtle px-5 py-4 sm:px-6">
          <p className="text-[13px] text-ink-soft">
            <span className="font-semibold text-ink">{countOf(summary.selected, "file")}</span> selected · {formatSize(summary.selectedBytes)} ·{" "}
            {summary.matched} to requested documents, {summary.selected - summary.matched} as other files
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onClear}>
              Clear list
            </Button>
            <Button variant="primary" icon="upload" onClick={onUpload} disabled={!summary.selected}>
              {summary.selected ? `Upload ${countOf(summary.selected, "file")}` : "Nothing to upload"}
            </Button>
          </div>
        </div>
      </section>
    </Card>
  );
}

const LEVEL_LABELS = { strong: "Strong match", likely: "Likely match", possible: "Possible match" } as const;

const ReviewRow = memo(function ReviewRow({
  row,
  itemOptions,
  targets,
  titles,
  verified,
  folders,
  maxFileBytes,
  queue,
}: {
  row: PortalRow;
  itemOptions: ReactNode;
  targets: HandoverMatchTarget[];
  titles: Map<string, string>;
  /** Requested documents Ikon has already verified (a new file sends them back for checking). */
  verified: ReadonlySet<string>;
  folders: readonly VaultFolderName[];
  maxFileBytes: number;
  queue: UploadQueue<PickedFile>;
}) {
  const id = `review-${row.id}`;
  const folderPath = row.path.split("/").slice(0, -1).join(" / ");
  const sendable = canSend(row);
  const suggested = row.match.itemId;
  const level = confidenceLevel(row.match.confidence);
  const reason = matchReason(row.match);

  let suggestion: ReactNode;
  if (!suggested) {
    suggestion = <span>{reason || "No requested document matched"}</span>;
  } else if (row.itemId === suggested) {
    suggestion = (
      <span className="inline-flex items-start gap-1.5">
        <Icon name="check" className="mt-px size-3.5 shrink-0 text-ink" />
        <span>
          {LEVEL_LABELS[level]} ({formatConfidence(row.match.confidence)}): {reason}
        </span>
      </span>
    );
  } else {
    suggestion = (
      <span>
        {LEVEL_LABELS[level]} ({formatConfidence(row.match.confidence)}): <span className="font-medium text-ink-soft">{titles.get(suggested)}</span>.{" "}
        <button
          type="button"
          className="link-brand font-medium"
          onClick={() => queue.update(row.id, (r) => chooseItem(r, suggested, targets))}
          disabled={!sendable}
        >
          Use this<span className="sr-only"> for {row.name}</span>
        </button>
        {reason ? <span className="mt-0.5 block">{reason}.</span> : null}
      </span>
    );
  }

  return (
    <li
      className={cx(
        "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-5 py-4 sm:px-6 lg:grid-cols-[1.25rem_minmax(0,1.25fr)_minmax(0,1.15fr)_minmax(0,0.75fr)] lg:gap-x-4",
        !row.include && "bg-subtle",
      )}
    >
      <input
        id={`${id}-include`}
        type="checkbox"
        className="mt-1 size-4 accent-[#292929]"
        checked={row.include && sendable}
        disabled={!sendable}
        onChange={(e) => {
          const include = e.currentTarget.checked;
          queue.update(row.id, (r) => ({ ...r, include }));
        }}
      />
      <div className="min-w-0">
        <label htmlFor={`${id}-include`} className={cx("block text-sm font-medium break-words", row.include ? "text-ink" : "text-muted")}>
          <span className="sr-only">Upload </span>
          {row.name}
        </label>
        <p className="mt-0.5 text-xs wrap-anywhere text-muted">
          {folderPath ? (
            <>
              <span className="sr-only">In </span>
              {folderPath} ·{" "}
            </>
          ) : null}
          <span className="whitespace-nowrap">{formatSize(row.size)}</span>
        </p>
        {row.flag ? (
          <p className="mt-1.5">
            {row.flag === "oversize" ? (
              <Badge tone="red" icon="alert">
                Over {formatSize(maxFileBytes)}: can't be uploaded
              </Badge>
            ) : row.flag === "empty" ? (
              <Badge tone="red" icon="alert">
                Empty file
              </Badge>
            ) : (
              <>
                <Badge tone="neutral" icon="check">
                  Already uploaded
                </Badge>
                <span className="mt-1 block text-xs text-muted">A file with this name and size is already in the handover. Tick it to upload it again.</span>
              </>
            )}
          </p>
        ) : null}
      </div>
      <div className="col-start-2 min-w-0 lg:col-start-auto">
        <label htmlFor={`${id}-item`} className="mb-1 block text-xs font-medium text-ink-soft lg:sr-only">
          Requested document<span className="sr-only"> for {row.name}</span>
        </label>
        <select
          id={`${id}-item`}
          className={selectClasses("text-[13px]", "h-9")}
          value={row.itemId ?? ""}
          disabled={!sendable}
          aria-describedby={`${id}-why`}
          onChange={(e) => {
            const itemId = e.currentTarget.value || null;
            queue.update(row.id, (r) => chooseItem(r, itemId, targets));
          }}
        >
          <option value="">No requested document (file as other)</option>
          {itemOptions}
        </select>
        <p id={`${id}-why`} className="mt-1 text-xs leading-relaxed text-muted">
          {suggestion}
          {row.itemId && verified.has(row.itemId) && sendable ? (
            <span className="mt-1 flex items-start gap-1.5 text-ink-soft">
              <Icon name="alert" className="mt-px size-3.5 shrink-0 text-taupe" />
              <span>Ikon has already verified this document. A new file sends it back for checking.</span>
            </span>
          ) : null}
        </p>
      </div>
      <div className="col-start-2 min-w-0 lg:col-start-auto">
        <label htmlFor={`${id}-folder`} className="mb-1 block text-xs font-medium text-ink-soft lg:sr-only">
          Folder<span className="sr-only"> for {row.name}</span>
        </label>
        <select
          id={`${id}-folder`}
          className={selectClasses("text-[13px]", "h-9")}
          value={row.folder}
          disabled={!sendable}
          onChange={(e) => {
            const folder = e.currentTarget.value as VaultFolderName;
            queue.update(row.id, (r) => chooseFolder(r, folder));
          }}
        >
          {folders.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
});
