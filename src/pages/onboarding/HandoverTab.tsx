// The requested handover documents, by Master File Structure folder. Each item shows what the outgoing
// manager supplied (files open in the building's Files tab, or as text here), their note, and Ikon's
// review: Verify, Needs replacing (with a note the outgoing manager sees), Not applicable, Reopen. Items
// awaiting verification can be verified in bulk. Extra files (not matched to an item) come last.

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  HANDOVER_STATUS_LABELS,
  type HandoverFile,
  type HandoverItem,
  type HandoverItemStatus,
} from "../../../shared/onboarding";
import { api } from "../../api";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState, FormError } from "../../components/EmptyState";
import { TextAreaField } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { Modal } from "../../components/Modal";
import { SkeletonText } from "../../components/Skeleton";
import { Spinner } from "../../components/Spinner";
import { Segmented } from "../../components/Tabs";
import { useToast } from "../../components/Toast";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { formatBytes, formatDate, formatDateTime, plural } from "../../lib/format";
import { navigate, paths, useLocationSearch } from "../../router";
import { itemsByFolder } from "./derive";
import { useProject } from "./ProjectContext";
import { HandoverStatusBadge } from "./ui";

type StatusFilter = HandoverItemStatus | "all";
const FILTERS: StatusFilter[] = ["all", "awaiting_verification", "awaiting_supply", "rejected", "verified", "not_applicable"];

function parseFilter(search: string): StatusFilter {
  const status = new URLSearchParams(search).get("status");
  return FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : "all";
}

function FilePreviewModal({ propertyId, file, onClose }: { propertyId: string; file: HandoverFile | null; onClose: () => void }) {
  const text = useResource(file ? `doc-text:${propertyId}:${file.docId}` : null, () => api.docText(propertyId, file!.docId));
  return (
    <Modal
      open={!!file}
      onClose={onClose}
      title={file?.name ?? "Document"}
      description={file ? `${file.folder} · ${formatBytes(file.size)} · from ${file.uploadedBy}` : undefined}
      size="lg"
      plainTitle
      footer={
        file ? (
          <>
            <Link href={paths.vaultDoc(propertyId, file.docId)} className="mr-auto inline-flex items-center gap-1 text-[13px] font-medium link-brand">
              <Icon name="folder" className="size-3.5" /> Open in Files
            </Link>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </>
        ) : null
      }
    >
      {text.error ? (
        <ErrorState error={text.error} onRetry={text.reload} title="Couldn't load the text" compact />
      ) : text.loading ? (
        <SkeletonText lines={8} />
      ) : text.data?.text ? (
        <pre className="max-h-[60vh] overflow-y-auto border border-line bg-subtle p-4 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft [overflow-wrap:anywhere]">
          {text.data.text}
        </pre>
      ) : (
        <p className="text-sm text-muted">No text could be read from this file. Open it in Files to download it.</p>
      )}
    </Modal>
  );
}

function FileList({ files, onPreview }: { files: HandoverFile[]; onPreview: (file: HandoverFile) => void }) {
  const { propertyId } = useProject();
  return (
    <ul className="mt-2 space-y-1.5">
      {files.map((file) => (
        <li key={file.docId} className="flex flex-wrap items-start gap-x-3 gap-y-1 border border-line bg-surface px-3 py-2 text-[13px]">
          <Icon name="file" className="mt-0.5 size-4 shrink-0 text-taupe" />
          <div className="min-w-0 flex-[1_1_14rem]">
            <Link href={paths.vaultDoc(propertyId, file.docId)} className="font-medium break-words link-brand">
              {file.name}
            </Link>
            <p className="mt-0.5 text-xs text-muted">
              {formatBytes(file.size)} · {file.folder} · {formatDate(file.uploadedAt)} · {file.uploadedBy}
            </p>
            {file.sourcePath ? <p className="mt-0.5 text-xs text-muted [overflow-wrap:anywhere]">From {file.sourcePath}</p> : null}
          </div>
          <button type="button" onClick={() => onPreview(file)} className="ml-7 inline-flex shrink-0 items-center gap-1 text-xs font-medium link-brand sm:ml-0">
            <Icon name="eye" className="size-3.5" />
            Preview text<span className="sr-only"> of {file.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

type Decision = { item: HandoverItem; status: "rejected" | "not_applicable" };

function DecisionModal({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const { patchItem } = useProject();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const rejecting = decision?.status === "rejected";

  useEffect(() => {
    if (!decision) return;
    setNote(decision.item.status === decision.status ? (decision.item.reviewNote ?? "") : "");
    setError(null);
  }, [decision]);

  const save = async () => {
    if (!decision) return;
    if (rejecting && !note.trim()) {
      setError(new Error("Tell the outgoing manager what to supply instead."));
      return;
    }
    setBusy(true);
    const ok = await patchItem(decision.item, { status: decision.status, reviewNote: note.trim() || null }, { quiet: false });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open={!!decision}
      onClose={busy ? () => undefined : onClose}
      title={rejecting ? "Needs replacing" : "Not applicable"}
      description={decision?.item.title}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={rejecting ? "danger" : "primary"} loading={busy} onClick={save}>
            {rejecting ? "Send back" : "Mark not applicable"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextAreaField
          label={rejecting ? "What should the outgoing manager supply instead?" : "Reason (optional)"}
          hint={rejecting ? "Shown to the outgoing manager in their portal." : "Kept with the item for the go-live review."}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={2000}
          required={rejecting}
          autoFocus
        />
        <FormError error={error} />
      </div>
    </Modal>
  );
}

function ItemActions({ item, onDecide }: { item: HandoverItem; onDecide: (d: Decision) => void }) {
  const { patchItem, saving } = useProject();
  const busy = saving.has(`item:${item.id}`);
  const verify = () => void patchItem(item, { status: "verified" });
  const reopen = () => void patchItem(item, { status: "awaiting_supply", reviewNote: null });
  const hasFiles = item.files.length > 0;
  const buttons: ReactNode[] = [];
  if (item.status === "awaiting_verification" || ((item.status === "rejected" || item.status === "awaiting_supply") && hasFiles)) {
    buttons.push(
      <Button key="verify" size="sm" variant="primary" icon="check" onClick={verify} disabled={busy}>
        Verify
      </Button>,
    );
  }
  if (item.status !== "rejected" && item.status !== "not_applicable" && (hasFiles || item.status === "awaiting_verification")) {
    buttons.push(
      <Button key="reject" size="sm" variant="secondary" icon="refresh" onClick={() => onDecide({ item, status: "rejected" })} disabled={busy}>
        Needs replacing
      </Button>,
    );
  }
  if (item.status !== "not_applicable" && item.status !== "verified") {
    buttons.push(
      <Button key="na" size="sm" variant="ghost" icon="close" onClick={() => onDecide({ item, status: "not_applicable" })} disabled={busy}>
        Not applicable
      </Button>,
    );
  }
  if (item.status === "verified" || item.status === "not_applicable" || item.status === "rejected") {
    buttons.push(
      <Button key="reopen" size="sm" variant="ghost" icon="refresh" onClick={reopen} disabled={busy}>
        Reopen
      </Button>,
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {buttons}
      {busy ? <Spinner className="size-3.5 text-muted" label="Saving" /> : null}
    </div>
  );
}

function ItemRow({
  item,
  selected,
  onSelect,
  onDecide,
  onPreview,
}: {
  item: HandoverItem;
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onDecide: (d: Decision) => void;
  onPreview: (file: HandoverFile) => void;
}) {
  const titleId = useId();
  const selectable = item.status === "awaiting_verification";
  return (
    <li className={cx("px-4 py-4", item.status === "rejected" && "bg-red-50/40")}>
      <div className="flex gap-3">
        <div className="w-[18px] shrink-0 pt-0.5">
          {selectable ? (
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
              aria-label={`Select ${item.title} for bulk verify`}
              className="size-[18px] accent-[#292929]"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={titleId} className="text-sm leading-snug font-semibold text-ink">
              {item.title}
            </h3>
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{item.required ? "Required" : "Optional"}</span>
            <HandoverStatusBadge status={item.status} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{item.detail}</p>

          {item.files.length ? <FileList files={item.files} onPreview={onPreview} /> : null}

          {item.supplierNote ? (
            <p className="mt-2 flex gap-2 border-l-2 border-line-strong bg-subtle px-3 py-1.5 text-xs text-ink-soft">
              <Icon name="message" className="mt-px size-3.5 shrink-0 text-taupe" />
              <span>
                <span className="font-medium text-ink">Outgoing manager's note: </span>
                {item.supplierNote}
              </span>
            </p>
          ) : null}
          {item.reviewNote ? (
            <p
              className={cx(
                "mt-2 flex gap-2 border-l-2 px-3 py-1.5 text-xs",
                item.status === "rejected" ? "border-red-300 bg-red-50 text-red-900" : "border-line-strong bg-subtle text-ink-soft",
              )}
            >
              <Icon name={item.status === "rejected" ? "alert" : "pencil"} className="mt-px size-3.5 shrink-0" />
              <span>
                <span className="font-medium">{item.status === "rejected" ? "Sent back: " : "Ikon's note: "}</span>
                {item.reviewNote}
              </span>
            </p>
          ) : null}
          {item.status === "verified" && item.verifiedBy ? (
            <p className="mt-2 text-xs text-emerald-800">
              Verified by {item.verifiedBy}
              {item.verifiedAt ? ` · ${formatDateTime(item.verifiedAt)}` : ""}
            </p>
          ) : null}

          <div className="mt-3">
            <ItemActions item={item} onDecide={onDecide} />
          </div>
        </div>
      </div>
    </li>
  );
}

export function HandoverTab() {
  const { project, propertyId, patchItem } = useProject();
  const toast = useToast();
  const search = useLocationSearch();
  const filter = parseFilter(search);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [decision, setDecision] = useState<Decision | null>(null);
  const [preview, setPreview] = useState<HandoverFile | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const { counts } = project;
  const shown = useMemo(() => (filter === "all" ? project.handoverItems : project.handoverItems.filter((i) => i.status === filter)), [project.handoverItems, filter]);
  const groups = useMemo(() => itemsByFolder(shown), [shown]);
  const awaiting = project.handoverItems.filter((i) => i.status === "awaiting_verification");
  // Keep the selection to items that can still be verified.
  const chosen = awaiting.filter((i) => selected.has(i.id));

  const setFilter = (next: StatusFilter) =>
    navigate(paths.onboardingProject(propertyId, "handover", { status: next === "all" ? null : next }), { replace: true });

  const select = (id: string, checked: boolean) =>
    setSelected((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const bulkVerify = async () => {
    setBulkBusy(true);
    let ok = 0;
    for (const item of chosen) if (await patchItem(item, { status: "verified" }, { quiet: true })) ok++;
    setBulkBusy(false);
    setSelected(new Set());
    const failed = chosen.length - ok;
    if (failed) toast.error(`${plural(failed, "document")} couldn't be verified`, `${ok} verified. Try the others again.`);
    else toast.success(`${plural(ok, "document")} verified`, "They are now part of the building's records.");
  };

  const filterLabel = (f: StatusFilter) => {
    if (f === "all") return `All ${counts.handoverItems}`;
    const n = project.handoverItems.filter((i) => i.status === f).length;
    return `${HANDOVER_STATUS_LABELS[f]} ${n}`;
  };

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Verified", value: counts.handoverVerified, tone: "text-emerald-800" },
          { label: "Awaiting verification", value: counts.handoverAwaitingVerification, tone: "text-amber-900" },
          { label: "Awaiting supply", value: counts.handoverAwaitingSupply, tone: "text-amber-900" },
          { label: "Needs replacing", value: counts.handoverRejected, tone: counts.handoverRejected ? "text-red-700" : "text-ink" },
          { label: "Not applicable", value: counts.handoverNotApplicable, tone: "text-ink" },
        ].map((stat) => (
          <Card key={stat.label} className="px-4 py-3">
            <dd className={cx("heading-display text-[22px] leading-7 tabular-nums", stat.tone)}>{stat.value}</dd>
            <dt className="text-xs text-muted">{stat.label}</dt>
          </Card>
        ))}
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4 scrollbar-thin sm:mx-0 sm:max-w-full sm:px-0">
          <Segmented<StatusFilter>
            label="Show documents"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f, label: filterLabel(f) }))}
          />
        </div>
        {awaiting.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="text-xs font-medium link-brand"
              onClick={() => setSelected(chosen.length === awaiting.length ? new Set() : new Set(awaiting.map((i) => i.id)))}
            >
              {chosen.length === awaiting.length ? "Clear selection" : `Select all ${awaiting.length} awaiting verification`}
            </button>
            <Button size="sm" variant="primary" icon="check" disabled={!chosen.length} loading={bulkBusy} onClick={bulkVerify}>
              Verify {chosen.length ? plural(chosen.length, "selected document") : "selected"}
            </Button>
          </div>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="folder"
            title="Nothing here"
            description={`No requested documents are ${filter === "all" ? "listed" : HANDOVER_STATUS_LABELS[filter as HandoverItemStatus].toLowerCase()}.`}
            action={
              <Button size="sm" onClick={() => setFilter("all")}>
                Show all documents
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {groups.map(({ folder, items }) => (
            <section key={folder} aria-labelledby={`folder-${folder}`}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`folder-${folder}`} className="heading-display flex items-center gap-2 text-[14px] leading-6 text-ink">
                  <Icon name="folder" className="size-4 text-taupe" />
                  {folder}
                </h2>
                <p className="text-xs text-muted tabular-nums">
                  {items.filter((i) => i.status === "verified" || i.status === "not_applicable").length} of {plural(items.length, "document")} settled
                </p>
              </div>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      selected={selected.has(item.id)}
                      onSelect={(checked) => select(item.id, checked)}
                      onDecide={setDecision}
                      onPreview={setPreview}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}

      <section aria-labelledby="extra-files">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="extra-files" className="heading-display text-[14px] leading-6 text-ink">
            Extra files ({project.extraFiles.length})
          </h2>
          <p className="text-xs text-muted">Uploaded by the outgoing manager but not matched to a requested document. Filed in the building's Files.</p>
        </div>
        <Card className="px-4 py-3">
          {project.extraFiles.length ? (
            <FileList files={project.extraFiles} onPreview={setPreview} />
          ) : (
            <p className="py-2 text-[13px] text-muted">No extra files.</p>
          )}
        </Card>
      </section>

      <DecisionModal decision={decision} onClose={() => setDecision(null)} />
      <FilePreviewModal propertyId={propertyId} file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
