// Every task of the project, by section then group. Each row: a checkbox to mark it done, a status menu,
// the owner (staff register, with initials), a due date and a note. Filters live in the URL so the section
// cards can link here (section, area, owner, status, "Mine"). Changes show at once and roll back on error.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  STAFF_DIRECTORY,
  STAFF_ROLE_LABELS,
  TASK_STATUS_LABELS,
  type OnboardingTask,
  type TaskStatus,
} from "../../../shared/onboarding";
import { formatLongDate } from "../../../shared/handover-letter";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { inputClasses, selectClasses, textareaClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { cx } from "../../lib/cx";
import { formatDate } from "../../lib/format";
import { navigate, paths, useLocationSearch } from "../../router";
import {
  NO_TASK_FILTERS,
  TASK_STATUS_FILTER_LABELS,
  filterTasks,
  groupTasks,
  hasTaskFilters,
  isOverdue,
  localDay,
  parseTaskFilters,
  staffName,
  taskFilterQuery,
  type TaskFilters,
  type TaskStatusFilter,
} from "./derive";
import { useProject } from "./ProjectContext";
import { ProgressText, StaffAvatar } from "./ui";

const STATUSES: TaskStatus[] = ["open", "done", "excluded", "cancelled"];
/** The "Showing N of M tasks" line: focus goes there when a change takes the row out of a filtered list. */
const SHOWING_ID = "tasks-showing";

/** After a change that may remove the row (a filtered list), keep keyboard focus on the page. */
function keepFocus() {
  requestAnimationFrame(() => {
    if (!document.activeElement || document.activeElement === document.body) document.getElementById(SHOWING_ID)?.focus();
  });
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClasses("text-[13px]! pr-8", "h-9")}>
        {children}
      </select>
    </div>
  );
}

function FilterBar({ filters, onChange, shown, total }: { filters: TaskFilters; onChange: (next: TaskFilters) => void; shown: number; total: number }) {
  const { project, acting } = useProject();
  const section = project.sections.find((s) => s.key === filters.section) ?? null;
  return (
    <div className="mb-5 space-y-3">
      <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <div className="col-span-2 sm:w-56">
          <FilterSelect label="Section" value={filters.section ?? ""} onChange={(v) => onChange({ ...filters, section: (v || null) as TaskFilters["section"], group: null })}>
            <option value="">All sections</option>
            {project.sections.map((s) => (
              <option key={s.key} value={s.key}>
                {s.title}
              </option>
            ))}
          </FilterSelect>
        </div>
        <div className="sm:w-48">
          {/* An owner and "Mine" are one choice: picking either replaces the other. */}
          <FilterSelect label="Owner" value={filters.mine ? (acting?.id ?? "") : (filters.owner ?? "")} onChange={(v) => onChange({ ...filters, owner: v || null, mine: false })}>
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {STAFF_DIRECTORY.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </FilterSelect>
        </div>
        <div className="sm:w-40">
          <FilterSelect label="Status" value={filters.status ?? ""} onChange={(v) => onChange({ ...filters, status: (v || null) as TaskStatusFilter | null })}>
            <option value="">Any status</option>
            {(Object.keys(TASK_STATUS_FILTER_LABELS) as TaskStatusFilter[]).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_FILTER_LABELS[s]}
              </option>
            ))}
          </FilterSelect>
        </div>
        <button
          type="button"
          aria-pressed={filters.mine}
          disabled={!acting}
          title={acting ? `Only tasks owned by ${acting.name}` : "Your sign-in name is not in the staff register"}
          onClick={() => onChange({ ...filters, mine: !filters.mine, owner: null })}
          className={cx(
            "inline-flex h-9 items-center justify-center gap-2 border px-3 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:text-muted",
            filters.mine ? "border-ink bg-accent text-white" : "border-line-input bg-surface text-ink hover:border-ink",
          )}
        >
          <StaffAvatar staffId={acting?.id} size="xs" className={filters.mine ? "bg-white! text-charcoal!" : undefined} />
          Mine
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-soft">
        <p id={SHOWING_ID} tabIndex={-1} aria-live="polite" className="focus:outline-none">
          Showing <span className="font-semibold text-ink tabular-nums">{shown}</span> of {total} tasks
          {section ? ` in ${section.title}` : ""}
        </p>
        {filters.group ? (
          <span className="inline-flex items-center gap-1 border border-line-strong bg-surface py-0.5 pr-0.5 pl-2 text-xs text-ink">
            Area: {filters.group}
            <button
              type="button"
              aria-label={`Show every area, not just ${filters.group}`}
              onClick={() => onChange({ ...filters, group: null })}
              className="grid size-5 place-items-center text-muted hover:bg-ink/5 hover:text-ink"
            >
              <Icon name="close" className="size-3" />
            </button>
          </span>
        ) : null}
        {hasTaskFilters(filters) ? (
          <button type="button" onClick={() => onChange(NO_TASK_FILTERS)} className="text-xs font-medium link-brand">
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Saves a typed date once it looks complete (a four-digit year from 2000), or on leaving the field. */
function DueDateInput({ task, onSave }: { task: OnboardingTask; onSave: (value: string | null) => void }) {
  const id = useId();
  const [value, setValue] = useState(task.dueDate ?? "");
  const timer = useRef<number | null>(null);
  useEffect(() => setValue(task.dueDate ?? ""), [task.dueDate]);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  const commit = (next: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if ((next || null) === task.dueDate) return;
    if (next && !/^20\d\d-\d\d-\d\d$/.test(next)) return;
    onSave(next || null);
  };
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="sr-only">
        Due date for {task.title}
      </label>
      <input
        id={id}
        type="date"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setValue(next);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => commit(next), 700);
        }}
        onBlur={() => commit(value)}
        className={inputClasses("text-[13px]! px-2!", "h-9")}
      />
    </div>
  );
}

function NoteEditor({ task, onSave, onClose }: { task: OnboardingTask; onSave: (note: string | null) => void; onClose: () => void }) {
  const id = useId();
  const [text, setText] = useState(task.note ?? "");
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(text.trim() || null);
        onClose();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Note for {task.title}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
        className={textareaClasses("text-[13px]!")}
      />
      <div className="flex gap-2">
        <Button type="submit" size="xs" variant="primary">
          Save note
        </Button>
        <Button size="xs" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * A select that saves on a pointer choice straight away, but holds keyboard changes on a closed menu (arrow
 * keys and type-ahead change the value at once in Chrome on Windows and Linux) until Enter or leaving it,
 * so stepping through the options doesn't save each one.
 */
function CommitSelect({
  id,
  value,
  onCommit,
  className,
  children,
}: {
  id: string;
  value: string;
  onCommit: (value: string) => void;
  className: string;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const keyed = useRef(false);
  const commit = (next: string) => {
    setDraft(null);
    if (next !== value) onCommit(next);
  };
  return (
    <select
      id={id}
      value={draft ?? value}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          if (draft !== null) {
            e.preventDefault();
            commit(draft);
          }
          return;
        }
        if (e.key === "Escape") {
          if (draft !== null) {
            e.preventDefault();
            setDraft(null);
          }
          return;
        }
        if (e.key === "Tab") return;
        keyed.current = true;
        window.setTimeout(() => (keyed.current = false), 0);
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (keyed.current) setDraft(next === value ? null : next);
        else commit(next);
      }}
      onBlur={() => {
        if (draft !== null) commit(draft);
      }}
      className={className}
    >
      {children}
    </select>
  );
}

function TaskRow({ task, today }: { task: OnboardingTask; today: string }) {
  const { patchTask, saving, readOnly } = useProject();
  const statusId = useId();
  const ownerId = useId();
  const titleId = useId();
  const [editingNote, setEditingNote] = useState(false);
  const noteButton = useRef<HTMLButtonElement>(null);
  const closeNote = () => {
    setEditingNote(false);
    // The editor's buttons are gone: back to the Add note (or Edit) button that opened it.
    requestAnimationFrame(() => noteButton.current?.focus());
  };
  const busy = saving.has(`task:${task.id}`);
  const done = task.status === "done";
  const setAside = task.status === "excluded" || task.status === "cancelled";
  const overdue = isOverdue(task, today);

  return (
    <li className="px-4 py-3.5" aria-busy={busy || undefined}>
      {/* A closed project's tasks are history: every control in the row is disabled. */}
      <fieldset disabled={readOnly} className="contents">
        <div className="flex gap-3">
          {/* A padded label makes the whole 40 px square the tap target, not just the 18 px box. */}
          <label className="-m-2.5 grid size-10 shrink-0 cursor-pointer place-items-center self-start">
            <input
              type="checkbox"
              checked={done}
              onChange={(e) => {
                void patchTask(task, { status: e.target.checked ? "done" : "open" });
                keepFocus();
              }}
              aria-label={`Done: ${task.title}`}
              aria-describedby={`${titleId}-state`}
              className="size-[18px] accent-[#292929]"
            />
          </label>
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
              <div className="min-w-0 flex-1">
                <p id={titleId} className={cx("text-sm leading-snug font-medium", done ? "text-ink-soft" : setAside ? "text-muted line-through" : "text-ink")}>
                  {task.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{task.detail}</p>
                <p id={`${titleId}-state`} className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  {done ? (
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-800">
                      <Icon name="check" className="size-3.5" />
                      Done{task.completedBy ? ` by ${task.completedBy}` : ""}
                      {task.completedAt ? ` · ${formatDate(task.completedAt)}` : ""}
                    </span>
                  ) : setAside ? (
                    <span className="text-muted">{TASK_STATUS_LABELS[task.status]}</span>
                  ) : overdue ? (
                    <span className="inline-flex items-center gap-1 font-medium text-red-700">
                      <Icon name="clock" className="size-3.5" />
                      Overdue · due {formatLongDate(task.dueDate)}
                    </span>
                  ) : task.dueDate ? (
                    <span className="text-ink-soft">Due {formatLongDate(task.dueDate)}</span>
                  ) : (
                    <span className="sr-only">Open</span>
                  )}
                  {busy ? (
                    <span className="inline-flex animate-[fade-in_160ms_ease-out_400ms_both] items-center gap-1 text-muted">
                      <Spinner className="size-3" label={null} /> Saving…
                    </span>
                  ) : null}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[8.5rem_12rem_9.75rem] lg:shrink-0">
                <div className="min-w-0">
                  <label htmlFor={statusId} className="sr-only">
                    Status of {task.title}
                  </label>
                  <CommitSelect
                    id={statusId}
                    value={task.status}
                    onCommit={(status) => {
                      void patchTask(task, { status: status as TaskStatus });
                      keepFocus();
                    }}
                    className={selectClasses("text-[13px]! pl-2!", "h-9")}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {TASK_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </CommitSelect>
                </div>
                <div className="flex min-w-0 items-center gap-1.5">
                  <StaffAvatar staffId={task.ownerId} />
                  <label htmlFor={ownerId} className="sr-only">
                    Owner of {task.title}
                  </label>
                  <CommitSelect
                    id={ownerId}
                    value={task.ownerId ?? ""}
                    onCommit={(owner) => void patchTask(task, { ownerId: owner || null })}
                    className={selectClasses("min-w-0 text-[13px]! pl-2!", "h-9")}
                  >
                    <option value="">Unassigned</option>
                    {STAFF_DIRECTORY.map((s) => (
                      <option key={s.id} value={s.id} title={STAFF_ROLE_LABELS[s.role]}>
                        {s.name}
                      </option>
                    ))}
                  </CommitSelect>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <DueDateInput task={task} onSave={(dueDate) => void patchTask(task, { dueDate })} />
                </div>
              </div>
            </div>

            {editingNote ? (
              <NoteEditor task={task} onSave={(note) => void patchTask(task, { note })} onClose={closeNote} />
            ) : task.note ? (
              <div className="mt-2 flex items-start gap-2 border-l-2 border-line-strong bg-subtle px-3 py-1.5 text-xs text-ink-soft">
                <p className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <span className="font-medium text-ink">Note: </span>
                  {task.note}
                </p>
                {readOnly ? null : (
                  <button ref={noteButton} type="button" onClick={() => setEditingNote(true)} className="-my-1 inline-flex min-h-6 shrink-0 items-center px-1 font-medium link-brand">
                    Edit<span className="sr-only"> the note for {task.title}</span>
                  </button>
                )}
              </div>
            ) : readOnly ? null : (
              <button
                ref={noteButton}
                type="button"
                onClick={() => setEditingNote(true)}
                className="mt-1 inline-flex min-h-7 items-center gap-1 pr-1 text-xs font-medium text-ink-soft hover:text-ink"
              >
                <Icon name="pencil" className="size-3" />
                Add note<span className="sr-only"> to {task.title}</span>
              </button>
            )}
          </div>
        </div>
      </fieldset>
    </li>
  );
}

export function TasksTab() {
  const { project, propertyId, acting } = useProject();
  const search = useLocationSearch();
  const filters = useMemo(() => parseTaskFilters(search), [search]);
  const shown = useMemo(() => filterTasks(project.tasks, filters, acting?.id ?? null), [project.tasks, filters, acting]);
  const blocks = useMemo(() => groupTasks(project.sections, shown), [project.sections, shown]);
  const today = localDay();

  const setFilters = (next: TaskFilters) => navigate(paths.onboardingProject(propertyId, "tasks", taskFilterQuery(next)), { replace: true });

  return (
    <div>
      <FilterBar filters={filters} onChange={setFilters} shown={shown.length} total={project.tasks.length} />
      {blocks.length === 0 ? (
        <Card>
          <EmptyState
            icon="check"
            title="No tasks match"
            description={filters.mine ? "Nothing in this view is assigned to you." : "Try a different section, owner or status."}
            action={
              <Button size="sm" onClick={() => setFilters(NO_TASK_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-8">
          {blocks.length > 1 ? (
            // Each task row has several controls: these links let a keyboard user skip to a section.
            <nav aria-label="Jump to a section" className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {blocks.map(({ section, count }) => (
                <a
                  key={section.key}
                  href={`#tasks-${section.key}`}
                  onClick={(e) => {
                    e.preventDefault();
                    const heading = document.getElementById(`tasks-${section.key}`);
                    heading?.scrollIntoView({ block: "start" });
                    heading?.focus({ preventScroll: true });
                  }}
                  className="inline-flex min-h-6 items-center font-medium link-brand"
                >
                  {section.title} <span className="ml-1 font-normal text-muted tabular-nums">({count})</span>
                </a>
              ))}
            </nav>
          ) : null}
          {blocks.map(({ section, groups }) => (
            <section key={section.key} aria-labelledby={`tasks-${section.key}`}>
              <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id={`tasks-${section.key}`} tabIndex={-1} className="scroll-mt-20 heading-display text-[14px] leading-6 text-ink focus:outline-none">
                  {section.title}
                </h2>
                <p className="text-xs text-ink-soft tabular-nums">
                  {section.counts.done} / {section.counts.total} done
                  {section.counts.excluded ? ` · ${section.counts.excluded} excluded` : ""} · <ProgressText progress={section.progress} /> · Owner:{" "}
                  {staffName(section.ownerId)}
                </p>
              </div>
              <Card className="overflow-hidden">
                {groups.map(({ group, tasks }) => (
                  <div key={group} className="border-b border-line last:border-b-0">
                    <h3 className="border-b border-line bg-subtle px-4 py-2 text-[11px] font-semibold tracking-[0.14em] text-ink-soft uppercase">
                      {group} <span className="font-normal text-muted tabular-nums">({tasks.length})</span>
                    </h3>
                    <ul className="divide-y divide-line">
                      {tasks.map((task) => (
                        <TaskRow key={task.id} task={task} today={today} />
                      ))}
                    </ul>
                  </div>
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
