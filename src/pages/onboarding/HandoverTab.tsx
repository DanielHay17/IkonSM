// The requested handover documents, by Master File Structure folder. Each item shows what the outgoing
// manager supplied (files open in the building's Files tab, or as text here), their note, and Ikon's
// review: Verify, Needs replacing (with a note the outgoing manager sees), Not applicable, Mark received
// (supplied outside the portal, e.g. originals on paper), Reopen. A "not applicable" claim from the outgoing
// manager is accepted or sent back, never verified. Items awaiting verification can be verified in bulk.
// Extra files (not matched to an item) come last: each can be verified as a building record or attached to a
// requested document. Uploads through a withdrawn or expired link are labelled.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  HANDOVER_STATUS_LABELS,
  type HandoverFile,
  type HandoverInvite,
  type HandoverItem,
  type HandoverItemStatus,
} from "../../../shared/onboarding";
import { api } from "../../api";
import { Badge } from "../../components/Badge";
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

const itemTitleId = (itemId: string) => `handover-item-${itemId}`;

/** Moves focus to an item's heading after an action replaced the button that had it. */
function focusItem(itemId: string) {
  requestAnimationFrame(() => document.getElementById(itemTitleId(itemId))?.focus());
}

/** An upload that came through a link that has since been withdrawn or has expired (null otherwise). */
function earlierLink(inviteId: string | null, invites: readonly HandoverInvite[]): HandoverInvite | null {
  const invite = inviteId ? invites.find((i) => i.id === inviteId) : undefined;
  return invite && (invite.status === "revoked" || invite.status === "expired") ? invite : null;
}

function earlierLinkLabel(invite: HandoverInvite): string {
  return `Through ${invite.status === "revoked" ? "a withdrawn" : "an expired"} link (${invite.outgoingManager.name}, ${invite.outgoingManager.company})`;
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

/** Verify an extra file, or attach it to a requested document (a select of the items, by folder). */
function ExtraFileActions({ file }: { file: HandoverFile }) {
  const { project, patchFile, saving } = useProject();
  const toast = useToast();
  const selectId = useId();
  const busy = saving.has(`file:${file.docId}`);
  const groups = useMemo(() => itemsByFolder(project.handoverItems), [project.handoverItems]);
  const attach = async (itemId: string) => {
    if (!itemId) return;
    const item = project.handoverItems.find((i) => i.id === itemId);
    if (await patchFile(file, { action: "attach", itemId })) toast.success(`Attached to "${item?.title ?? "the requested document"}"`, "It is now waiting for verification there.");
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {file.verifiedBy ? null : (
        <Button
          size="sm"
          variant="primary"
          icon="check"
          loading={busy}
          onClick={async () => {
            if (await patchFile(file, { action: "verify" })) toast.success(`"${file.name}" verified`, "It is now part of the building's records.");
          }}
        >
          Verify<span className="sr-only"> {file.name}</span>
        </Button>
      )}
      <label htmlFor={selectId} className="sr-only">
        Attach {file.name} to a requested document
      </label>
      <select
        id={selectId}
        value=""
        disabled={busy}
        onChange={(e) => void attach(e.target.value)}
        className="h-8 max-w-full min-w-0 flex-[0_1_18rem] border border-line-input bg-surface px-2 text-xs text-ink"
      >
        <option value="">Attach to a requested document…</option>
        {groups.map((g) => (
          <optgroup key={g.folder} label={g.folder}>
            {g.items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function FileList({ files, onPreview, extra = false }: { files: HandoverFile[]; onPreview: (file: HandoverFile) => void; extra?: boolean }) {
  const { propertyId, project, readOnly } = useProject();
  return (
    <ul className="mt-2 space-y-1.5">
      {files.map((file) => {
        const earlier = earlierLink(file.inviteId, project.invites);
        return (
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
              <div className="mt-1 flex flex-wrap gap-1.5">
                {file.verifiedBy ? (
                  <Badge tone="green" icon="check">
                    Verified by {file.verifiedBy}
                  </Badge>
                ) : extra ? (
                  <Badge tone="amber">Awaiting verification</Badge>
                ) : null}
                {earlier ? (
                  <Badge tone={earlier.status === "revoked" ? "red" : "neutral"} icon="alert">
                    {earlierLinkLabel(earlier)}
                  </Badge>
                ) : null}
              </div>
              {extra && !readOnly ? <ExtraFileActions file={file} /> : null}
            </div>
            <button
              type="button"
              onClick={() => onPreview(file)}
              className="ml-7 inline-flex min-h-8 shrink-0 items-center gap-1 px-1 text-xs font-medium link-brand sm:ml-0"
            >
              <Icon name="eye" className="size-3.5" />
              Preview text<span className="sr-only"> of {file.name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

type DecisionKind = "rejected" | "not_applicable" | "received";
type Decision = { item: HandoverItem; kind: DecisionKind };

const DECISION_COPY: Record<DecisionKind, { title: string; label: string; hint: string; button: string; required: boolean }> = {
  rejected: {
    title: "Needs replacing",
    label: "What should the outgoing manager supply instead?",
    hint: "Shown to the outgoing manager in their portal.",
    button: "Send back",
    required: true,
  },
  not_applicable: {
    title: "Not applicable",
    label: "Reason (optional)",
    hint: "Kept with the item for the go-live review.",
    button: "Mark not applicable",
    required: false,
  },
  received: {
    title: "Mark received",
    label: "How was it received?",
    hint: "For a document supplied outside the portal, e.g. \"Originals handed over on paper on 12 November\". Kept with the item.",
    button: "Mark received",
    required: true,
  },
};

function DecisionModal({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const { patchItem } = useProject();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const last = useRef<Decision | null>(null);
  if (decision) last.current = decision;
  const kind = decision?.kind ?? "not_applicable";
  const claim = decision?.item.notApplicableClaimed === true;
  const copy =
    kind === "rejected" && claim
      ? { ...DECISION_COPY.rejected, title: "Needs supplying", label: "What should the outgoing manager do?", button: "Send back" }
      : kind === "not_applicable" && claim
        ? { ...DECISION_COPY.not_applicable, title: "Accept as not applicable", button: "Accept (not applicable)" }
        : DECISION_COPY[kind];

  useEffect(() => {
    if (!decision) return;
    const { item } = decision;
    setNote(decision.kind === "rejected" && item.status === "rejected" ? (item.reviewNote ?? "") : "");
    setError(null);
  }, [decision]);

  const save = async () => {
    if (!decision) return;
    if (copy.required && !note.trim()) {
      setError(new Error(kind === "received" ? "Say how the document was received." : "Tell the outgoing manager what to supply instead."));
      document.getElementById(fieldId)?.focus();
      return;
    }
    setBusy(true);
    const status = kind === "received" ? "verified" : kind;
    const ok = await patchItem(decision.item, { status, reviewNote: note.trim() || null }, { quiet: false });
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Modal
      open={!!decision}
      onClose={busy ? () => undefined : onClose}
      title={copy.title}
      description={decision?.item.title}
      size="md"
      returnFocus={() => (last.current ? document.getElementById(itemTitleId(last.current.item.id)) : null)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={kind === "rejected" ? "danger" : "primary"} loading={busy} onClick={save}>
            {copy.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {claim && decision?.item.supplierNote ? (
          <p className="border-l-2 border-line-strong bg-subtle px-3 py-1.5 text-xs text-ink-soft">
            <span className="font-medium text-ink">The outgoing manager says: </span>
            {decision.item.supplierNote}
          </p>
        ) : null}
        <TextAreaField
          id={fieldId}
          label={copy.label}
          hint={copy.hint}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          maxLength={2000}
          required={copy.required}
          aria-invalid={error ? true : undefined}
          aria-describedby={[`${fieldId}-hint`, error ? errorId : null].filter(Boolean).join(" ")}
          data-autofocus
        />
        <div id={errorId}>
          <FormError error={error} />
        </div>
      </div>
    </Modal>
  );
}

function ItemActions({ item, onDecide }: { item: HandoverItem; onDecide: (d: Decision) => void }) {
  const { patchItem, saving, readOnly } = useProject();
  if (readOnly) return null;
  const busy = saving.has(`item:${item.id}`);
  const act = (patch: Parameters<typeof patchItem>[1]) => {
    void patchItem(item, patch);
    focusItem(item.id);
  };
  const hasFiles = item.files.length > 0;
  const claim = item.notApplicableClaimed;
  const sr = <span className="sr-only">: {item.title}</span>;
  const buttons: ReactNode[] = [];
  const button = (key: string, label: string, onClick: () => void, variant: "primary" | "secondary" | "ghost" = "ghost", icon: "check" | "refresh" | "close" | "file" = "close") =>
    buttons.push(
      <Button key={key} size="sm" variant={variant} icon={icon} onClick={onClick} disabled={busy}>
        {label}
        {sr}
      </Button>,
    );

  if (item.status === "awaiting_verification" && claim) {
    // The outgoing manager says it doesn't apply: staff agree, or ask for it after all. Never "verified".
    button("accept", "Accept (not applicable)", () => onDecide({ item, kind: "not_applicable" }), "primary", "check");
    button("supply", "Needs supplying", () => onDecide({ item, kind: "rejected" }), "secondary", "refresh");
    if (hasFiles) button("verify", "Verify the files", () => act({ status: "verified" }), "ghost", "check");
  } else {
    if (hasFiles && (item.status === "awaiting_verification" || item.status === "rejected" || item.status === "awaiting_supply")) {
      button("verify", "Verify", () => act({ status: "verified" }), "primary", "check");
    }
    if (!hasFiles && item.status !== "verified" && item.status !== "not_applicable") {
      button("received", "Mark received", () => onDecide({ item, kind: "received" }), "ghost", "file");
    }
    if (hasFiles && item.status !== "rejected" && item.status !== "not_applicable") {
      button("reject", "Needs replacing", () => onDecide({ item, kind: "rejected" }), "secondary", "refresh");
    }
    if (item.status !== "not_applicable" && item.status !== "verified") {
      button("na", "Not applicable", () => onDecide({ item, kind: "not_applicable" }), "ghost", "close");
    }
  }
  if (item.status === "verified" || item.status === "not_applicable" || item.status === "rejected") {
    button("reopen", "Reopen", () => act({ status: "awaiting_supply", reviewNote: null }), "ghost", "refresh");
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {buttons}
      {busy ? <Spinner className="size-3.5 text-muted" label="Saving" /> : null}
    </div>
  );
}

/** Items that bulk verify may pick: files to check, no "not applicable" claim. */
function bulkVerifiable(item: HandoverItem): boolean {
  return item.status === "awaiting_verification" && item.files.length > 0 && !item.notApplicableClaimed;
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
  const { project, readOnly } = useProject();
  const selectable = bulkVerifiable(item) && !readOnly;
  const noteFrom = earlierLink(item.supplierNoteInviteId, project.invites);
  return (
    <li className={cx("px-4 py-4", item.status === "rejected" && "bg-red-50/40")}>
      <div className="flex gap-3">
        <div className="w-6 shrink-0">
          {selectable ? (
            <label className="-m-2 grid size-10 cursor-pointer place-items-center">
              <input
                type="checkbox"
                checked={selected}
                onChange={(e) => onSelect(e.target.checked)}
                aria-label={`Select ${item.title} for bulk verify`}
                className="size-[18px] accent-[#292929]"
              />
            </label>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={itemTitleId(item.id)} tabIndex={-1} className="text-sm leading-snug font-semibold text-ink focus:outline-none">
              {item.title}
            </h3>
            <span className="text-[11px] font-medium tracking-wide text-muted uppercase">{item.required ? "Required" : "Optional"}</span>
            {item.notApplicableClaimed && item.status === "awaiting_verification" ? (
              <Badge tone="amber" icon="message">
                Not applicable claimed
              </Badge>
            ) : (
              <HandoverStatusBadge status={item.status} />
            )}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">{item.detail}</p>

          {item.files.length ? <FileList files={item.files} onPreview={onPreview} /> : null}

          {item.supplierNote ? (
            <p className="mt-2 flex gap-2 border-l-2 border-line-strong bg-subtle px-3 py-1.5 text-xs text-ink-soft">
              <Icon name="message" className="mt-px size-3.5 shrink-0 text-taupe" />
              <span>
                <span className="font-medium text-ink">
                  {item.notApplicableClaimed ? "Outgoing manager says it doesn't apply: " : "Outgoing manager's note: "}
                </span>
                {item.supplierNote}
                {noteFrom ? <span className="mt-0.5 block text-[11px] text-muted">{earlierLinkLabel(noteFrom)}</span> : null}
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
              {item.files.length ? "Verified" : "Recorded as received"} by {item.verifiedBy}
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

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card className="px-4 py-3">
      {/* The term comes first in the list (dt, dd); the number is shown above it. */}
      <div className="flex flex-col-reverse">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className={cx("heading-display text-[22px] leading-7 tabular-nums", tone)}>{value}</dd>
      </div>
    </Card>
  );
}

function ExtraFiles({ onPreview }: { onPreview: (file: HandoverFile) => void }) {
  const { project, patchFile, readOnly } = useProject();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const unverified = project.extraFiles.filter((f) => !f.verifiedBy);
  const verifyAll = async () => {
    setBusy(true);
    let ok = 0;
    for (const file of unverified) if (await patchFile(file, { action: "verify" }, { quiet: true })) ok++;
    setBusy(false);
    const failed = unverified.length - ok;
    if (failed) toast.error(`${plural(failed, "file")} couldn't be verified`, `${ok} verified. Try the others again.`);
    else toast.success(`${plural(ok, "extra file")} verified`, "They are now part of the building's records.");
  };
  return (
    <section aria-labelledby="extra-files">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="extra-files" className="heading-display text-[14px] leading-6 text-ink">
          Extra files ({project.extraFiles.length})
        </h2>
        {unverified.length > 1 && !readOnly ? (
          <Button size="sm" variant="secondary" icon="check" loading={busy} onClick={verifyAll}>
            Verify all {unverified.length} unverified
          </Button>
        ) : null}
      </div>
      <p className="mb-2 text-xs text-muted">
        Uploaded by the outgoing manager but not matched to a requested document, and filed in the building's Files. Verify each one to make it a building
        record the agents can use, or attach it to the requested document it belongs to.
      </p>
      <Card className="px-4 py-3">
        {project.extraFiles.length ? (
          <FileList files={project.extraFiles} onPreview={onPreview} extra />
        ) : (
          <p className="py-2 text-[13px] text-muted">No extra files.</p>
        )}
      </Card>
    </section>
  );
}

export function HandoverTab() {
  const { project, propertyId, patchItem, readOnly } = useProject();
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
  const verifiable = project.handoverItems.filter(bulkVerifiable);
  // "Select all" leaves out uploads through a withdrawn link: they may have come from the wrong person.
  const safe = verifiable.filter((i) => !i.files.some((f) => earlierLink(f.inviteId, project.invites)?.status === "revoked"));
  // Keep the selection to items that can still be verified.
  const chosen = verifiable.filter((i) => selected.has(i.id));

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
        <StatCard label="Verified" value={counts.handoverVerified} tone="text-emerald-800" />
        <StatCard label="Awaiting verification" value={counts.handoverAwaitingVerification} tone="text-amber-900" />
        <StatCard label="Awaiting supply" value={counts.handoverAwaitingSupply} tone="text-amber-900" />
        <StatCard label="Needs replacing" value={counts.handoverRejected} tone={counts.handoverRejected ? "text-red-700" : "text-ink"} />
        <StatCard label="Not applicable" value={counts.handoverNotApplicable} tone="text-ink" />
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
        {verifiable.length && !readOnly ? (
          <div className="flex flex-wrap items-center gap-2">
            {safe.length ? (
              <button
                type="button"
                className="min-h-8 px-1 text-xs font-medium link-brand"
                onClick={() => setSelected(chosen.length >= safe.length ? new Set() : new Set(safe.map((i) => i.id)))}
              >
                {chosen.length >= safe.length ? "Clear selection" : `Select all ${safe.length} with files to verify`}
              </button>
            ) : null}
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
                  {items.filter((i) => i.status === "verified" || i.status === "not_applicable").length} of {plural(items.length, "document")} verified or not
                  applicable
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

      <ExtraFiles onPreview={setPreview} />

      <DecisionModal decision={decision} onClose={() => setDecision(null)} />
      <FilePreviewModal propertyId={propertyId} file={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
