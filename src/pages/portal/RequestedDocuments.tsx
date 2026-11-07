// The requested documents, grouped by the 8 Master File Structure folders: each with its status, the
// files already supplied, Ikon's note when a document needs replacing, and the outgoing manager's actions
// (Upload to this document, Not applicable with a reason, a note to Ikon). Then the other files.

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { HandoverMatchTarget, PortalItem, PortalView } from "../../../shared/onboarding";
import {
  countOf,
  formatPortalDate,
  formatSize,
  groupByFolder,
  itemMatchesFilter,
  rowForItem,
  type ItemFilter,
  type QueueSnapshot,
  type UploadQueue,
} from "../../../shared/portal-upload";
import { portalApi } from "../../api";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { FormError } from "../../components/EmptyState";
import { TextAreaField } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { cx } from "../../lib/cx";
import { pickedFile, type PickedFile } from "../../lib/dropFiles";
import { HiddenFileInput, ItemStatusBadge } from "./labels";
import { nextRowId, type PortalRow } from "./useUploadQueue";

const FILTERS: { key: ItemFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "needed", label: "Still needed" },
  { key: "with_ikon", label: "With Ikon" },
  { key: "verified", label: "Verified" },
  { key: "not_applicable", label: "Not applicable" },
];

const EMPTY_FILTER: Record<ItemFilter, string> = {
  all: "No documents have been requested.",
  needed: "Nothing is still needed: every requested document has been supplied or marked not applicable.",
  with_ikon: "Nothing is waiting for Ikon to verify.",
  verified: "Ikon hasn't verified any documents yet.",
  not_applicable: "No documents are marked not applicable.",
};

interface RequestedDocumentsProps {
  token: string;
  view: PortalView;
  targets: HandoverMatchTarget[];
  queue: UploadQueue<PickedFile>;
  snapshot: QueueSnapshot<PickedFile>;
  /** An item changed (not applicable, a note): merge it and refresh the view. */
  onItemChanged: (item: PortalItem) => void;
  /** A failed call: true when it was the link itself (the page then shows the expired message). */
  onFailure: (err: unknown) => boolean;
}

export function RequestedDocuments({ token, view, targets, queue, snapshot, onItemChanged, onFailure }: RequestedDocumentsProps) {
  const toast = useToast();
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [notApplicable, setNotApplicable] = useState<PortalItem | null>(null);
  const [noting, setNoting] = useState<PortalItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<PortalItem | null>(null);

  const counts = useMemo(() => {
    const result = {} as Record<ItemFilter, number>;
    for (const f of FILTERS) result[f.key] = view.items.filter((item) => itemMatchesFilter(item.status, f.key)).length;
    return result;
  }, [view.items]);
  const groups = groupByFolder(view.items, view.folders)
    .map((group) => ({ ...group, shown: group.items.filter((item) => itemMatchesFilter(item.status, filter)) }))
    .filter((group) => group.shown.length);

  // Item uploads in flight or failed, by item (finished ones show up in the item's files on the next refresh).
  const uploadsByItem = useMemo(() => {
    const map = new Map<string, PortalRow[]>();
    for (const row of snapshot.rows) {
      if (row.origin !== "item" || !row.itemId || row.status === "done" || row.status === "staged") continue;
      map.set(row.itemId, [...(map.get(row.itemId) ?? []), row]);
    }
    return map;
  }, [snapshot.rows]);

  const chooseFiles = (item: PortalItem) => {
    uploadTarget.current = item;
    fileInput.current?.click();
  };

  const onFiles = (list: FileList | null) => {
    const item = uploadTarget.current;
    // Copy the files first: clearing the input empties its FileList in place.
    const files = Array.from(list ?? []);
    if (fileInput.current) fileInput.current.value = "";
    if (!item || !files.length) return;
    const rows: PortalRow[] = [];
    let skipped = 0;
    for (const file of files) {
      const row = rowForItem({ path: file.name, size: file.size, source: pickedFile(file, file.name) }, item, {
        targets,
        maxFileBytes: view.limits.maxFileBytes,
        nextId: nextRowId,
      });
      if (row) rows.push(row);
      else skipped++;
    }
    queue.add(rows);
    const sending = rows.filter((row) => row.status === "queued").length;
    if (sending) toast.info(`Uploading ${countOf(sending, "file")} to “${item.title}”`);
    for (const row of rows.filter((r) => r.status === "failed")) toast.error(`${row.name} can't be uploaded`, row.error ?? undefined);
    if (skipped) toast.info(`${countOf(skipped, "system file")} left out`);
  };

  return (
    <section aria-labelledby="portal-requested-title" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id="portal-requested-title" className="heading-display text-[20px] leading-tight text-ink sm:text-[24px]">
            Requested documents
          </h2>
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">
            The {view.progress.total} documents Ikon needs, grouped by where they are filed in Ikon's Master File Structure. Upload straight to a
            document, or mark it not applicable with a reason.
          </p>
        </div>
      </div>
      <div role="group" aria-label="Show documents" className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cx(
              "inline-flex h-9 items-center gap-1.5 border px-3 text-[13px] font-medium transition-colors",
              filter === f.key ? "border-ink bg-ink text-white" : "border-line-input bg-surface text-ink-soft hover:border-ink hover:text-ink",
            )}
          >
            {f.label}
            <span className={cx("tabular-nums", filter === f.key ? "text-white/80" : "text-muted")}>{counts[f.key]}</span>
          </button>
        ))}
      </div>

      <HiddenFileInput ref={fileInput} multiple onChange={(e) => onFiles(e.currentTarget.files)} />

      {groups.length ? (
        <div className="space-y-4">
          {groups.map((group) => {
            const supplied = group.items.filter((item) => item.status !== "awaiting_supply" && item.status !== "rejected").length;
            return (
              <Card key={group.folder}>
                <section aria-label={group.folder}>
                  <CardHeader
                    as="h3"
                    leading={<Icon name="folder" className="mt-1 size-4 text-taupe" />}
                    title={group.folder}
                    description={`${supplied} of ${countOf(group.items.length, "document")} supplied or not applicable`}
                  />
                  <ul className="divide-y divide-line">
                    {group.shown.map((item) => (
                      <ItemRow
                        key={item.id}
                        item={item}
                        uploads={uploadsByItem.get(item.id) ?? []}
                        queue={queue}
                        onUpload={() => chooseFiles(item)}
                        onNotApplicable={() => setNotApplicable(item)}
                        onNote={() => setNoting(item)}
                      />
                    ))}
                  </ul>
                </section>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <p className="px-5 py-10 text-center text-sm text-muted">{EMPTY_FILTER[filter]}</p>
        </Card>
      )}

      <NoteDialog
        mode="not_applicable"
        item={notApplicable}
        onClose={() => setNotApplicable(null)}
        onSave={async (item, text) => {
          const updated = await portalApi.notApplicable(token, item.id, text);
          onItemChanged(updated);
          toast.success(
            updated.status === "not_applicable" ? "Marked not applicable" : "Sent to Ikon to confirm",
            updated.status === "not_applicable" ? item.title : `${item.title} is a required document, so Ikon will check your reason.`,
          );
        }}
        onFailure={onFailure}
      />
      <NoteDialog
        mode="note"
        item={noting}
        onClose={() => setNoting(null)}
        onSave={async (item, text) => {
          onItemChanged(await portalApi.note(token, item.id, text));
          toast.success("Note saved", item.title);
        }}
        onFailure={onFailure}
      />
    </section>
  );
}

function ItemRow({
  item,
  uploads,
  queue,
  onUpload,
  onNotApplicable,
  onNote,
}: {
  item: PortalItem;
  uploads: PortalRow[];
  queue: UploadQueue<PickedFile>;
  onUpload: () => void;
  onNotApplicable: () => void;
  onNote: () => void;
}) {
  const canMarkNotApplicable = item.status === "awaiting_supply" || item.status === "rejected";
  const titleId = useId();
  return (
    <li aria-labelledby={titleId} className="flex flex-col gap-3 px-5 py-4 sm:px-6 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <h4 id={titleId} className="text-[15px] leading-snug font-semibold text-ink">
            {item.title}
          </h4>
          <ItemStatusBadge status={item.status} />
          <Badge tone="neutral">{item.required ? "Required" : "Optional"}</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-muted">{item.detail}</p>

        {item.status === "rejected" && item.reviewNote ? (
          <div role="note" className="mt-3 flex max-w-3xl items-start gap-2 border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] leading-relaxed text-red-900">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-red-700" />
            <p>
              <span className="font-semibold">Ikon needs a replacement:</span> {item.reviewNote}
            </p>
          </div>
        ) : null}

        {item.supplierNote ? (
          <p className="mt-3 max-w-3xl border-l-2 border-line-strong pl-3 text-[13px] leading-relaxed text-ink-soft">
            <span className="font-medium text-ink">
              {item.status === "awaiting_verification" && !item.files.length
                ? "You said this doesn't apply (Ikon will confirm): "
                : item.status === "not_applicable"
                  ? "You said this doesn't apply: "
                  : "Your note: "}
            </span>
            {item.supplierNote}
          </p>
        ) : null}

        {item.files.length ? (
          <ul className="mt-3 space-y-1" aria-label={`Files supplied for ${item.title}`}>
            {item.files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-start gap-2 text-[13px] text-ink-soft">
                <Icon name="file" className="mt-0.5 size-3.5 shrink-0 text-taupe" />
                <span className="min-w-0 break-words">
                  {file.name} <span className="text-muted">· {formatSize(file.size)} · {formatPortalDate(file.uploadedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        {uploads.length ? (
          <ul className="mt-3 space-y-1.5">
            {uploads.map((row) => (
              <li key={row.id} className="text-[13px]">
                {row.status === "failed" ? (
                  <span className="flex flex-wrap items-center gap-2 text-red-800">
                    <Icon name="alert" className="size-3.5" />
                    <span className="break-words">
                      {row.name}: {row.error ?? "upload failed"}
                    </span>
                    {row.flag === null ? (
                      <Button size="xs" icon="refresh" onClick={() => queue.retry(row.id)}>
                        Retry<span className="sr-only"> {row.name}</span>
                      </Button>
                    ) : null}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-ink-soft">
                    <Icon name={row.status === "uploading" ? "upload" : "clock"} className="size-3.5 text-taupe" />
                    <span className="min-w-0 break-words">
                      {row.status === "uploading" ? `Uploading ${row.name}… ${Math.round(row.progress * 100)}%` : `${row.name} is waiting to upload`}
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap gap-2 md:max-w-[19rem] md:justify-end">
        <Button size="sm" variant={item.status === "awaiting_supply" || item.status === "rejected" ? "primary" : "secondary"} icon="upload" onClick={onUpload}>
          {item.status === "rejected" ? "Upload replacement" : item.files.length ? "Upload more" : "Upload"}
          <span className="sr-only"> for {item.title}</span>
        </Button>
        {canMarkNotApplicable ? (
          <Button size="sm" variant="secondary" onClick={onNotApplicable} aria-label={`Not applicable: ${item.title}`}>
            Not applicable
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" icon="pencil" onClick={onNote}>
          {item.supplierNote ? "Edit note" : "Add a note"}
          <span className="sr-only"> for {item.title}</span>
        </Button>
      </div>
    </li>
  );
}

/** The reason for "not applicable", or a note to Ikon about a document. */
function NoteDialog({
  mode,
  item,
  onClose,
  onSave,
  onFailure,
}: {
  mode: "not_applicable" | "note";
  item: PortalItem | null;
  onClose: () => void;
  onSave: (item: PortalItem, text: string) => Promise<void>;
  onFailure: (err: unknown) => boolean;
}) {
  return (
    <Modal
      open={item !== null}
      onClose={onClose}
      title={mode === "not_applicable" ? "Not applicable" : "Note to Ikon"}
      description={item?.title}
      size="md"
    >
      {item ? <NoteForm key={item.id} mode={mode} item={item} onClose={onClose} onSave={onSave} onFailure={onFailure} /> : null}
    </Modal>
  );
}

function NoteForm({
  mode,
  item,
  onClose,
  onSave,
  onFailure,
}: {
  mode: "not_applicable" | "note";
  item: PortalItem;
  onClose: () => void;
  onSave: (item: PortalItem, text: string) => Promise<void>;
  onFailure: (err: unknown) => boolean;
}) {
  const [text, setText] = useState(mode === "note" ? (item.supplierNote ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) {
      setError(new Error(mode === "not_applicable" ? "Please say why this document doesn't apply." : "Please write a note."));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(item, value);
      onClose();
    } catch (err) {
      if (onFailure(err)) return;
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {mode === "not_applicable" ? (
        <p className="text-sm leading-relaxed text-ink-soft">
          {item.required
            ? "This is a required document, so Ikon will check your reason before treating it as not applicable."
            : "This document is optional. Tell Ikon why it doesn't apply to this scheme."}
        </p>
      ) : null}
      <TextAreaField
        label={mode === "not_applicable" ? "Why doesn't this apply?" : "Your note"}
        hint={mode === "not_applicable" ? "For example: “There is no lift or pool at this scheme.”" : "Ikon will see this note against the document."}
        required
        rows={4}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <FormError error={error} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          {mode === "not_applicable" ? "Mark not applicable" : "Save note"}
        </Button>
      </div>
    </form>
  );
}

/** Files the outgoing manager uploaded that are not one of the requested documents. */
export function ExtraFilesCard({ view }: { view: PortalView }) {
  return (
    <Card>
      <section aria-labelledby="portal-extra-title">
        <CardHeader
          title={<span id="portal-extra-title">Other files you uploaded</span>}
          description="Files that aren't one of the requested documents. They are still filed in the folder shown for Ikon to review."
          actions={<Badge tone="neutral">{countOf(view.extraFiles.length, "file")}</Badge>}
        />
        {view.extraFiles.length ? (
          <ul className="divide-y divide-line">
            {view.extraFiles.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-start gap-3 px-5 py-3 sm:px-6">
                <Icon name="file" className="mt-0.5 size-4 shrink-0 text-taupe" />
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words text-ink">{file.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {file.folder} · {formatSize(file.size)} · {formatPortalDate(file.uploadedAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={cx("px-5 py-6 text-[13px] text-muted sm:px-6")}>None yet.</p>
        )}
      </section>
    </Card>
  );
}
