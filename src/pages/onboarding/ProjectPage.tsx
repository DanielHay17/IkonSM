// One scheme's onboarding project: the header block (name, SAMPLE checklist, status, progress, who you're
// acting as) and the tabs overview / tasks / handover / go-live / approvals / map / activity. The detail
// refetches whenever the building agent's live state version bumps (usePropertyLive).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatLongDate } from "../../../shared/handover-letter";
import type {
  GoLiveCheck,
  GoLiveCheckPatch,
  HandoverItem,
  HandoverItemPatch,
  OnboardingProjectDetail,
  OnboardingTask,
  TaskPatch,
} from "../../../shared/onboarding";
import { isNotFound, onboardingApi } from "../../api";
import { CountBubble } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState, ErrorState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { Skeleton } from "../../components/Skeleton";
import { TabNav, type TabItem } from "../../components/Tabs";
import { useToast } from "../../components/Toast";
import { usePropertyLive } from "../../hooks/usePropertyLive";
import { useResource } from "../../hooks/useResource";
import { propertyAddress } from "../../lib/format";
import { usePortfolio } from "../../providers/PortfolioProvider";
import { paths, type OnboardingTab } from "../../router";
import { withGoLiveCheck, withHandoverItem, withTask, percentComplete, statusLine } from "./derive";
import { ProjectContext, type ProjectContextValue } from "./ProjectContext";
import { StartOnboardingModal } from "./OnboardingDashboard";
import { ActingAs, Crumbs, ProgressBar, ProjectStatusBadge, SampleChecklistBadge, useActingStaff } from "./ui";
import { OverviewTab } from "./OverviewTab";
import { TasksTab } from "./TasksTab";
import { HandoverTab } from "./HandoverTab";
import { GoLiveTab } from "./GoLiveTab";
import { ApprovalsTab } from "./ApprovalsTab";
import { MapTab } from "./MapTab";
import { ActivityTab } from "./ActivityTab";

type Overlay =
  | { kind: "task"; value: OnboardingTask }
  | { kind: "item"; value: HandoverItem }
  | { kind: "check"; value: GoLiveCheck }
  /** A file action in flight (nothing to lay over: the project is refetched when it is saved). */
  | { kind: "file" };

const REFRESH_DEBOUNCE_MS = 700;

function overlay(detail: OnboardingProjectDetail, change: Overlay): OnboardingProjectDetail {
  if (change.kind === "task") return withTask(detail, change.value);
  if (change.kind === "item") return withHandoverItem(detail, change.value);
  if (change.kind === "check") return withGoLiveCheck(detail, change.value);
  return detail;
}

function tabItems(propertyId: string, project: OnboardingProjectDetail): TabItem<OnboardingTab>[] {
  const href = (tab: OnboardingTab) => paths.onboardingProject(propertyId, tab);
  const openTasks = project.counts.tasks - project.counts.tasksDone - project.counts.tasksExcluded;
  return [
    { key: "overview", label: "Overview", icon: "grid", href: href("overview") },
    {
      key: "tasks",
      label: "Tasks",
      icon: "check",
      href: href("tasks"),
      // All open tasks; the blockers line counts only those before go-live (not the closeout ones).
      adornment: <CountBubble count={openTasks} label="open, including closeout tasks" />,
    },
    {
      key: "handover",
      label: "Handover",
      icon: "folder",
      href: href("handover"),
      adornment: <CountBubble count={project.counts.handoverAwaitingVerification} label="awaiting verification" />,
    },
    {
      key: "golive",
      label: "Go-live",
      icon: "flag",
      href: href("golive"),
      adornment: (
        <span className="text-[11px] font-medium tracking-normal text-muted normal-case tabular-nums">
          {project.counts.goLiveVerified + project.counts.goLiveNotApplicable}/{project.counts.goLiveChecks}
          <span className="sr-only"> checks done</span>
        </span>
      ),
    },
    {
      key: "approvals",
      label: "Approvals",
      icon: "approve",
      href: href("approvals"),
      adornment: <CountBubble count={project.goLive === "approved" ? 0 : project.blockers.length} tone="red" label="blocking go-live" />,
    },
    { key: "map", label: "Map", icon: "route", href: href("map") },
    { key: "activity", label: "Activity", icon: "clock", href: href("activity") },
  ];
}

function ProjectHeader({ project, propertyId, address }: { project: OnboardingProjectDetail; propertyId: string; address: string | null }) {
  const pct = percentComplete(project.counts);
  const spNumber = propertyId.replace(/^sp-/i, "");
  return (
    <Card className="mb-6">
      <div className="px-5 py-4 sm:px-6 sm:py-5">
        <Crumbs items={[{ label: "Portfolio", href: paths.portfolio() }, { label: "Onboarding", href: paths.onboarding() }, { label: `SP ${spNumber}` }]} />
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-[1_1_20rem]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="heading-display text-[24px] leading-[1.1] text-ink [overflow-wrap:anywhere] sm:text-[30px]">{project.name}</h1>
              <SampleChecklistBadge />
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="mt-1.5 text-[15px] text-ink-soft">
              {address ?? `SP ${spNumber}`}
              <Link href={paths.building(propertyId)} className="ml-2.5 inline-flex items-center gap-1 align-middle text-[13px] font-medium link-brand">
                <Icon name="building" className="size-3.5" />
                Open building
              </Link>
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {statusLine(project)}
              {project.targetGoLiveDate ? ` · Target go-live ${formatLongDate(project.targetGoLiveDate)}` : ""}
            </p>
          </div>
          <ActingAs />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-sm font-semibold text-ink tabular-nums">{pct}% complete</p>
          <ProgressBar value={pct} label="Onboarding tasks complete" className="max-w-md min-w-[8rem] flex-1" />
          <p className="text-xs text-muted tabular-nums">
            {project.counts.tasksDone} done · {project.counts.tasksExcluded} excluded · {project.counts.tasks} tasks
          </p>
        </div>
      </div>
    </Card>
  );
}

function HeaderSkeleton() {
  return (
    <div role="status" aria-label="Loading the project">
      <Card className="mb-6 px-6 py-5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-3 h-7 w-80 max-w-full" />
        <Skeleton className="mt-3 h-4 w-64 max-w-full" />
        <Skeleton className="mt-5 h-2 w-full max-w-md" />
      </Card>
      <Skeleton className="mb-6 h-11 w-full" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    </div>
  );
}

function NoProject({ propertyId }: { propertyId: string }) {
  const card = usePortfolio().cardFor(propertyId);
  const [starting, setStarting] = useState(false);
  if (!card) {
    return (
      <EmptyState
        icon="building"
        title="Building not found"
        description={`There's no scheme "${propertyId}" in the portfolio.`}
        action={
          <Link href={paths.onboarding()} className="text-sm font-medium link-brand">
            Back to onboarding
          </Link>
        }
      />
    );
  }
  const { profile } = card;
  return (
    <>
      <Crumbs items={[{ label: "Portfolio", href: paths.portfolio() }, { label: "Onboarding", href: paths.onboarding() }, { label: `SP ${profile.spNumber}` }]} />
      <h1 className="heading-display mb-4 text-[24px] leading-[1.1] text-ink sm:text-[30px]">SP {profile.spNumber} onboarding</h1>
      <Card>
        <EmptyState
          icon="clipboard"
          title={`SP ${profile.spNumber} has no onboarding project`}
          description="Start one to track the records handover, set-up and go-live checks for this scheme."
          action={
            <Button variant="primary" icon="plus" onClick={() => setStarting(true)}>
              Start onboarding
            </Button>
          }
        />
      </Card>
      <StartOnboardingModal
        open={starting}
        onClose={() => setStarting(false)}
        fixed={propertyId}
        candidates={[{ propertyId, spNumber: profile.spNumber, street: profile.street, suburb: profile.suburb, buildingStatus: profile.status }]}
      />
    </>
  );
}

const TABS: Record<OnboardingTab, () => ReactNode> = {
  overview: () => <OverviewTab />,
  tasks: () => <TasksTab />,
  handover: () => <HandoverTab />,
  golive: () => <GoLiveTab />,
  approvals: () => <ApprovalsTab />,
  map: () => <MapTab />,
  activity: () => <ActivityTab />,
};

export function ProjectPage({ propertyId, tab }: { propertyId: string; tab: OnboardingTab }) {
  const toast = useToast();
  const portfolio = usePortfolio();
  const live = usePropertyLive(propertyId);
  const resource = useResource(`onboarding:${propertyId}`, () => onboardingApi.project(propertyId), live.refreshKey);
  const { name: actingName, staff: acting } = useActingStaff();
  const [pending, setPending] = useState<ReadonlyMap<string, Overlay>>(new Map());
  const profile = portfolio.cardFor(propertyId)?.profile ?? null;

  const { mutate, invalidate, reload } = resource;
  const refreshTimer = useRef<number | null>(null);
  const refresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void reload();
    }, REFRESH_DEBOUNCE_MS);
  }, [reload]);
  useEffect(() => () => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
  }, []);

  const project = useMemo(() => {
    if (!resource.data) return undefined;
    let detail = resource.data;
    for (const change of pending.values()) detail = overlay(detail, change);
    return detail;
  }, [resource.data, pending]);

  /** Shows `change` at once, saves it, then applies the server's copy, or drops the change and says why. */
  const save = useCallback(
    async <T extends Exclude<Overlay, { kind: "file" }>>(key: string, change: T, call: () => Promise<T["value"]>, failure: string, quiet = false): Promise<boolean> => {
      invalidate();
      setPending((map) => new Map(map).set(key, change));
      let ok = false;
      try {
        const saved = await call();
        // Responses to loads already in flight may predate this change: ignore them.
        invalidate();
        mutate((detail) => (detail ? overlay(detail, { ...change, value: saved } as Overlay) : detail!));
        ok = true;
      } catch (err) {
        if (!quiet) toast.error(failure, err);
      } finally {
        setPending((map) => {
          if (map.get(key) !== change) return map;
          const next = new Map(map);
          next.delete(key);
          return next;
        });
        refresh();
      }
      return ok;
    },
    [invalidate, mutate, refresh, toast],
  );

  const context = useMemo<ProjectContextValue | null>(() => {
    if (!project) return null;
    const now = () => new Date().toISOString();
    return {
      propertyId,
      project,
      profile,
      actingName,
      acting,
      saving: new Set(pending.keys()),
      patchTask: (task, patch: TaskPatch) => {
        const status = patch.status ?? task.status;
        const next: OnboardingTask = {
          ...task,
          ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
          completedBy: status === "done" ? (task.status === "done" ? task.completedBy : actingName) : null,
          completedAt: status === "done" ? (task.status === "done" ? task.completedAt : now()) : null,
          updatedAt: now(),
        };
        return save(`task:${task.id}`, { kind: "task", value: next }, () => onboardingApi.updateTask(propertyId, task.id, patch), `Couldn't update "${task.title}"`);
      },
      patchItem: (item, patch: HandoverItemPatch, options) => {
        const next: HandoverItem = {
          ...item,
          // Reopening a document that still has files sends it back for checking (as the server does).
          status: patch.status === "awaiting_supply" && item.files.length > 0 ? "awaiting_verification" : patch.status,
          notApplicableClaimed: false,
          reviewNote: patch.reviewNote !== undefined ? patch.reviewNote : item.reviewNote,
          verifiedBy: patch.status === "verified" ? actingName : null,
          verifiedAt: patch.status === "verified" ? now() : null,
          updatedAt: now(),
        };
        return save(
          `item:${item.id}`,
          { kind: "item", value: next },
          () => onboardingApi.updateHandoverItem(propertyId, item.id, patch),
          `Couldn't update "${item.title}"`,
          options?.quiet,
        );
      },
      patchCheck: (check, patch: GoLiveCheckPatch) => {
        const next: GoLiveCheck = {
          ...check,
          status: patch.status,
          note: patch.note !== undefined ? patch.note : check.note,
          checkedBy: patch.status === "open" ? null : actingName,
          checkedAt: patch.status === "open" ? null : now(),
        };
        return save(`check:${check.id}`, { kind: "check", value: next }, () => onboardingApi.updateGoLiveCheck(propertyId, check.id, patch), `Couldn't update "${check.title}"`);
      },
      patchFile: async (file, action, options) => {
        const key = `file:${file.docId}`;
        setPending((map) => new Map(map).set(key, { kind: "file" }));
        try {
          await onboardingApi.updateHandoverFile(propertyId, file.docId, action);
          invalidate();
          await reload();
          return true;
        } catch (err) {
          if (!options?.quiet) toast.error(action.action === "verify" ? `Couldn't verify "${file.name}"` : `Couldn't attach "${file.name}"`, err);
          return false;
        } finally {
          setPending((map) => {
            const next = new Map(map);
            next.delete(key);
            return next;
          });
        }
      },
      readOnly: project.status === "closed",
      apply: (update) => {
        invalidate();
        mutate((detail) => (detail ? update(detail) : detail!));
        refresh();
      },
      refresh,
    };
  }, [project, propertyId, profile, actingName, acting, pending, save, invalidate, mutate, refresh, reload, toast]);

  useEffect(() => {
    if (project) document.title = `${project.name} · Onboarding · IKON SM Command Hub`;
  }, [project]);

  // Deep links to a part of the overview (#handover-invitation, #handover-requests-…) once it has rendered.
  const ready = !!context;
  useEffect(() => {
    if (!ready || !window.location.hash) return;
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    target?.scrollIntoView({ block: "start" });
  }, [ready, tab]);

  if (!context) {
    if (resource.error && isNotFound(resource.error)) return <NoProject propertyId={propertyId} />;
    if (resource.error) return <ErrorState error={resource.error} onRetry={resource.reload} title="Couldn't load this onboarding project" />;
    return <HeaderSkeleton />;
  }

  return (
    <ProjectContext.Provider value={context}>
      <ProjectHeader project={context.project} propertyId={propertyId} address={profile ? propertyAddress(profile) : null} />
      <div className="mb-6">
        <TabNav label="Onboarding project" items={tabItems(propertyId, context.project)} active={tab} />
      </div>
      {context.readOnly ? (
        <p role="note" className="mb-5 flex items-start gap-2 border border-line bg-subtle px-4 py-3 text-[13px] text-ink-soft">
          <Icon name="lock" className="mt-0.5 size-4 shrink-0 text-taupe" />
          This project is closed out. It is kept as read-only history: tasks, documents, checks and links can't be changed.
        </p>
      ) : null}
      {TABS[tab]()}
    </ProjectContext.Provider>
  );
}
