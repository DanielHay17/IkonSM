import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, PageHeader } from "../components/Card";
import { ErrorState } from "../components/EmptyState";
import { Modal } from "../components/Modal";
import { Spinner } from "../components/Spinner";
import { SampleBadge } from "../components/StatusBadges";
import { BRAIN_KINDS, BRAIN_KIND_LABELS, brainGraph, type BrainKind, type BrainNode } from "../lib/brain";
import { mountBrainGraph, type MountedBrainGraph } from "../lib/brainGraph";
import { cx } from "../lib/cx";
import { usePortfolio } from "../providers/PortfolioProvider";
import { navigate, paths } from "../router";
import "./brain.css";

function KindShape({ kind }: { kind: BrainKind }) {
  return (
    <svg width="14" height="14" viewBox="-7 -7 14 14" className="brain-shape shrink-0" aria-hidden="true">
      {kind === "skill" ? (
        <rect className="shape is-skill" x="-5.6" y="-5.6" width="11.2" height="11.2" transform="rotate(45) scale(.8)" />
      ) : kind === "building" ? (
        <rect className="shape is-building" x="-3.9" y="-5.6" width="7.8" height="11.2" />
      ) : kind === "doc" ? (
        <rect className="shape is-doc" x="-4.9" y="-4.9" width="9.8" height="9.8" />
      ) : (
        <circle className={`shape is-${kind}`} r="5.6" />
      )}
    </svg>
  );
}

const kindLabel = (n: BrainNode) => (n.kind === "core" ? "Start here" : BRAIN_KIND_LABELS[n.kind].one);

export function BrainPage() {
  const { cards, error, reload } = usePortfolio();
  // The portfolio is polled: the graph is rebuilt only when a building is added, removed or renamed.
  const key = cards?.map((c) => `${c.profile.id}|${c.profile.street}|${c.profile.suburb}|${c.profile.status}`).join("\n");
  const data = useMemo(() => (cards ? brainGraph(cards) : null), [key]);
  const byId = useMemo(() => new Map(data?.nodes.map((n) => [n.id, n])), [data]);

  const svg = useRef<SVGSVGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const graph = useRef<MountedBrainGraph | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<BrainKind>>(new Set());
  const [traced, setTraced] = useState<{ id: string; corner: "left" | "right" } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!svg.current || !data) return;
    const mounted = mountBrainGraph(svg.current, data, {
      onOpen: setOpenId,
      onTrace: (id, corner) => setTraced(id ? { id, corner } : null),
      tooltip: () => tip.current,
    });
    graph.current = mounted;
    return () => {
      graph.current = null;
      mounted.destroy();
    };
  }, [data]);
  useEffect(() => graph.current?.setHidden(hidden), [hidden, data]);
  useEffect(() => graph.current?.setPaused(openId !== null), [openId, data]);

  const open = openId ? byId.get(openId) : undefined;
  const tracedNode = traced ? byId.get(traced.id) : undefined;
  const connected = useMemo(() => {
    if (!open || !data) return [];
    const ids = new Set(data.edges.flatMap(([a, b]) => (a === open.id ? [b] : b === open.id ? [a] : [])));
    return data.nodes.filter((n) => ids.has(n.id));
  }, [open, data]);
  const count = (kind: BrainKind) => data?.nodes.filter((n) => n.kind === kind).length ?? 0;

  const toggle = (kind: BrainKind) =>
    setHidden((before) => {
      const next = new Set(before);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });

  return (
    <>
      <PageHeader
        title="AI Brain"
        description="Ikon's shared brain: one page per building, the rules, and how repeat jobs are done. This is the map; the pages themselves stay in the brain."
      />
      {error && !cards ? (
        <Card>
          <ErrorState error={error} onRetry={reload} title="Couldn't load the buildings" />
        </Card>
      ) : !data ? (
        <p className="flex items-center gap-3 py-10 text-sm text-muted">
          <Spinner className="size-5 text-accent" label={null} />
          Loading…
        </p>
      ) : (
        <Card className="relative overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            {BRAIN_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={!hidden.has(kind)}
                onClick={() => toggle(kind)}
                className={cx(
                  "inline-flex min-h-10 items-center gap-2 border border-line-strong px-3 text-[13px] transition-colors hover:border-ink active:bg-sunken sm:min-h-9",
                  hidden.has(kind) ? "bg-subtle text-muted" : "bg-surface text-ink",
                )}
              >
                <KindShape kind={kind} />
                {BRAIN_KIND_LABELS[kind].many}
                <span className="text-muted tabular-nums">{count(kind)}</span>
              </button>
            ))}
            <p className="text-xs text-muted sm:ml-auto">
              <span className="[@media(hover:none)]:hidden">Hover to trace links, click to read, drag to move</span>
              <span className="hidden [@media(hover:none)]:inline">Tap to trace links, tap again to read</span>
            </p>
          </div>
          <svg ref={svg} className="brain-graph" role="group" aria-label="How the brain's pages connect" />
          <div
            ref={tip}
            hidden={!tracedNode}
            className={cx(
              "pointer-events-none absolute bottom-3.5 max-w-[min(320px,calc(100%-28px))] bg-charcoal px-3.5 py-2.5 text-[13px] leading-snug text-charcoal-text shadow-pop",
              traced?.corner === "right" ? "right-3.5" : "left-3.5",
            )}
          >
            <p className="font-semibold text-white">{tracedNode?.title}</p>
            <p>{tracedNode?.summary}</p>
          </div>
        </Card>
      )}

      <Modal
        open={Boolean(open)}
        onClose={() => setOpenId(null)}
        placement="right"
        size="md"
        title={open?.title ?? ""}
        plainTitle
        description={open ? kindLabel(open) : undefined}
        footer={
          open?.propertyId ? (
            <Button variant="primary" onClick={() => navigate(paths.building(open.propertyId as string))}>
              Open building
            </Button>
          ) : undefined
        }
      >
        {open ? (
          <div className="space-y-6">
            <div className="space-y-2">
              {open.pilot || open.sample ? (
                <p className="flex gap-2">
                  {open.pilot ? <Badge tone="accent">Pilot</Badge> : null}
                  {open.sample ? <SampleBadge /> : null}
                </p>
              ) : null}
              <p className="text-sm leading-relaxed text-ink-soft">{open.summary}</p>
            </div>
            <section>
              <h3 className="heading-display mb-2 text-[13px] leading-6 text-ink">Connected to</h3>
              <ul className="flex flex-wrap gap-2">
                {connected.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(n.id)}
                      className="inline-flex min-h-9 items-center gap-2 border border-line-strong px-3 text-left text-[13px] text-ink transition-colors hover:border-ink active:bg-sunken"
                    >
                      <KindShape kind={n.kind === "core" ? "rule" : n.kind} />
                      {n.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
