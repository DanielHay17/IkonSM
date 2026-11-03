import { useId, useMemo, useState, type FormEvent } from "react";
import {
  ASSIGNEE_LABELS,
  ASSIGNEE_ROLES,
  CATEGORIES,
  CATEGORY_LABELS,
  type AssigneeRole,
  type Category,
  type Contact,
  type Priority,
  type Ticket,
  type TicketInput,
  type TicketStatus,
} from "../../../shared/types";
import { api } from "../../api";
import { Button } from "../../components/Button";
import { Card } from "../../components/Card";
import { ErrorState, FormError } from "../../components/EmptyState";
import { SelectField, TextAreaField, TextField, selectClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { Modal } from "../../components/Modal";
import { Skeleton } from "../../components/Skeleton";
import { PRIORITY_LABELS, PriorityBadge, TICKET_STATUS_LABELS } from "../../components/StatusBadges";
import { useToast } from "../../components/Toast";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { formatDate, fromDateInput, timeAgo } from "../../lib/format";
import { paths } from "../../router";
import { useBuilding } from "./BuildingContext";

const COLUMNS: TicketStatus[] = ["new", "assigned", "in_progress", "waiting", "done"];
const COLUMN_ACCENT: Record<TicketStatus, string> = {
  new: "bg-sky-500",
  assigned: "bg-violet-500",
  in_progress: "bg-accent",
  waiting: "bg-amber-500",
  done: "bg-emerald-500",
};
const PRIORITIES: Priority[] = ["P1", "P2", "P3"];
const PRIORITY_RANK: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };

function byUrgency(a: Ticket, b: Ticket): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt);
}

function TicketCard({
  ticket,
  contractor,
  onMove,
  moving,
}: {
  ticket: Ticket;
  contractor: Contact | undefined;
  onMove: (status: TicketStatus) => void;
  moving: boolean;
}) {
  const { propertyId } = useBuilding();
  const selectId = useId();
  const overdue = ticket.dueAt && ticket.status !== "done" && new Date(ticket.dueAt).getTime() < Date.now();

  return (
    <li className={cx("rounded-xl border border-line bg-surface p-3.5 shadow-card transition-opacity", moving && "opacity-60")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted">{ticket.number}</span>
        <PriorityBadge priority={ticket.priority} />
      </div>
      <p className="mt-1.5 line-clamp-3 text-sm leading-snug font-medium break-words text-ink" title={ticket.title}>
        {ticket.title}
      </p>
      {ticket.description ? <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">{ticket.description}</p> : null}

      <dl className="mt-3 space-y-1 text-xs">
        <div className="flex gap-1.5">
          <dt className="sr-only">Assigned to</dt>
          <Icon name="users" className="size-3.5 text-muted" />
          <dd className="truncate text-ink-soft">
            {ASSIGNEE_LABELS[ticket.assigneeRole]}
            {ticket.assigneeName ? ` · ${ticket.assigneeName}` : ""}
          </dd>
        </div>
        {contractor ? (
          <div className="flex gap-1.5">
            <dt className="sr-only">Contractor</dt>
            <Icon name="wrench" className="size-3.5 text-muted" />
            <dd className="truncate text-ink-soft">{contractor.name}</dd>
          </div>
        ) : null}
        {ticket.dueAt ? (
          <div className={cx("flex gap-1.5", overdue ? "font-medium text-red-700" : "text-ink-soft")}>
            <dt className="sr-only">Due</dt>
            <Icon name="clock" className="size-3.5" />
            <dd>
              {overdue ? "Overdue · " : "Due "}
              {formatDate(ticket.dueAt)}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
        {ticket.threadId ? (
          <Link href={paths.thread(propertyId, ticket.threadId)} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            <Icon name="mail" className="size-3.5" /> Thread
          </Link>
        ) : (
          <span className="text-[11px] text-muted">{timeAgo(ticket.updatedAt)}</span>
        )}
        <label htmlFor={selectId} className="sr-only">
          Move {ticket.number} to
        </label>
        <select
          id={selectId}
          value={ticket.status}
          disabled={moving}
          onChange={(e) => onMove(e.target.value as TicketStatus)}
          className={cx(selectClasses(undefined, "h-7"), "w-auto! min-w-0 max-w-[60%] rounded-md! py-0 pl-2! text-xs!")}
        >
          {COLUMNS.map((status) => (
            <option key={status} value={status}>
              {TICKET_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}

interface TicketForm {
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  assigneeRole: AssigneeRole;
  assigneeName: string;
  contractorId: string;
  dueDate: string;
}

const EMPTY_FORM: TicketForm = {
  title: "",
  description: "",
  category: "maintenance",
  priority: "P3",
  assigneeRole: "strata_manager",
  assigneeName: "",
  contractorId: "",
  dueDate: "",
};

function CreateTicketModal({
  open,
  onClose,
  contractors,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  contractors: Contact[];
  onCreated: (ticket: Ticket) => void;
}) {
  const { propertyId } = useBuilding();
  const [form, setForm] = useState<TicketForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof TicketForm>(key: K, value: TicketForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const close = () => {
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const input: TicketInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      priority: form.priority,
      assigneeRole: form.assigneeRole,
      assigneeName: form.assigneeName.trim() || null,
      contractorId: form.contractorId || null,
      dueAt: fromDateInput(form.dueDate),
    };
    try {
      onCreated(await api.createTicket(propertyId, input));
      close();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : close}
      title="New work order"
      description="Create a ticket on this building's board. Contractors are only contacted through an approved dispatch."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="create-ticket-form" variant="primary" icon="plus" loading={busy}>
            Create work order
          </Button>
        </>
      }
    >
      <form id="create-ticket-form" onSubmit={submit} className="space-y-4">
        <TextField label="Title" required maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Replace failed stairwell light, level 1" />
        <TextAreaField label="Description" rows={4} maxLength={10000} value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="What needs doing, where, access and safety notes" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Category" value={form.category} onChange={(e) => set("category", e.target.value as Category)}>
            {CATEGORIES.filter((c) => c !== "spam").map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Priority" value={form.priority} onChange={(e) => set("priority", e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p} · {PRIORITY_LABELS[p]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Assign to" value={form.assigneeRole} onChange={(e) => set("assigneeRole", e.target.value as AssigneeRole)}>
            {ASSIGNEE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ASSIGNEE_LABELS[r]}
              </option>
            ))}
          </SelectField>
          <TextField label="Assignee name" maxLength={120} value={form.assigneeName} onChange={(e) => set("assigneeName", e.target.value)} placeholder="Optional" />
          <SelectField label="Contractor" value={form.contractorId} onChange={(e) => set("contractorId", e.target.value)}>
            <option value="">None yet</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.trade ? ` (${c.trade})` : ""}
              </option>
            ))}
          </SelectField>
          <TextField label="Due date" type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
        </div>
        <FormError error={error} />
      </form>
    </Modal>
  );
}

function BoardSkeleton() {
  return (
    <div className="grid auto-cols-[minmax(196px,1fr)] grid-flow-col gap-3 overflow-hidden" role="status" aria-label="Loading work orders">
      {COLUMNS.map((c) => (
        <div key={c} className="space-y-3 rounded-xl bg-[#f0eee9] p-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export function WorkOrdersTab() {
  const { propertyId, refreshKey, reloadOverview } = useBuilding();
  const toast = useToast();
  const tickets = useResource(`tickets:${propertyId}`, () => api.tickets(propertyId), refreshKey);
  const contacts = useResource(`contacts:${propertyId}`, () => api.contacts(propertyId), refreshKey);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<Set<string>>(new Set());

  const contractors = useMemo(() => (contacts.data ?? []).filter((c) => c.role === "contractor"), [contacts.data]);
  const contactsById = useMemo(() => new Map((contacts.data ?? []).map((c) => [c.id, c])), [contacts.data]);
  const columns = useMemo(() => {
    const grouped = new Map<TicketStatus, Ticket[]>(COLUMNS.map((s) => [s, []]));
    for (const ticket of tickets.data ?? []) grouped.get(ticket.status)?.push(ticket);
    for (const list of grouped.values()) list.sort(byUrgency);
    return grouped;
  }, [tickets.data]);

  const move = async (ticket: Ticket, status: TicketStatus) => {
    if (status === ticket.status) return;
    setMoving((s) => new Set(s).add(ticket.id));
    tickets.mutate((list = []) => list.map((t) => (t.id === ticket.id ? { ...t, status } : t)));
    try {
      const updated = await api.updateTicket(propertyId, ticket.id, { status });
      tickets.mutate((list = []) => list.map((t) => (t.id === updated.id ? updated : t)));
      void reloadOverview();
    } catch (err) {
      tickets.mutate((list = []) => list.map((t) => (t.id === ticket.id ? ticket : t)));
      toast.error(`Couldn't move ${ticket.number}`, err);
    } finally {
      setMoving((s) => {
        const next = new Set(s);
        next.delete(ticket.id);
        return next;
      });
    }
  };

  const total = tickets.data?.length ?? 0;
  const open = (tickets.data ?? []).filter((t) => t.status !== "done").length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Work orders</h2>
          <p className="text-[13px] text-muted">
            {tickets.data ? `${open} open · ${total} total. P1/P2 maintenance creates tickets automatically.` : "Loading…"}
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New work order
        </Button>
      </div>

      {tickets.loading ? (
        <BoardSkeleton />
      ) : tickets.error ? (
        <Card>
          <ErrorState error={tickets.error} onRetry={tickets.reload} title="Couldn't load work orders" />
        </Card>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 scrollbar-thin sm:mx-0 sm:px-0">
          <div className="grid auto-cols-[minmax(196px,1fr)] grid-flow-col gap-3">
            {COLUMNS.map((status) => {
              const list = columns.get(status) ?? [];
              return (
                <section key={status} aria-labelledby={`col-${status}`} className="flex min-w-0 flex-col rounded-xl bg-[#f0eee9] p-3 ring-1 ring-line/70">
                  <h3 id={`col-${status}`} className="mb-3 flex items-center gap-2 px-1 text-[13px] font-semibold text-ink">
                    <span aria-hidden="true" className={cx("size-2 rounded-full", COLUMN_ACCENT[status])} />
                    {TICKET_STATUS_LABELS[status]}
                    <span className="ml-auto text-xs font-medium text-muted tabular-nums">{list.length}</span>
                  </h3>
                  {list.length ? (
                    <ul className="space-y-3">
                      {list.map((ticket) => (
                        <TicketCard
                          key={ticket.id}
                          ticket={ticket}
                          contractor={ticket.contractorId ? contactsById.get(ticket.contractorId) : undefined}
                          moving={moving.has(ticket.id)}
                          onMove={(next) => void move(ticket, next)}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-xs text-muted">Nothing here</p>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      )}

      <CreateTicketModal
        open={creating}
        onClose={() => setCreating(false)}
        contractors={contractors}
        onCreated={(ticket) => {
          tickets.mutate((list = []) => [ticket, ...list]);
          toast.success(`Created ${ticket.number}`, ticket.title);
          void reloadOverview();
        }}
      />
    </div>
  );
}
