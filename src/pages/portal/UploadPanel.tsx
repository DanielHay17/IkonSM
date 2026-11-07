// Uploading on the portal: the drop zone (a SharePoint or OneDrive zip, a folder or files, dropped anywhere
// on the page or chosen with the buttons), then the review list (ReviewList.tsx) and the upload list
// (UploadProgress.tsx).

import { useEffect, useMemo, useRef, useState } from "react";
import type { HandoverMatchTarget, PortalView } from "../../../shared/onboarding";
import { batchSummary, countOf, formatSize, planRows, uploadedFileKeys, type QueueSnapshot, type UploadQueue } from "../../../shared/portal-upload";
import { errorMessage } from "../../api";
import { Button } from "../../components/Button";
import { Card, CardHeader } from "../../components/Card";
import { Icon } from "../../components/Icon";
import { Spinner } from "../../components/Spinner";
import { useToast } from "../../components/Toast";
import { cx } from "../../lib/cx";
import { dragHasFiles, filesFromDrop, filesFromInput, type DroppedFiles, type PickedFile } from "../../lib/dropFiles";
import { readZipFiles } from "../../lib/zipUpload";
import { HiddenFileInput } from "./labels";
import { ReviewList, type ReviewSession } from "./ReviewList";
import { UploadProgress } from "./UploadProgress";
import { nextRowId } from "./useUploadQueue";

const EMPTY_SESSION: ReviewSession = { sources: [], skipped: 0, repeated: 0 };

/** "“SP87192 Handover.zip”", "the folder “SP87192 Handover”" or "12 files". */
function describeDrop(dropped: DroppedFiles): string {
  if (dropped.zips.length === 1 && !dropped.files.length) return `“${dropped.zips[0]!.name}”`;
  if (!dropped.zips.length && dropped.files.length) {
    const tops = new Set(dropped.files.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "")));
    const top = [...tops][0];
    if (tops.size === 1 && top) return `the folder “${top}”`;
  }
  return countOf(dropped.files.length + dropped.zips.length, "item");
}

interface UploadPanelProps {
  view: PortalView;
  targets: HandoverMatchTarget[];
  queue: UploadQueue<PickedFile>;
  snapshot: QueueSnapshot<PickedFile>;
}

export function UploadPanel({ view, targets, queue, snapshot }: UploadPanelProps) {
  const toast = useToast();
  const [reading, setReading] = useState<string | null>(null);
  const [session, setSession] = useState<ReviewSession>(EMPTY_SESSION);
  const [announcement, setAnnouncement] = useState("");
  const [dragging, setDragging] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const progressHeading = useRef<HTMLHeadingElement>(null);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  const staged = useMemo(() => snapshot.rows.filter((row) => row.status === "staged"), [snapshot.rows]);
  const batch = useMemo(() => snapshot.rows.filter((row) => row.status !== "staged" && row.origin === "review"), [snapshot.rows]);
  const stopped = snapshot.state === "stopped";
  const busyReading = reading !== null;

  const readingRef = useRef(false);
  const stage = async (dropped: DroppedFiles, source: string) => {
    if (stopped) return;
    if (readingRef.current) {
      toast.info("Still opening the last zip", "Drop these files again once its files are listed.");
      return;
    }
    const picked = [...dropped.files];
    if (dropped.zips.length) {
      const names = dropped.zips.map((zip) => zip.name).join(", ");
      readingRef.current = true;
      setReading(names);
      setAnnouncement(`Reading ${names}`);
      for (const zip of dropped.zips) {
        try {
          picked.push(...(await readZipFiles(zip)));
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }
      readingRef.current = false;
      setReading(null);
    }
    const plan = planRows(
      picked.map((file) => ({ path: file.path, size: file.size, source: file })),
      {
        targets,
        maxFileBytes: view.limits.maxFileBytes,
        uploaded: uploadedFileKeys(view),
        listed: new Set(queue.rows.map((row) => row.path.toLowerCase())),
        nextId: nextRowId,
      },
    );
    const continuing = queue.rows.some((row) => row.status === "staged");
    setSession((current) =>
      continuing
        ? { sources: [...current.sources, source], skipped: current.skipped + plan.skipped, repeated: current.repeated + plan.repeated }
        : { sources: [source], skipped: plan.skipped, repeated: plan.repeated },
    );
    queue.add(plan.rows);
    const notes = [
      plan.skipped ? `${countOf(plan.skipped, "system file")} skipped` : "",
      plan.repeated ? `${countOf(plan.repeated, "file")} already in the list` : "",
    ].filter(Boolean);
    if (!plan.rows.length) {
      const message = picked.length ? `Nothing new to upload from ${source}` : `No files found in ${source}`;
      toast.info(message, notes.join(". ") || undefined);
      setAnnouncement([message, ...notes].join(". "));
      return;
    }
    setAnnouncement([`${countOf(plan.rows.length, "file")} ready to review`, ...notes].join(". "));
    window.requestAnimationFrame(() => reviewHeading.current?.focus());
  };
  const stageRef = useRef(stage);
  stageRef.current = stage;

  // Drop anywhere on the page. Also stops a missed drop from opening the file in this tab (and losing the list).
  useEffect(() => {
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event: DragEvent) => {
      if (!dragHasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      // Read the drop now: the browser empties dataTransfer once this handler returns.
      void filesFromDrop(event.dataTransfer).then((dropped) => stageRef.current(dropped, describeDrop(dropped)));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const onPicked = (list: FileList | null, input: HTMLInputElement | null) => {
    const dropped = filesFromInput(list);
    if (input) input.value = "";
    if (dropped.files.length || dropped.zips.length) void stage(dropped, describeDrop(dropped));
  };

  const upload = () => {
    // A new batch starts a fresh list (the last batch's files are already in the requested documents).
    if (!queue.rows.some((row) => row.status === "queued" || row.status === "uploading")) queue.clearFinished();
    const count = queue.start();
    setSession(EMPTY_SESSION);
    setAnnouncement(`Uploading ${countOf(count, "file")}`);
    window.requestAnimationFrame(() => progressHeading.current?.focus());
  };

  const clearReview = () => {
    queue.clearStaged();
    setSession(EMPTY_SESSION);
    setAnnouncement("Review list cleared");
  };

  // Say when a batch finishes (screen readers otherwise only hear the list change).
  const summary = batchSummary(batch);
  const active = summary.queued + summary.uploading;
  const wasActive = useRef(false);
  useEffect(() => {
    if (active > 0) wasActive.current = true;
    else if (wasActive.current && summary.total > 0) {
      wasActive.current = false;
      setAnnouncement(
        `Upload finished: ${countOf(summary.done, "file")} uploaded${summary.failed ? `, ${countOf(summary.failed, "file")} failed` : ""}`,
      );
    }
  }, [active, summary.done, summary.failed, summary.total]);

  return (
    <>
      <Card>
        <section aria-labelledby="portal-upload-title">
          <CardHeader
            title={<span id="portal-upload-title">Upload documents</span>}
            description="Drop a SharePoint or OneDrive download (.zip), a folder or individual files. You'll check where each file goes before anything is sent."
          />
          <div className="px-5 py-5 sm:px-6">
            <div
              className={cx(
                "flex flex-col items-center border border-dashed px-4 py-8 text-center transition-colors sm:py-10",
                dragging ? "border-ink bg-accent-soft" : "border-line-input bg-subtle",
              )}
            >
              {busyReading ? (
                <p className="flex items-center gap-3 text-sm font-medium text-ink" role="status">
                  <Spinner className="size-5 text-accent" label={null} />
                  Reading {reading}…
                </p>
              ) : (
                <>
                  <Icon name="upload" className={cx("size-7", dragging ? "text-ink" : "text-taupe")} />
                  <p className="mt-3 text-base font-medium text-ink">
                    <span className="max-sm:hidden">Drop a zip, a folder or files here</span>
                    <span className="sm:hidden">Choose files or a zip to upload</span>
                  </p>
                  <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">
                    Up to {formatSize(view.limits.maxFileBytes)} per file. System files such as .DS_Store and __MACOSX are left out automatically.
                  </p>
                </>
              )}
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button icon="file" onClick={() => filesInput.current?.click()} disabled={busyReading || stopped}>
                  Choose files
                </Button>
                <Button icon="folder" onClick={() => folderInput.current?.click()} disabled={busyReading || stopped} className="max-sm:hidden">
                  Choose a folder
                </Button>
                <Button icon="library" onClick={() => zipInput.current?.click()} disabled={busyReading || stopped}>
                  Choose a zip
                </Button>
              </div>
              <HiddenFileInput ref={filesInput} multiple onChange={(e) => onPicked(e.currentTarget.files, e.currentTarget)} />
              <HiddenFileInput ref={folderInput} directory onChange={(e) => onPicked(e.currentTarget.files, e.currentTarget)} />
              <HiddenFileInput ref={zipInput} accept=".zip,application/zip,application/x-zip-compressed" multiple onChange={(e) => onPicked(e.currentTarget.files, e.currentTarget)} />
            </div>
            <details className="group mt-4 text-[13px] text-ink-soft">
              <summary className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-ink select-none">
                <Icon name="cloud" className="size-4 text-taupe" />
                How to download a folder from SharePoint or OneDrive
              </summary>
              <ol className="mt-2 ml-5 list-decimal space-y-1 leading-relaxed">
                <li>Open the scheme's folder in SharePoint or OneDrive and select it (or the files inside it).</li>
                <li>Choose Download. You'll get a .zip file, usually in your Downloads folder.</li>
                <li>Drop the .zip here, or use Choose a zip. It is opened in your browser and nothing is sent until you choose Upload.</li>
              </ol>
            </details>
          </div>
        </section>
      </Card>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {dragging ? (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 grid animate-fade-in place-items-center bg-charcoal/55 p-6">
          <div className="border border-white/30 bg-charcoal px-8 py-6 text-center text-white shadow-pop">
            <Icon name="upload" className="mx-auto size-8 text-white" />
            <p className="heading-display mt-3 text-sm">Drop to add to the review list</p>
          </div>
        </div>
      ) : null}

      {staged.length ? (
        <ReviewList
          rows={staged}
          view={view}
          targets={targets}
          queue={queue}
          session={session}
          headingRef={reviewHeading}
          onUpload={upload}
          onClear={clearReview}
        />
      ) : null}

      {batch.length ? <UploadProgress rows={batch} view={view} queue={queue} snapshot={snapshot} headingRef={progressHeading} /> : null}
    </>
  );
}
