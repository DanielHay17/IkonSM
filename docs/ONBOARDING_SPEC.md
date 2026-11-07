# Onboarding module: spec

**Status:** contract for the build. Types live in `shared/onboarding.ts`; they are the source of truth, and this document explains them.

## Why

When Ikon wins a new scheme, Peter King has to collect thousands of documents from the outgoing strata manager, set the scheme up in Stratafy and Xero, sort out finance, insurance and compliance, introduce Ikon to the owners, and only then go live. He started building this in Zoho Creator: the "IK Property Operations Platform → Onboarding Dashboard". We rebuild that inside the IKON SM Command Hub, keyed by building (property id / SP number), with two improvements:

1. **The outgoing manager gets their own upload portal**, reached with a secure link. Their uploads go straight into the right Master File Structure folder of that building's Files. This is the "data room" idea from the Sapien HFG Renewables repo: SharePoint zips are read in the browser and uploaded file by file (`src/lib/zipUpload.ts` there).
2. **It is a project map**: one screen shows where the onboarding is, who owns each part, what is blocking go-live, and the activity history.

## Screens to mirror (from Peter's Zoho screenshots)

**Onboarding dashboard** (`PORTFOLIO / ONBOARDING`)
- Heading "ONBOARDING DASHBOARD", with the intro: "Track each scheme from records transfer to operational readiness. Open a project to review its eight onboarding sections, owners and outstanding documents."
- Button **View projects & approvals**.
- Links: **Management company directory · Add company · Outgoing manager directory · Add outgoing manager**.
- Each project is a collapsible block headed "SP87192 · SP87192 – PILOT ONBOARDING" (`Project: Draft · Go-live: Not reviewed · Closeout: Open`). The block contains:
  - the line "82 tasks · 30 handover items · 56 go-live checks";
  - links **Project & final approvals · All project tasks · All handover records**.
- **Handover invitation** card:
  - "Select the incoming Ikon manager from the staff register, enter the outgoing manager and confirm the two dates."
  - "0 saved drafts", **Prepare handover draft**, **View handover requests**.
  - "Email delivery: not connected. Saving prepares a draft; it does not send an invitation."
- **Eight section cards**, in a grid of 4 columns × 2 rows on desktop. Each card has:
  - the title in display caps and a one-line description;
  - "N / M tasks complete" (large) and "N excluded or cancelled";
  - sub-area links (the section's groups);
  - for Outgoing manager, "N documents verified · N awaiting verification";
  - for Readiness, "N / 56 checks verified · N not applicable";
  - small lines: "Progress: Not started · Review: Not reviewed · Owner: Unassigned · Nominated approver: Unassigned";
  - a **Section assignment** link.
- **Documents missing** card: "Outstanding handover documents across the same project. **N awaiting supply**".

The eight sections, in this order:

| # | Key | Title | Tasks | Description | Groups |
|---|---|---|---|---|---|
| 1 | `outgoing_manager` | Outgoing manager | 8 | Request, receive and verify the handover pack. | Document checklist & evidence; Records transfer |
| 2 | `stratafy` | Stratafy | 17 | Prepare and configure the scheme in Stratafy. | Stratafy / Systems |
| 3 | `xero` | Xero setup | 3 | Customer, invoice and item-code setup. | Xero set up |
| 4 | `appointment` | Appointment & owners | 17 | Authority to act, council and owner records, by-laws. | Appointment; Council; Owners; By-laws |
| 5 | `finance_compliance` | Finance & compliance | 13 | Opening finances, insurance, taxation and statutory records. | Financial setup; Insurance; Tax & statutory returns; Legal & compliance |
| 6 | `facilities_site` | Facilities & site | 12 | Site, utilities, access, contractors and services. | Property & site setup; Utilities; Keys & security; Contractors & services |
| 7 | `readiness_closeout` | Readiness & closeout | 6 | Quality review, operational readiness and final closeout. | Go-live checks; Completion & quality assurance |
| 8 | `communications` | Communications and introductions | 6 | Owner welcome, app rollout, council and agent correspondence, contractor handover and registration. | Communications |

- **Totals:** 82 tasks, 30 handover items and 56 go-live checks.
- **Section 4:** Peter's 4th card is cut off ("AP…"). Its links begin "App…", "Cou…", "Own…" and "Hous…". The task total (82) implies 17 tasks.
- **WA content:** tasks, documents and checks must be realistic for WA strata (Strata Titles Act 1985 (WA) as amended 2020). Use "strata company", "council", "contributions", "administrative fund" and "reserve fund"; never "owners corporation" or "sinking fund".
- **SAMPLE label:** the content is SAMPLE until Peter supplies his exact list. Label it so in the UI with a "SAMPLE checklist" badge on the project header.

## Roles and identity

- Everyone signs in with the shared passcode. The name typed at sign-in maps to a staff member with `staffForName()`.
- The UI shows "Acting as Peter King · Principal". For a name not in the register, it shows "Not in the staff register".
- Anyone signed in can do anything. Every action records the actor's name.
- When someone other than the nominated approver reviews or approves, the event says so, e.g. "Daniel reviewed Finance & compliance (nominated approver: Priya Sample)".
- The staff register is `STAFF_DIRECTORY`: Peter King (real), plus SAMPLE Tom Placeholder (strata manager), Priya Sample (accountant), Mia Example (onboarding officer) and Lee Demo (administration).
- New projects take each section's default owner and approver from the template roles, using the first staff member with that role.

## Data model

### Building agent (`PropertyAgent`, one SQLite per building)

New tables in `worker/agents/property-schema.ts`, all using `CREATE TABLE IF NOT EXISTS`:
- `onboarding_project`: at most one row; holds the project fields.
- `onboarding_sections`
- `onboarding_tasks`
- `handover_items`: one row per requested item. Files link through `handover_files`, which has `doc_id`, `item_id` (nullable for extra files), `source_path`, `uploaded_by` and `uploaded_at`.
- `golive_checks`
- `handover_invites`: holds `token_hash` (hex SHA-256 of the full token) and `token_enc` (the token, AES-GCM encrypted with a key HKDF-derived from SESSION_SECRET, info "ikonsm-portal-token"), so staff can copy the link again.
- `onboarding_events`

Put the onboarding logic in a new module `worker/agents/onboarding.ts`, with functions that take the agent's `sql` helpers. Keep `property-agent.ts` changes to thin RPC methods.

**Derived values** (computed on read, never stored):
- **Section counts:** done and open as named. "excluded" counts excluded plus cancelled.
- **Section progress:** `not_started` if done = 0 and excluded = 0; `complete` if open = 0; otherwise `in_progress`.
- **Project counts:** see `ProjectCounts`.
- **Blockers:** plain-English lines, empty when go-live can be approved. Each kind reports its count only when it is non-zero:
  - "3 sections not reviewed: Stratafy, Xero setup, Facilities & site"
  - "12 tasks still open"
  - "8 required handover documents not verified"
  - "40 go-live checks not done"
  - "No handover invitation sent" (when no invite has ever been activated)

**Status transitions:**
- **Project:** `draft` when created. It becomes `active` when the first invite is activated or the first task is completed. It becomes `go_live_approved` on final approval (only with no blockers; otherwise 409 with the blockers). It becomes `closed` on closeout, which is only after go-live approval and only once the "Completion & quality assurance" tasks are all done or excluded.
- **Handover item:**
  - Starts `awaiting_supply`.
  - Moves to `awaiting_verification` on the first file, or when a file arrives after a rejection.
  - Staff can set `verified`, `rejected` (`reviewNote` required, shown in the portal), `not_applicable` or `awaiting_supply`.
  - The outgoing manager can mark an item `not_applicable` with a note. For a required item this still needs staff verification: the status becomes `awaiting_verification`, and the supplier note is shown to staff.
- **Go-live check:** `open` → `verified` or `not_applicable`, and can be reopened.

**Building status:** when go-live is approved, the building's profile status becomes `active`. Store this as a meta override (`status_override`) applied when the profile is read, so re-seeding does not undo it. The portfolio then shows it as active.

### Chief of Staff agent (hub-wide)

- **Directory tables:** `mgmt_companies` and `outgoing_managers` (see the `ManagementCompany` and `OutgoingManagerContact` types), seeded with 3 SAMPLE companies and 4 SAMPLE outgoing managers.
- **Dashboard list:** `listOnboarding()` fans out to every building with `agent.getOnboardingSummary()`, which returns the project without detail, or null. It returns `OnboardingSummary[]` for all 16 buildings: buildings with a project first (newest first), then the rest.

## Upload trust model

Portal uploads are filed with `uploadedBy = "handover:<Name> (<Company>)"` (`HANDOVER_UPLOAD_PREFIX`). Until verified, they are excluded from the agents' trusted search and drafting, exactly like `email:` attachments:
- `searchIndex` excludes `handover:%` unless `includeEmailed` is set (the Files screen).
- The drafting and agent-loop checks that use `emailedBy` also treat `handoverUploadedBy()` as untrusted.

When staff **verify** an item, its documents are promoted: `uploaded_by` becomes `"<Name> (<Company>), verified by <staff>"`, and the documents become normal building records. The Files tab shows unverified handover documents with a "From outgoing manager · awaiting verification" label.

## API

All routes are under `/api` and follow the existing conventions: Hono, zod validation, JSON content type plus Origin check on mutations (`requestGuard`), 404 on unknown ids, and `HTTPException` for errors.

### Staff (requires a session)

| Method and path | Body | Returns |
|---|---|---|
| `GET /staff` | | `StaffMember[]` |
| `GET /onboarding` | | `OnboardingSummary[]` (via the Chief of Staff) |
| `GET /directory/companies` | | `ManagementCompany[]` |
| `POST /directory/companies` | name, abn?, phone?, email?, website?, address?, notes? | `ManagementCompany` (201) |
| `GET /directory/outgoing-managers` | | `OutgoingManagerContact[]` |
| `POST /directory/outgoing-managers` | companyId?, name, email, phone? | `OutgoingManagerContact` (201) |
| `GET /properties/:id/onboarding` | | `OnboardingProjectDetail` (404 if none) |
| `POST /properties/:id/onboarding` | `CreateProjectInput` | `OnboardingProjectDetail` (201; 409 if one exists). Default name `"SP<n> – Onboarding"`. |
| `POST /properties/:id/onboarding/tasks/:taskId` | `TaskPatch` | `OnboardingTask` |
| `POST /properties/:id/onboarding/sections/:key` | `SectionPatch` | `OnboardingSection` |
| `POST /properties/:id/onboarding/sections/:key/review` | `SectionReviewInput` | `OnboardingSection` |
| `POST /properties/:id/onboarding/handover/:itemId` | `HandoverItemPatch` | `HandoverItem` |
| `POST /properties/:id/onboarding/golive/:checkId` | `GoLiveCheckPatch` | `GoLiveCheck` |
| `POST /properties/:id/onboarding/approve` | `FinalApprovalInput` | `OnboardingProjectDetail` (409 with `{error, blockers}` when blocked) |
| `POST /properties/:id/onboarding/closeout` | `{}` | `OnboardingProjectDetail` (409 when not allowed) |
| `POST /properties/:id/onboarding/invites` | `CreateInviteInput` | `HandoverInvite` (201, status `draft`). Also adds the outgoing manager to the building's contacts as role `other`, with notes "Outgoing strata manager (handover)", if not already there. |
| `POST /properties/:id/onboarding/invites/:inviteId/activate` | `{ expiresInDays?: number }` (default 30, max 90) | `{ invite, url }`; see below |
| `GET /properties/:id/onboarding/invites/:inviteId/link` | | `{ url }` (decrypted; active invites only) |
| `GET /properties/:id/onboarding/invites/:inviteId/letter` | | `{ subject, text }` |
| `POST /properties/:id/onboarding/invites/:inviteId/revoke` | `{}` | `HandoverInvite` |

**Activating an invite:**
- Generates the token `"<spNumber>-<43 base64url chars>"` from 32 random bytes and stores the hash and encrypted copy.
- Sets `expiresAt`.
- Builds the letter with `renderHandoverLetter` and creates a **send_email approval** (no thread) addressed to the outgoing manager, containing the link. It appears in Approvals like any draft and is never sent automatically.
- Logs events and returns the absolute URL `<origin>/handover/<token>`. Use `env.PUBLIC_URL` if set, else the request origin.

Only one invite may be `active` at a time. Activating another revokes the previous one.

### Portal (public; the token is the credential)

All portal routes are under `/api/portal/:token`:
- The path is matched in `PUBLIC_API_PATHS` handling by prefix `/api/portal/`. Keep `requestGuard`, and require a same-origin Origin header on mutations (`requireBrowserOrigin`).
- The token must match `PORTAL_TOKEN`. The Worker routes to building `sp-<n>`, and the building agent compares the SHA-256 hash in constant time.
- Unknown tokens or unknown buildings get **404** "This link is not valid."
- Expired or revoked links get **410** "This link has expired or been withdrawn. Please contact Ikon." Do not reveal which.
- Rate limit with a new ratelimit binding `PORTAL_LIMITER` (namespace "1002", 600 requests per 60 s), keyed by token + IP.

| Method and path | Body | Returns |
|---|---|---|
| `GET /portal/:token` | | `PortalView`. Logs a `portal` event at most once per 10 minutes per token, and updates `lastAccessAt` and `accessCount`. |
| `POST /portal/:token/upload` | multipart: `file`; `folder` (a VAULT_FOLDERS value); `itemId` (optional); `relativePath` (optional, ≤ 500 chars) | `PortalUploadResult` (201) |
| `POST /portal/:token/items/:itemId/not-applicable` | `{ note }` | `PortalItem` |
| `POST /portal/:token/items/:itemId/note` | `{ note }` | `PortalItem` |
| `POST /portal/:token/submit` | `{ message? }` | `PortalView` |

**Uploads:**
- At most 25 MB per file (reuse `MAX_UPLOAD_BYTES`), 3,000 files and 5 GB in total per invite.
- No junk files (`isJunkPath`).
- File names go through `displayFileName`.
- With no `itemId`, the server runs `matchHandoverFile` and attaches the file to the best item if confidence ≥ 0.5. Otherwise it is an extra file.
- An upload to a `verified` item is allowed: it adds the file and sets the item back to `awaiting_verification`.
- Files are filed through `worker/docs/filing.ts` with the `handover:` uploader.

**Submit:** sets the invite to `submitted`. It records an event, logs building activity ("Outgoing manager submitted the handover pack: 18 of 30 documents supplied"), and the Chief of Staff brief mentions it. The portal stays usable for late documents until it expires.

## Outgoing manager's portal (`/handover/:token`, public SPA route)

- Rendered without a session, with no sidebar. Branded IKON SM: charcoal band with the reversed logo, Poppins, square corners.
- **Header:** "Handover of SP 87192, 160 Wright Street, Kewdale". "Requested by Tom Placeholder, Strata Manager, IKON SM. Records due 21 Nov 2026. This secure link expires 6 Dec 2026."
- **Progress bar:** supplied / verified / not applicable / outstanding.
- **Upload zone:**
  - Drop a SharePoint or OneDrive zip, a folder, or files.
  - Zips are read in the browser with `@zip.js/zip.js` (`ZipReader` + `BlobReader`, `useWebWorkers: false`, `filenameEncoding: 'utf-8'`), as in HFG `src/lib/zipUpload.ts`. Files are listed without unpacking and decompressed one at a time while uploading.
  - Folders are read with `webkitGetAsEntry`, as in HFG `src/lib/dropFiles.ts`.
- **Review table** before upload:
  - one row per file: path, size, suggested requested document (from `matchHandoverFile`) with confidence, and folder;
  - both can be changed with selects;
  - junk files are skipped and counted ("3 system files skipped");
  - files over the limit are flagged.
  - **Upload N files** sends 3 at a time with per-file progress and retry. A summary follows.
- **Requested documents:** grouped by the 8 folders. Each item shows its title, detail, Required/Optional, status chip, uploaded files, **Upload** (to that item), and **Not applicable** with a reason. A rejected item shows Ikon's note.
- **Submit handover pack** button, with a confirmation. The page says it can still be used for late documents.
- **Errors:** an expired or revoked link gets a friendly full-page message. A network failure keeps the queue and offers retry.
- **Phone:** a usable single column.

## Staff UI

- **Sidebar:** new item **Onboarding** (between Approvals and Chief of Staff) → `/onboarding`.
- **Routes** (in `src/router.ts`):
  - `/onboarding`: the dashboard.
  - `/onboarding/:propertyId/:tab`: tabs `overview`, `tasks`, `handover`, `golive`, `approvals`, `map`, `activity`; default `overview`.
  - `/onboarding/directory/companies` and `/onboarding/directory/outgoing-managers`.
  - `/handover/:token`: the public portal.
- **Dashboard:**
  - Mirrors Peter's screen (above), with every project collapsible. The first project is open by default.
  - "Start onboarding" picks a building without a project (onboarding-status buildings first).
- **Project overview:**
  - Header block.
  - The handover invitation card, with drafts, the active link (Copy link / Revoke / Preview letter) and access stats ("Opened 3 times, last 2 hours ago").
  - The 8 section cards; a card click goes to Tasks filtered to that section.
  - The Documents missing card.
  - A blockers panel ("Before go-live: …").
- **Tasks:** grouped by section, then group. Each row has:
  - a checkbox to mark done;
  - a status menu (open / done / excluded / cancelled);
  - owner select from the staff register, with initials avatars;
  - due date;
  - note.
  - Filters: section, owner, status, "mine" (the acting staff member). Optimistic updates with rollback.
- **Handover:** the 30 items grouped by folder, with status chips. Each item has:
  - its files (open in Files and preview text);
  - Verify / Needs replacing (note) / Not applicable / Reopen;
  - supplier notes;
  - an "Extra files" list.
  - Bulk verify for selected items.
- **Go-live:** the 56 checks grouped, each with Verified / N/A / reopen and a note; a counter at the top.
- **Approvals:**
  - Section reviews: each section with its approver, review status, Reviewed / Changes requested buttons and a note.
  - Final approval: shows the blockers, or **Approve go-live**; then **Close out project**.
- **Map:** the project map.
  - A horizontal flow on desktop (vertical on phones) of milestones: Appointed → Handover requested → Records received → Records verified → Systems set up (Stratafy + Xero) → Finance & compliance → Facilities & site → Communications → Go-live checks → Go-live approved → Closed out.
  - Each node shows its status (done, in progress, not started, blocked), counts and owner initials, and links to its tab.
  - All derived from the project detail; no new API.
- **Activity:** the project's events, newest first.
- **Building page:** if the building has a project, a chip in the header "Onboarding 37%" links to it.
- **Brand and components:** use the existing ones (Card, Button, Badge, Modal, Field, Tabs, Toast, Icon, EmptyState).
  - Squared, charcoal and white.
  - Amber is for "awaiting" or SAMPLE only; red for blockers or rejections; green for verified or done.
  - Section card titles use `heading-display` caps like Peter's.
- **Accessibility:** WCAG AA, keyboard operable, labelled controls.

## Chief of Staff and agents

- **Rules brief and "what needs my attention" answer:** add an "Onboarding" section, e.g. "SP 87192 Kewdale: 26/82 tasks, 12 handover documents awaiting supply, 4 awaiting verification, go-live blocked by 5 items". A submitted handover pack is a highlight.
- **Building agent chat tool** `onboarding_status` (agent-loop tool set "chat"): returns outstanding handover documents and blockers, so "What are we still waiting for from the outgoing manager?" works with AI on.
- **Offline chat:** if the question mentions onboarding, handover or outstanding documents, prepend a short onboarding summary.

## Demo data (`POST /api/demo/load` and `/api/demo/clear`)

Load two projects, both with `demo: true`, replacing previous demo projects. `/api/demo/clear` removes demo projects (and their portal uploads, files and invites) but never non-demo projects.

**SP 87192 Kewdale, "SP87192 – Pilot onboarding":**
- **Dates:** created 9 days ago; handover date in 12 days; records due in 5 days; target go-live in 20 days.
- **Invite:** active, opened 3 times. Incoming manager Tom Placeholder; outgoing manager "Sam Outgoing, Sample Strata Co Pty Ltd" (SAMPLE).
- **Task progress per section:**
  - Outgoing manager 5/8
  - Stratafy 6/17
  - Xero 3/3 (reviewed by Priya)
  - Appointment 12/17
  - Finance 4/13 (1 excluded)
  - Facilities 3/12
  - Readiness 0/6
  - Communications 2/6
- **Handover:**
  - 9 verified, 5 awaiting verification (with SAMPLE files), 1 rejected (with a note), 1 not applicable, the rest awaiting supply.
  - Plus 2 extra files.
  - The SAMPLE files are small generated `.txt` files with realistic SAMPLE content, named like real documents (e.g. "SP87192 Certificate of Currency 2026 (SAMPLE).txt").
- **Go-live:** 14 of 56 verified.
- **Events:** backdated across the 9 days.

**SP 82719 Rivervale, "SP82719 – Onboarding":** a fresh draft, created today, with one draft invite not yet activated.

## Tests (vitest in workerd)

- **Project basics:**
  - create and get a project; counts match the template;
  - a second create gets 409;
  - section progress derivation;
  - task patching (owner must be in the register or null; status values);
  - events are recorded with the actor.
- **Reviews and go-live:**
  - review by a non-approver is allowed and the event says so;
  - final approval returns 409 with blockers until everything is done, then succeeds;
  - after approval, the building status is `active` and the portfolio shows it;
  - closeout rules.
- **Invites:**
  - create, then activate: the token format, the stored hash, the URL, and a send_email approval with the link and the letter;
  - the outgoing manager added to contacts;
  - activating another invite revokes the previous one;
  - copying the link returns the same URL;
  - revoke works.
- **Portal access:**
  - GET with a valid token gives the `PortalView` with no internal notes leaked (no staff-only fields);
  - an unknown token gives 404; revoked or expired gives 410;
  - a malformed token gives 404;
  - no session is needed;
  - a mutation without Origin gets 403;
  - the rate limiter is wired.
- **Portal uploads:**
  - an upload to an item sets it to `awaiting_verification`;
  - an upload without an item is auto-matched, or filed as an extra;
  - a junk file is rejected;
  - an oversize file gets 413;
  - a bad folder gets 400;
  - path traversal in `relativePath` is sanitised;
  - the file appears in the building's Files with the `handover:` uploader;
  - it is excluded from the agent's search until verified, then included.
- **Portal actions:** not-applicable and note work; submit works; a verified-then-new-upload item goes back to `awaiting_verification`.
- **Directories:** list and create, with validation.
- **Chief of Staff:** `GET /onboarding` lists all 16 buildings with the demo projects first; the rules brief includes the onboarding section.
- **Demo:** demo load and clear for onboarding, with non-demo projects untouched.
- **Shared functions** (unit tests): `staffForName`, `matchHandoverFile` (against realistic SharePoint paths), `renderHandoverLetter`.

## Not in scope

- Real Stratafy or Xero integrations: they are checklist items only.
- Real email sending: the invitation is a draft in Approvals until email is set up for agent.ikonsm.com.au.
- Per-user logins.
- Contract e-signing.

## Build ownership (parallel branches; keep to your files to avoid merge conflicts)

- **content** owns:
  - `worker/seed/onboarding-template.ts` (full content);
  - `shared/handover-match.ts`;
  - `shared/handover-letter.ts` (text body in the style of Peter's letter: introduction, schedule of documents grouped by folder, transfer arrangements, funds transfer with a phone-verification warning, signature line in the `email-html.ts` format);
  - `test/onboarding-content.spec.ts`.
- **backend** owns:
  - `worker/agents/onboarding.ts`, the schema additions, the PropertyAgent RPC methods, and the Chief of Staff directories and fan-out;
  - `worker/onboarding-routes.ts` and `worker/portal-routes.ts`, plus mounting them in `worker/api.ts`;
  - the `wrangler.jsonc` ratelimit binding and `worker-configuration.d.ts`;
  - the trust-model changes, demo data and agent tool;
  - `test/onboarding.spec.ts` and `test/portal.spec.ts`.
- **staff-ui** owns:
  - `src/pages/onboarding/**`, the router and sidebar additions, the building header chip;
  - `src/api.ts` (onboarding functions).
- **portal-ui** owns:
  - `src/pages/portal/**` and `src/lib/zipUpload.ts`;
  - `src/lib/dropFiles.ts`;
  - the public-route handling in `src/App.tsx`;
  - the `src/api.ts` portal functions in a separate `portalApi` object, added at the end of the file.
