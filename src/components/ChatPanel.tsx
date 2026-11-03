import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ChatMessage } from "../../shared/types";
import { useResource } from "../hooks/useResource";
import { cx } from "../lib/cx";
import { formatDateTime, formatTime } from "../lib/format";
import { useSession } from "../providers/SessionProvider";
import { CitationList } from "./ApprovalCard";
import { Button } from "./Button";
import { Card } from "./Card";
import { ErrorState } from "./EmptyState";
import { textareaClasses } from "./Field";
import { Icon } from "./Icon";
import { ConfirmDialog } from "./Modal";
import { RichText } from "./RichText";
import { Skeleton } from "./Skeleton";
import { useToast } from "./Toast";

interface ChatPanelProps {
  title: string;
  description: string;
  /** Who answers, for the empty state and typing indicator: "the SP 26707 agent". */
  assistantName: string;
  /** What the assistant can do, shown in the empty state. */
  intro: string;
  /** Identity of the conversation (resets the view when it changes). */
  resourceKey: string;
  load: () => Promise<ChatMessage[]>;
  send: (text: string) => Promise<ChatMessage>;
  reset: () => Promise<unknown>;
  suggestions: string[];
  aiOnline: boolean;
  /** Bumps when the agent's state changes, so another staff member's messages show up. */
  refreshKey?: unknown;
  /** Live "what the agent is doing" label while it works on the reply. */
  busyLabel?: string | null;
  /** Building id, so citations link into that building's vault. */
  propertyId?: string;
  /** What answers look like with no LLM, shown above the composer. */
  offlineHint?: string;
  className?: string;
}

interface PendingTurn {
  text: string;
  /** How many server messages existed when this turn was sent; later ones stay hidden until it completes. */
  baseCount: number;
}

/** Plain labels for the agents' tools (the raw names mean nothing to staff). */
const TOOL_NAMES: Record<string, string> = {
  search_documents: "Searched documents",
  read_document: "Read a document",
  list_contacts: "Checked contacts",
  list_tickets: "Checked work orders",
  list_threads: "Checked the inbox",
  create_ticket: "Created a work order",
  remember: "Saved a memory note",
  draft_reply: "Drafted a reply",
  list_properties: "Checked buildings",
  property_overview: "Checked a building",
  search_property_documents: "Searched a building's documents",
  list_open_items: "Checked open items",
};

function ToolChips({ calls }: { calls: ChatMessage["toolCalls"] }) {
  if (calls.length === 0) return null;
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Tools used">
      {calls.map((call, i) => (
        <li
          key={`${call.name}-${i}`}
          title={call.summary}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-violet-50 px-2 py-0.5 text-[11px] text-violet-900 ring-1 ring-violet-200 ring-inset"
        >
          <Icon name="bolt" className="size-3 text-violet-500" />
          <span className="font-medium">{TOOL_NAMES[call.name] ?? call.name.replace(/_/g, " ")}</span>
          {call.summary ? <span className="truncate text-violet-800/80">{call.summary}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function AssistantAvatar() {
  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/15">
      <Icon name="bot" className="size-4" />
    </span>
  );
}

/** Mail sent to the hub address is stored in the Chief of Staff log; it is untrusted, so it never looks like an answer. */
function InboundEmailCard({ message }: { message: ChatMessage }) {
  return (
    <li>
      <div className="rounded-xl border border-dashed border-line-strong bg-surface px-4 py-3">
        <p className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <Icon name="mail" className="size-3.5" />
          <span className="font-semibold text-ink-soft">Inbound email (unverified)</span>
          <span>· {message.author?.replace(/^Email from /, "")}</span>
          <span>
            · <time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{formatTime(message.createdAt)}</time>
          </span>
        </p>
        <div className="text-[13px] leading-relaxed whitespace-pre-wrap text-ink-soft">{message.text}</div>
      </div>
    </li>
  );
}

function MessageBubble({ message, propertyId }: { message: ChatMessage; propertyId?: string }) {
  if (message.role === "assistant" && message.author?.startsWith("Email from ")) return <InboundEmailCard message={message} />;
  if (message.role === "user") {
    return (
      <li className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[75%]">
          <p className="mb-1 text-right text-[11px] text-muted">
            {message.author ?? "You"} · <time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{formatTime(message.createdAt)}</time>
          </p>
          <div className="rounded-2xl rounded-tr-md bg-navy px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-white">{message.text}</div>
        </div>
      </li>
    );
  }
  return (
    <li className="flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-[11px] text-muted">
          <time dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>{formatTime(message.createdAt)}</time>
        </p>
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3">
          <ToolChips calls={message.toolCalls} />
          <RichText text={message.text} />
          {message.citations.length ? (
            <div className="mt-3 border-t border-line pt-3">
              <CitationList citations={message.citations} propertyId={propertyId} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function TypingBubble({ label }: { label: string }) {
  return (
    <li className="flex gap-3" aria-live="polite">
      <AssistantAvatar />
      <div className="flex items-center gap-2.5 rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-[13px] text-muted">
        <span aria-hidden="true" className="flex gap-1">
          {[0, 150, 300].map((delay) => (
            <span key={delay} className="size-1.5 animate-soft-pulse rounded-full bg-accent" style={{ animationDelay: `${delay}ms` }} />
          ))}
        </span>
        <span>{label}</span>
      </div>
    </li>
  );
}

function Suggestions({ items, onPick, disabled }: { items: string[]; onPick: (text: string) => void; disabled: boolean }) {
  return (
    <ul className="flex flex-wrap justify-center gap-2" aria-label="Suggested questions">
      {items.map((text) => (
        <li key={text}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPick(text)}
            className="rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent-strong disabled:opacity-60"
          >
            {text}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Conversation with an agent: history, tool-call chips, citations, suggested prompts and a composer. */
export function ChatPanel({
  title,
  description,
  assistantName,
  intro,
  resourceKey,
  load,
  send,
  reset,
  suggestions,
  aiOnline,
  refreshKey,
  busyLabel,
  propertyId,
  offlineHint = "AI offline: answers show matching document passages only.",
  className,
}: ChatPanelProps) {
  const toast = useToast();
  const { session } = useSession();
  const inputId = useId();
  const history = useResource(resourceKey, load, refreshKey);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages = history.data ?? [];
  const visible = pending ? messages.slice(0, pending.baseCount) : messages;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [visible.length, pending]);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    const turn = { text: trimmed, baseCount: messages.length };
    setPending(turn);
    setDraft("");
    try {
      const reply = await send(trimmed);
      const sent: ChatMessage = {
        id: `local-${reply.id}`,
        role: "user",
        text: trimmed,
        author: session.staffName,
        toolCalls: [],
        citations: [],
        createdAt: reply.createdAt,
      };
      history.mutate((prev) => [...(prev ?? []).slice(0, turn.baseCount), sent, reply]);
      void history.reload();
    } catch (err) {
      toast.error("The agent couldn't answer", err);
      setDraft(trimmed);
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit(draft);
    }
  };

  const doReset = async () => {
    await reset();
    history.mutate([]);
    toast.success("Conversation cleared");
  };

  const empty = !history.loading && !history.error && visible.length === 0 && !pending;

  return (
    <Card className={cx("flex flex-col overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5 sm:py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 hidden text-[13px] text-muted sm:block">{description}</p>
        </div>
        <Button
          size="sm"
          icon="refresh"
          aria-label="New conversation"
          disabled={!!pending || messages.length === 0}
          onClick={() => setConfirmReset(true)}
        >
          <span className="hidden sm:inline">New conversation</span>
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-[240px] flex-1 overflow-y-auto bg-subtle/60 px-4 py-5 scrollbar-thin sm:min-h-[360px] sm:px-6">
        {history.loading ? (
          <div className="space-y-5" aria-label="Loading conversation" role="status">
            <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
            <Skeleton className="h-24 w-4/5 rounded-2xl" />
            <Skeleton className="ml-auto h-10 w-1/3 rounded-2xl" />
          </div>
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={history.reload} title="Couldn't load the conversation" compact />
        ) : empty ? (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">
              <Icon name="bot" className="size-6" />
            </span>
            <p className="mt-3 text-sm font-semibold text-ink">Ask {assistantName}</p>
            <p className="mt-1 mb-5 max-w-sm text-[13px] text-muted">{intro}</p>
            <Suggestions items={suggestions} onPick={submit} disabled={!!pending} />
          </div>
        ) : (
          <ol className="space-y-5" aria-label="Conversation">
            {visible.map((message) => (
              <MessageBubble key={message.id} message={message} propertyId={propertyId} />
            ))}
            {pending ? (
              <>
                <MessageBubble
                  message={{
                    id: "pending",
                    role: "user",
                    text: pending.text,
                    author: session.staffName,
                    toolCalls: [],
                    citations: [],
                    createdAt: new Date().toISOString(),
                  }}
                />
                <TypingBubble label={busyLabel || `${assistantName.replace(/^the /, "The ")} is thinking…`} />
              </>
            ) : null}
          </ol>
        )}
      </div>

      <form onSubmit={onSubmit} className="border-t border-line bg-surface px-4 py-3 sm:px-5">
        {!aiOnline ? (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-800">
            <Icon name="alert" className="size-3.5" />
            {offlineHint}
          </p>
        ) : session.ai?.provider === "workers-ai" ? (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-sky-800">
            <Icon name="alert" className="size-3.5" />
            Workers AI light mode{session.ai.model ? ` (${session.ai.model})` : ""}: one answer from a document search, no tools.
          </p>
        ) : null}
        {!empty && !pending && visible.length > 0 && visible.length < 3 ? (
          <div className="mb-2.5 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-thin">
            {suggestions.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => submit(text)}
                className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-accent/40 hover:text-accent-strong"
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <label htmlFor={inputId} className="sr-only">
            Message {assistantName}
          </label>
          <textarea
            ref={inputRef}
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={Math.min(6, Math.max(1, draft.split("\n").length))}
            maxLength={4000}
            placeholder={`Message ${assistantName}…`}
            className={textareaClasses("min-h-10 resize-none")}
          />
          <Button type="submit" variant="primary" icon="send" loading={!!pending} disabled={!draft.trim()} aria-label="Send message">
            <span className="hidden sm:inline">Send</span>
          </Button>
        </div>
        <p className="mt-1.5 hidden text-[11px] text-muted sm:block">Enter to send · Shift+Enter for a new line</p>
      </form>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={doReset}
        title="Start a new conversation?"
        description="This clears the chat history for everyone. Memory notes, documents and records are kept."
        confirmLabel="Clear conversation"
      />
    </Card>
  );
}
