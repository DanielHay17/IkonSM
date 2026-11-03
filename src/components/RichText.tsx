import type { ReactNode } from "react";
import { cx } from "../lib/cx";

// Renders the "markdown-ish" text the agents produce (headings, bullets, numbered lists,
// **bold**, `code`) as React elements. Never injects HTML.

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,3})\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  // The block that following lines extend (null after a blank line or heading).
  let open: Block | null = null;

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) {
      open = null;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! });
      open = null;
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const itemText = (bullet ?? numbered)?.[1];
    if (itemText !== undefined) {
      const ordered = !bullet;
      if (open?.kind === "list" && open.ordered === ordered) {
        open.items.push(itemText);
      } else {
        open = { kind: "list", ordered, items: [itemText] };
        blocks.push(open);
      }
      continue;
    }

    if (open?.kind === "list" && /^\s{2,}\S/.test(line)) {
      // Indented continuation of the previous list item.
      open.items[open.items.length - 1] += ` ${line.trim()}`;
    } else if (open?.kind === "paragraph") {
      open.lines.push(line);
    } else {
      open = { kind: "paragraph", lines: [line] };
      blocks.push(open);
    }
  }
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-ink/[0.06] px-1 py-px font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className={cx("space-y-2.5 text-sm leading-relaxed text-ink-soft", className)}>
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return (
            <p key={i} className={cx("font-semibold text-ink", block.level === 1 ? "text-[15px]" : "text-sm", i > 0 && "pt-1")}>
              {renderInline(block.text)}
            </p>
          );
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={i} className={cx("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc marker:text-line-strong")}>
              {block.items.map((item, j) => (
                <li key={j} className="pl-0.5">
                  {renderInline(item)}
                </li>
              ))}
            </ListTag>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/** Wraps occurrences of the query's words in <mark> (search result snippets). */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length > 1);
  if (terms.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "giu");
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0.5 text-ink">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
