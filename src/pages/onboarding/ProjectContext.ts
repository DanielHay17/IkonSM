import { createContext, useContext } from "react";
import type {
  GoLiveCheck,
  GoLiveCheckPatch,
  HandoverFile,
  HandoverFileAction,
  HandoverItem,
  HandoverItemPatch,
  OnboardingProjectDetail,
  OnboardingTask,
  StaffMember,
  TaskPatch,
} from "../../../shared/onboarding";
import type { PropertyProfile } from "../../../shared/types";

export interface ProjectContextValue {
  propertyId: string;
  /** The project as shown: the last server copy with any changes still being saved laid over it. */
  project: OnboardingProjectDetail;
  profile: PropertyProfile | null;
  /** The signed-in name and the staff member it maps to (null when not in the register). */
  actingName: string;
  acting: StaffMember | null;
  /**
   * Optimistic changes: shown at once, saved, then replaced by the server's copy, or rolled back (with a
   * toast) if the save fails. Resolve to true when saved.
   */
  patchTask: (task: OnboardingTask, patch: TaskPatch) => Promise<boolean>;
  patchItem: (item: HandoverItem, patch: HandoverItemPatch, options?: { quiet?: boolean }) => Promise<boolean>;
  patchCheck: (check: GoLiveCheck, patch: GoLiveCheckPatch) => Promise<boolean>;
  /** Verify an uploaded (extra) file, or attach it to a requested document; refetches the project. */
  patchFile: (file: HandoverFile, action: HandoverFileAction, options?: { quiet?: boolean }) => Promise<boolean>;
  /** A closed-out project is read-only history: its edit controls are hidden or disabled. */
  readOnly: boolean;
  /** Apply a mutation's result (a section, an invite, or the whole detail) and refetch in the background. */
  apply: (update: (detail: OnboardingProjectDetail) => OnboardingProjectDetail) => void;
  /** Refetch the detail in the background. */
  refresh: () => void;
  /** Keys ("task:<id>", "item:<id>", "check:<id>") with a save in flight. */
  saving: ReadonlySet<string>;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProject must be used inside an onboarding project page");
  return value;
}
