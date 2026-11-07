// The onboarding dashboard (PORTFOLIO / ONBOARDING), mirroring Peter King's Zoho Creator screen: one
// collapsible block per scheme being onboarded, each with its status line, links, the handover invitation
// card, the eight section cards and the Documents missing card; then a projects & approvals table.

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { OnboardingProject, OnboardingSummary } from "../../../shared/onboarding";
import { onboardingApi } from "../../api";
import { Badge } from "../../components/Badge";
import { Button, buttonClasses } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState, FormError } from "../../components/EmptyState";
import { SelectField, TextField } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { Modal } from "../../components/Modal";
import { Skeleton } from "../../components/Skeleton";
import { PropertyStatusPill } from "../../components/StatusBadges";
import { useToast } from "../../components/Toast";
import { usePolling } from "../../hooks/usePolling";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { plural } from "../../lib/format";
import { navigate, paths } from "../../router";
import { percentComplete, scopeLine, statusLine, withSection } from "./derive";
import { AddCompanyModal, AddOutgoingManagerModal } from "./Directory";
import { InvitationCard } from "./Invitation";
import { SectionGrid } from "./SectionCards";
import { ActingAs, Crumbs, ProjectStatusBadge, SampleChecklistBadge } from "./ui";

const REFRESH_MS = 60_000;

type ProjectRow = OnboardingSummary & { project: OnboardingProject };

function ProjectBlock({
  row,
  open,
  onToggle,
  onChanged,
  onProjectChange,
}: {
  row: ProjectRow;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onProjectChange: (project: OnboardingProject) => void;
}) {
  const { project } = row;
  const bodyId = useId();
  const pct = percentComplete(project.counts);
  const blockers = project.blockers.length;
  const linkClass = "text-[13px] font-semibold link-brand";

  return (
    <section aria-label={`SP ${row.spNumber} onboarding`}>
      <h2 className="border border-line bg-surface shadow-card">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex w-full items-start gap-3 px-5 py-4 text-left hover:bg-subtle sm:px-6"
        >
          <Icon name="chevronDown" className={cx("mt-1 size-4 shrink-0 text-ink transition-transform", !open && "-rotate-90")} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-6 font-semibold tracking-[0.04em] text-ink uppercase [overflow-wrap:anywhere]">
              SP{row.spNumber} · {project.name}
            </span>
            <span className="mt-0.5 block text-[13px] font-normal text-muted">
              {row.street}, {row.suburb} · {pct}% complete
              {blockers ? ` · ${plural(blockers, "item")} blocking go-live` : project.goLive === "approved" ? "" : " · ready for go-live approval"}
            </span>
          </span>
          <span className="hidden shrink-0 items-center gap-2 sm:flex">
            <ProjectStatusBadge status={project.status} />
          </span>
        </button>
      </h2>

      <div id={bodyId} hidden={!open} className="space-y-5 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <SampleChecklistBadge />
          <PropertyStatusPill status={row.buildingStatus} />
          {project.demo ? <Badge tone="neutral">Demo project</Badge> : null}
        </div>
        <p className="border-l-2 border-line-input bg-surface px-3 py-2 text-[13px] text-ink-soft">{statusLine(project)}</p>
        <p className="text-sm text-ink">{scopeLine(project.counts)}</p>
        <ul className="flex flex-wrap gap-x-5 gap-y-2">
          <li>
            <Link href={paths.onboardingProject(row.propertyId, "approvals")} className={linkClass}>
              Project &amp; final approvals
            </Link>
          </li>
          <li>
            <Link href={paths.onboardingProject(row.propertyId, "tasks")} className={linkClass}>
              All project tasks
            </Link>
          </li>
          <li>
            <Link href={paths.onboardingProject(row.propertyId, "handover")} className={linkClass}>
              All handover records
            </Link>
          </li>
          <li>
            <Link href={paths.onboardingProject(row.propertyId, "map")} className={linkClass}>
              Project map
            </Link>
          </li>
          <li>
            <Link href={paths.onboardingProject(row.propertyId)} className={cx(linkClass, "inline-flex items-center gap-1")}>
              Open project <Icon name="arrowRight" className="size-3.5" />
            </Link>
          </li>
        </ul>

        {open ? (
          <>
            <InvitationCard
              propertyId={row.propertyId}
              spNumber={row.spNumber}
              project={project}
              onChanged={onChanged}
              anchorId={`handover-invitation-${row.propertyId}`}
            />
            <SectionGrid
              propertyId={row.propertyId}
              project={project}
              onSectionChanged={(section) => {
                onProjectChange(withSection(project, section));
                onChanged();
              }}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}

function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map(({ propertyId, spNumber, suburb, project }) => {
        const reviewed = project.sections.filter((s) => s.review === "reviewed").length;
        const changes = project.sections.filter((s) => s.review === "changes_requested").length;
        const pct = percentComplete(project.counts);
        return (
          <li key={propertyId} className="grid gap-x-5 gap-y-2 px-5 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <Link href={paths.onboardingProject(propertyId)} className="text-sm font-semibold link-brand">
                SP {spNumber} · {suburb}
              </Link>
              <p className="mt-0.5 truncate text-xs text-muted">{project.name}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
              <ProjectStatusBadge status={project.status} />
              <span className="tabular-nums">{pct}% complete</span>
            </div>
            <div className="text-xs text-ink-soft">
              <p>
                {reviewed} of {project.sections.length} sections reviewed
                {changes ? <span className="font-medium text-red-700"> · {changes} changes requested</span> : null}
              </p>
              <p className="mt-0.5">
                {project.goLive === "approved" ? (
                  <span className="font-medium text-emerald-800">Go-live approved{project.closeout === "closed" ? " · closed out" : ""}</span>
                ) : project.blockers.length ? (
                  <span className="font-medium text-red-700">{plural(project.blockers.length, "blocker")}</span>
                ) : (
                  <span className="font-medium text-emerald-800">Ready for go-live approval</span>
                )}
              </p>
            </div>
            <Link href={paths.onboardingProject(propertyId, "approvals")} className={buttonClasses("secondary", "sm", "justify-self-start")}>
              Approvals
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Buildings without a project, the ones marked "onboarding" first. */
function candidatesFrom(list: OnboardingSummary[]): OnboardingSummary[] {
  return list.filter((s) => !s.project).sort((a, b) => Number(b.buildingStatus === "onboarding") - Number(a.buildingStatus === "onboarding"));
}

export function StartOnboardingModal({
  open,
  onClose,
  candidates,
  fixed,
}: {
  open: boolean;
  onClose: () => void;
  candidates: Pick<OnboardingSummary, "propertyId" | "spNumber" | "suburb" | "street" | "buildingStatus">[];
  /** Start for this building only (the project page's "no project yet" state). */
  fixed?: string;
}) {
  const toast = useToast();
  const [propertyId, setPropertyId] = useState("");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setPropertyId(fixed ?? candidates[0]?.propertyId ?? "");
    setName("");
    setTarget("");
    setError(null);
    // Reset when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = candidates.find((c) => c.propertyId === propertyId) ?? null;

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (!propertyId) return;
    setBusy(true);
    setError(null);
    try {
      const project = await onboardingApi.create(propertyId, { name: name.trim() || undefined, targetGoLiveDate: target || null });
      toast.success("Onboarding started", project.name);
      navigate(paths.onboardingProject(propertyId));
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
      title="Start onboarding"
      description="Creates the project from the onboarding checklist: 8 sections of tasks, the handover schedule and the go-live checks."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="start-onboarding-form" loading={busy} disabled={!propertyId}>
            Start onboarding
          </Button>
        </>
      }
    >
      <form id="start-onboarding-form" onSubmit={start} className="space-y-4">
        {candidates.length === 0 ? (
          <p className="text-sm text-ink-soft">Every building already has an onboarding project.</p>
        ) : fixed ? (
          <p className="text-sm text-ink">
            SP {chosen?.spNumber}, {chosen?.street}, {chosen?.suburb}
          </p>
        ) : (
          <SelectField label="Scheme" value={propertyId} onChange={(e) => setPropertyId(e.target.value)} required>
            {candidates.map((c) => (
              <option key={c.propertyId} value={c.propertyId}>
                SP {c.spNumber} · {c.street ? `${c.street}, ` : ""}
                {c.suburb}
                {c.buildingStatus === "onboarding" ? " (onboarding)" : ""}
              </option>
            ))}
          </SelectField>
        )}
        <TextField
          label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={chosen ? `SP${chosen.spNumber} – Onboarding` : undefined}
          hint="Leave blank for the standard name."
          autoComplete="off"
        />
        <TextField label="Target go-live date" type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        <FormError error={error} />
      </form>
    </Modal>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading onboarding projects">
      {[0, 1].map((i) => (
        <Card key={i} className="p-5">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-3 h-3 w-1/3" />
          {i === 0 ? (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, j) => (
                <Skeleton key={j} className="h-48" />
              ))}
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

export function OnboardingDashboard() {
  const list = useResource("onboarding:list", onboardingApi.list);
  usePolling(() => void list.reload(), REFRESH_MS);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [starting, setStarting] = useState(false);
  const [adding, setAdding] = useState<"company" | "manager" | null>(null);
  const tableRef = useRef<HTMLHeadingElement>(null);

  const rows = useMemo(() => (list.data ?? []).filter((s): s is ProjectRow => !!s.project), [list.data]);
  const candidates = useMemo(() => candidatesFrom(list.data ?? []), [list.data]);
  // The first project is open by default; the rest start collapsed.
  const isOpen = (row: ProjectRow, index: number) => expanded[row.propertyId] ?? index === 0;

  const reload = () => void list.reload();
  const replaceProject = (propertyId: string, project: OnboardingProject) =>
    list.mutate((all = []) => all.map((s) => (s.propertyId === propertyId ? { ...s, project } : s)));

  const linkClass = "text-[13px] font-semibold link-brand";

  return (
    <>
      <Crumbs items={[{ label: "Portfolio", href: paths.portfolio() }, { label: "Onboarding" }]} />
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl flex-[1_1_20rem]">
          <h1 className="heading-display text-[26px] leading-[1.05] text-ink sm:text-[34px]">Onboarding dashboard</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Track each scheme from records transfer to operational readiness. Open a project to review its eight onboarding sections, owners and
            outstanding documents.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <a
              href="#projects-approvals"
              onClick={(e) => {
                e.preventDefault();
                tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                tableRef.current?.focus({ preventScroll: true });
              }}
              className={buttonClasses("primary", "md")}
            >
              View projects &amp; approvals
            </a>
            <Button variant="secondary" icon="plus" onClick={() => setStarting(true)} disabled={!list.data}>
              Start onboarding
            </Button>
          </div>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2" aria-label="Directories">
            <li>
              <Link href={paths.onboardingDirectory("companies")} className={linkClass}>
                Management company directory
              </Link>
            </li>
            <li>
              <button type="button" onClick={() => setAdding("company")} className={linkClass}>
                Add company
              </button>
            </li>
            <li>
              <Link href={paths.onboardingDirectory("outgoing-managers")} className={linkClass}>
                Outgoing manager directory
              </Link>
            </li>
            <li>
              <button type="button" onClick={() => setAdding("manager")} className={linkClass}>
                Add outgoing manager
              </button>
            </li>
          </ul>
        </div>
        <ActingAs />
      </header>

      {list.loading ? (
        <DashboardSkeleton />
      ) : list.error ? (
        <Card>
          <ErrorState error={list.error} onRetry={reload} title="Couldn't load the onboarding projects" />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="clipboard"
            title="No schemes are being onboarded"
            description="When Ikon wins a scheme, start its onboarding project here: the checklist, the handover link for the outgoing manager and the go-live checks."
            action={
              <Button variant="primary" icon="plus" onClick={() => setStarting(true)}>
                Start onboarding
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {rows.map((row, index) => (
            <ProjectBlock
              key={row.propertyId}
              row={row}
              open={isOpen(row, index)}
              onToggle={() => setExpanded((e) => ({ ...e, [row.propertyId]: !isOpen(row, index) }))}
              onChanged={reload}
              onProjectChange={(project) => replaceProject(row.propertyId, project)}
            />
          ))}
        </div>
      )}

      {list.data ? (
        <section aria-labelledby="projects-approvals" className="mt-10">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <h2 id="projects-approvals" ref={tableRef} tabIndex={-1} className="scroll-mt-20 heading-display text-[15px] leading-6 text-ink outline-none">
              Projects &amp; approvals
            </h2>
            <p className="text-xs text-muted">
              {plural(rows.length, "project")} · {plural(candidates.length, "building")} not onboarding
            </p>
          </div>
          <Card>
            {rows.length ? (
              <ProjectsTable rows={rows} />
            ) : (
              <EmptyState compact icon="approve" title="No projects yet" description="Projects appear here once onboarding starts." />
            )}
          </Card>
        </section>
      ) : null}

      <StartOnboardingModal open={starting} onClose={() => setStarting(false)} candidates={candidates} />
      <AddCompanyModal open={adding === "company"} onClose={() => setAdding(null)} onSaved={() => setAdding(null)} />
      <AddOutgoingManagerModal open={adding === "manager"} onClose={() => setAdding(null)} onSaved={() => setAdding(null)} />
    </>
  );
}
