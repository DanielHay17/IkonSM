// "Connect to OneDrive" on a building's Files tab: the setup guide for a Microsoft 365 admin, the
// sign-in (a top-level navigation, so the CSP never has to allow Microsoft), and the picker that imports
// files from OneDrive or a SharePoint document library into this building.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { VAULT_FOLDERS, type OneDriveAccount, type OneDriveImportResult, type OneDriveItem, type OneDriveSource } from "../../../shared/types";
import { ApiError, api, type OneDriveLocation } from "../../api";
import { Button, buttonClasses } from "../../components/Button";
import { CopyButton } from "../../components/CopyButton";
import { EmptyState, ErrorState } from "../../components/EmptyState";
import { SelectField } from "../../components/Field";
import { Icon, type IconName } from "../../components/Icon";
import { Modal } from "../../components/Modal";
import { SkeletonList } from "../../components/Skeleton";
import { useToast } from "../../components/Toast";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { formatBytes, formatDate, plural } from "../../lib/format";
import { paths } from "../../router";
import { useBuilding } from "./BuildingContext";

/** The Worker's limit for one file (MAX_UPLOAD_BYTES); larger files can't be selected. */
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const CALLBACK_PATH = "/api/integrations/onedrive/callback";

const SOURCES: { key: OneDriveSource; label: string; icon: IconName }[] = [
  { key: "me", label: "My files", icon: "cloud" },
  { key: "sites", label: "SharePoint", icon: "globe" },
];

const KIND_ICONS: Record<OneDriveItem["kind"], IconName> = { site: "globe", drive: "library", folder: "folder", file: "file" };

// ---------------------------------------------------------------------------
// The header button: setup guide, sign-in, or the picker
// ---------------------------------------------------------------------------

export function OneDriveButton({ defaultFolder, onImported }: { defaultFolder: string; onImported: () => void }) {
  const { propertyId } = useBuilding();
  const toast = useToast();
  const status = useResource("onedrive:status", () => api.onedriveStatus());
  const [open, setOpen] = useState<"setup" | "picker" | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const { reload } = status;
  const onConnectionChanged = useCallback(() => void reload(), [reload]);

  const connected = status.data?.connected === true;
  const account = status.data?.account ?? null;

  // Microsoft stopped accepting the sign-in while the picker was open: close it and say why.
  useEffect(() => {
    if (open !== "picker" || !status.data || status.data.connected) return;
    setOpen(null);
    toast.info("OneDrive needs connecting again", "Choose Connect to OneDrive to sign in to Microsoft 365.");
  }, [open, status.data, toast]);

  let button: ReactNode;
  if (status.loading) {
    button = (
      <Button icon="cloud" loading>
        Connect to OneDrive
      </Button>
    );
  } else if (connected) {
    button = (
      <Button icon="cloud" onClick={() => setOpen("picker")}>
        Import from OneDrive
      </Button>
    );
  } else if (status.data?.configured) {
    // A real navigation: the sign-in leaves the hub for Microsoft and comes back to this tab.
    button = (
      <a href={api.onedriveConnectUrl(paths.building(propertyId, "files"))} className={buttonClasses("secondary", "md")}>
        <Icon name="cloud" className="size-4" />
        Connect to OneDrive
      </a>
    );
  } else if (status.error) {
    button = (
      <Button
        icon="cloud"
        onClick={() => {
          toast.error("Couldn't check the OneDrive connection", status.error);
          void reload();
        }}
      >
        Connect to OneDrive
      </Button>
    );
  } else {
    button = (
      <Button icon="cloud" onClick={() => setOpen("setup")}>
        Connect to OneDrive
      </Button>
    );
  }

  return (
    <>
      {button}
      <OneDriveSetupModal open={open === "setup"} onClose={close} />
      <OneDrivePicker
        open={open === "picker"}
        onClose={close}
        account={account}
        defaultFolder={defaultFolder}
        onImported={onImported}
        onConnectionChanged={onConnectionChanged}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Setup guide (shown until MS_CLIENT_ID and MS_CLIENT_SECRET are set)
// ---------------------------------------------------------------------------

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center bg-accent text-xs font-semibold text-white tabular-nums">
        {n}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="font-medium text-ink">{title}</p>
        <div className="mt-1 text-[13px] leading-relaxed text-ink-soft">{children}</div>
      </div>
    </li>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-sm bg-sunken px-1 py-0.5 font-mono text-[12px] text-ink">{children}</code>;
}

function OneDriveSetupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const redirectUri = `${window.location.origin}${CALLBACK_PATH}`;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Connect to OneDrive"
      description="A one-time setup for an Ikon Microsoft 365 admin. Staff can then import building records from OneDrive and SharePoint."
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <ol className="space-y-5" aria-label="Setup steps">
        <Step n={1} title="Register the hub with Microsoft">
          In the <strong>Microsoft Entra admin centre</strong>, open <strong>App registrations → New registration</strong>. Name it{" "}
          <strong>IKON SM Command Hub</strong>. Under supported account types, choose{" "}
          <strong>accounts in any organisational directory and personal Microsoft accounts</strong>.
        </Step>
        <Step n={2} title="Add the redirect URI">
          Under <strong>Redirect URI</strong>, choose the <strong>Web</strong> platform and enter exactly:
          <span className="mt-2 flex items-center gap-1 border border-line bg-subtle py-1 pr-1 pl-3">
            <code className="min-w-0 flex-1 font-mono text-[12px] break-all text-ink">{redirectUri}</code>
            <CopyButton text={redirectUri} label="Copy redirect URI" />
          </span>
        </Step>
        <Step n={3} title="Create a client secret">
          In <strong>Certificates &amp; secrets</strong>, choose <strong>New client secret</strong>. Copy its <strong>Value</strong> straight away:
          Microsoft only shows it once.
        </Step>
        <Step n={4} title="Allow the hub to read files">
          In <strong>API permissions</strong>, choose <strong>Add a permission → Microsoft Graph → Delegated permissions</strong> and add{" "}
          <Code>Files.Read.All</Code>, <Code>Sites.Read.All</Code>, <Code>User.Read</Code> and <Code>offline_access</Code>. If your
          organisation asks for it, choose <strong>Grant admin consent</strong>.
        </Step>
        <Step n={5} title="Give the hub the ID and secret">
          Add the <strong>Application (client) ID</strong> from the app's Overview page and the secret value as Worker secrets{" "}
          <Code>MS_CLIENT_ID</Code> and <Code>MS_CLIENT_SECRET</Code>: Cloudflare dashboard →{" "}
          <strong>Workers &amp; Pages → ikonsm → Settings → Variables and Secrets</strong>. Then reload this page and choose{" "}
          <strong>Connect to OneDrive</strong> again.
        </Step>
      </ol>
      <p className="mt-6 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        The hub only reads files, and only when a member of staff imports them. To accept Ikon's own accounts only, also add{" "}
        <Code>MS_TENANT</Code> with the Directory (tenant) ID from the app's Overview page.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Picker
// ---------------------------------------------------------------------------

interface Crumb {
  label: string;
  location: OneDriveLocation;
}

function rootCrumb(source: OneDriveSource): Crumb {
  return { label: SOURCES.find((s) => s.key === source)?.label ?? "My files", location: { source } };
}

/** Where opening a site, library or folder leads. */
function locationOf(item: OneDriveItem, source: OneDriveSource): OneDriveLocation {
  if (item.kind === "site") return { source, siteId: item.id };
  if (item.kind === "drive") return { source, siteId: item.siteId, driveId: item.id };
  return { source, siteId: item.siteId, driveId: item.driveId ?? undefined, itemId: item.id };
}

const selectionKey = (item: OneDriveItem) => `${item.driveId}:${item.id}`;
const canImport = (item: OneDriveItem) => item.kind === "file" && item.driveId !== null && (item.size ?? 0) <= MAX_IMPORT_BYTES;

interface PickerProps {
  open: boolean;
  onClose: () => void;
  account: OneDriveAccount | null;
  defaultFolder: string;
  onImported: () => void;
  /** The connection was dropped (disconnected here, or Microsoft no longer accepts it). */
  onConnectionChanged: () => void;
}

function OneDrivePicker({ open, onClose, account, defaultFolder, onImported, onConnectionChanged }: PickerProps) {
  const { propertyId, reloadOverview } = useBuilding();
  const toast = useToast();
  const [trail, setTrail] = useState<Crumb[]>(() => [rootCrumb("me")]);
  const [selected, setSelected] = useState<Map<string, OneDriveItem>>(() => new Map());
  const [folder, setFolder] = useState(defaultFolder);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<OneDriveImportResult[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  /** A toast held back while the picker stays open: the dialog sits above the toasts, so it would go unseen. */
  const heldToast = useRef<{ title: string; description: string } | null>(null);
  const busy = progress !== null;

  // Every opening starts afresh, filing into the folder the Files tab is showing.
  useEffect(() => {
    if (!open) return;
    setTrail([rootCrumb("me")]);
    setSelected(new Map());
    setFolder(defaultFolder);
    setResults([]);
    setSummary(null);
  }, [open, defaultFolder]);

  const close = () => {
    if (heldToast.current) toast.success(heldToast.current.title, heldToast.current.description);
    heldToast.current = null;
    onClose();
  };

  const here = trail[trail.length - 1]!;
  const source = here.location.source;
  const listing = useResource(open ? `onedrive:browse:${JSON.stringify(here.location)}` : null, () => api.onedriveBrowse(here.location));

  useEffect(() => {
    if (listing.error instanceof ApiError && listing.error.status === 409) onConnectionChanged();
  }, [listing.error, onConnectionChanged]);

  const items = listing.data?.items ?? [];
  const importable = useMemo(() => items.filter(canImport), [items]);

  const toggle = (item: OneDriveItem) =>
    setSelected((current) => {
      const next = new Map(current);
      const key = selectionKey(item);
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return next;
    });

  const toggleAll = (on: boolean) =>
    setSelected((current) => {
      const next = new Map(current);
      for (const item of importable) {
        if (on) next.set(selectionKey(item), item);
        else next.delete(selectionKey(item));
      }
      return next;
    });

  const runImport = async () => {
    const queue = [...selected.values()];
    if (!queue.length) return;
    const done: OneDriveImportResult[] = [];
    setResults([]);
    setSummary(null);
    setProgress({ done: 0, total: queue.length });
    // One file per request: a progress count staff can watch, and a slow file can't time out the rest.
    for (const item of queue) {
      const ref = { driveId: item.driveId ?? "", itemId: item.id };
      try {
        const { results: answered } = await api.importFromOneDrive(propertyId, [ref], folder);
        done.push(...answered.map((r) => ({ ...r, name: r.name ?? item.name })));
      } catch (err) {
        done.push({ ...ref, status: "failed", name: item.name, reason: err instanceof Error ? err.message : "Import failed", docId: null });
      }
      setProgress({ done: done.length, total: queue.length });
      setResults([...done]);
    }
    setProgress(null);
    finishImport(done);
  };

  /**
   * All imported: close and say so in a toast. Otherwise stay open with the per-file list (and a summary
   * line), keeping only the failed files selected so they can be retried; the toast follows on close.
   */
  const finishImport = (done: OneDriveImportResult[]) => {
    const imported = done.filter((r) => r.status === "imported");
    const missed = done.length - imported.length;
    if (imported.length) {
      onImported();
      void reloadOverview();
    }
    const title = `Imported ${plural(imported.length, "file")} from OneDrive`;
    if (!missed) {
      toast.success(title, `Filed in ${folder}`);
      onClose();
      return;
    }
    heldToast.current = imported.length ? { title, description: `Filed in ${folder}. ${missed} not imported.` } : null;
    setSummary(
      `${imported.length ? `Imported ${plural(imported.length, "file")} into ${folder}. ` : "Nothing was imported. "}` +
        `${plural(missed, "file")} ${missed === 1 ? "was" : "were"} not imported: see below.`,
    );
    const retry = new Set(done.filter((r) => r.status === "failed").map((r) => `${r.driveId}:${r.itemId}`));
    setSelected((current) => new Map([...current].filter(([key]) => retry.has(key))));
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await api.onedriveDisconnect();
      heldToast.current = null;
      toast.success("OneDrive disconnected", "Connect again at any time from a building's Files tab.");
      onClose();
      onConnectionChanged();
    } catch (err) {
      toast.error("Couldn't disconnect OneDrive", err);
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : close}
      size="xl"
      title="Import from OneDrive"
      description="Choose files from OneDrive or a SharePoint document library. They are copied into this building's files and indexed for the agent."
      footer={
        <>
          <div className="mr-auto flex min-w-0 items-center gap-2 text-xs text-muted">
            <Icon name="cloud" className="size-4 text-taupe" />
            <span className="min-w-0 truncate">
              {account ? (
                <>
                  Connected as <span className="font-medium text-ink">{account.name}</span>
                  {account.email && account.email !== account.name ? ` (${account.email})` : ""}
                </>
              ) : (
                "Not connected"
              )}
            </span>
            <Button size="xs" variant="dangerQuiet" onClick={disconnect} loading={disconnecting} disabled={busy}>
              Disconnect
            </Button>
          </div>
          <Button variant="secondary" onClick={close} disabled={busy}>
            {results.length ? "Close" : "Cancel"}
          </Button>
          <Button variant="primary" icon="download" onClick={runImport} loading={busy} disabled={selected.size === 0}>
            {progress ? `Importing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : selected.size ? `Import ${plural(selected.size, "file")}` : "Import"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SourceSwitch source={source} disabled={busy} onChange={(next) => setTrail([rootCrumb(next)])} />
          <SelectField label="File into" value={folder} onChange={(e) => setFolder(e.target.value)} disabled={busy} fieldClassName="min-w-[220px] flex-1 sm:max-w-xs">
            {VAULT_FOLDERS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </SelectField>
        </div>

        <Breadcrumbs trail={trail} disabled={busy} onSelect={(index) => setTrail((t) => t.slice(0, index + 1))} />

        <div className="border border-line">
          {listing.loading ? (
            <SkeletonList rows={5} />
          ) : listing.error ? (
            <ErrorState error={listing.error} onRetry={listing.reload} title="Couldn't open this location" compact />
          ) : items.length ? (
            <ItemTable
              items={items}
              caption={here.label}
              selected={selected}
              importable={importable}
              disabled={busy}
              onOpen={(item) => setTrail((t) => [...t, { label: item.name, location: locationOf(item, source) }])}
              onToggle={toggle}
              onToggleAll={toggleAll}
            />
          ) : (
            <EmptyState compact icon={source === "sites" && trail.length === 1 ? "globe" : "folder"} title="Nothing here" description={emptyMessage(here, trail.length)} />
          )}
        </div>
        {listing.data?.truncated ? (
          <p className="text-xs text-muted">Showing the first {listing.data.items.length} items. Open a folder to narrow it down.</p>
        ) : null}

        {progress ? <ImportProgress done={progress.done} total={progress.total} /> : null}
        {summary ? (
          <p role="status" className="border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            {summary}
          </p>
        ) : null}
        {results.length ? <ImportResults results={results} /> : null}
      </div>
    </Modal>
  );
}

function emptyMessage(here: Crumb, depth: number): string {
  if (here.location.source === "sites" && depth === 1) return "This account can't see any SharePoint sites.";
  return "This folder has no files or folders.";
}

function SourceSwitch({ source, disabled, onChange }: { source: OneDriveSource; disabled: boolean; onChange: (s: OneDriveSource) => void }) {
  return (
    <div role="group" aria-label="Where to look" className="inline-flex border border-line-input">
      {SOURCES.map((s) => {
        const active = s.key === source;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(s.key)}
            className={cx(
              "inline-flex h-10 items-center gap-2 px-4 text-[13px] font-medium transition-colors disabled:cursor-not-allowed",
              active ? "bg-accent text-white" : "bg-surface text-ink-soft hover:bg-subtle hover:text-ink",
            )}
          >
            <Icon name={s.icon} className="size-4" />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function Breadcrumbs({ trail, disabled, onSelect }: { trail: Crumb[]; disabled: boolean; onSelect: (index: number) => void }) {
  return (
    <nav aria-label="Location">
      <ol className="flex flex-wrap items-center gap-1 text-[13px]">
        {trail.map((crumb, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={`${index}-${crumb.label}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <span aria-hidden="true" className="text-muted">
                  /
                </span>
              ) : null}
              {last ? (
                <span aria-current="location" className="truncate font-medium text-ink">
                  {crumb.label}
                </span>
              ) : (
                <button type="button" disabled={disabled} onClick={() => onSelect(index)} className="truncate link-brand disabled:cursor-not-allowed">
                  {crumb.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

interface ItemTableProps {
  items: OneDriveItem[];
  caption: string;
  selected: Map<string, OneDriveItem>;
  importable: OneDriveItem[];
  disabled: boolean;
  onOpen: (item: OneDriveItem) => void;
  onToggle: (item: OneDriveItem) => void;
  onToggleAll: (on: boolean) => void;
}

function ItemTable({ items, caption, selected, importable, disabled, onOpen, onToggle, onToggleAll }: ItemTableProps) {
  const idPrefix = useId();
  const chosenHere = importable.filter((item) => selected.has(selectionKey(item))).length;
  const allChosen = importable.length > 0 && chosenHere === importable.length;

  return (
    <table className="w-full table-fixed text-left text-[13px]">
      <caption className="sr-only">Contents of {caption}</caption>
      <thead className="border-b border-line bg-subtle text-xs text-muted">
        <tr>
          <th scope="col" className="w-10 py-2 pl-3">
            {importable.length ? (
              <input
                type="checkbox"
                aria-label="Select every file here"
                checked={allChosen}
                ref={(el) => {
                  if (el) el.indeterminate = chosenHere > 0 && !allChosen;
                }}
                disabled={disabled}
                onChange={(e) => onToggleAll(e.target.checked)}
                className="size-4 accent-[#292929]"
              />
            ) : (
              <span className="sr-only">Select</span>
            )}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Name
          </th>
          <th scope="col" className="w-24 py-2 pr-3 text-right font-medium">
            Size
          </th>
          <th scope="col" className="hidden w-28 py-2 pr-3 font-medium sm:table-cell">
            Modified
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {items.map((item) => {
          const key = selectionKey(item);
          const inputId = `${idPrefix}-${key}`;
          const isFile = item.kind === "file";
          const allowed = canImport(item);
          return (
            <tr key={key} className={cx(selected.has(key) && "bg-accent-soft/60")}>
              <td className="py-2.5 pl-3 align-middle">
                {isFile ? (
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={selected.has(key)}
                    disabled={disabled || !allowed}
                    onChange={() => onToggle(item)}
                    className="size-4 accent-[#292929]"
                  />
                ) : null}
              </td>
              <td className="py-2.5 pr-3 align-middle">
                {isFile ? (
                  <label htmlFor={inputId} className={cx("flex min-w-0 items-center gap-2", allowed ? "cursor-pointer text-ink" : "text-muted")}>
                    <Icon name={KIND_ICONS[item.kind]} className="size-4 text-taupe" />
                    <span className="min-w-0">
                      <span className="block truncate" title={item.name}>
                        {item.name}
                      </span>
                      {!allowed ? <span className="block text-xs text-muted">Over 25 MB: too large to import</span> : null}
                    </span>
                  </label>
                ) : (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onOpen(item)}
                    className="flex max-w-full min-w-0 items-center gap-2 text-left font-medium text-ink hover:underline disabled:cursor-not-allowed"
                  >
                    <Icon name={KIND_ICONS[item.kind]} className="size-4 text-taupe" />
                    <span className="truncate" title={item.name}>
                      {item.name}
                    </span>
                    <span className="sr-only">, open {item.kind === "site" ? "site" : item.kind === "drive" ? "library" : "folder"}</span>
                    <Icon name="arrowRight" className="size-3.5 text-muted" />
                  </button>
                )}
              </td>
              <td className="py-2.5 pr-3 text-right whitespace-nowrap text-muted tabular-nums">{sizeLabel(item)}</td>
              <td className="hidden py-2.5 pr-3 whitespace-nowrap text-muted sm:table-cell">{item.modified ? formatDate(item.modified) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function sizeLabel(item: OneDriveItem): string {
  if (item.kind === "folder") return item.childCount === null ? "—" : plural(item.childCount, "item");
  if (item.kind === "file") return item.size === null ? "—" : formatBytes(item.size);
  return "—";
}

function ImportProgress({ done, total }: { done: number; total: number }) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs text-muted">
        <span>Downloading and indexing…</span>
        <span className="tabular-nums">
          {done} of {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Import progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="h-1.5 w-full bg-sunken"
      >
        <div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

const RESULT_ICONS: Record<OneDriveImportResult["status"], { icon: IconName; tone: string; label: string }> = {
  imported: { icon: "check", tone: "text-emerald-600", label: "Imported" },
  skipped: { icon: "alert", tone: "text-amber-600", label: "Skipped" },
  failed: { icon: "alert", tone: "text-red-600", label: "Failed" },
};

function ImportResults({ results }: { results: OneDriveImportResult[] }) {
  return (
    <ul className="space-y-1.5" aria-live="polite" aria-label="Import results">
      {results.map((result) => {
        const look = RESULT_ICONS[result.status];
        return (
          <li key={`${result.driveId}:${result.itemId}`} className="flex items-center gap-2 text-[13px]">
            <Icon name={look.icon} className={cx("size-4", look.tone)} />
            <span className="min-w-0 flex-1 truncate text-ink">{result.name ?? result.itemId}</span>
            <span className={cx("shrink-0 text-xs", result.status === "failed" ? "text-red-700" : "text-muted")}>
              {look.label}
              {result.reason ? `: ${result.reason}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
