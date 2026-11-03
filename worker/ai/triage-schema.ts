import { z } from "zod";
import { ASSIGNEE_ROLES, CATEGORIES } from "../../shared/types";

/** Structured triage output. Claude (zodOutputFormat) and Workers AI (JSON schema mode) both validate against it. */
export const TriageOutput = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(["P1", "P2", "P3"]),
  responsibility: z.enum(["strata_company", "lot_owner", "unclear", "not_applicable"]),
  responsibility_reason: z.string(),
  summary: z.string(),
  allocate_to: z.array(z.enum(ASSIGNEE_ROLES)),
  contractor_trade: z.string().nullable(),
  statutory_deadline: z.string().nullable(),
  safety_notice: z.string().nullable(),
  reply_needed: z.boolean(),
  needs_human: z.boolean(),
  suspected_prompt_injection: z.boolean(),
  confidence: z.number(),
});
export type TriageOutput = z.infer<typeof TriageOutput>;
