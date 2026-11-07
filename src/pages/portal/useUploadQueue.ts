// The portal's review and upload list: one UploadQueue (shared/portal-upload.ts) for the page, sending
// with portalApi.upload. Zip entries are decompressed one at a time as they come up (src/lib/zipUpload.ts).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { UploadQueue, uploadFields, type QueueSnapshot, type UploadRow } from "../../../shared/portal-upload";
import { portalApi } from "../../api";
import type { PickedFile } from "../../lib/dropFiles";

export type PortalRow = UploadRow<PickedFile>;

let sequence = 0;
/** Row ids unique for the page's lifetime. */
export const nextRowId = () => `f${++sequence}`;

export function useUploadQueue(token: string, onSettled: (row: PortalRow) => void): { queue: UploadQueue<PickedFile>; snapshot: QueueSnapshot<PickedFile> } {
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  const [queue] = useState(
    () =>
      new UploadQueue<PickedFile>({
        send: async (row, onProgress) => {
          const blob = await row.source.load();
          return portalApi.upload(token, blob, row.name, uploadFields(row), onProgress);
        },
        onSettled: (row) => settledRef.current(row),
      }),
  );
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);

  // Back online: carry on with the files that were waiting.
  useEffect(() => {
    const online = () => queue.resume();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [queue]);

  // Closing the tab mid-upload loses the rest of the list: ask first.
  const busy = snapshot.state === "running" || snapshot.state === "paused";
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  return { queue, snapshot };
}
