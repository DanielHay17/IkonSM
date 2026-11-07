// The onboarding checklist every new scheme starts from. STUB: the content agent replaces this file with
// the full template (8 sections / 82 tasks, 30 handover documents, 56 go-live checks). Keep the export
// name and type; nothing else may depend on exact counts.

import type { OnboardingTemplate } from "../../shared/onboarding";

export const ONBOARDING_TEMPLATE: OnboardingTemplate = {
  version: "stub-1",
  sections: [
    { key: "outgoing_manager", title: "Outgoing manager", description: "Request, receive and verify the handover pack.", groups: ["Document checklist & evidence", "Records transfer"], defaultOwnerRole: "onboarding_officer", defaultApproverRole: "principal",
      tasks: [{ key: "outgoing_manager.request", title: "Send the handover request", detail: "The handover letter and secure link have gone to the outgoing manager.", group: "Records transfer", role: "onboarding_officer" }] },
    { key: "stratafy", title: "Stratafy", description: "Prepare and configure the scheme in Stratafy.", groups: ["Stratafy / Systems"], defaultOwnerRole: "onboarding_officer", defaultApproverRole: "strata_manager",
      tasks: [{ key: "stratafy.create-scheme", title: "Create the scheme in Stratafy", detail: "Plan number, address and lots entered.", group: "Stratafy / Systems", role: "onboarding_officer" }] },
    { key: "xero", title: "Xero setup", description: "Customer, invoice and item-code setup.", groups: ["Xero set up"], defaultOwnerRole: "accountant", defaultApproverRole: "principal",
      tasks: [{ key: "xero.customer", title: "Create the Xero customer", detail: "The strata company is set up as a customer.", group: "Xero set up", role: "accountant" }] },
    { key: "appointment", title: "Appointment & owners", description: "Authority to act, council and owner records, by-laws.", groups: ["Appointment", "Council", "Owners", "By-laws"], defaultOwnerRole: "strata_manager", defaultApproverRole: "principal",
      tasks: [{ key: "appointment.contract", title: "Signed management contract on file", detail: "Countersigned by the strata company.", group: "Appointment", role: "strata_manager" }] },
    { key: "finance_compliance", title: "Finance & compliance", description: "Opening finances, insurance, taxation and statutory records.", groups: ["Financial setup", "Insurance", "Tax & statutory returns", "Legal & compliance"], defaultOwnerRole: "accountant", defaultApproverRole: "principal",
      tasks: [{ key: "finance_compliance.bank", title: "Open the trust bank accounts", detail: "Administrative and reserve fund accounts opened.", group: "Financial setup", role: "accountant" }] },
    { key: "facilities_site", title: "Facilities & site", description: "Site, utilities, access, contractors and services.", groups: ["Property & site setup", "Utilities", "Keys & security", "Contractors & services"], defaultOwnerRole: "strata_manager", defaultApproverRole: "principal",
      tasks: [{ key: "facilities_site.inspection", title: "Initial site inspection", detail: "Walk-through done and photos filed.", group: "Property & site setup", role: "strata_manager" }] },
    { key: "readiness_closeout", title: "Readiness & closeout", description: "Quality review, operational readiness and final closeout.", groups: ["Go-live checks", "Completion & quality assurance"], defaultOwnerRole: "principal", defaultApproverRole: "principal",
      tasks: [{ key: "readiness_closeout.qa", title: "Quality review of the onboarding", detail: "Every section reviewed by its approver.", group: "Completion & quality assurance", role: "principal" }] },
    { key: "communications", title: "Communications and introductions", description: "Owner welcome, app rollout, council and agent correspondence, contractor handover and registration.", groups: ["Communications"], defaultOwnerRole: "administration", defaultApproverRole: "strata_manager",
      tasks: [{ key: "communications.welcome", title: "Send the owner welcome letter", detail: "Every owner has the welcome pack.", group: "Communications", role: "administration" }] },
  ],
  handoverItems: [
    { key: "strata-plan", title: "Registered strata plan", detail: "The registered plan and any re-subdivisions.", folder: "01 Plan & By-laws", required: true, keywords: ["strata plan", "registered plan"] },
    { key: "insurance-policy", title: "Current insurance policy", detail: "Policy schedule and certificate of currency.", folder: "02 Insurance", required: true, keywords: ["insurance", "certificate of currency"] },
    { key: "agm-minutes", title: "Minutes of the last three AGMs", detail: "Signed minutes with attachments.", folder: "03 Meetings", required: true, keywords: ["agm", "minutes"] },
  ],
  goLiveChecks: [
    { key: "records.plan-filed", title: "Strata plan filed in 01 Plan & By-laws", group: "Records" },
    { key: "finance.balances", title: "Opening balances agree to the outgoing manager's statements", group: "Finance" },
    { key: "insurance.current", title: "Insurance is current and Ikon is noted as manager", group: "Insurance" },
  ],
};
