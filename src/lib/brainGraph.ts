// The Brain screen's force graph, drawn straight into an <svg> (no library). Every page has a home and a spring to
// it, so a drag can interrupt anything. It rests when idle, off screen or behind a dialog, and draws no motion when
// the reader prefers reduced motion. On touch the first tap traces a page's links and the second opens it.

import { BRAIN_CORE_ID, type BrainGraphData, type BrainKind, type BrainNode } from "./brain";

interface Dot extends BrainNode {
  x: number;
  y: number;
  /** Home. */
  hx: number;
  hy: number;
  vx: number;
  vy: number;
  /** Space the shape and its label need: half width, above, below. */
  w: number;
  up: number;
  down: number;
  depth: number;
  /** Entrance delay in ms; 0 once shown. */
  wait: number;
  phase: number;
  fixed: boolean;
}

interface Pulse {
  a: string;
  b: string;
  el: SVGCircleElement;
  t: number;
  hops: number;
  ms: number;
}

export interface BrainGraphOptions {
  onOpen: (id: string) => void;
  /** The page being traced, or null. The tooltip is the caller's. */
  onTrace: (id: string | null, corner: "left" | "right") => void;
  tooltip: () => HTMLElement | null;
}

export interface MountedBrainGraph {
  setHidden: (kinds: ReadonlySet<BrainKind>) => void;
  setPaused: (paused: boolean) => void;
  destroy: () => void;
}

const NS = "http://www.w3.org/2000/svg";
const NARROW = 560;
const REST_AFTER_MS = 6000;

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** One shape per kind: the palette is monochrome, so colour never carries the meaning alone. */
export function brainShape(kind: BrainNode["kind"], r: number): SVGElement {
  const cls = { class: `shape is-${kind}` };
  if (kind === "skill") return svgEl("rect", { ...cls, x: -r, y: -r, width: 2 * r, height: 2 * r, transform: "rotate(45) scale(.8)" });
  if (kind === "building") return svgEl("rect", { ...cls, x: -r * 0.7, y: -r, width: r * 1.4, height: r * 2 });
  if (kind === "doc") return svgEl("rect", { ...cls, x: -r * 0.88, y: -r * 0.88, width: r * 1.76, height: r * 1.76 });
  return svgEl("circle", { ...cls, r });
}

export function mountBrainGraph(svg: SVGSVGElement, data: BrainGraphData, options: BrainGraphOptions): MountedBrainGraph {
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
  const near = new Map<string, Set<string>>(data.nodes.map((n) => [n.id, new Set<string>()]));
  for (const [a, b] of data.edges) {
    near.get(a)?.add(b);
    near.get(b)?.add(a);
  }
  const links = (id: string) => near.get(id) ?? new Set<string>();

  let W = 0;
  let H = 0;
  let dots: Dot[] = [];
  let byId = new Map<string, Dot>();
  let groups = new Map<string, SVGGElement>();
  let lines: SVGLineElement[] = [];
  let pulseLayer = svgEl("g");
  let pulses: Pulse[] = [];
  let hidden: ReadonlySet<BrainKind> = new Set();
  let hot: string | null = null;
  let picked: string | null = null;
  let drag: { dot: Dot; x: number; y: number; pointer: number } | null = null;
  let moved = false;
  let byTouch = false;
  let paused = false;
  let seen = true;
  let raf = 0;
  let last = 0;
  let born = 0;
  let awake = 0;
  let drift = 0;
  let nextPulse = 0;
  let soon = 0;

  const dot = (id: string): Dot => byId.get(id) as Dot;
  const radius = (n: BrainNode) => (n.kind === "core" ? 20 : n.kind === "idea" ? 8 : 9 + Math.min(6, links(n.id).size * 0.5));
  const named = (n: BrainNode) => n.kind === "core" || n.kind === "skill" || n.kind === "doc" || W >= NARROW;
  const shownDot = (id: string) => {
    const g = groups.get(id);
    return Boolean(g) && !g?.classList.contains("off") && !g?.classList.contains("wait");
  };

  function layout() {
    const box = svg.getBoundingClientRect();
    W = Math.max(280, box.width);
    H = Math.max(300, box.height);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const lean: Record<BrainNode["kind"], number> = { core: 0, building: Math.PI, rule: -1.5, skill: -0.5, idea: -0.1, doc: 0.8 };
    const count: Partial<Record<BrainNode["kind"], number>> = {};
    dots = data.nodes.map((n, i) => {
      const k = (count[n.kind] = (count[n.kind] ?? 0) + 1);
      const angle = lean[n.kind] + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.19;
      const reach = n.kind === "core" ? 0 : 0.34;
      const r = radius(n);
      const label = named(n) ? (n.title.length * (n.kind === "core" ? 9.6 : 7.3)) / 2 + 5 : 0;
      const x = W / 2 + Math.cos(angle) * reach * W;
      const y = H / 2 + Math.sin(angle) * reach * H;
      return { ...n, x, y, hx: x, hy: y, vx: 0, vy: 0, w: Math.max(r + 5, label), up: r + 5, down: named(n) ? r + 25 : r + 5, depth: 99, wait: 0, phase: i * 1.7, fixed: false };
    });
    byId = new Map(dots.map((d) => [d.id, d]));
    for (let k = 0; k < 360; k++) step((1 - k / 360) * Math.min(W, H) * 0.05 + 0.4);
    for (let k = 0; k < 90; k++) apart();
  }

  function step(limit: number) {
    const k = 0.62 * Math.sqrt((W * H) / dots.length);
    const push = new Map(dots.map((d) => [d.id, { x: 0, y: 0 }]));
    const at = (id: string) => push.get(id) as { x: number; y: number };
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i] as Dot;
        const b = dots[j] as Dot;
        const dx = a.x - b.x || 0.1;
        const dy = a.y - b.y || 0.1;
        const force = ((k * k) / Math.max(40, dx * dx + dy * dy)) * (a.kind === "core" || b.kind === "core" ? 1.8 : 1);
        at(a.id).x += dx * force;
        at(a.id).y += dy * force;
        at(b.id).x -= dx * force;
        at(b.id).y -= dy * force;
      }
    }
    for (const [p, q] of data.edges) {
      const a = dot(p);
      const b = dot(q);
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const force = ((Math.hypot(dx, dy) || 1) / k) * (p === BRAIN_CORE_ID ? 0.55 : 0.3);
      at(p).x -= dx * force;
      at(p).y -= dy * force;
      at(q).x += dx * force;
      at(q).y += dy * force;
    }
    for (const d of dots) {
      const pull = d.kind === "core" ? 0.9 : 0.16;
      const x = at(d.id).x + ((W / 2 - d.x) * pull * H) / W;
      const y = at(d.id).y + (H / 2 - d.y) * pull;
      const length = Math.hypot(x, y) || 1;
      d.x += (x * Math.min(length, limit)) / length;
      d.y += (y * Math.min(length, limit)) / length;
    }
    apart();
  }

  /** No shape or label sits on another, and everything stays inside the frame. */
  function apart() {
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i] as Dot;
        const b = dots[j] as Dot;
        const ox = a.w + b.w - Math.abs(a.x - b.x);
        const oy = a.y < b.y ? a.y + a.down - (b.y - b.up) : b.y + b.down - (a.y - a.up);
        if (ox <= 0 || oy <= 0) continue;
        const share = a.fixed ? 0 : b.fixed ? 1 : 0.5;
        if (ox < oy * 1.4) {
          const side = a.x < b.x ? -1 : 1;
          a.x += side * ox * share;
          b.x -= side * ox * (1 - share);
        } else {
          const side = a.y < b.y ? -1 : 1;
          a.y += side * oy * share;
          b.y -= side * oy * (1 - share);
        }
      }
    }
    for (const d of dots) {
      d.x = Math.max(d.w + 6, Math.min(W - d.w - 6, d.x));
      d.y = Math.max(d.up + 8, Math.min(H - d.down - 8, d.y));
    }
  }

  function draw() {
    svg.replaceChildren();
    lines = data.edges.map(() => svg.appendChild(svgEl("line", { class: "edge" })));
    pulseLayer = svg.appendChild(svgEl("g"));
    pulses = [];
    groups = new Map();
    for (const d of dots) {
      const g = svgEl("g", { class: `node is-${d.kind}${named(d) ? "" : " bare"}`, tabindex: 0, role: "button", "aria-label": `${d.title}. ${d.summary}` });
      g.dataset.id = d.id;
      const r = radius(d);
      g.appendChild(svgEl("circle", { class: "target", r: Math.max(18, r + 5) }));
      const body = g.appendChild(svgEl("g", { class: "body" }));
      body.appendChild(brainShape(d.kind, r));
      const text = g.appendChild(svgEl("text", { y: r + 18 }));
      text.textContent = d.title;
      svg.appendChild(g);
      groups.set(d.id, g);
    }
    place();
  }

  function place() {
    data.edges.forEach(([p, q], i) => {
      const line = lines[i];
      const a = byId.get(p);
      const b = byId.get(q);
      if (!line || !a || !b) return;
      line.setAttribute("x1", a.x.toFixed(1));
      line.setAttribute("y1", a.y.toFixed(1));
      line.setAttribute("x2", b.x.toFixed(1));
      line.setAttribute("y2", b.y.toFixed(1));
    });
    for (const d of dots) groups.get(d.id)?.setAttribute("transform", `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})`);
  }

  function applyHidden() {
    for (const d of dots) groups.get(d.id)?.classList.toggle("off", d.kind !== "core" && hidden.has(d.kind));
    data.edges.forEach(([p, q], i) => lines[i]?.classList.toggle("off", [p, q].some((id) => groups.get(id)?.classList.contains("off"))));
  }

  function focus(id: string | null) {
    svg.classList.toggle("dim", Boolean(id));
    for (const g of groups.values()) g.classList.remove("on", "hot", "mute");
    for (const l of lines) l.classList.remove("on");
    if (!id) return options.onTrace(null, "left");
    for (const x of [id, ...links(id)]) groups.get(x)?.classList.add("on");
    groups.get(id)?.classList.add("hot");
    data.edges.forEach(([p, q], i) => (p === id || q === id) && lines[i]?.classList.add("on"));
    const tip = options.tooltip();
    const tw = (tip?.offsetWidth || 260) + 24;
    const th = (tip?.offsetHeight || 80) + 24;
    const under = (right: boolean) => [id, ...links(id)].filter((x) => shownDot(x) && dot(x).y > H - th && (right ? dot(x).x > W - tw : dot(x).x < tw)).length;
    options.onTrace(id, under(false) > under(true) ? "right" : "left");
    fitLabels(id);
  }

  /** Labels that only show while tracing: kept inside the frame, below or above their shape, and dropped if they would sit on another. */
  function fitLabels(id: string) {
    const taken: number[][] = [];
    const hits = (b: number[]) => taken.some((t) => (b[0] as number) < (t[2] as number) && (t[0] as number) < (b[2] as number) && (b[1] as number) < (t[3] as number) && (t[1] as number) < (b[3] as number));
    const rank = (x: string) => (named(dot(x)) ? 0 : x === id ? 1 : 2);
    for (const x of [id, ...links(id)].filter(shownDot).sort((a, b) => rank(a) - rank(b))) {
      const d = dot(x);
      const text = groups.get(x)?.querySelector("text");
      if (!text) continue;
      const half = text.getComputedTextLength() / 2 + 3;
      const r = radius(d);
      const box = (dx: number, y: number) => [d.x + dx - half, d.y + y - 12, d.x + dx + half, d.y + y + 5];
      if (rank(x) === 0) {
        taken.push(box(0, r + 18));
        continue;
      }
      const dx = Math.max(half + 4 - d.x, Math.min(0, W - half - 4 - d.x));
      const rows = [r + 18, -r - 8].filter((y) => d.y + y + 6 < H && d.y + y > 14);
      const free = rows.find((y) => !hits(box(dx, y)));
      const y = free ?? rows[0] ?? r + 18;
      text.setAttribute("x", String(dx));
      text.setAttribute("y", String(y));
      if (free === undefined && x !== id) groups.get(x)?.classList.add("mute");
      else taken.push(box(dx, y));
    }
  }

  function trace(id: string | null) {
    hot = id;
    nextPulse = 0;
    awake = performance.now();
    focus(id);
    run();
  }

  const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];
  const outward = (id: string) => [...links(id)].filter((x) => dot(x).depth > dot(id).depth);

  function pulse(a: string, b: string, hops: number) {
    if (pulses.length > 36 || !shownDot(a) || !shownDot(b)) return;
    const el = pulseLayer.appendChild(svgEl("circle", { class: "pulse", r: hops ? 2.2 : 2.6, opacity: 0 }));
    pulses.push({ a, b, el, t: 0, hops, ms: Math.max(420, Math.min(1100, Math.hypot(dot(a).x - dot(b).x, dot(a).y - dot(b).y) * 4.2)) });
  }

  function frame(now: number) {
    const ms = Math.min(50, now - last || 16.7);
    const f = ms / 16.7;
    last = now;
    let busy = Boolean(drag) || pulses.length > 0;
    const rest = now - awake > REST_AFTER_MS && !drag;
    const live = seen && !paused && !document.hidden && !calm.matches;
    drift += ((hot || drag || rest || !live ? 0 : 1) - drift) * 0.06 * f;
    for (const d of dots) {
      if (d.wait) {
        if (now - born < d.wait) {
          busy = true;
          continue;
        }
        d.wait = 0;
        groups.get(d.id)?.classList.remove("wait");
        data.edges.forEach(([p, q], i) => (p === d.id || q === d.id) && !dot(p).wait && !dot(q).wait && lines[i]?.classList.remove("wait"));
      }
      if (drag?.dot === d && moved) continue;
      const still = d.kind === "core" ? 0 : drift;
      let tx = d.hx + Math.cos(now / 2400 + d.phase) * 2.6 * still;
      let ty = d.hy + Math.sin(now / 2900 + d.phase * 1.3) * 2.6 * still;
      if (drag && moved && links(drag.dot.id).has(d.id)) {
        tx += (drag.dot.x - drag.dot.hx) * 0.2;
        ty += (drag.dot.y - drag.dot.hy) * 0.2;
      }
      const damp = Math.pow(0.62, f);
      d.vx = (d.vx + (tx - d.x) * 0.08 * f) * damp;
      d.vy = (d.vy + (ty - d.y) * 0.08 * f) * damp;
      d.x += d.vx * f;
      d.y += d.vy * f;
      if (Math.abs(d.vx) + Math.abs(d.vy) > 0.04) busy = true;
    }
    place();
    if (!calm.matches) {
      if (live && !rest && now > nextPulse && now - born > 1200) {
        if (hot) {
          for (const b of links(hot)) pulse(hot, b, 0);
          nextPulse = now + 1300;
        } else {
          const b = pick(outward(BRAIN_CORE_ID));
          if (b) pulse(BRAIN_CORE_ID, b, 2);
          nextPulse = now + 650;
        }
      }
      const onward: [string, string, number][] = [];
      pulses = pulses.filter((p) => {
        p.t += ms / p.ms;
        const a = dot(p.a);
        const b = dot(p.b);
        const t = Math.min(1, p.t);
        const k = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
        p.el.setAttribute("transform", `translate(${a.x + (b.x - a.x) * k} ${a.y + (b.y - a.y) * k})`);
        p.el.setAttribute("opacity", String((hot && p.a !== hot ? 0.15 : 1) * Math.min(1, 5 * t, 5 * (1 - t))));
        if (p.t < 1 && shownDot(p.a) && shownDot(p.b)) return true;
        p.el.remove();
        if (p.t >= 1 && p.hops && !hot && live && !rest) {
          const next = pick(outward(p.b));
          if (next) onward.push([p.b, next, p.hops - 1]);
        }
        return false;
      });
      for (const o of onward) pulse(...o);
    }
    raf = (live && (!rest || drift > 0.02)) || busy ? requestAnimationFrame(frame) : 0;
  }

  function run() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function boot(first: boolean) {
    layout();
    hot = null;
    const order = [BRAIN_CORE_ID];
    dot(BRAIN_CORE_ID).depth = 0;
    for (const id of order) {
      for (const x of links(id)) {
        if (dot(x).depth !== 99) continue;
        dot(x).depth = dot(id).depth + 1;
        order.push(x);
      }
    }
    for (const d of dots) {
      d.hx = d.x;
      d.hy = d.y;
    }
    born = awake = performance.now();
    // First look: pages grow out of the one that links to them.
    if (first && !calm.matches && !document.hidden) {
      order.forEach((id, i) => {
        if (i === 0) return;
        const d = dot(id);
        const from = dot([...links(id)].find((x) => dot(x).depth === d.depth - 1) ?? BRAIN_CORE_ID);
        d.x = (from.hx + d.hx * 0.15) / 1.15;
        d.y = (from.hy + d.hy * 0.15) / 1.15;
        d.wait = 80 + d.depth * 70 + i * 6;
      });
    }
    draw();
    for (const d of dots) if (d.wait) groups.get(d.id)?.classList.add("wait");
    data.edges.forEach(([p, q], i) => (dot(p).wait || dot(q).wait) && lines[i]?.classList.add("wait"));
    applyHidden();
    focus(null);
    run();
  }

  const idOf = (e: Event) => (e.target as Element | null)?.closest<SVGGElement>(".node")?.dataset.id ?? null;
  const stop = new AbortController();
  const on = (target: EventTarget, type: string, handler: (e: never) => void, opts: AddEventListenerOptions = {}) =>
    target.addEventListener(type, handler as EventListener, { ...opts, signal: stop.signal });

  on(svg, "pointerover", (e: PointerEvent) => {
    if (drag || e.pointerType === "touch") return;
    const id = idOf(e);
    clearTimeout(soon);
    if (id !== hot) soon = window.setTimeout(() => !drag && !paused && trace(id), hot && id ? 0 : 80);
  });
  on(svg, "pointerleave", (e: PointerEvent) => {
    if (drag || e.pointerType === "touch") return;
    clearTimeout(soon);
    trace(null);
  });
  on(
    svg,
    "pointermove",
    () => {
      awake = performance.now();
      run();
    },
    { passive: true },
  );
  on(svg, "focusin", (e: FocusEvent) => !byTouch && trace(idOf(e)));
  on(svg, "focusout", () => !byTouch && trace(null));
  on(svg, "keydown", (e: KeyboardEvent) => {
    const id = idOf(e);
    if (!id || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    options.onOpen(id);
  });
  on(svg, "click", (e: MouseEvent) => {
    const id = idOf(e);
    if (moved) return;
    if (!byTouch || (id && id === picked)) {
      if (id) options.onOpen(id);
      return;
    }
    picked = id;
    trace(id);
  });
  on(svg, "pointerdown", (e: PointerEvent) => {
    byTouch = e.pointerType === "touch";
    moved = false;
    const id = idOf(e);
    if (id && !drag && e.isPrimary && !byTouch) drag = { dot: dot(id), x: e.clientX, y: e.clientY, pointer: e.pointerId };
  });
  on(window, "pointermove", (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    if (!moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    if (!moved) {
      moved = true;
      svg.setPointerCapture(drag.pointer);
    }
    const box = svg.getBoundingClientRect();
    // Past the edge it drags instead of hitting a wall.
    const soft = (v: number, lo: number, hi: number) => (v < lo ? lo - Math.sqrt(lo - v) * 2 : v > hi ? hi + Math.sqrt(v - hi) * 2 : v);
    const x = soft(e.clientX - box.left, 24, W - 24);
    const y = soft(e.clientY - box.top, 24, H - 36);
    drag.dot.vx = x - drag.dot.x;
    drag.dot.vy = y - drag.dot.y;
    drag.dot.x = x;
    drag.dot.y = y;
    run();
  });
  const drop = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const d = drag.dot;
    drag = null;
    if (!moved) return;
    // Where it lands is its new home, and anything underneath moves over.
    d.hx = d.x;
    d.hy = d.y;
    const at = dots.map((m) => [m.x, m.y] as const);
    for (const m of dots) {
      m.x = m.hx;
      m.y = m.hy;
    }
    d.fixed = true;
    for (let k = 0; k < 40; k++) apart();
    d.fixed = false;
    dots.forEach((m, i) => {
      m.hx = m.x;
      m.hy = m.y;
      [m.x, m.y] = at[i] as readonly [number, number];
    });
    run();
  };
  on(window, "pointerup", drop);
  on(window, "pointercancel", drop);
  on(document, "visibilitychange", () => !document.hidden && run());
  on(calm, "change", run);

  const watch = new IntersectionObserver(([entry]) => {
    seen = entry?.isIntersecting ?? true;
    if (seen) run();
  });
  watch.observe(svg);
  let width = 0;
  let again = 0;
  const resize = new ResizeObserver(([entry]) => {
    const now = entry?.contentRect.width ?? 0;
    if (!width) width = now;
    if (Math.abs(now - width) < 1) return;
    width = now;
    clearTimeout(again);
    again = window.setTimeout(() => boot(false), 150);
  });
  resize.observe(svg);

  boot(true);
  return {
    setHidden: (kinds) => {
      hidden = kinds;
      applyHidden();
    },
    setPaused: (value) => {
      paused = value;
      clearTimeout(soon);
      trace(null);
    },
    destroy: () => {
      stop.abort();
      watch.disconnect();
      resize.disconnect();
      clearTimeout(soon);
      clearTimeout(again);
      cancelAnimationFrame(raf);
    },
  };
}
