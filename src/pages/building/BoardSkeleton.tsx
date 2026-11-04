import { Skeleton } from "../../components/Skeleton";

/**
 * Placeholder board while work orders load (and while the board's code chunk loads). Kept apart
 * from WorkOrdersTab so showing it doesn't pull in the drag-and-drop code.
 */
export function BoardSkeleton() {
  return (
    <div className="grid auto-cols-[minmax(196px,1fr)] grid-flow-col gap-3 overflow-hidden" role="status" aria-label="Loading work orders">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl bg-sunken p-3 ring-1 ring-line">
          <Skeleton tone="onSunken" className="h-4 w-20" />
          <Skeleton tone="onSunken" className="h-28 w-full rounded-xl" />
          <Skeleton tone="onSunken" className="h-20 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
