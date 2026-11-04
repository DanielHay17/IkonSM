import { useEffect } from "react";
import { useToast } from "../components/Toast";
import { navigate, useLocationSearch } from "../router";

/** The callback's `reason` codes (worker/integrations/onedrive-routes.ts), in words staff can act on. */
const REASONS: Record<string, string> = {
  not_configured: "OneDrive isn't set up on this hub yet. Choose Connect to OneDrive on a building's Files tab for the steps.",
  state: "The sign-in took too long or was started in another tab. Try connecting again.",
  signin: "Your hub session ended during the Microsoft sign-in. Sign in to the hub and try again.",
  denied: "The Microsoft sign-in was cancelled, or permission wasn't given.",
  microsoft: "Microsoft couldn't complete the sign-in. Try again, or check the app registration.",
  exchange: "Microsoft didn't accept the hub's app details. Check the redirect URI and the client secret.",
  storage: "The sign-in worked but couldn't be saved. Try again.",
};
const FALLBACK = "Something went wrong connecting OneDrive. Try again.";

/**
 * Microsoft's sign-in comes back to the hub with ?onedrive=connected or ?onedrive=error&reason=…:
 * say what happened and take the parameters out of the address bar.
 */
export function useOneDriveReturn(): void {
  const toast = useToast();
  const search = useLocationSearch();

  useEffect(() => {
    // Read the live URL, not `search`: after the first run has cleaned it, a repeat run (StrictMode) finds nothing.
    const params = new URLSearchParams(window.location.search);
    const result = params.get("onedrive");
    if (!result) return;
    const reason = params.get("reason") ?? "";
    params.delete("onedrive");
    params.delete("reason");
    const rest = params.toString();
    navigate(`${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`, { replace: true });

    if (result === "connected") toast.success("OneDrive connected", "Import documents from OneDrive and SharePoint on a building's Files tab.");
    else toast.error("Couldn't connect OneDrive", REASONS[reason] ?? FALLBACK);
  }, [search, toast]);
}
