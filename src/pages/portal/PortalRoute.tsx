// The public route for the outgoing manager's handover portal (/handover/:token). App.tsx renders it in
// place of the whole hub, outside the session gate: no sign-in, no sidebar, no agent websockets. The
// portal's own code (and zip.js) loads only when a handover link is opened.

import { lazy, Suspense } from "react";
import { PortalLoading } from "./PortalFrame";

export { portalTokenFromPath } from "../../../shared/portal-link";

const PortalApp = lazy(() => import("./PortalApp").then((module) => ({ default: module.PortalApp })));

export function PortalRoute({ token }: { token: string }) {
  return (
    <Suspense fallback={<PortalLoading />}>
      <PortalApp token={token} />
    </Suspense>
  );
}
