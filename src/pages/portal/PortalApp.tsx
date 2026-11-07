// The outgoing manager's handover portal (/handover/:token): public, reached with the secure link in
// Ikon's handover letter. The token is the credential; there is no session and no hub shell. It shows
// what Ikon needs, takes uploads (a zip, a folder or files, reviewed first), and the "Submit handover
// pack" step. See docs/ONBOARDING_SPEC.md, "Outgoing manager's portal".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PortalItem, PortalView } from "../../../shared/onboarding";
import { classifyPortalFailure, countOf, isPortalToken, matchTargets } from "../../../shared/portal-upload";
import { ApiError, errorMessage, portalApi } from "../../api";
import { ToastProvider } from "../../components/Toast";
import { cx } from "../../lib/cx";
import { CONTAINER, PortalBand, PortalFooter, PortalLoading, PortalMessage } from "./PortalFrame";
import { PortalHeading, ProgressCard } from "./PortalSummary";
import { ExtraFilesCard, RequestedDocuments } from "./RequestedDocuments";
import { SubmitPanel } from "./SubmitPanel";
import { UploadPanel } from "./UploadPanel";
import { useUploadQueue } from "./useUploadQueue";

type PageState =
  | { status: "loading" }
  | { status: "ready"; view: PortalView }
  /** 404: the link was never valid (or was mistyped). */
  | { status: "invalid"; view: PortalView | null }
  /** 410: expired, withdrawn, or the project was closed. */
  | { status: "gone"; view: PortalView | null }
  | { status: "error"; error: unknown };

/** How soon after a finished upload the page re-reads the handover (it has no live connection). */
const REFRESH_AFTER_UPLOAD_MS = 2500;

export function PortalApp({ token }: { token: string }) {
  return (
    <ToastProvider>
      <Portal token={token} />
    </ToastProvider>
  );
}

function usePortalDocumentMeta(title: string) {
  useEffect(() => {
    // The link is a credential: keep it out of the tab title and out of search engines.
    document.title = title;
    const robots = document.createElement("meta");
    robots.name = "robots";
    robots.content = "noindex, nofollow";
    document.head.appendChild(robots);
    return () => robots.remove();
  }, [title]);
}

function Portal({ token }: { token: string }) {
  const [state, setState] = useState<PageState>(() => (isPortalToken(token) ? { status: "loading" } : { status: "invalid", view: null }));
  const viewRef = useRef<PortalView | null>(null);
  const refreshTimer = useRef<number | null>(null);

  /** A failed call: when it means the link no longer works, show that page instead. */
  const linkFailed = useCallback((err: unknown): boolean => {
    if (!(err instanceof ApiError) || classifyPortalFailure(err.status, err.message) !== "link") return false;
    setState({ status: err.status === 410 ? "gone" : "invalid", view: viewRef.current });
    return true;
  }, []);

  const load = useCallback(
    async (mode: "initial" | "background") => {
      try {
        const view = await portalApi.view(token);
        viewRef.current = view;
        setState({ status: "ready", view });
      } catch (err) {
        if (linkFailed(err)) return;
        // A background refresh that fails keeps the page as it is; the next one will catch up.
        if (mode === "initial") setState({ status: "error", error: err });
      }
    },
    [token, linkFailed],
  );

  useEffect(() => {
    if (isPortalToken(token)) void load("initial");
  }, [token, load]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      void load("background");
    }, REFRESH_AFTER_UPLOAD_MS);
  }, [load]);
  useEffect(
    () => () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    },
    [],
  );

  const { queue, snapshot } = useUploadQueue(token, scheduleRefresh);

  // The queue stops when an upload finds the link expired, withdrawn or not valid.
  useEffect(() => {
    if (snapshot.state !== "stopped") return;
    const invalid = /not valid/i.test(snapshot.message ?? "");
    setState({ status: invalid ? "invalid" : "gone", view: viewRef.current });
  }, [snapshot.state, snapshot.message]);

  const view = state.status === "ready" ? state.view : null;
  usePortalDocumentMeta(view ? `Handover of SP ${view.building.spNumber} · IKON SM` : "Handover · IKON SM");

  if (state.status === "loading") return <PortalLoading />;

  if (state.status === "error") {
    return (
      <PortalMessage
        icon="alert"
        tone="red"
        title="Couldn't open your handover"
        onRetry={() => {
          setState({ status: "loading" });
          void load("initial");
        }}
      >
        <p>{errorMessage(state.error)}</p>
        <p>Check your internet connection, then try again.</p>
      </PortalMessage>
    );
  }

  if (state.status === "invalid" || state.status === "gone") {
    const waiting = snapshot.rows.filter((row) => row.status === "queued" || row.status === "uploading").length;
    const contact = state.view ? `${state.view.incomingManager.name} at Ikon (${state.view.incomingManager.email})` : "your Ikon strata manager";
    // Without a valid link there is no manager to name: Ikon's public website has the office's contact details.
    const office = (
      <p>
        Not sure who that is? Ikon Strata Management's contact details are at{" "}
        <a href="https://www.ikonsm.com.au" target="_blank" rel="noreferrer" className="font-medium link-brand">
          ikonsm.com.au
        </a>
        .
      </p>
    );
    return state.status === "invalid" ? (
      <PortalMessage icon="lock" title="This link is not valid">
        <p>Check that you opened the whole link from Ikon's handover email: it is long, and some email programs split it over two lines.</p>
        <p>If it still doesn't open, please contact {contact} for a new link.</p>
        {state.view ? null : office}
      </PortalMessage>
    ) : (
      <PortalMessage icon="clock" title="This link has expired or been withdrawn">
        <p>For security, handover links stop working after their expiry date, or when Ikon sends a new one.</p>
        <p>Please contact {contact} for a new link. Documents you have already uploaded are safe with Ikon.</p>
        {state.view ? null : office}
        {waiting ? (
          <p className="font-medium text-ink">
            {countOf(waiting, "file was", "files were")} not sent. Please upload {waiting === 1 ? "it" : "them"} with the new link.
          </p>
        ) : null}
      </PortalMessage>
    );
  }

  return (
    <PortalPage
      token={token}
      view={state.view}
      queueState={snapshot.state}
      onView={(next) => {
        viewRef.current = next;
        setState({ status: "ready", view: next });
      }}
      onItemChanged={(item) => {
        const current = viewRef.current;
        if (current) {
          const next = { ...current, items: current.items.map((i) => (i.id === item.id ? item : i)) };
          viewRef.current = next;
          setState({ status: "ready", view: next });
        }
        // Progress counts come from the server.
        void load("background");
      }}
      onFailure={linkFailed}
      queue={queue}
      snapshot={snapshot}
    />
  );
}

function PortalPage({
  token,
  view,
  queueState,
  onView,
  onItemChanged,
  onFailure,
  queue,
  snapshot,
}: {
  token: string;
  view: PortalView;
  queueState: string;
  onView: (view: PortalView) => void;
  onItemChanged: (item: PortalItem) => void;
  onFailure: (err: unknown) => boolean;
} & Pick<ReturnType<typeof useUploadQueue>, "queue" | "snapshot">) {
  // One targets array per checklist (not per refresh): the matcher caches its preparation per array.
  const itemsRef = useRef(view.items);
  itemsRef.current = view.items;
  const checklistKey = view.items.map((item) => `${item.id}:${item.keywords.join("|")}`).join(",");
  const targets = useMemo(() => matchTargets(itemsRef.current), [checklistKey]);
  const uploading = queueState === "running" || queueState === "paused";

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <a
        href="#portal-requested-title"
        className={cx(
          "sr-only z-50 bg-surface px-4 py-2 text-sm font-medium text-ink shadow-pop",
          "focus:not-sr-only focus:fixed focus:top-3 focus:left-3",
        )}
      >
        Skip to the requested documents
      </a>
      <PortalBand>
        <PortalHeading view={view} />
      </PortalBand>

      <main className={cx(CONTAINER, "space-y-6 py-6 sm:space-y-8 sm:py-8")}>
        <ProgressCard view={view} />
        <div className="space-y-6">
          <UploadPanel view={view} targets={targets} queue={queue} snapshot={snapshot} />
        </div>
        <RequestedDocuments
          token={token}
          view={view}
          targets={targets}
          queue={queue}
          snapshot={snapshot}
          onItemChanged={onItemChanged}
          onFailure={onFailure}
        />
        <ExtraFilesCard view={view} />
        <SubmitPanel token={token} view={view} uploading={uploading} onSubmitted={onView} onFailure={onFailure} />
      </main>

      <PortalFooter>
        <p>
          Questions about this handover? Contact {view.incomingManager.name}, {view.incomingManager.title}, at{" "}
          <a href={`mailto:${view.incomingManager.email}`} className="link-brand text-ink-soft">
            {view.incomingManager.email}
          </a>
          .
        </p>
        <p>
          This secure link is for {view.outgoingManager.name} ({view.outgoingManager.company}). Please share it only with colleagues helping with this
          handover, and not outside your office: anyone with the link can upload documents to it.
        </p>
      </PortalFooter>
    </div>
  );
}
