// The project's events, newest first, grouped by day, with a filter by kind.

import { useId, useMemo, useState } from "react";
import type { OnboardingEvent, OnboardingEventKind } from "../../../shared/onboarding";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { selectClasses } from "../../components/Field";
import { Icon, type IconName } from "../../components/Icon";
import { useNow } from "../../hooks/useNow";
import { formatDate, formatTime, plural, timeAgo } from "../../lib/format";
import { useProject } from "./ProjectContext";

const KINDS: Record<OnboardingEventKind, { label: string; icon: IconName }> = {
  project: { label: "Project", icon: "clipboard" },
  task: { label: "Tasks", icon: "check" },
  section: { label: "Sections and reviews", icon: "approve" },
  handover: { label: "Handover review", icon: "folder" },
  upload: { label: "Uploads", icon: "upload" },
  invite: { label: "Invitations", icon: "link" },
  portal: { label: "Portal visits", icon: "globe" },
  golive: { label: "Go-live checks", icon: "flag" },
  approval: { label: "Approvals", icon: "shield" },
};

function dayLabel(iso: string, now: number): string {
  const date = new Date(iso);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return formatDate(iso);
}

function groupByDay(events: OnboardingEvent[], now: number): { day: string; events: OnboardingEvent[] }[] {
  const groups: { day: string; events: OnboardingEvent[] }[] = [];
  for (const event of events) {
    const day = dayLabel(event.at, now);
    const last = groups.at(-1);
    if (last?.day === day) last.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return groups;
}

export function ActivityTab() {
  const { project } = useProject();
  const now = useNow(60_000);
  const filterId = useId();
  const [kind, setKind] = useState<OnboardingEventKind | "all">("all");
  const kinds = useMemo(() => (Object.keys(KINDS) as OnboardingEventKind[]).filter((k) => project.events.some((e) => e.kind === k)), [project.events]);
  const events = useMemo(
    () => [...project.events].sort((a, b) => b.at.localeCompare(a.at)).filter((e) => kind === "all" || e.kind === kind),
    [project.events, kind],
  );
  const days = groupByDay(events, now);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full sm:w-64">
          <label htmlFor={filterId} className="mb-1 block text-xs font-medium text-muted">
            Show
          </label>
          <select id={filterId} value={kind} onChange={(e) => setKind(e.target.value as OnboardingEventKind | "all")} className={selectClasses("text-[13px]!", "h-9")}>
            <option value="all">Everything</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KINDS[k].label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted" aria-live="polite">
          {plural(events.length, "event")}
          {project.events.length >= 200 ? " (the latest 200)" : ""}
        </p>
      </div>

      {days.length === 0 ? (
        <Card>
          <EmptyState icon="clock" title="No activity yet" description="Every change to the project is recorded here with who made it." />
        </Card>
      ) : (
        <div className="space-y-6">
          {days.map(({ day, events: list }, index) => (
            <section key={day} aria-labelledby={`${filterId}-day-${index}`}>
              <h2 id={`${filterId}-day-${index}`} className="mb-2 text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
                {day}
              </h2>
              <Card>
                <ol className="divide-y divide-line">
                  {list.map((event) => {
                    const meta = KINDS[event.kind] ?? { label: event.kind, icon: "clock" as IconName };
                    return (
                      <li key={event.id} className="flex gap-3 px-4 py-3">
                        <span className="mt-0.5 grid size-7 shrink-0 place-items-center border border-line-strong bg-surface text-taupe">
                          <Icon name={meta.icon} className="size-3.5" label={meta.label} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] leading-snug text-ink [overflow-wrap:anywhere]">{event.summary}</p>
                          {event.detail ? <p className="mt-0.5 text-xs text-muted [overflow-wrap:anywhere]">{event.detail}</p> : null}
                        </div>
                        <time dateTime={event.at} title={new Date(event.at).toLocaleString("en-AU")} className="shrink-0 text-xs text-muted tabular-nums">
                          {day === "Today" ? timeAgo(event.at, now) : formatTime(event.at)}
                        </time>
                      </li>
                    );
                  })}
                </ol>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
