// The go-live checks, grouped (Records, Stratafy, Xero, Finance, Insurance, Compliance, Site,
// Communications): each can be verified, marked not applicable or reopened, with a note.

import { useId, useMemo, useState } from "react";
import type { GoLiveCheck, GoLiveCheckStatus } from "../../../shared/onboarding";
import { Badge } from "../../components/Badge";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { textareaClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { Segmented } from "../../components/Tabs";
import { cx } from "../../lib/cx";
import { formatDate } from "../../lib/format";
import { useProject } from "./ProjectContext";
import { ProgressBar } from "./ui";

type Filter = "all" | GoLiveCheckStatus;

function CheckNote({ check, onDone }: { check: GoLiveCheck; onDone: () => void }) {
  const { patchCheck } = useProject();
  const id = useId();
  const [text, setText] = useState(check.note ?? "");
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        void patchCheck(check, { status: check.status, note: text.trim() || null });
        onDone();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Note for {check.title}
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
            onDone();
          }
        }}
        className={textareaClasses("text-[13px]!")}
      />
      <div className="flex gap-2">
        <Button type="submit" size="xs" variant="primary">
          Save note
        </Button>
        <Button size="xs" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CheckRow({ check }: { check: GoLiveCheck }) {
  const { patchCheck, saving } = useProject();
  const [editing, setEditing] = useState(false);
  const busy = saving.has(`check:${check.id}`);
  const settled = check.status !== "open";
  return (
    <li className="flex gap-3 px-4 py-3.5">
      <span
        aria-hidden="true"
        className={cx(
          "mt-0.5 grid size-5 shrink-0 place-items-center",
          check.status === "verified" ? "bg-emerald-600 text-white" : check.status === "not_applicable" ? "bg-sunken text-muted" : "border-[1.5px] border-line-input",
        )}
      >
        {check.status === "verified" ? <Icon name="check" className="size-3.5" strokeWidth={2.5} /> : check.status === "not_applicable" ? <Icon name="close" className="size-3" /> : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <p className={cx("text-sm leading-snug", check.status === "not_applicable" ? "text-muted" : "text-ink")}>{check.title}</p>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              {check.status === "verified" ? (
                <Badge tone="green" icon="check">
                  Verified
                </Badge>
              ) : check.status === "not_applicable" ? (
                <Badge tone="neutral">Not applicable</Badge>
              ) : (
                <span className="sr-only">Not done</span>
              )}
              {settled && check.checkedBy ? (
                <span>
                  {check.checkedBy}
                  {check.checkedAt ? ` · ${formatDate(check.checkedAt)}` : ""}
                </span>
              ) : null}
              {busy ? <Spinner className="size-3" label="Saving" /> : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {check.status === "open" ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="check"
                  disabled={busy}
                  aria-label={`Verified: ${check.title}`}
                  onClick={() => void patchCheck(check, { status: "verified" })}
                >
                  Verified
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`N/A, not applicable: ${check.title}`}
                  onClick={() => void patchCheck(check, { status: "not_applicable" })}
                >
                  N/A
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" icon="refresh" disabled={busy} aria-label={`Reopen: ${check.title}`} onClick={() => void patchCheck(check, { status: "open" })}>
                Reopen
              </Button>
            )}
          </div>
        </div>
        {editing ? (
          <CheckNote check={check} onDone={() => setEditing(false)} />
        ) : check.note ? (
          <div className="mt-2 flex items-start gap-2 border-l-2 border-line-strong bg-subtle px-3 py-1.5 text-xs text-ink-soft">
            <p className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
              <span className="font-medium text-ink">Note: </span>
              {check.note}
            </p>
            <button type="button" onClick={() => setEditing(true)} className="shrink-0 font-medium link-brand">
              Edit<span className="sr-only"> the note for {check.title}</span>
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-ink-soft hover:text-ink">
            <Icon name="pencil" className="size-3" />
            Add note<span className="sr-only"> to {check.title}</span>
          </button>
        )}
      </div>
    </li>
  );
}

export function GoLiveTab() {
  const { project } = useProject();
  const [filter, setFilter] = useState<Filter>("all");
  const { goLiveChecks: total, goLiveVerified: verified, goLiveNotApplicable: na } = project.counts;
  const remaining = total - verified - na;

  const groups = useMemo(() => {
    const order: string[] = [];
    for (const check of project.goLiveChecks) if (!order.includes(check.group)) order.push(check.group);
    return order.map((group) => {
      const all = project.goLiveChecks.filter((c) => c.group === group);
      return { group, all, shown: filter === "all" ? all : all.filter((c) => c.status === filter) };
    });
  }, [project.goLiveChecks, filter]);
  const visible = groups.filter((g) => g.shown.length > 0);

  return (
    <div className="space-y-5">
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="text-xl font-semibold text-ink tabular-nums">
            {verified} / {total} checks verified
          </p>
          <p className="text-[13px] text-ink-soft tabular-nums">
            {na} not applicable · {remaining ? `${remaining} to do` : "all done"}
          </p>
        </div>
        <ProgressBar value={total ? ((verified + na) / total) * 100 : 0} label="Go-live checks done" className="mt-3" />
        <p className="mt-2 text-xs text-muted">Every check must be verified or not applicable before go-live can be approved.</p>
      </Card>

      <Segmented<Filter>
        label="Show checks"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: `All ${total}` },
          { value: "open", label: `To do ${remaining}` },
          { value: "verified", label: `Verified ${verified}` },
          { value: "not_applicable", label: `N/A ${na}` },
        ]}
      />

      {visible.length === 0 ? (
        <Card>
          <EmptyState icon="flag" title="No checks here" description="Nothing matches this filter." compact />
        </Card>
      ) : (
        <div className="space-y-6">
          {visible.map(({ group, all, shown }) => (
            <section key={group} aria-labelledby={`checks-${group}`}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 id={`checks-${group}`} className="heading-display text-[14px] leading-6 text-ink">
                  {group}
                </h2>
                <p className="text-xs text-muted tabular-nums">
                  {all.filter((c) => c.status !== "open").length} / {all.length} done
                </p>
              </div>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {shown.map((check) => (
                    <CheckRow key={check.id} check={check} />
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
