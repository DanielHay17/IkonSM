import { useEffect, useId, useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";
import { VAULT_FOLDERS, type DocMeta } from "../../../shared/types";
import { api } from "../../api";
import { Badge } from "../../components/Badge";
import { Button, IconButton, buttonClasses } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState } from "../../components/EmptyState";
import { inputClasses, selectClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { ConfirmDialog, Modal } from "../../components/Modal";
import { Highlight } from "../../components/RichText";
import { SkeletonList, SkeletonText } from "../../components/Skeleton";
import { CompanyPolicyBadge, IndexedBadge, SampleBadge } from "../../components/StatusBadges";
import { useToast } from "../../components/Toast";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { formatBytes, formatDateTime, plural, timeAgo } from "../../lib/format";
import { navigate, paths, useLocationSearch } from "../../router";
import { useBuilding } from "./BuildingContext";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const DEFAULT_UPLOAD_FOLDER = "07 Correspondence";
const ACCEPT = ".pdf,.docx,.txt,.md,.csv,.json,.html,.htm,.eml,.png,.jpg,.jpeg,.xlsx,.doc";

/** Folder filter: a vault folder, every document, or Ikon-wide policies. */
type FolderFilter = { kind: "all" } | { kind: "company" } | { kind: "folder"; folder: string };

interface UploadItem {
  key: string;
  name: string;
  status: "uploading" | "done" | "error";
  message?: string;
}

function filterDocs(docs: DocMeta[], filter: FolderFilter): DocMeta[] {
  const list =
    filter.kind === "all" ? docs : filter.kind === "company" ? docs.filter((d) => d.scope === "company") : docs.filter((d) => d.folder === filter.folder);
  return [...list].sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
}

function sameFilter(a: FolderFilter, b: FolderFilter): boolean {
  return a.kind === b.kind && (a.kind !== "folder" || (b.kind === "folder" && a.folder === b.folder));
}

// ---------------------------------------------------------------------------

function FolderTree({ docs, filter, onSelect }: { docs: DocMeta[]; filter: FolderFilter; onSelect: (f: FolderFilter) => void }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const doc of docs) map.set(doc.folder, (map.get(doc.folder) ?? 0) + 1);
    return map;
  }, [docs]);
  const extraFolders = [...counts.keys()].filter((f) => !(VAULT_FOLDERS as readonly string[]).includes(f)).sort();
  const companyCount = docs.filter((d) => d.scope === "company").length;

  const item = (key: string, label: string, count: number, target: FolderFilter, icon: "folder" | "grid" | "bookmark") => {
    const active = sameFilter(filter, target);
    return (
      <li key={key}>
        <button
          type="button"
          onClick={() => onSelect(target)}
          aria-current={active ? "true" : undefined}
          className={cx(
            "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
            active ? "bg-accent-soft font-medium text-accent-strong" : "text-ink-soft hover:bg-subtle hover:text-ink",
          )}
        >
          <Icon name={icon} className={cx("size-4", active ? "text-accent" : "text-muted")} />
          <span className="min-w-0 flex-1 truncate" title={label}>
            {label}
          </span>
          <span className="text-xs text-muted tabular-nums">{count}</span>
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="Vault folders">
      <ul className="space-y-0.5">
        {item("all", "All documents", docs.length, { kind: "all" }, "grid")}
        <li aria-hidden="true" className="my-2 border-t border-line" />
        {[...VAULT_FOLDERS, ...extraFolders].map((folder) => item(folder, folder, counts.get(folder) ?? 0, { kind: "folder", folder }, "folder"))}
        <li aria-hidden="true" className="my-2 border-t border-line" />
        {item("company", "Ikon company policies", companyCount, { kind: "company" }, "bookmark")}
      </ul>
    </nav>
  );
}

const FILTER_ALL = "__all__";
const FILTER_COMPANY = "__company__";

/** Compact folder picker used instead of the tree on small screens. */
function FolderSelect({ filter, onSelect }: { filter: FolderFilter; onSelect: (f: FolderFilter) => void }) {
  const value = filter.kind === "all" ? FILTER_ALL : filter.kind === "company" ? FILTER_COMPANY : filter.folder;
  const onChange = (next: string) =>
    onSelect(next === FILTER_ALL ? { kind: "all" } : next === FILTER_COMPANY ? { kind: "company" } : { kind: "folder", folder: next });
  return (
    <div className="lg:hidden">
      <label htmlFor="vault-folder-filter" className="mb-1.5 block text-[13px] font-medium text-ink-soft">
        Folder
      </label>
      <select id="vault-folder-filter" value={value} onChange={(e) => onChange(e.target.value)} className={selectClasses()}>
        <option value={FILTER_ALL}>All documents</option>
        {VAULT_FOLDERS.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
        <option value={FILTER_COMPANY}>Ikon company policies</option>
      </select>
    </div>
  );
}

function UploadPanel({ defaultFolder, onUploaded }: { defaultFolder: string; onUploaded: (doc: DocMeta) => void }) {
  const { propertyId, reloadOverview } = useBuilding();
  const toast = useToast();
  const folderId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [folder, setFolder] = useState(defaultFolder);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  useEffect(() => setFolder(defaultFolder), [defaultFolder]);

  const update = (key: string, patch: Partial<UploadItem>) => setUploads((list) => list.map((u) => (u.key === key ? { ...u, ...patch } : u)));

  const uploadAll = async (files: File[]) => {
    if (files.length === 0) return;
    const items = files.map((file) => ({ key: crypto.randomUUID(), name: file.name, status: "uploading" as const }));
    setUploads((list) => [...items, ...list].slice(0, 8));
    let succeeded = 0;
    for (const [i, file] of files.entries()) {
      const key = items[i]!.key;
      if (file.size > MAX_UPLOAD_BYTES) {
        update(key, { status: "error", message: "Larger than 25 MB" });
        continue;
      }
      try {
        const doc = await api.uploadDoc(propertyId, file, folder);
        onUploaded(doc);
        succeeded += 1;
        update(key, {
          status: "done",
          message: doc.indexed === "full" ? `Indexed ${doc.chars.toLocaleString("en-AU")} characters` : doc.indexed === "metadata" ? "Stored; name and folder searchable" : "Stored; text extraction failed",
        });
      } catch (err) {
        update(key, { status: "error", message: err instanceof Error ? err.message : "Upload failed" });
      }
    }
    if (succeeded) {
      toast.success(`Uploaded ${plural(succeeded, "document")}`, `Filed in ${folder}`);
      void reloadOverview();
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void uploadAll([...event.dataTransfer.files]);
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px] flex-1">
          <label htmlFor={folderId} className="mb-1.5 block text-[13px] font-medium text-ink-soft">
            Upload into folder
          </label>
          <select id={folderId} value={folder} onChange={(e) => setFolder(e.target.value)} className={selectClasses()}>
            {VAULT_FOLDERS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <Button icon="upload" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            void uploadAll([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "mt-3 flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft/60" : "border-line-strong bg-subtle/60",
        )}
      >
        <Icon name="upload" className={cx("size-6", dragging ? "text-accent" : "text-muted")} />
        <p className="mt-2 text-sm font-medium text-ink">Drop files here</p>
        <p className="mt-0.5 text-xs text-muted">PDF, Word (.docx), text, Markdown, CSV or HTML, up to 25 MB. Text is extracted and indexed for the agent.</p>
      </div>

      {uploads.length ? (
        <ul className="mt-3 space-y-1.5" aria-live="polite" aria-label="Uploads">
          {uploads.map((u) => (
            <li key={u.key} className="flex items-center gap-2 text-[13px]">
              {u.status === "uploading" ? (
                <span className="size-4 animate-spin rounded-full border-2 border-accent/25 border-t-accent" aria-hidden="true" />
              ) : (
                <Icon name={u.status === "done" ? "check" : "alert"} className={cx("size-4", u.status === "done" ? "text-emerald-600" : "text-red-600")} />
              )}
              <span className="min-w-0 flex-1 truncate text-ink">{u.name}</span>
              <span className={cx("shrink-0 text-xs", u.status === "error" ? "text-red-700" : "text-muted")}>
                {u.status === "uploading" ? "Uploading and indexing…" : u.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function DocRow({ doc, onView, onDelete, showFolder }: { doc: DocMeta; onView: () => void; onDelete: () => void; showFolder: boolean }) {
  const { propertyId } = useBuilding();
  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-subtle text-muted ring-1 ring-line">
        <Icon name="file" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onView} className="line-clamp-2 max-w-full text-left text-sm font-medium break-words text-ink hover:text-accent hover:underline">
          {doc.name}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <IndexedBadge indexed={doc.indexed} />
          {doc.sample ? <SampleBadge /> : null}
          {doc.scope === "company" ? <CompanyPolicyBadge /> : null}
          <span className="text-xs text-muted">
            {showFolder ? `${doc.folder} · ` : ""}
            {formatBytes(doc.size)} · <span title={formatDateTime(doc.uploadedAt)}>{timeAgo(doc.uploadedAt)}</span>
            {doc.uploadedBy ? ` by ${doc.uploadedBy}` : ""}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <IconButton icon="eye" label={`View text of ${doc.name}`} onClick={onView} />
        <a href={api.docDownloadUrl(propertyId, doc.id)} download className={buttonClasses("ghost", "sm", "w-8 px-0")} aria-label={`Download ${doc.name}`} title="Download">
          <Icon name="download" className="size-4" />
        </a>
        <IconButton icon="trash" label={`Delete ${doc.name}`} variant="dangerGhost" onClick={onDelete} />
      </div>
    </li>
  );
}

function DocViewer({ docId, onClose, onDelete }: { docId: string | null; onClose: () => void; onDelete: (doc: DocMeta) => void }) {
  const { propertyId } = useBuilding();
  const doc = useResource(docId ? `doctext:${propertyId}:${docId}` : null, () => api.docText(propertyId, docId ?? ""));
  const meta = doc.data?.meta;

  return (
    <Modal
      open={docId !== null}
      onClose={onClose}
      placement="right"
      size="lg"
      title={meta?.name ?? "Document"}
      description={
        meta ? (
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <span>{meta.folder}</span>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(meta.size)}</span>
            <IndexedBadge indexed={meta.indexed} />
            {meta.sample ? <SampleBadge /> : null}
            {meta.scope === "company" ? <CompanyPolicyBadge /> : null}
          </span>
        ) : null
      }
      footer={
        meta ? (
          <>
            <Button variant="dangerGhost" icon="trash" onClick={() => onDelete(meta)} className="mr-auto">
              Delete
            </Button>
            <a href={api.docDownloadUrl(propertyId, meta.id)} download className={buttonClasses("secondary", "md")}>
              <Icon name="download" className="size-4" /> Download original
            </a>
          </>
        ) : null
      }
    >
      {doc.loading ? (
        <SkeletonText lines={12} />
      ) : doc.error ? (
        <ErrorState error={doc.error} onRetry={doc.reload} compact />
      ) : doc.data?.text ? (
        <>
          {meta?.sample ? (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 ring-1 ring-amber-200 ring-inset">
              Sample document: replace it with the real record before relying on it.
            </p>
          ) : null}
          <pre className="font-sans text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink-soft">{doc.data.text}</pre>
        </>
      ) : (
        <EmptyState compact icon="file" title="No text extracted" description="Only the name and folder are searchable. Download the original to read it." />
      )}
    </Modal>
  );
}

function SearchResults({ query, onOpen }: { query: string; onOpen: (docId: string) => void }) {
  const { propertyId } = useBuilding();
  const hits = useResource(`search:${propertyId}:${query}`, () => api.search(propertyId, query));

  if (hits.loading) return <SkeletonList rows={4} />;
  if (hits.error) return <ErrorState error={hits.error} onRetry={hits.reload} compact />;
  if (!hits.data?.length) {
    return <EmptyState compact icon="search" title="No matches" description={`Nothing in this building's documents matches "${query}".`} />;
  }
  return (
    <ol className="divide-y divide-line" aria-label="Search results">
      {hits.data.map((hit, i) => (
        <li key={`${hit.docId}-${hit.chunkIndex}-${i}`}>
          <button type="button" onClick={() => onOpen(hit.docId)} className="block w-full px-4 py-3.5 text-left hover:bg-subtle">
            <span className="flex items-center gap-2">
              <Icon name="file" className="size-4 text-muted" />
              <span className="truncate text-sm font-medium text-ink">{hit.docName}</span>
              <span className="shrink-0 text-xs text-muted">{hit.folder}</span>
            </span>
            <span className="mt-1.5 line-clamp-3 block text-[13px] leading-relaxed text-ink-soft">
              <Highlight text={hit.snippet} query={query} />
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------

export function VaultTab() {
  const { propertyId, refreshKey, reloadOverview } = useBuilding();
  const toast = useToast();
  const search = useLocationSearch();
  const docs = useResource(`docs:${propertyId}`, () => api.docs(propertyId), refreshKey);
  const [filter, setFilter] = useState<FolderFilter>({ kind: "all" });
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DocMeta | null>(null);

  // Citations elsewhere link here with ?doc=<id> to open that document's text.
  useEffect(() => {
    const docId = new URLSearchParams(search).get("doc");
    if (docId) setViewing(docId);
  }, [search]);

  const closeViewer = () => {
    setViewing(null);
    if (new URLSearchParams(window.location.search).has("doc")) navigate(paths.building(propertyId, "vault"), { replace: true });
  };

  const visible = useMemo(() => filterDocs(docs.data ?? [], filter), [docs.data, filter]);
  const uploadFolder = filter.kind === "folder" && (VAULT_FOLDERS as readonly string[]).includes(filter.folder) ? filter.folder : DEFAULT_UPLOAD_FOLDER;
  const heading = filter.kind === "all" ? "All documents" : filter.kind === "company" ? "Ikon company policies" : filter.folder;

  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    setQuery(queryInput.trim());
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await api.deleteDoc(propertyId, deleting.id);
    docs.mutate((list = []) => list.filter((d) => d.id !== deleting.id));
    if (viewing === deleting.id) closeViewer();
    toast.success("Document deleted", deleting.name);
    void reloadOverview();
  };

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
      <Card className="hidden p-2 lg:sticky lg:top-6 lg:block">
        {docs.data ? <FolderTree docs={docs.data} filter={filter} onSelect={setFilter} /> : <SkeletonList rows={4} />}
      </Card>

      <div className="min-w-0 space-y-4">
        <FolderSelect filter={filter} onSelect={setFilter} />
        <form role="search" onSubmit={runSearch} className="flex gap-2">
          <label htmlFor="vault-search" className="sr-only">
            Search this building's documents
          </label>
          <div className="relative flex-1">
            <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              id="vault-search"
              type="search"
              value={queryInput}
              onChange={(e) => {
                setQueryInput(e.target.value);
                if (!e.target.value) setQuery("");
              }}
              placeholder="Search documents, e.g. water main, insurance excess, pets"
              className={inputClasses("pl-9!")}
            />
          </div>
          <Button type="submit" disabled={!queryInput.trim()}>
            Search
          </Button>
        </form>

        {query ? (
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">
                Results for <span className="text-accent-strong">“{query}”</span>
              </h2>
              <Button
                size="sm"
                variant="ghost"
                icon="close"
                onClick={() => {
                  setQuery("");
                  setQueryInput("");
                }}
              >
                Clear
              </Button>
            </div>
            <SearchResults query={query} onOpen={setViewing} />
          </Card>
        ) : null}

        <UploadPanel defaultFolder={uploadFolder} onUploaded={(doc) => docs.mutate((list = []) => [doc, ...list.filter((d) => d.id !== doc.id)])} />

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Icon name={filter.kind === "company" ? "bookmark" : "folder"} className="size-4 text-muted" />
              {heading}
            </h2>
            {docs.data ? <Badge tone="neutral">{plural(visible.length, "document")}</Badge> : null}
          </div>
          {docs.loading ? (
            <SkeletonList rows={5} />
          ) : docs.error ? (
            <ErrorState error={docs.error} onRetry={docs.reload} compact />
          ) : visible.length ? (
            <ul className="divide-y divide-line">
              {visible.map((doc) => (
                <DocRow key={doc.id} doc={doc} showFolder={filter.kind !== "folder"} onView={() => setViewing(doc.id)} onDelete={() => setDeleting(doc)} />
              ))}
            </ul>
          ) : (
            <EmptyState compact icon="folder" title="This folder is empty" description="Upload documents above so the agent can read and cite them." />
          )}
        </Card>
      </div>

      <DocViewer docId={viewing} onClose={closeViewer} onDelete={setDeleting} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete this document?"
        description={
          <>
            <span className="font-medium text-ink">{deleting?.name}</span> will be removed from the vault and the agent's index. This can't be undone.
          </>
        }
        confirmLabel="Delete document"
      />
    </div>
  );
}
