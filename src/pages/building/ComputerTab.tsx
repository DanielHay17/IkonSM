import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PROVIDER_NAMES } from "../../../shared/engines";
import { VAULT_FOLDERS, type ActivityEvent, type ActivityKind, type DocMeta, type MemoryNote, type Thread } from "../../../shared/types";
import { api } from "../../api";
import { Button, IconButton } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { EmptyState, ErrorState } from "../../components/EmptyState";
import { textareaClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { LiveModeIndicator } from "../../components/LiveStatus";
import { Skeleton, SkeletonList } from "../../components/Skeleton";
import { AiStatusPill, triageEngineText } from "../../components/StatusBadges";
import { useToast } from "../../components/Toast";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { formatClock, formatDateTime, timeAgo } from "../../lib/format";
import { useBuilding } from "./BuildingContext";

const FEED_LIMIT = 200;
const STICK_TO_BOTTOM_PX = 48;

const KINDS: Record<ActivityKind, { tag: string; color: string }> = {
  email_in: { tag: "EMAIL IN", color: "text-sky-300" },
  message_in: { tag: "MSG IN", color: "text-sky-300" },
  triage: { tag: "TRIAGE", color: "text-amber-300" },
  tool: { tag: "TOOL", color: "text-violet-300" },
  draft: { tag: "DRAFT", color: "text-teal-300" },
  approval: { tag: "APPROVAL", color: "text-emerald-300" },
  email_out: { tag: "EMAIL OUT", color: "text-emerald-300" },
  ticket: { tag: "TICKET", color: "text-orange-300" },
  doc: { tag: "DOC", color: "text-slate-300" },
  memory: { tag: "MEMORY", color: "text-pink-300" },
  chat: { tag: "CHAT", color: "text-cyan-300" },
  error: { tag: "ERROR", color: "text-red-400" },
  system: { tag: "SYSTEM", color: "text-slate-400" },
};

/** History from the API plus the live websocket tail, de-duplicated, oldest first like a terminal. */
function mergeActivity(history: ActivityEvent[] | undefined, live: ActivityEvent[] | undefined): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>();
  for (const event of [...(history ?? []), ...(live ?? [])]) byId.set(event.id, event);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-FEED_LIMIT);
}

function ActivityTerminal({ events, loading, error, onRetry }: { events: ActivityEvent[]; loading: boolean; error: unknown; onRetry: () => void }) {
  const { propertyId, live, liveMode } = useBuilding();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const busy = live?.busy.active ? live.busy : null;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length, busy?.label]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_PX;
  };

  return (
    <section aria-labelledby="terminal-title" className="overflow-hidden rounded-xl bg-navy shadow-pop ring-1 ring-navy">
      <div className="flex items-center gap-3 border-b border-white/10 bg-navy-800 px-4 py-2.5">
        <span aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]/80" />
          <span className="size-2.5 rounded-full bg-[#febc2e]/80" />
          <span className="size-2.5 rounded-full bg-[#28c840]/80" />
        </span>
        <h2 id="terminal-title" className="min-w-0 flex-1 truncate font-mono text-xs text-navy-text">
          {propertyId.replace(/^sp-/i, "SP ")} · agent activity
        </h2>
        <LiveModeIndicator mode={liveMode} className="text-navy-muted!" />
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-[520px] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed scrollbar-dark sm:h-[600px]"
      >
        {loading && events.length === 0 ? (
          <div className="space-y-2" aria-label="Loading activity" role="status">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className={cx("h-3 bg-white/5", i % 3 === 0 ? "w-2/3" : "w-full")} />
            ))}
          </div>
        ) : error && events.length === 0 ? (
          <div className="text-red-300">
            Couldn't load activity.{" "}
            <button type="button" className="underline hover:text-white" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <ol role="log" aria-live="polite" aria-label="Agent activity" className="space-y-1.5">
            {events.length === 0 ? <li className="text-slate-500"># No activity yet. Simulate an inbound message to wake the agent.</li> : null}
            {events.map((event) => {
              const kind = KINDS[event.kind] ?? KINDS.system;
              return (
                <li key={event.id} className="grid animate-fade-in grid-cols-[auto_minmax(0,1fr)] gap-x-3 sm:grid-cols-[auto_9ch_minmax(0,1fr)]">
                  <time dateTime={event.at} title={formatDateTime(event.at)} className="text-slate-500 tabular-nums">
                    {formatClock(event.at)}
                  </time>
                  <span className={cx("hidden font-semibold sm:inline", kind.color)}>{kind.tag}</span>
                  <span className="min-w-0 break-words text-slate-100">
                    <span className={cx("mr-2 font-semibold sm:hidden", kind.color)}>{kind.tag}</span>
                    {event.summary}
                    {event.detail ? <span className="block text-slate-400">{event.detail}</span> : null}
                  </span>
                </li>
              );
            })}
            <li className="pt-1 text-teal-300">
              {busy ? (
                <span>
                  <span className="text-slate-500">▸ </span>
                  {busy.label ?? "working"}
                  <span aria-hidden="true" className="ml-1 inline-block animate-blink">
                    █
                  </span>
                </span>
              ) : (
                <span className="text-slate-400">
                  {propertyId}:~$
                  <span aria-hidden="true" className="ml-1.5 inline-block animate-blink text-slate-300">
                    █
                  </span>
                </span>
              )}
            </li>
          </ol>
        )}
      </div>
    </section>
  );
}

/** Engine of the most recent triage, so staff see what actually ran, not just what is configured. */
function latestTriageEngine(threads: Thread[] | undefined): string | null {
  const triaged = (threads ?? [])
    .filter((t) => t.triage)
    .sort((a, b) => (b.triage?.triagedAt ?? "").localeCompare(a.triage?.triagedAt ?? ""));
  const triage = triaged[0]?.triage;
  return triage ? triageEngineText(triage) : null;
}

function StatusCard({ threads }: { threads: Thread[] | undefined }) {
  const { live, liveMode, aiOnline, ai } = useBuilding();
  const lastTriage = latestTriageEngine(threads);
  const busy = live?.busy.active ? live.busy : null;
  const provider = ai?.provider ?? (aiOnline ? null : "off");

  const rows: [string, ReactNode][] = [
    ["AI", <AiStatusPill key="ai" online={aiOnline} ai={ai} />],
    ["Provider", <span key="p">{provider ? PROVIDER_NAMES[provider] : "Unknown"}</span>],
    ["Model", <span key="m" className="font-mono text-xs">{ai?.model ?? (aiOnline ? "-" : "None (rules engine)")}</span>],
    ...(ai?.note ? ([["Setup", <span key="n" className="text-xs whitespace-normal" title={ai.note}>{ai.note}</span>]] as [string, ReactNode][]) : []),
    ["Last triage", <span key="t" className="text-xs">{lastTriage ?? "No triage run yet"}</span>],
    ["Status", busy ? <span key="s" className="font-medium text-accent-strong">Working: {busy.label ?? "busy"}</span> : <span key="s">Idle</span>],
    ["Connection", <LiveModeIndicator key="c" mode={liveMode} />],
    ["Last change", <span key="u">{live?.updatedAt ? timeAgo(live.updatedAt) : "-"}</span>],
  ];

  return (
    <Card>
      <CardHeader title="Status" as="h3" leading={<Icon name="cpu" className="mt-1 size-4 text-muted" />} />
      <dl className="divide-y divide-line px-5 py-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
            <dt className="text-muted">{label}</dt>
            <dd className="min-w-0 truncate text-right text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function FilesCard({ docs, loading }: { docs: DocMeta[] | undefined; loading: boolean }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>(VAULT_FOLDERS.map((f) => [f, 0]));
    for (const doc of docs ?? []) map.set(doc.folder, (map.get(doc.folder) ?? 0) + 1);
    return [...map.entries()];
  }, [docs]);
  const max = Math.max(1, ...counts.map(([, n]) => n));
  const indexed = (docs ?? []).filter((d) => d.indexed === "full").length;

  return (
    <Card>
      <CardHeader
        title="Files on this computer"
        as="h3"
        leading={<Icon name="folder" className="mt-1 size-4 text-muted" />}
        description={docs ? `${docs.length} documents · ${indexed} fully indexed` : undefined}
      />
      <div className="px-5 py-4">
        {loading ? (
          <SkeletonList rows={3} />
        ) : (
          <ul className="space-y-2">
            {counts.map(([folder, n]) => (
              <li key={folder} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-soft">{folder}</span>
                  <span className="font-mono text-muted tabular-nums">{n}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-subtle ring-1 ring-line ring-inset" aria-hidden="true">
                  <div className="h-full rounded-full bg-accent/70" style={{ width: `${(n / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function MemoryCard() {
  const { propertyId, refreshKey } = useBuilding();
  const toast = useToast();
  const memory = useResource(`memory:${propertyId}`, () => api.memory(propertyId), refreshKey);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const note = text.trim();
    if (!note) return;
    setAdding(true);
    try {
      const created = await api.addMemory(propertyId, note);
      memory.mutate((list = []) => [created, ...list]);
      setText("");
    } catch (err) {
      toast.error("Couldn't save the note", err);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (note: MemoryNote) => {
    setRemoving(note.id);
    try {
      await api.deleteMemory(propertyId, note.id);
      memory.mutate((list = []) => list.filter((n) => n.id !== note.id));
    } catch (err) {
      toast.error("Couldn't delete the note", err);
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Memory"
        as="h3"
        leading={<Icon name="bookmark" className="mt-1 size-4 text-muted" />}
        description="Standing facts the agent reads before every task."
      />
      <form onSubmit={add} className="border-b border-line px-5 py-4">
        <label htmlFor="memory-text" className="sr-only">
          New memory note
        </label>
        <textarea
          id="memory-text"
          rows={2}
          value={text}
          maxLength={2000}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Lot 6 is tenanted: copy Sample Realty on maintenance"
          className={textareaClasses("text-[13px]!")}
        />
        <div className="mt-2 flex justify-end">
          <Button type="submit" size="sm" icon="plus" loading={adding} disabled={!text.trim()}>
            Remember
          </Button>
        </div>
      </form>
      {memory.loading ? (
        <SkeletonList rows={3} />
      ) : memory.error ? (
        <ErrorState error={memory.error} onRetry={memory.reload} compact />
      ) : memory.data?.length ? (
        <ul className="max-h-[360px] divide-y divide-line overflow-y-auto scrollbar-thin">
          {memory.data.map((note) => (
            <li key={note.id} className="group flex items-start gap-2 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-relaxed text-ink">{note.text}</p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {note.source} · {timeAgo(note.createdAt)}
                </p>
              </div>
              <IconButton
                icon="trash"
                label="Delete note"
                size="xs"
                variant="dangerGhost"
                loading={removing === note.id}
                onClick={() => remove(note)}
                className="opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
              />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact icon="bookmark" title="No memory notes" description="Add facts staff want the agent to always keep in mind." />
      )}
    </Card>
  );
}

/** The agent's "screen": what it is doing right now, what it has done, and what it knows. */
export function ComputerTab() {
  const { propertyId, refreshKey, live } = useBuilding();
  const activity = useResource(`activity:${propertyId}`, () => api.activity(propertyId, 100), refreshKey);
  const docs = useResource(`docs:${propertyId}`, () => api.docs(propertyId), refreshKey);
  const threads = useResource(`threads:${propertyId}:all`, () => api.threads(propertyId), refreshKey);
  const events = useMemo(() => mergeActivity(activity.data, live?.recentActivity), [activity.data, live?.recentActivity]);

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <ActivityTerminal events={events} loading={activity.loading} error={activity.error} onRetry={activity.reload} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-1">
        <StatusCard threads={threads.data} />
        <FilesCard docs={docs.data} loading={docs.loading} />
        <div className="md:col-span-2 xl:col-span-1">
          <MemoryCard />
        </div>
      </div>
    </div>
  );
}
