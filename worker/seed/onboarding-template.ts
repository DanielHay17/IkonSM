// The onboarding checklist every new scheme starts from: 8 sections with 82 tasks, the 30 documents the
// outgoing strata manager is asked to supply, and 56 go-live checks. It mirrors the sections of Ikon's
// own onboarding dashboard (built in Zoho Creator) and is written for WA schemes under the Strata Titles
// Act 1985 (WA) as amended in 2020.
//
// SAMPLE content: a realistic starting point drafted for the demo, not Ikon's adopted policy. The UI
// labels it "SAMPLE checklist" until Peter King supplies the firm's own list. Keys are stable: projects
// store them, so rename titles freely but never change or reuse a key.

import type { OnboardingTemplate, TemplateGoLiveCheck, TemplateHandoverItem, TemplateSection, TemplateTask } from "../../shared/onboarding";

/** Tasks that all sit in one group (sections with a single group). */
const inGroup = (group: string, tasks: Omit<TemplateTask, "group">[]): TemplateTask[] => tasks.map((task) => ({ ...task, group }));

// ===========================================================================
// Sections and tasks (8 sections, 8 + 17 + 3 + 17 + 13 + 12 + 6 + 6 = 82 tasks)
// ===========================================================================

const OUTGOING_MANAGER: TemplateSection = {
  key: "outgoing_manager",
  title: "Outgoing manager",
  description: "Request, receive and verify the handover pack.",
  groups: ["Document checklist & evidence", "Records transfer"],
  defaultOwnerRole: "onboarding_officer",
  defaultApproverRole: "principal",
  tasks: [
    {
      key: "outgoing_manager.tailor-schedule",
      title: "Tailor the document schedule to the scheme",
      detail:
        "The 30-item handover schedule has been checked against this scheme (lot count, lift, pool, building age, GST status) and anything that cannot apply is noted before the request goes out.",
      group: "Document checklist & evidence",
      role: "onboarding_officer",
    },
    {
      key: "outgoing_manager.send-request",
      title: "Send the handover letter and secure link",
      detail:
        "After confirming the outgoing manager's contact, the handover date and the records due date by phone, the handover letter with the schedule and secure upload link has been approved and sent.",
      group: "Records transfer",
      role: "onboarding_officer",
    },
    {
      key: "outgoing_manager.chase",
      title: "Chase outstanding records before the due date",
      detail:
        "Outstanding required documents are followed up in writing about five business days before the records due date, and again on the day; each chase is noted on the project.",
      group: "Records transfer",
      role: "onboarding_officer",
    },
    {
      key: "outgoing_manager.verify-pack",
      title: "Verify the handover pack against the schedule",
      detail:
        "Every uploaded document has been opened and checked (right scheme, complete, current) and each item is marked verified, needs replacing or not applicable with a note.",
      group: "Document checklist & evidence",
      role: "onboarding_officer",
    },
    {
      key: "outgoing_manager.reconcile-records",
      title: "Reconcile the records transfer",
      detail:
        "The outgoing manager's index of records has been reconciled to what was received (uploads and paper files); any differences are listed and sent back to them in writing.",
      group: "Records transfer",
      role: "onboarding_officer",
    },
    {
      key: "outgoing_manager.physical-items",
      title: "Collect keys, fobs, remotes and original records",
      detail:
        "Keys, fobs, remotes, access cards, the common seal (if any) and original paper records are collected, counted against the outgoing manager's list and signed for by both parties.",
      group: "Records transfer",
      role: "strata_manager",
    },
    {
      key: "outgoing_manager.escalate",
      title: "Escalate records still missing after the due date",
      detail:
        "If required records are still missing ten business days after the due date, the principal writes to the outgoing manager setting out what is outstanding and tells the council.",
      group: "Document checklist & evidence",
      role: "principal",
    },
    {
      key: "outgoing_manager.file-evidence",
      title: "File the handover evidence",
      detail:
        "The handover letter, chase emails, signed receipts for keys and records, and the outgoing manager's written confirmation that the handover is complete are filed in 07 Correspondence.",
      group: "Document checklist & evidence",
      role: "administration",
    },
  ],
};

const STRATAFY_GROUP = "Stratafy / Systems";

const STRATAFY: TemplateSection = {
  key: "stratafy",
  title: "Stratafy",
  description: "Prepare and configure the scheme in Stratafy.",
  groups: [STRATAFY_GROUP],
  defaultOwnerRole: "onboarding_officer",
  defaultApproverRole: "strata_manager",
  tasks: inGroup(STRATAFY_GROUP, [
    {
      key: "stratafy.create-scheme",
      title: "Create the scheme in Stratafy",
      detail:
        "The SP number, scheme name, street address, scheme type and the strata company's ABN (if any) are entered and match the registered strata plan.",
      role: "onboarding_officer",
    },
    {
      key: "stratafy.lot-entitlements",
      title: "Enter lots and unit entitlements",
      detail:
        "Every lot is entered with its unit entitlement (and any other contribution basis set by the by-laws); the total agrees to the strata plan's schedule of unit entitlement.",
      role: "onboarding_officer",
    },
    {
      key: "stratafy.owners",
      title: "Enter owners and addresses for service",
      detail:
        "Each lot's owner or owners, postal address for service, email address for service and phone are entered from the verified strata roll, with each owner's choice of email or post for notices.",
      role: "onboarding_officer",
    },
    {
      key: "stratafy.tenants-agents",
      title: "Record tenants and property managers",
      detail:
        "Leased lots show the tenant and the managing agent (property manager) with contact details, so repairs and by-law matters reach the right person.",
      role: "administration",
    },
    {
      key: "stratafy.council",
      title: "Record council members and officers",
      detail:
        "The council members, chairperson, secretary and treasurer are recorded with their contact details, matching the minutes of the last AGM.",
      role: "onboarding_officer",
    },
    {
      key: "stratafy.financial-year",
      title: "Set the financial year and contribution periods",
      detail:
        "The strata company's financial year, contribution periods and due dates, and interest on overdue contributions are set as resolved at the last general meeting.",
      role: "accountant",
    },
    {
      key: "stratafy.budgets",
      title: "Enter the administrative and reserve fund budgets",
      detail:
        "The administrative fund and reserve fund budgets adopted for the current financial year are entered by account and agree to the AGM minutes.",
      role: "accountant",
    },
    {
      key: "stratafy.levy-schedule",
      title: "Generate the contribution (levy) schedule",
      detail:
        "Contributions for each lot are generated from the budgets and unit entitlements; the schedule totals agree to the budgets and to the outgoing manager's contribution (levy) register.",
      role: "accountant",
    },
    {
      key: "stratafy.lot-balances",
      title: "Enter lot balances and arrears at handover",
      detail:
        "Each lot's balance at the handover date (arrears, interest, prepaid contributions) is entered and agrees to the outgoing manager's contribution (levy) register and final reconciliation.",
      role: "accountant",
    },
    {
      key: "stratafy.bank-details",
      title: "Enter the trust account and payment details",
      detail:
        "The administrative and reserve fund trust accounts, BPAY or payment references are entered, so contribution notices show the strata company's new payment details.",
      role: "accountant",
    },
    {
      key: "stratafy.fund-balances",
      title: "Enter fund opening balances",
      detail:
        "Opening cash for the administrative and reserve funds, unpaid creditors and prepaid contributions are entered at the handover date, and the trial balance agrees to the outgoing manager's final reconciliation.",
      role: "accountant",
    },
    {
      key: "stratafy.insurance",
      title: "Enter the insurance policies",
      detail:
        "Each policy is entered with insurer, broker, policy number, sums insured, excesses and renewal date, with a renewal reminder set.",
      role: "onboarding_officer",
    },
    {
      key: "stratafy.contractors",
      title: "Set up contractors and suppliers",
      detail:
        "Current contractors and suppliers are set up as creditors with ABN, trade, contact and payment details, and their insurance expiry dates are recorded.",
      role: "onboarding_officer",
    },
    {
      key: "stratafy.key-dates",
      title: "Set key dates and reminders",
      detail:
        "Reminders are set for the next AGM, insurance renewal, fire services, lift and pool barrier inspections and contract expiries.",
      role: "onboarding_officer",
    },
    {
      key: "stratafy.documents",
      title: "Link the key documents",
      detail:
        "The strata plan, by-laws, insurance schedule, latest minutes and budgets are linked or uploaded in Stratafy and point to the verified copies in the building's Files.",
      role: "administration",
    },
    {
      key: "stratafy.test-notice",
      title: "Check a sample contribution notice",
      detail:
        "A sample contribution notice is produced and checked (amount, due date, payment details, Ikon's contacts) before the first notices go to owners.",
      role: "accountant",
    },
    {
      key: "stratafy.review",
      title: "Second-person review of the Stratafy setup",
      detail:
        "A second staff member has checked the setup against the strata plan, strata roll and budgets, and any differences are fixed or noted.",
      role: "strata_manager",
    },
  ]),
};

const XERO_GROUP = "Xero set up";

const XERO: TemplateSection = {
  key: "xero",
  title: "Xero setup",
  description: "Customer, invoice and item-code setup.",
  groups: [XERO_GROUP],
  defaultOwnerRole: "accountant",
  defaultApproverRole: "principal",
  tasks: [
    {
      key: "xero.customer",
      title: "Create the strata company as a Xero customer",
      detail:
        "The strata company is a customer contact in Ikon's Xero with its registered name, SP number, ABN (if any) and billing address in Ikon's care.",
      group: XERO_GROUP,
      role: "accountant",
    },
    {
      key: "xero.billing-schedule",
      title: "Set up management fee invoices from the fee schedule",
      detail:
        "Repeating invoices for the management fee follow the management contract's fee schedule (amount, GST treatment, frequency, start at the handover date), and the first invoice has been checked against the contract.",
      group: XERO_GROUP,
      role: "accountant",
    },
    {
      key: "xero.item-codes",
      title: "Set up item codes, including additional-work charges",
      detail:
        "Item codes exist for the contract's additional-work charges (extra meetings, s110 certificates, debt recovery, insurance claims, after-hours call-outs) at the contract rates.",
      group: XERO_GROUP,
      role: "accountant",
    },
  ],
};

const APPOINTMENT: TemplateSection = {
  key: "appointment",
  title: "Appointment & owners",
  description: "Authority to act, council and owner records, by-laws.",
  groups: ["Appointment", "Council", "Owners", "By-laws"],
  defaultOwnerRole: "strata_manager",
  defaultApproverRole: "principal",
  tasks: [
    // Appointment
    {
      key: "appointment.contract",
      title: "Signed management contract on file",
      detail:
        "The strata management contract is signed for the strata company (as its resolution authorises) and by Ikon, dated and filed; the term, fees and delegations are recorded.",
      group: "Appointment",
      role: "principal",
    },
    {
      key: "appointment.resolution",
      title: "Resolution appointing Ikon on file",
      detail:
        "The minutes of the meeting at which the strata company resolved to appoint Ikon (and end the previous appointment) are filed and the resolution wording has been checked.",
      group: "Appointment",
      role: "strata_manager",
    },
    {
      key: "appointment.disclosure",
      title: "Disclose commissions and conflicts of interest",
      detail:
        "Ikon's written disclosure of commissions, insurance-related payments and any conflicts of interest has been given to the strata company, and a copy is filed.",
      group: "Appointment",
      role: "principal",
    },
    {
      key: "appointment.notice-outgoing",
      title: "Send the notice of appointment to the outgoing manager",
      detail:
        "The outgoing manager has written notice that Ikon is appointed, with the handover date and a request for the strata company's records, money and property.",
      group: "Appointment",
      role: "strata_manager",
    },
    {
      key: "appointment.address-for-service",
      title: "Change the address for service at Landgate",
      detail:
        "The change of the strata company's address for service to Ikon has been lodged with Landgate and the registration confirmation is filed in 01 Plan & By-laws.",
      group: "Appointment",
      role: "onboarding_officer",
    },
    {
      key: "appointment.delegations",
      title: "Record delegations and spending limits",
      detail:
        "What Ikon may approve without the council (spending limit, emergency authority, who may instruct Ikon) is recorded on the building's profile so staff and agents follow it.",
      group: "Appointment",
      role: "strata_manager",
    },
    // Council
    {
      key: "appointment.council-members",
      title: "Confirm council members and officers",
      detail:
        "The council, chairperson, secretary and treasurer are confirmed against the last AGM minutes and with the chairperson, including any casual vacancies.",
      group: "Council",
      role: "strata_manager",
    },
    {
      key: "appointment.council-contacts",
      title: "Record council contact details and preferences",
      detail:
        "Each council member's phone, email and preferred contact method are recorded, with who may approve spending on the council's behalf.",
      group: "Council",
      role: "administration",
    },
    {
      key: "appointment.council-meeting",
      title: "Hold an introductory meeting with the council",
      detail:
        "An introductory meeting or call with the council has agreed priorities, open issues and the plan for the first 90 days; brief notes are filed in 03 Meetings.",
      group: "Council",
      role: "strata_manager",
    },
    {
      key: "appointment.agm-due",
      title: "Confirm the next AGM date",
      detail:
        "The date of the last AGM is checked, the next AGM is diarised within 15 months of it, and resolutions still to be actioned are listed.",
      group: "Council",
      role: "strata_manager",
    },
    // Owners
    {
      key: "appointment.strata-roll",
      title: "Check the strata roll",
      detail:
        "The strata roll is checked against Landgate ownership (title searches where in doubt) and every lot has a current owner and address for service.",
      group: "Owners",
      role: "onboarding_officer",
    },
    {
      key: "appointment.electronic-notices",
      title: "Collect owners' email addresses for service",
      detail:
        "Owners have been asked to confirm an email address for service and consent to receive notices electronically; replies are recorded and everyone else stays on post.",
      group: "Owners",
      role: "administration",
    },
    {
      key: "appointment.occupancy",
      title: "Record owner-occupied and leased lots",
      detail:
        "Each lot is marked owner-occupied or leased, and leased lots have the property manager's details, so notices and by-law matters reach the right person.",
      group: "Owners",
      role: "administration",
    },
    {
      key: "appointment.owner-matters",
      title: "Log open owner matters",
      detail:
        "Open owner complaints, requests, approvals in progress and by-law breach matters from the outgoing manager are logged with next steps and owners.",
      group: "Owners",
      role: "strata_manager",
    },
    // By-laws
    {
      key: "appointment.bylaws-registered",
      title: "Obtain the registered by-laws from Landgate",
      detail:
        "The registered by-laws and every registered amendment are obtained from Landgate (not only the outgoing manager's copy) and filed in 01 Plan & By-laws.",
      group: "By-laws",
      role: "onboarding_officer",
    },
    {
      key: "appointment.bylaws-summary",
      title: "Review and summarise the by-laws",
      detail:
        "The governance and conduct by-laws are reviewed for exclusive use, pets, parking, short-stay letting and anything unusual; a one-page summary is added to the building's memory.",
      group: "By-laws",
      role: "strata_manager",
    },
    {
      key: "appointment.bylaws-unregistered",
      title: "Lodge by-law changes not yet registered",
      detail:
        "By-law changes that were resolved but never registered (they have no effect until registered) are identified and lodged with Landgate, or the council is told what is needed.",
      group: "By-laws",
      role: "strata_manager",
    },
  ],
};

const FINANCE_COMPLIANCE: TemplateSection = {
  key: "finance_compliance",
  title: "Finance & compliance",
  description: "Opening finances, insurance, taxation and statutory records.",
  groups: ["Financial setup", "Insurance", "Tax & statutory returns", "Legal & compliance"],
  defaultOwnerRole: "accountant",
  defaultApproverRole: "principal",
  tasks: [
    // Financial setup
    {
      key: "finance_compliance.trust-accounts",
      title: "Open the trust accounts",
      detail:
        "Trust accounts for the strata company's administrative fund and reserve fund are open, and the bank has confirmed the account names, BSBs and numbers in writing.",
      group: "Financial setup",
      role: "accountant",
    },
    {
      key: "finance_compliance.funds-transfer",
      title: "Receive and reconcile the funds transfer",
      detail:
        "After Ikon gave the account details to the outgoing manager by phone, the administrative and reserve fund balances have arrived and agree to their final reconciliation; any difference is raised in writing.",
      group: "Financial setup",
      role: "accountant",
    },
    {
      key: "finance_compliance.opening-balances",
      title: "Agree the opening balances",
      detail:
        "Opening fund balances, lot balances, prepaid contributions and unpaid creditors at the handover date agree to the outgoing manager's final reconciliation and bank statements; the working is filed.",
      group: "Financial setup",
      role: "accountant",
    },
    {
      key: "finance_compliance.arrears",
      title: "Take over arrears and debt recovery",
      detail:
        "Each lot in arrears has its balance, interest, payment plan and recovery stage confirmed, and any letters of demand, Magistrates Court or SAT action continues without a gap.",
      group: "Financial setup",
      role: "accountant",
    },
    {
      key: "finance_compliance.budget-review",
      title: "Review the budgets and the 10-year plan",
      detail:
        "The adopted budgets are checked for adequacy (insurance, utilities, contracts) and the reserve fund against the 10-year plan (required for schemes of 10 or more lots); concerns go to the council in writing.",
      group: "Financial setup",
      role: "accountant",
    },
    // Insurance
    {
      key: "finance_compliance.insurance-current",
      title: "Confirm insurance is current and adequate",
      detail:
        "The policy is current, the building sum insured matches the latest replacement valuation, public liability is at least $10 million, and Ikon is noted as strata manager with the insurer or broker.",
      group: "Insurance",
      role: "strata_manager",
    },
    {
      key: "finance_compliance.insurance-claims",
      title: "Take over open insurance claims",
      detail:
        "Open claims are listed with claim numbers, insurer contacts and next steps, and the insurer or broker has been told Ikon now manages them.",
      group: "Insurance",
      role: "strata_manager",
    },
    {
      key: "finance_compliance.other-covers",
      title: "Review the other covers",
      detail:
        "Office bearers' liability, fidelity guarantee, voluntary workers and (if the strata company employs anyone) workers' compensation are reviewed, and any gaps are raised with the council.",
      group: "Insurance",
      role: "strata_manager",
    },
    // Tax & statutory returns
    {
      key: "finance_compliance.gst-bas",
      title: "Confirm GST registration and BAS obligations",
      detail:
        "Whether the strata company has an ABN and is registered for GST is confirmed with ABN Lookup and the ATO; if registered, the BAS cycle and any outstanding BAS are recorded (many small schemes are not registered and lodge no BAS).",
      group: "Tax & statutory returns",
      role: "accountant",
    },
    {
      key: "finance_compliance.income-tax",
      title: "Confirm the income tax return position",
      detail:
        "The strata company's income tax position is confirmed (returns are generally needed for non-mutual income such as interest or rent from common property), with the last return lodged and anything outstanding recorded.",
      group: "Tax & statutory returns",
      role: "accountant",
    },
    {
      key: "finance_compliance.audit",
      title: "Confirm audit requirements",
      detail:
        "Whether the financial statements must be audited (under the Act's thresholds or a resolution of the strata company) is confirmed, and an auditor is engaged where needed.",
      group: "Tax & statutory returns",
      role: "accountant",
    },
    // Legal & compliance
    {
      key: "finance_compliance.legal-matters",
      title: "Take over legal matters and SAT proceedings",
      detail:
        "Open legal matters, SAT applications or orders and solicitor engagements are listed with their next dates, and the parties have been told Ikon now manages the scheme.",
      group: "Legal & compliance",
      role: "strata_manager",
    },
    {
      key: "finance_compliance.statutory-records",
      title: "Confirm the statutory records are complete",
      detail:
        "The records the strata company must keep (strata roll, minutes, financial records, notices and correspondence for the required period) are received; any gaps are recorded with the outgoing manager.",
      group: "Legal & compliance",
      role: "onboarding_officer",
    },
  ],
};

const FACILITIES_SITE: TemplateSection = {
  key: "facilities_site",
  title: "Facilities & site",
  description: "Site, utilities, access, contractors and services.",
  groups: ["Property & site setup", "Utilities", "Keys & security", "Contractors & services"],
  defaultOwnerRole: "strata_manager",
  defaultApproverRole: "principal",
  tasks: [
    // Property & site setup
    {
      key: "facilities_site.inspection",
      title: "Carry out the initial site inspection",
      detail:
        "The strata manager has walked the common property, photographed its condition and noted defects, hazards and urgent works; the report is filed in 05 Maintenance & Contractors.",
      group: "Property & site setup",
      role: "strata_manager",
    },
    {
      key: "facilities_site.asset-register",
      title: "Build the common property asset register",
      detail:
        "Common property assets (roof, gates, pumps, lift, fire equipment, pool plant, lighting) are listed with age, condition and service provider, and linked to the 10-year plan.",
      group: "Property & site setup",
      role: "strata_manager",
    },
    {
      key: "facilities_site.open-works",
      title: "Take over open works and defects",
      detail:
        "Open work orders, quotes awaiting approval and known defects (including any building defect claims) are entered as work orders with next steps.",
      group: "Property & site setup",
      role: "strata_manager",
    },
    // Utilities
    {
      key: "facilities_site.utility-accounts",
      title: "Transfer the common property utility accounts",
      detail:
        "Common property electricity (Synergy), water (Water Corporation) and gas accounts are identified by account and meter number, and bills now come to the strata company in Ikon's care.",
      group: "Utilities",
      role: "administration",
    },
    {
      key: "facilities_site.utility-payments",
      title: "Move recurring payments to the new accounts",
      detail:
        "Utility and service payments are set up from the new administrative fund account, and direct debits on the outgoing manager's accounts have been cancelled.",
      group: "Utilities",
      role: "accountant",
    },
    // Keys & security
    {
      key: "facilities_site.key-register",
      title: "Register keys, fobs and remotes",
      detail:
        "Keys, fobs, remotes and access cards received are counted, tagged and recorded in Ikon's key register with where each is held.",
      group: "Keys & security",
      role: "onboarding_officer",
    },
    {
      key: "facilities_site.access-control",
      title: "Take over access control and codes",
      detail:
        "Administrator access to the gate, intercom and fob systems, and alarm or lock-box codes, are with Ikon, and the outgoing manager's access has been removed.",
      group: "Keys & security",
      role: "strata_manager",
    },
    {
      key: "facilities_site.site-notices",
      title: "Update on-site notices and emergency contacts",
      detail:
        "Noticeboards, lift and plant-room signs show Ikon's contacts and after-hours number, and the outgoing manager's notices have been removed.",
      group: "Keys & security",
      role: "strata_manager",
    },
    // Contractors & services
    {
      key: "facilities_site.fire-services",
      title: "Confirm fire services (AS 1851)",
      detail:
        "The fire services contractor is confirmed, routine servicing to AS 1851 is current, defects from the last report are listed, and the logbook is on site.",
      group: "Contractors & services",
      role: "strata_manager",
    },
    {
      key: "facilities_site.lift",
      title: "Confirm lift maintenance and registration",
      detail:
        "Where there is a lift, the maintenance contract, plant registration and latest inspection are confirmed and the emergency phone has been tested; otherwise the task is excluded.",
      group: "Contractors & services",
      role: "strata_manager",
    },
    {
      key: "facilities_site.cleaning-gardens-pest",
      title: "Confirm cleaning, gardening and pest control",
      detail:
        "Cleaning, gardening and pest-control contractors are confirmed with scope, frequency and price, and told to send invoices and reports to Ikon.",
      group: "Contractors & services",
      role: "onboarding_officer",
    },
    {
      key: "facilities_site.contractor-insurances",
      title: "Check contractor insurances",
      detail:
        "Every regular contractor's public liability and workers' compensation certificates are current and filed, and they have Ikon's work order and invoicing instructions.",
      group: "Contractors & services",
      role: "onboarding_officer",
    },
  ],
};

const READINESS_CLOSEOUT: TemplateSection = {
  key: "readiness_closeout",
  title: "Readiness & closeout",
  description: "Quality review, operational readiness and final closeout.",
  groups: ["Go-live checks", "Completion & quality assurance"],
  defaultOwnerRole: "principal",
  defaultApproverRole: "principal",
  tasks: [
    // Go-live checks
    {
      key: "readiness_closeout.golive-checks",
      title: "Work through the go-live checks",
      detail: "All 56 go-live checks are verified, or marked not applicable with a note explaining why.",
      group: "Go-live checks",
      role: "onboarding_officer",
    },
    {
      key: "readiness_closeout.section-reviews",
      title: "Quality review of every section",
      detail:
        "Each section has been reviewed by its nominated approver, and any changes requested have been made or accepted as a noted exception.",
      group: "Go-live checks",
      role: "principal",
    },
    {
      key: "readiness_closeout.final-approval",
      title: "Give final go-live approval",
      detail:
        "With no blockers left, the principal approves go-live on the Approvals tab; the building becomes active and owners and contractors deal with Ikon from then on.",
      group: "Go-live checks",
      role: "principal",
    },
    // Completion & quality assurance
    {
      key: "readiness_closeout.records-archived",
      title: "Archive the handover records",
      detail:
        "The outgoing manager's uploads, index, chase correspondence and sign-off are kept in the building's Files, and the secure link has been revoked or left to expire.",
      group: "Completion & quality assurance",
      role: "administration",
    },
    {
      key: "readiness_closeout.closeout-report",
      title: "Send the closeout report to the council",
      detail:
        "A short report to the council confirms what was received, the opening balances, open issues and the 90-day plan, and is filed in 07 Correspondence.",
      group: "Completion & quality assurance",
      role: "strata_manager",
    },
    {
      key: "readiness_closeout.lessons-learned",
      title: "Record lessons learned",
      detail:
        "What went well, what was late and any changes to this onboarding template are recorded, and the template is updated where needed.",
      group: "Completion & quality assurance",
      role: "principal",
    },
  ],
};

const COMMUNICATIONS_GROUP = "Communications";

const COMMUNICATIONS: TemplateSection = {
  key: "communications",
  title: "Communications and introductions",
  description: "Owner welcome, app rollout, council and agent correspondence, contractor handover and registration.",
  groups: [COMMUNICATIONS_GROUP],
  defaultOwnerRole: "administration",
  defaultApproverRole: "strata_manager",
  tasks: inGroup(COMMUNICATIONS_GROUP, [
    {
      key: "communications.owner-welcome",
      title: "Send the owner welcome letter",
      detail:
        "Every owner has Ikon's welcome letter (by email or post, per their address for service) with contacts, the new payment details for contributions, how to report repairs and the after-hours number.",
      role: "administration",
    },
    {
      key: "communications.owner-app",
      title: "Roll out the owner app and portal",
      detail:
        "Owners have been invited to the owner app and portal with simple instructions; sign-ups are tracked and a reminder goes to those not registered after two weeks.",
      role: "administration",
    },
    {
      key: "communications.council-introduction",
      title: "Send the council introduction letter",
      detail:
        "The council has the strata manager's introduction: direct contacts, how approvals and spending decisions will work, and the plan for the first 90 days.",
      role: "strata_manager",
    },
    {
      key: "communications.agent-letters",
      title: "Write to property managers and real estate agents",
      detail:
        "Property managers of leased lots know Ikon now manages the scheme, with contacts for repairs, by-law matters and s110 requests, and have been asked to tell their tenants.",
      role: "administration",
    },
    {
      key: "communications.contractor-handover",
      title: "Send contractor handover letters",
      detail:
        "Each contractor and supplier has written notice of the change of manager, where to send invoices and reports, and that work must be ordered by Ikon from the handover date.",
      role: "administration",
    },
    {
      key: "communications.registrations",
      title: "Update registrations and notifications",
      detail:
        "The insurer or broker, utility providers, the ATO (if registered), the local government and the bank have Ikon's details as manager and the new address for service; confirmations are filed.",
      role: "administration",
    },
  ]),
};

// ===========================================================================
// Handover documents the outgoing manager supplies (30, across all 8 folders)
// ===========================================================================

const HANDOVER_ITEMS: TemplateHandoverItem[] = [
  // 01 Plan & By-laws
  {
    key: "strata-plan",
    title: "Registered strata plan",
    detail:
      "The registered strata or survey-strata plan with the schedule of unit entitlement, and the scheme notice or management statement and any registered amendments.",
    folder: "01 Plan & By-laws",
    required: true,
    keywords: ["strata plan", "survey strata plan", "registered plan", "schedule of unit entitlement", "unit entitlement", "scheme notice", "management statement", "plan of subdivision", "landgate plan"],
  },
  {
    key: "by-laws",
    title: "Registered by-laws and amendments",
    detail:
      "The by-laws as registered at Landgate, every registered amendment (including exclusive use by-laws) and any resolutions to change the by-laws that have not been registered yet.",
    folder: "01 Plan & By-laws",
    required: true,
    keywords: ["by-laws", "bylaws", "by laws", "consolidated by-laws", "conduct by-laws", "governance by-laws", "exclusive use", "by-law amendment", "house rules"],
  },
  {
    key: "strata-roll",
    title: "Strata roll and owner contacts",
    detail:
      "The current strata roll: each lot's owner, address for service, email and phone, any consent to receive notices by email, and mortgagees where recorded.",
    folder: "01 Plan & By-laws",
    required: true,
    keywords: ["strata roll", "owner roll", "roll of owners", "owners register", "owner register", "owners list", "owner list", "owner contacts", "owner details", "lot owners", "contact list", "address for service"],
  },
  // 02 Insurance
  {
    key: "insurance-schedule",
    title: "Current insurance policy schedule",
    detail:
      "The current building and public liability policy schedule with the policy wording or PDS, the broker's details and the latest renewal notice or invoice.",
    folder: "02 Insurance",
    required: true,
    keywords: ["policy schedule", "insurance schedule", "schedule of insurance", "insurance policy", "policy wording", "product disclosure statement", "pds", "strata insurance", "building insurance", "insurance renewal", "renewal notice", "broker"],
  },
  {
    key: "certificate-of-currency",
    title: "Certificate of currency",
    detail: "The certificate of currency for the current insurance period, showing the sums insured and the period of cover.",
    folder: "02 Insurance",
    required: true,
    keywords: ["certificate of currency", "coc", "currency certificate", "certificate of insurance", "insurance certificate"],
  },
  {
    key: "insurance-valuation",
    title: "Insurance replacement valuation",
    detail: "The most recent replacement-cost (reinstatement) valuation of the buildings used to set the sum insured.",
    folder: "02 Insurance",
    required: true,
    keywords: ["insurance valuation", "replacement valuation", "reinstatement valuation", "replacement cost", "valuation report", "valuation", "quantity surveyor"],
  },
  {
    key: "insurance-claims",
    title: "Insurance claims history and open claims",
    detail: "A claims history for the last five years and the file for every open claim, with claim numbers, insurer contacts and where each claim is up to.",
    folder: "02 Insurance",
    required: true,
    keywords: ["claims history", "claims register", "claim register", "open claims", "insurance claim", "claim form", "loss history", "claims", "claim"],
  },
  // 03 Meetings
  {
    key: "general-meeting-minutes",
    title: "AGM and EGM minutes for the last three years",
    detail:
      "Signed minutes of every AGM and EGM in the last three years, with the notices, budgets adopted and resolutions passed, and papers for any meeting already called.",
    folder: "03 Meetings",
    required: true,
    keywords: ["agm minutes", "egm minutes", "annual general meeting", "extraordinary general meeting", "general meeting", "agm", "egm", "notice of meeting", "agm notice", "agenda", "special resolution", "resolution without dissent", "minutes"],
  },
  {
    key: "council-minutes",
    title: "Council meeting minutes and decisions",
    detail: "Minutes of council meetings and council decisions made by email or in writing over the last three years.",
    folder: "03 Meetings",
    required: true,
    keywords: ["council minutes", "council meeting", "council resolution", "council decision", "committee minutes", "committee meeting", "council", "minutes"],
  },
  {
    key: "council-members",
    title: "Council members and officers",
    detail: "The current council members and the chairperson, secretary and treasurer, with their contact details and when each was elected.",
    folder: "03 Meetings",
    required: true,
    keywords: ["council members", "council list", "council contacts", "council details", "office bearers", "chairperson", "treasurer", "secretary"],
  },
  // 04 Financials & Levies
  {
    key: "financial-statements",
    title: "Financial statements for the last three years",
    detail:
      "Financial statements for the last three financial years for the administrative and reserve funds, with the auditor's report where the accounts were audited.",
    folder: "04 Financials & Levies",
    required: true,
    keywords: ["financial statements", "financial report", "annual accounts", "audited accounts", "audited financial statements", "audit report", "auditor", "income and expenditure", "statement of financial position", "eofy", "fy accounts", "year end accounts"],
  },
  {
    key: "budgets",
    title: "Current administrative and reserve fund budgets",
    detail: "The administrative fund and reserve fund budgets adopted for the current financial year, as approved at the last AGM.",
    folder: "04 Financials & Levies",
    required: true,
    keywords: ["budget", "budgets", "admin fund budget", "administrative fund budget", "reserve fund budget", "adopted budget", "proposed budget"],
  },
  {
    key: "levy-register",
    title: "Contribution (levy) register and lot ledgers",
    detail:
      "The contribution (levy) register showing, for each lot, contributions raised and paid, the balance at the handover date and the next due date, with copies of the last contribution notices.",
    folder: "04 Financials & Levies",
    required: true,
    keywords: ["levy register", "levy roll", "levy schedule", "levy notice", "levy", "levies", "contribution register", "contribution schedule", "contribution notice", "contributions", "lot ledger", "owner ledger", "owner ledgers"],
  },
  {
    key: "arrears",
    title: "Arrears and debt recovery",
    detail:
      "An arrears report at the handover date, any payment plans, and the file for each debt recovery matter (letters of demand, Magistrates Court or SAT action).",
    folder: "04 Financials & Levies",
    required: true,
    keywords: ["arrears", "arrears report", "aged debtors", "debtors", "debt recovery", "debt collection", "overdue", "outstanding levies", "letter of demand", "payment plan"],
  },
  {
    key: "bank-statements",
    title: "Trust account bank statements",
    detail: "Bank statements for the strata company's administrative and reserve fund accounts for the last 12 months, up to the handover date.",
    folder: "04 Financials & Levies",
    required: true,
    keywords: ["bank statement", "bank statements", "trust account statement", "account statement", "trust account", "term deposit", "investment statement"],
  },
  {
    key: "final-reconciliation",
    title: "Final bank reconciliation and trial balance",
    detail:
      "The reconciliation of each fund at the handover date, the trial balance and the closing balances to be transferred to the strata company's new trust accounts.",
    folder: "04 Financials & Levies",
    required: true,
    keywords: ["bank rec", "bank reconciliation", "final reconciliation", "handover reconciliation", "reconciliation", "trial balance", "balance sheet", "closing balances", "funds transfer", "statement of funds"],
  },
  {
    key: "creditors",
    title: "Creditors and recurring payments",
    detail:
      "Unpaid invoices at the handover date, recurring payments and direct debits, and the account numbers for common property electricity, water and gas.",
    folder: "04 Financials & Levies",
    required: true,
    keywords: ["creditors", "creditors list", "aged creditors", "accounts payable", "unpaid invoices", "payables", "direct debit", "recurring payments", "utility accounts", "synergy", "water corporation"],
  },
  {
    key: "tax-records",
    title: "ABN, GST, BAS and income tax records",
    detail:
      "The strata company's ABN and GST registration (or confirmation it is not registered), BAS lodged in the last two years, and income tax returns and notices of assessment.",
    folder: "04 Financials & Levies",
    required: true,
    keywords: ["bas", "business activity statement", "activity statement", "gst", "gst registration", "abn", "tax return", "income tax", "notice of assessment", "ato", "tfn"],
  },
  // 05 Maintenance & Contractors
  {
    key: "contractors",
    title: "Contractors and service agreements",
    detail:
      "A list of current contractors and suppliers with contacts, and the signed agreements for cleaning, gardening, lift, fire services and pest control, with prices and expiry dates.",
    folder: "05 Maintenance & Contractors",
    required: true,
    keywords: ["contractor list", "contractors list", "contractor register", "contractors", "supplier list", "service agreement", "service agreements", "maintenance contract", "cleaning contract", "gardening contract", "lift contract", "cleaning", "gardening", "pest control"],
  },
  {
    key: "maintenance-records",
    title: "Open work orders and maintenance history",
    detail: "Open work orders, quotes awaiting approval and the maintenance history for the last two years, including recurring problems.",
    folder: "05 Maintenance & Contractors",
    required: true,
    keywords: ["work orders", "work order", "maintenance log", "maintenance history", "maintenance register", "maintenance report", "repairs", "quotes", "quote", "quotation", "job list", "open jobs"],
  },
  {
    key: "ten-year-plan",
    title: "10-year plan and reserve fund forecast",
    detail:
      "The current 10-year plan (required for schemes of 10 or more lots) or maintenance plan, with the reserve fund forecast and any building condition report.",
    folder: "05 Maintenance & Contractors",
    required: true,
    keywords: ["10 year plan", "ten year plan", "10 year maintenance plan", "maintenance plan", "capital works plan", "reserve fund forecast", "reserve fund plan", "building condition report", "condition report"],
  },
  {
    key: "warranties-drawings",
    title: "Warranties, defects and building drawings",
    detail:
      "Current warranties, defect reports and claims, building and services drawings (as-constructed plans) and manuals for common property plant and equipment.",
    folder: "05 Maintenance & Contractors",
    required: false,
    keywords: ["warranty", "warranties", "defects", "defect report", "building defects", "as constructed", "as built", "drawings", "building plans", "manual", "manuals", "operation and maintenance"],
  },
  {
    key: "keys-register",
    title: "Keys, fobs and remotes register",
    detail:
      "A list of the keys, fobs, remotes and access cards held for the strata company (and who else holds them), access-control and alarm codes, and the common seal if there is one.",
    folder: "05 Maintenance & Contractors",
    required: true,
    keywords: ["key register", "keys register", "key list", "keys", "key", "fob", "fobs", "remote", "remotes", "access cards", "access card", "swipe cards", "access control", "common seal"],
  },
  // 06 Compliance & Safety
  {
    key: "fire-services",
    title: "Fire services records and logbook",
    detail:
      "Fire services maintenance reports and the logbook (AS 1851), the fire equipment register, any outstanding fire defects and the emergency evacuation plan.",
    folder: "06 Compliance & Safety",
    required: true,
    keywords: ["fire services", "fire safety", "fire report", "fire logbook", "fire log book", "fire inspection", "fire equipment", "as1851", "as 1851", "afss", "fire safety statement", "essential safety", "evacuation plan", "evacuation", "evac plan", "evac", "emergency lighting", "exit lights", "extinguishers", "sprinklers", "hydrant", "fire"],
  },
  {
    key: "asbestos-whs",
    title: "Asbestos register and safety records",
    detail:
      "The asbestos register and management plan (buildings constructed before 2004), hazardous materials surveys and common property work health and safety risk assessments.",
    folder: "06 Compliance & Safety",
    required: true,
    keywords: ["asbestos", "asbestos register", "asbestos management plan", "hazardous materials", "hazmat", "whs", "ohs", "work health and safety", "risk assessment", "safety audit", "safety report"],
  },
  {
    key: "other-compliance",
    title: "Other compliance certificates",
    detail:
      "Where they apply: lift registration and inspection reports, pool barrier inspection, backflow testing, roof anchor and height safety certification, and RCD testing.",
    folder: "06 Compliance & Safety",
    required: false,
    keywords: ["lift registration", "lift inspection", "lift certificate", "lift cert", "lift", "pool barrier", "pool inspection", "pool", "backflow", "backflow test", "roof anchor", "anchor points", "height safety", "rcd", "test and tag", "compliance certificate", "legionella"],
  },
  // 07 Correspondence
  {
    key: "correspondence",
    title: "Recent correspondence and open owner matters",
    detail:
      "Correspondence with owners, the council and third parties from the last 12 months, open complaints and by-law breach notices, and approvals given or in progress.",
    folder: "07 Correspondence",
    required: true,
    keywords: ["correspondence", "letters", "letter", "emails", "email", "complaint", "complaints", "breach notice", "by-law breach", "notice of breach", "owner correspondence", "approvals", "renovation approval"],
  },
  {
    key: "legal-matters",
    title: "Legal matters and SAT proceedings",
    detail:
      "Files for any current or recent legal matter: SAT applications and orders, court proceedings, solicitors' advice and disputes, with key dates. Mark not applicable if there are none.",
    folder: "07 Correspondence",
    required: true,
    keywords: ["sat", "state administrative tribunal", "tribunal", "sat orders", "legal advice", "legal", "solicitor", "lawyer", "court", "magistrates court", "dispute", "litigation"],
  },
  // 08 Sales & Disclosure
  {
    key: "s110-certificates",
    title: "s110 certificates and sales in progress",
    detail:
      "Section 110 certificates and disclosure information issued in the last 12 months, and requests or settlements still in progress.",
    folder: "08 Sales & Disclosure",
    required: true,
    keywords: ["s110", "s110 certificate", "section 110", "disclosure", "disclosure statement", "settlement", "settlements", "settlement agent", "conveyancer", "sale", "sales", "purchaser", "information certificate"],
  },
  {
    key: "ownership-tenancies",
    title: "Ownership changes and tenancies",
    detail:
      "Notices of change of ownership received in the last 12 months, and the tenants and managing agents (property managers) of leased lots.",
    folder: "08 Sales & Disclosure",
    required: false,
    keywords: ["change of ownership", "notice of transfer", "transfer of land", "new owner", "property manager", "property managers", "managing agent", "real estate agent", "tenancy", "tenancies", "tenant", "tenants", "lease"],
  },
];

// ===========================================================================
// Go-live checks (56): Records 8, Stratafy 8, Xero 4, Finance 10, Insurance 6, Compliance 8, Site 6,
// Communications 6
// ===========================================================================

const check = (group: string, key: string, title: string): TemplateGoLiveCheck => ({ key: `golive.${key}`, title, group });

const GO_LIVE_CHECKS: TemplateGoLiveCheck[] = [
  // Records
  check("Records", "records.strata-plan", "Registered strata plan and schedule of unit entitlement filed in 01 Plan & By-laws"),
  check("Records", "records.by-laws", "Registered by-laws, with every amendment, filed and checked against Landgate's copy"),
  check("Records", "records.strata-roll", "Strata roll complete: every lot has an owner and an address for service"),
  check("Records", "records.minutes", "Last three years of AGM, EGM and council minutes filed in 03 Meetings"),
  check("Records", "records.required-verified", "Every required handover document verified, or not applicable with a reason"),
  check("Records", "records.extra-files", "Extra files from the outgoing manager reviewed and filed in the right folders"),
  check("Records", "records.originals", "Original records, keys and the common seal (if any) received and signed for"),
  check("Records", "records.sign-off", "Outgoing manager's written confirmation that the handover is complete is on file"),
  // Stratafy
  check("Stratafy", "stratafy.scheme", "Scheme details in Stratafy match the strata plan (SP number, address, lots)"),
  check("Stratafy", "stratafy.entitlements", "Unit entitlements in Stratafy add up to the strata plan's total"),
  check("Stratafy", "stratafy.owners", "Every lot has its owner, address for service and notice preference in Stratafy"),
  check("Stratafy", "stratafy.council", "Council members and officers recorded in Stratafy"),
  check("Stratafy", "stratafy.budgets", "Administrative and reserve fund budgets in Stratafy match the adopted budgets"),
  check("Stratafy", "stratafy.contributions", "Contribution schedule totals agree to the budgets"),
  check("Stratafy", "stratafy.lot-balances", "Lot balances agree to the outgoing manager's contribution (levy) register"),
  check("Stratafy", "stratafy.payment-details", "Contribution notices show the new trust account and payment references"),
  // Xero
  check("Xero", "xero.customer", "Strata company set up as a customer in Xero"),
  check("Xero", "xero.repeating-invoice", "Management fee repeating invoice matches the contract's fee schedule"),
  check("Xero", "xero.item-codes", "Item codes for additional-work charges set at the contract rates"),
  check("Xero", "xero.first-invoice", "First invoice checked and starting from the handover date"),
  // Finance
  check("Finance", "finance.trust-accounts", "Administrative and reserve fund trust accounts open and confirmed by the bank"),
  check("Finance", "finance.details-by-phone", "Account details given to the outgoing manager by phone, not only by email"),
  check("Finance", "finance.funds-received", "Administrative and reserve fund balances received from the outgoing manager"),
  check("Finance", "finance.funds-reconciled", "Funds received agree to the outgoing manager's final reconciliation"),
  check("Finance", "finance.opening-balances", "Opening balances entered and the trial balance agrees"),
  check("Finance", "finance.arrears", "Arrears confirmed and every recovery matter has a next step"),
  check("Finance", "finance.creditors", "Unpaid creditors at handover listed and scheduled for payment"),
  check("Finance", "finance.direct-debits", "Recurring payments moved to the new accounts and old direct debits cancelled"),
  check("Finance", "finance.gst-bas", "GST registration status confirmed and BAS obligations recorded (or none)"),
  check("Finance", "finance.income-tax", "Income tax return position confirmed"),
  // Insurance
  check("Insurance", "insurance.current", "Building insurance current, with the certificate of currency on file"),
  check("Insurance", "insurance.sum-insured", "Sum insured matches the latest replacement valuation"),
  check("Insurance", "insurance.public-liability", "Public liability cover is at least $10 million"),
  check("Insurance", "insurance.manager-noted", "Insurer or broker has Ikon recorded as strata manager"),
  check("Insurance", "insurance.renewal", "Renewal date diarised with a reminder 60 days before"),
  check("Insurance", "insurance.claims", "Open claims listed and the insurer told Ikon now manages them"),
  // Compliance
  check("Compliance", "compliance.contract", "Signed management contract and appointing resolution on file"),
  check("Compliance", "compliance.disclosure", "Commission and conflict of interest disclosures given to the strata company"),
  check("Compliance", "compliance.address-for-service", "Landgate change of the strata company's address for service lodged"),
  check("Compliance", "compliance.agm-due", "Next AGM diarised within 15 months of the last one"),
  check("Compliance", "compliance.fire", "Fire services serviced to AS 1851 and open defects listed"),
  check("Compliance", "compliance.asbestos", "Asbestos register on file (buildings constructed before 2004)"),
  check("Compliance", "compliance.lift-pool", "Lift registration and pool barrier inspection current, where present"),
  check("Compliance", "compliance.legal", "Legal matters and SAT proceedings listed with their next dates"),
  // Site
  check("Site", "site.inspection", "Initial site inspection report and photos filed"),
  check("Site", "site.keys", "Keys, fobs and remotes counted and in Ikon's key register"),
  check("Site", "site.access", "Access-control and alarm codes changed over; outgoing manager's access removed"),
  check("Site", "site.utilities", "Electricity, water and gas accounts billed in Ikon's care"),
  check("Site", "site.contractors", "Regular contractors confirmed, with current insurance certificates"),
  check("Site", "site.notices", "On-site notices show Ikon's contacts and after-hours number"),
  // Communications
  check("Communications", "communications.owners", "Welcome letter sent to every owner"),
  check("Communications", "communications.owner-app", "Owner app and portal invitations sent"),
  check("Communications", "communications.council", "Council introduction letter sent"),
  check("Communications", "communications.agents", "Property managers of leased lots notified"),
  check("Communications", "communications.contractors", "Contractors and suppliers notified of the change of manager"),
  check("Communications", "communications.registrations", "Insurer, utilities and other registrations updated"),
];

/** The groups go-live checks are shown under, in display order. */
export const GO_LIVE_CHECK_GROUPS = ["Records", "Stratafy", "Xero", "Finance", "Insurance", "Compliance", "Site", "Communications"] as const;

export const ONBOARDING_TEMPLATE: OnboardingTemplate = {
  version: "2026-11-sample-1",
  sections: [OUTGOING_MANAGER, STRATAFY, XERO, APPOINTMENT, FINANCE_COMPLIANCE, FACILITIES_SITE, READINESS_CLOSEOUT, COMMUNICATIONS],
  handoverItems: HANDOVER_ITEMS,
  goLiveChecks: GO_LIVE_CHECKS,
};
