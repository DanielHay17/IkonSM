// Drag-and-drop plumbing for column boards (the work orders kanban), built on @dnd-kit/core.
// Mouse and pen drag after a few pixels, touch after a short long-press (so a swipe still
// scrolls the page), and the keyboard picks up from the card's grip and moves column by column.

import {
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
  type PointerSensorOptions,
  type TouchSensorOptions,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { useMemo, useSyncExternalStore, type ComponentPropsWithRef, type PointerEvent, type TouchEvent } from "react";
import { cx } from "../lib/cx";

/** Presses that start on these keep their normal click/tap behaviour instead of starting a drag. */
const CONTROLS = "a, button, select, input, textarea, label, summary, [contenteditable]";
const HANDLE_ATTR = "data-drag-handle";

function startsOnControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element) || target.closest(`[${HANDLE_ATTR}]`)) return false;
  return target.closest(CONTROLS) !== null;
}

/** Mouse and pen. Touch is left to {@link BoardTouchSensor} so a swipe scrolls instead of dragging. */
class BoardPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: PointerEvent, { onActivation }: PointerSensorOptions) => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === "touch" || startsOnControl(event.target)) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

class BoardTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: ({ nativeEvent: event }: TouchEvent, { onActivation }: TouchSensorOptions) => {
        if (event.touches.length > 1 || startsOnControl(event.target)) return false;
        onActivation?.({ event });
        return true;
      },
    },
  ];
}

const POINTER_OPTIONS: PointerSensorOptions = { activationConstraint: { distance: 6 } };
const TOUCH_OPTIONS: TouchSensorOptions = { activationConstraint: { delay: 250, tolerance: 8 } };

/**
 * Keyboard moves jump a whole column: Left/Right go to the previous/next column in `order`
 * (droppable ids). Up/Down are swallowed so the page doesn't scroll out from under the card.
 */
export function columnKeyboardCoordinates(order: readonly UniqueIdentifier[], columnOf: (activeData: unknown) => UniqueIdentifier | undefined): KeyboardCoordinateGetter {
  return (event, { context: { active, over, collisionRect, droppableRects }, currentCoordinates }) => {
    const step = event.code === KeyboardCode.Right ? 1 : event.code === KeyboardCode.Left ? -1 : 0;
    if (event.code === KeyboardCode.Up || event.code === KeyboardCode.Down) event.preventDefault();
    if (!step || !active || !collisionRect) return undefined;
    event.preventDefault();
    const from = over?.id ?? columnOf(active.data.current);
    const index = from === undefined ? -1 : order.indexOf(from);
    const target = index === -1 ? undefined : order[index + step];
    const rect = target === undefined ? undefined : droppableRects.get(target);
    if (!rect) return undefined;
    const maxY = Math.max(rect.top, rect.bottom - collisionRect.height);
    return {
      x: rect.left + (rect.width - collisionRect.width) / 2,
      y: Math.min(Math.max(currentCoordinates.y, rect.top), maxY),
    };
  };
}

/** The column under the pointer; otherwise (keyboard drags, or a pointer in the gap between columns) the one the card overlaps most. */
export const boardCollisions: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length ? hits : rectIntersection(args);
};

export function useBoardSensors(coordinateGetter: KeyboardCoordinateGetter, reducedMotion: boolean) {
  const keyboard = useMemo(() => ({ coordinateGetter, scrollBehavior: reducedMotion ? ("auto" as const) : ("smooth" as const) }), [coordinateGetter, reducedMotion]);
  return useSensors(useSensor(BoardPointerSensor, POINTER_OPTIONS), useSensor(BoardTouchSensor, TOUCH_OPTIONS), useSensor(KeyboardSensor, keyboard));
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia?.(REDUCED_MOTION).matches ?? false,
    () => false,
  );
}

function GripDots({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      {[4.5, 8, 11.5].map((y) => (
        <g key={y}>
          <circle cx="5.75" cy={y} r="1.15" />
          <circle cx="10.25" cy={y} r="1.15" />
        </g>
      ))}
    </svg>
  );
}

/**
 * The card's grip: the keyboard (and screen reader) way to pick a card up. Pass dnd-kit's
 * `attributes` and `setActivatorNodeRef`; pointer and touch drags work from anywhere on the card.
 * `decorative` renders a look-alike for the drag overlay.
 */
export function DragHandle({ label, decorative, className, ...rest }: ComponentPropsWithRef<"button"> & { label: string; decorative?: boolean }) {
  const classes = cx("-ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted", className);
  if (decorative) {
    return (
      <span aria-hidden="true" className={cx(classes, "cursor-grabbing")}>
        <GripDots className="size-3.5" />
      </span>
    );
  }
  return (
    <button
      type="button"
      {...{ [HANDLE_ATTR]: "" }}
      aria-label={label}
      title="Drag to another column, or press Space to pick up"
      className={cx(classes, "cursor-grab transition-colors hover:bg-ink/5 hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-50")}
      {...rest}
    >
      <GripDots className="size-3.5" />
    </button>
  );
}
