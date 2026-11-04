import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  useDraggable,
  useDroppable,
  type Active,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import { ApiError, api } from "../../api";
import { DragHandle, boardCollisions, columnKeyboardCoordinates, useBoardSensors, usePrefersReducedMotion } from "../../components/BoardDnd";
import { Button, IconButton } from "../../components/Button";
import { Card } from "../../components/Card";
import { ErrorState, FormError } from "../../components/EmptyState";
import { SelectField, TextAreaField, TextField, selectClasses } from "../../components/Field";
import { Icon } from "../../components/Icon";
import { Link } from "../../components/Link";
import { Modal } from "../../components/Modal";
import { Spinner } from "../../components/Spinner";
import { PRIORITY_LABELS, PriorityBadge, TICKET_STATUS_LABELS } from "../../components/StatusBadges";
import { useToast } from "../../components/Toast";
import { useResource } from "../../hooks/useResource";
import { cx } from "../../lib/cx";
import { formatDate, formatDateTime, fromDateInput, timeAgo } from "../../lib/format";
import { paths } from "../../router";
import { BoardSkeleton } from "./BoardSkeleton";
import { useBuilding } from "./BuildingContext";

const COLUMNS: TicketStatus[] = ["new", "assigned", "in_progress", "waiting", "done"];
// Status dots in the brand's monochrome, from hollow (new) to charcoal (in progress); waiting and done keep their usual colours.
const COLUMN_ACCENT: Record<TicketStatus, string> = {
  new: "border-[1.5px] border-ink",
  assigned: "bg-taupe",
  in_progress: "bg-ink",
  waiting: "bg-amber-500",
  done: "bg-emerald-600",
};
const PRIORITIES: Priority[] = ["P1", "P2", "P3"];
const PRIORITY_RANK: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };

/** Most urgent first, then most recently updated. A move being saved counts as the newest update, so the card lands where it will stay. */
function byUrgency(saving: ReadonlyMap<string, unknown>) {
  return (a: Ticket, b: Ticket): number =>
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || Number(saving.has(b.id)) - Number(saving.has(a.id)) || b.updatedAt.localeCompare(a.updatedAt);
}

// Occupied columns get room for their cards; empty ones only need to be a drop target.
const OCCUPIED_TRACK = "minmax(232px, 1fr)";
const EMPTY_TRACK = "minmax(148px, 0.6fr)";

interface DragData {
  ticket: Ticket;
}

const ticketOf = (active: Active) => (active.data.current as DragData | undefined)?.ticket;
const columnOfData = (data: unknown) => (data as DragData | undefined)?.ticket.status;
const columnLabel = (id: UniqueIdentifier) => TICKET_STATUS_LABELS[id as TicketStatus] ?? String(id);
const isColumn = (id: UniqueIdentifier | undefined): id is TicketStatus => COLUMNS.includes(id as TicketStatus);

const KEYBOARD_COORDINATES = columnKeyboardCoordinates(COLUMNS, columnOfData);
const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "To move this work order, press Space or Enter to pick it up, use the left and right arrow keys to choose a status column, then press Space or Enter to drop it. Press Escape to cancel. The status menu on the card does the same.",
};
const DROP_ANIMATION: DropAnimation = {
  duration: 180,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  // While the overlay settles onto the card, let presses through so the card can be grabbed again.
  // (A class, because dnd-kit applies `styles` with setProperty, which ignores camelCase names.)
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } }, className: { dragOverlay: "pointer-events-none" } }),
};

// Border colour and shadow are set per use, so the card and its drag copy never carry two of each.
const CARD_CLASSES = "rounded-xl border bg-surface p-3.5";

interface CardProps {
  ticket: Ticket;
  contractor: Contact | undefined;
  onMove: (status: TicketStatus) => void;
  /** A status change is being saved. */
  moving: boolean;
}

function TicketCardContent({
  ticket,
  contractor,
  onMove,
  moving = false,
  handle,
}: Partial<Pick<CardProps, "onMove" | "moving">> & Pick<CardProps, "ticket" | "contractor"> & { handle: ReactNode }) {
  const { propertyId } = useBuilding();
  const selectId = useId();
  const overlay = !onMove;
  // On a closed menu, arrow keys and type-ahead change the value straight away (Chrome on Windows
  // and Linux). Hold that choice as a draft and apply it on Enter or on leaving the menu, so the
  // card doesn't jump columns on every key press.
  const [draft, setDraft] = useState<TicketStatus | null>(null);
  const keyed = useRef(false);
  const commit = (status: TicketStatus) => {
    setDraft(null);
    if (status !== ticket.status) onMove?.(status);
  };
  const overdue = ticket.dueAt && ticket.status !== "done" && new Date(ticket.dueAt).getTime() < Date.now();
  // The contractor usually is the assignee: show them once.
  const showContractor = !!contractor && contractor.name !== ticket.assigneeName;
  // P1/P2 deadlines are hours away, so show the time; P3 only needs the date.
  const due = ticket.dueAt ? (ticket.priority === "P3" ? formatDate(ticket.dueAt) : formatDateTime(ticket.dueAt)) : "";

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1">
          {handle}
          <span className="text-[11px] font-medium tracking-[0.04em] whitespace-nowrap text-muted tabular-nums">{ticket.number}</span>
          {moving ? (
            // Only shows when a save is slow, so quick moves don't flicker.
            <span className="ml-1 animate-[fade-in_160ms_ease-out_400ms_both] text-muted">
              <Spinner className="size-3" label={null} />
            </span>
          ) : null}
        </span>
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
          <dd className="min-w-0 text-ink-soft [overflow-wrap:anywhere]">
            {ticket.assigneeName ? `${ticket.assigneeName} · ${ASSIGNEE_LABELS[ticket.assigneeRole].toLowerCase()}` : ASSIGNEE_LABELS[ticket.assigneeRole]}
          </dd>
        </div>
        {showContractor && contractor ? (
          <div className="flex gap-1.5">
            <dt className="sr-only">Contractor</dt>
            <Icon name="wrench" className="size-3.5 text-muted" />
            <dd className="min-w-0 text-ink-soft [overflow-wrap:anywhere]">{contractor.name}</dd>
          </div>
        ) : null}
        {ticket.dueAt ? (
          <div className={cx("flex gap-1.5", overdue ? "font-medium text-red-700" : "text-ink-soft")}>
            <dt className="sr-only">Due</dt>
            <Icon name="clock" className="size-3.5" />
            <dd>
              {overdue ? "Overdue · " : ticket.priority === "P3" ? "Due " : "Make safe by "}
              <span className="whitespace-nowrap">{due}</span>
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
        {onMove ? (
          <label htmlFor={selectId} className="sr-only">
            Move {ticket.number} to
          </label>
        ) : null}
        {/* The drag copy shows the same menu, so it lays out exactly like the card; it is hidden and inert there. */}
        <select
          id={overlay ? undefined : selectId}
          tabIndex={overlay ? -1 : undefined}
          data-refocus="status"
          value={draft ?? ticket.status}
          // Not `disabled` while saving: a disabled menu can't hold focus, and focus follows the card to its new column.
          aria-disabled={moving || undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (draft) {
                e.preventDefault();
                commit(draft);
              }
              return;
            }
            if (e.key === "Escape") {
              if (draft) {
                e.preventDefault();
                e.stopPropagation();
                setDraft(null);
              }
              return;
            }
            if (e.key === "Tab") return;
            keyed.current = true;
            window.setTimeout(() => (keyed.current = false), 0);
          }}
          onChange={(e) => {
            if (moving) return;
            const next = e.target.value as TicketStatus;
            if (keyed.current) setDraft(next === ticket.status ? null : next);
            else commit(next);
          }}
          onBlur={() => {
            if (!draft) return;
            const next = draft;
            // Once focus has landed, so the board can keep it if it stayed inside this card.
            window.setTimeout(() => commit(next), 0);
          }}
          className={cx(
            selectClasses(undefined, "h-8 pointer-coarse:h-10"),
            "min-w-0 flex-1 py-0 pl-2! text-xs! aria-disabled:cursor-progress aria-disabled:text-muted",
          )}
        >
          {COLUMNS.map((status) => (
            <option key={status} value={status}>
              {TICKET_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {ticket.threadId && !overlay ? (
          <Link
            href={paths.thread(propertyId, ticket.threadId)}
            data-refocus="thread"
            aria-label={`Open the email thread for ${ticket.number}`}
            className="link-brand inline-flex shrink-0 items-center gap-1 text-xs font-medium"
          >
            <Icon name="mail" className="size-3.5" /> Thread
          </Link>
        ) : ticket.threadId ? (
          <span className="link-brand inline-flex shrink-0 items-center gap-1 text-xs font-medium">
            <Icon name="mail" className="size-3.5" /> Thread
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-muted">{timeAgo(ticket.updatedAt)}</span>
        )}
      </div>
    </>
  );
}

/** A card on the board. Mouse and touch drags start anywhere except its links and menu; the keyboard uses the grip. */
function TicketCard(props: CardProps) {
  const { ticket, moving } = props;
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: ticket.id,
    data: { ticket } satisfies DragData,
    disabled: moving,
    attributes: { roleDescription: "draggable work order" },
  });

  return (
    <li
      ref={setNodeRef}
      {...listeners}
      data-ticket={ticket.number}
      aria-busy={moving || undefined}
      className={cx(
        CARD_CLASSES,
        "border-line shadow-card",
        // manipulation keeps page scrolling on touch; the long-press callout and text selection would fight the drag.
        "touch-manipulation transition-opacity duration-150 [-webkit-touch-callout:none] pointer-coarse:select-none",
        !moving && "cursor-grab",
        // Faded, not hidden: the grip inside keeps focus during a keyboard drag and must stay visible.
        isDragging && "opacity-60",
      )}
    >
      <TicketCardContent {...props} handle={<DragHandle ref={setActivatorNodeRef} label={`Move ${ticket.number}`} data-refocus="grip" {...attributes} />} />
    </li>
  );
}

/** The copy that follows the pointer while dragging. Hidden from screen readers: the live region narrates the drag. */
function TicketCardOverlay({ ticket, contractor }: Pick<CardProps, "ticket" | "contractor">) {
  return (
    <div data-drag-overlay="" aria-hidden="true" inert className={cx(CARD_CLASSES, "h-full cursor-grabbing border-ink shadow-pop")}>
      <TicketCardContent ticket={ticket} contractor={contractor} handle={<DragHandle decorative label="" />} />
    </div>
  );
}

function BoardColumn({
  status,
  count,
  dragging,
  source,
  children,
}: {
  status: TicketStatus;
  count: number;
  /** A card is being dragged somewhere on the board. */
  dragging: boolean;
  /** The dragged card came from this column. */
  source: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const target = isOver && !source;

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={`col-${status}`}
      data-column={status}
      data-over={isOver || undefined}
      className={cx(
        "flex min-w-0 flex-col rounded-xl p-3 transition-[background-color,box-shadow] duration-150",
        // One background and one ring at a time: Tailwind's own ordering would decide between two.
        // The target lights up white with a charcoal keyline, like the website's outline buttons;
        // while a card is moving, every column is outlined so the drop zones read clearly.
        target
          ? "bg-surface ring-2 ring-ink"
          : isOver
            ? "bg-sunken ring-2 ring-line-input"
            : dragging
              ? "bg-sunken ring-1 ring-line-input"
              : "bg-sunken ring-1 ring-line",
      )}
    >
      <h3 id={`col-${status}`} className="mb-3 flex items-center gap-2 border-b border-line-strong px-1 pb-2.5">
        <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", COLUMN_ACCENT[status])} />
        <span className="heading-display min-w-0 truncate text-[11px] leading-5 text-ink">{TICKET_STATUS_LABELS[status]}</span>
        <span className="ml-auto text-xs font-medium text-muted tabular-nums">{count}</span>
      </h3>
      {count ? (
        children
      ) : (
        <p
          className={cx(
            "border border-dashed px-3 py-6 text-center text-xs transition-colors duration-150",
            target ? "border-ink font-medium text-ink" : dragging ? "border-line-input text-ink-soft" : "border-line-strong text-muted",
          )}
        >
          {dragging ? "Drop here" : "Nothing here"}
        </p>
      )}
    </section>
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
          <Button variant="secondary" onClick={close} disabled={busy}>
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

export function WorkOrdersTab() {
  const { propertyId, refreshKey, reloadOverview } = useBuilding();
  const toast = useToast();
  const tickets = useResource(`tickets:${propertyId}`, () => api.tickets(propertyId), refreshKey);
  const contacts = useResource(`contacts:${propertyId}`, () => api.contacts(propertyId), refreshKey);
  const [creating, setCreating] = useState(false);
  // Status changes being saved, by ticket id. They are laid over the fetched list, so a live
  // refresh that lands before the server has the change can't snap the card back.
  const [pending, setPending] = useState<ReadonlyMap<string, TicketStatus>>(new Map());
  // While a card is being dragged the board holds still: live refreshes wait until the drop.
  const [drag, setDrag] = useState<{ ticket: Ticket; board: Map<TicketStatus, Ticket[]> } | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const sensors = useBoardSensors(KEYBOARD_COORDINATES, reducedMotion);

  const contractors = useMemo(() => (contacts.data ?? []).filter((c) => c.role === "contractor"), [contacts.data]);
  const contactsById = useMemo(() => new Map((contacts.data ?? []).map((c) => [c.id, c])), [contacts.data]);
  const board = useMemo(() => {
    const grouped = new Map<TicketStatus, Ticket[]>(COLUMNS.map((s) => [s, []]));
    for (const ticket of tickets.data ?? []) {
      const status = pending.get(ticket.id) ?? ticket.status;
      grouped.get(status)?.push(status === ticket.status ? ticket : { ...ticket, status });
    }
    const order = byUrgency(pending);
    for (const list of grouped.values()) list.sort(order);
    return grouped;
  }, [tickets.data, pending]);
  const columns = drag?.board ?? board;
  // The drag announcements and drop check compare against the latest list, not the frozen board.
  const latest = useRef(tickets.data);
  latest.current = tickets.data;

  // A status change re-mounts the card in another column, which would drop keyboard focus to the
  // page. Note which control in the card had focus, and put focus back once the card has moved.
  const scroller = useRef<HTMLDivElement>(null);
  const refocus = useRef<{ number: string; control: string } | null>(null);
  const rememberFocus = (number: string) => {
    const active = document.activeElement;
    const control = active instanceof HTMLElement ? active.dataset.refocus : undefined;
    refocus.current = control && active?.closest("[data-ticket]")?.getAttribute("data-ticket") === number ? { number, control } : null;
  };
  useLayoutEffect(() => {
    const wanted = refocus.current;
    if (!wanted) return;
    const control = scroller.current?.querySelector<HTMLElement>(`[data-ticket="${CSS.escape(wanted.number)}"] [data-refocus="${wanted.control}"]`);
    if (!control) return;
    refocus.current = null;
    if (control !== document.activeElement) control.focus();
  }, [columns]);

  const settle = (id: string) =>
    setPending((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });

  // No success toast: the card moving is the feedback, and drags are announced to screen readers.
  const move = async (ticket: Ticket, status: TicketStatus) => {
    if (status === ticket.status || pending.has(ticket.id)) return;
    rememberFocus(ticket.number);
    setPending((current) => new Map(current).set(ticket.id, status));
    const saved = (update: Ticket[] | ((list?: Ticket[]) => Ticket[])) => {
      tickets.mutate(update);
      // A list request sent before the save committed could still land with the old status: drop
      // it, so the pending overlay can go in the same render. The live refresh brings the next list.
      tickets.invalidate();
      settle(ticket.id);
      void reloadOverview();
    };
    try {
      const updated = await api.updateTicket(propertyId, ticket.id, { status });
      saved((list = []) => list.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      // The save can reach the hub even when its reply is lost: check before reporting a failure.
      if (err instanceof ApiError && err.status === 0) {
        const fresh = await api.tickets(propertyId).catch(() => null);
        if (fresh?.find((t) => t.id === ticket.id)?.status === status) return saved(fresh);
      }
      rememberFocus(ticket.number);
      settle(ticket.id);
      toast.error(`Couldn't move ${ticket.number}`, err);
    }
  };

  // Screen reader narration for drags (dnd-kit reads these out through its live region).
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const accessibility = useMemo(() => {
    const name = (active: Active) => ticketOf(active)?.number ?? "The work order";
    const home = (active: Active) => columnOfData(active.data.current);
    /** Where the card is now, if someone else moved it while it was being dragged. */
    const movedElsewhere = (active: Active) => {
      const now = latest.current?.find((t) => t.id === active.id)?.status;
      return now && now !== home(active) ? now : undefined;
    };
    const announcements: Announcements = {
      onDragStart: ({ active }) => {
        lastOver.current = home(active) ?? null;
        const from = home(active);
        return `Picked up ${name(active)}${from ? ` from ${columnLabel(from)}` : ""}.`;
      },
      onDragOver: ({ active, over }) => {
        const id = over?.id ?? null;
        if (id === lastOver.current) return undefined;
        lastOver.current = id;
        if (!over) return `${name(active)} is not over a column.`;
        return over.id === home(active) ? `${name(active)} is back over ${columnLabel(over.id)}, where it started.` : `${name(active)} is over ${columnLabel(over.id)}.`;
      },
      onDragEnd: ({ active, over }) => {
        const from = home(active);
        const elsewhere = movedElsewhere(active);
        if (elsewhere) return `${name(active)} was moved to ${columnLabel(elsewhere)} by someone else while you were dragging, so your move wasn't applied.`;
        if (!over || !isColumn(over.id)) return `${name(active)} was dropped outside the board. It stays in ${from ? columnLabel(from) : "its column"}.`;
        if (over.id === from) return `${name(active)} was dropped back in ${columnLabel(over.id)}. Nothing changed.`;
        return `Moved ${name(active)} to ${columnLabel(over.id)}.`;
      },
      onDragCancel: ({ active }) => {
        const from = home(active);
        return `Move cancelled. ${name(active)} stays in ${from ? columnLabel(from) : "its column"}.`;
      },
    };
    return { announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS };
  }, []);

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    const ticket = ticketOf(active);
    if (!ticket) return;
    setDrag({ ticket, board });
    // A small buzz confirms the long-press on phones that support it.
    if (typeof TouchEvent !== "undefined" && activatorEvent instanceof TouchEvent) navigator.vibrate?.(10);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDrag(null);
    const ticket = ticketOf(active);
    if (!ticket) return;
    // Someone else moved it mid-drag: don't overwrite their change (the board now shows it).
    const now = latest.current?.find((t) => t.id === ticket.id)?.status;
    if (now && now !== ticket.status) {
      toast.info(`${ticket.number} was moved to ${TICKET_STATUS_LABELS[now]}`, "Someone else changed it while you were dragging, so your move wasn't applied.");
      return;
    }
    if (over && isColumn(over.id) && over.id !== ticket.status) void move(ticket, over.id);
  };

  const collisions = useMemo(() => boardCollisions(() => scroller.current), []);
  // Counted from what the board shows, so the line can't disagree with a board held still mid-drag.
  const total = COLUMNS.reduce((n, status) => n + (columns.get(status)?.length ?? 0), 0);
  const open = total - (columns.get("done")?.length ?? 0);
  const tracks = COLUMNS.map((status) => (columns.get(status)?.length ? OCCUPIED_TRACK : EMPTY_TRACK)).join(" ");

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3 sm:items-center">
        <div className="min-w-0">
          <h2 className="heading-display text-[15px] leading-6 text-ink">Work orders</h2>
          <p className="text-[13px] text-muted">
            {tickets.data ? (
              <>
                {open} open · {total} total. <span className="pointer-coarse:hidden">Drag</span>
                <span className="hidden pointer-coarse:inline">Press and hold</span> a card to change its status.
                <span className="max-sm:hidden"> P1/P2 maintenance creates tickets automatically.</span>
              </>
            ) : (
              "Loading…"
            )}
          </p>
        </div>
        {/* Wrappers carry the breakpoint (the buttons set their own display): an icon button on a phone. */}
        <div className="hidden shrink-0 sm:block">
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            New work order
          </Button>
        </div>
        <div className="shrink-0 sm:hidden">
          <IconButton icon="plus" label="New work order" variant="primary" size="md" onClick={() => setCreating(true)} />
        </div>
      </div>

      {tickets.loading ? (
        <BoardSkeleton />
      ) : tickets.error ? (
        <Card>
          <ErrorState error={tickets.error} onRetry={tickets.reload} title="Couldn't load work orders" />
        </Card>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={collisions}
          accessibility={accessibility}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDrag(null)}
        >
          {/* relative: the scroller must contain the cards' sr-only (absolute) labels, or they widen the page. */}
          <div ref={scroller} className="relative -mx-4 overflow-x-auto px-4 pb-2 scrollbar-thin sm:mx-0 sm:px-0">
            <div className="grid gap-3 transition-[grid-template-columns] duration-200" style={{ gridTemplateColumns: tracks }}>
              {COLUMNS.map((status) => {
                const list = columns.get(status) ?? [];
                return (
                  <BoardColumn key={status} status={status} count={list.length} dragging={drag !== null} source={drag?.ticket.status === status}>
                    <ul className="space-y-3">
                      {list.map((ticket) => (
                        <TicketCard
                          key={ticket.id}
                          ticket={ticket}
                          contractor={ticket.contractorId ? contactsById.get(ticket.contractorId) : undefined}
                          moving={pending.has(ticket.id)}
                          onMove={(next) => void move(ticket, next)}
                        />
                      ))}
                    </ul>
                  </BoardColumn>
                );
              })}
            </div>
          </div>
          {/* Portalled so a transformed ancestor can't offset the fixed-position overlay. */}
          {createPortal(
            <DragOverlay dropAnimation={reducedMotion ? null : DROP_ANIMATION}>
              {drag ? (
                <TicketCardOverlay ticket={drag.ticket} contractor={drag.ticket.contractorId ? contactsById.get(drag.ticket.contractorId) : undefined} />
              ) : null}
            </DragOverlay>,
            document.body,
          )}
        </DndContext>
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
