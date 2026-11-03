# IkonSM — Strata Command Hub

An AI command hub for Ikon's strata portfolio. Every strata plan (SP) is its own
agent with its own inbox, email address, document vault, memory and work queue.
A Chief of Staff agent sits above them and runs the portfolio.

Pilot building: **SP 26707 – 34 Davies Road, Claremont**. The other 15 schemes are
loaded as lighter entries so the portfolio view is real from day one.

---

## 1. What it does (the demo story)

1. An owner emails `sp26707@<ikon-domain>`: *"Water is pouring through my
   bathroom ceiling, is a pipe broken?"*
2. The SP 26707 agent receives it, reads the building's own documents
   (emergency procedures, water main location, preferred plumber, insurance
   certificate, by-laws), and triages it:
   - **Category:** Maintenance → water leak
   - **Urgency:** Emergency (P1)
   - **Responsibility:** likely common property (pipe in ceiling cavity
     between lots), so it's the strata company's to fix. Flag the owner's insurance and excess.
   - **Allocate to:** after-hours plumber + strata manager; notify council
3. It drafts a reply grounded in the building's docs (*isolate water at the
   main in the garage meter box, photos for the insurer, plumber is on the way*)
   with citations to the source documents.
4. A human approves (or edits) the reply and the work order in the hub. Nothing
   leaves the building's agent without approval (configurable per category later).
5. The Chief of Staff sees the P1 across the portfolio, and the morning brief
   says what happened overnight in every building.

## 2. Architecture (all on Cloudflare)

```
                 ┌──────────────────────── Cloudflare Worker (one deploy) ───────────────────────┐
 Email ─────────▶│ email() handler ─▶ routeAgentEmail ─▶ PropertyAgent("sp-26707")               │
 (Email Routing) │                                                                                │
 Browser ───────▶│ Hono /api/*  ──────────────────────▶ PropertyAgent / ChiefOfStaffAgent (DOs)   │
 (React SPA)     │ /agents/*  (websocket state sync)                                              │
                 │ static assets (React command hub)                                              │
                 └───────┬──────────────┬───────────────┬──────────────┬─────────────────────────┘
                         │              │               │              │
                    R2 "vault"      D1 "portfolio"   Claude API     send_email
                  (per-SP files)   (registry, cross-  (triage,      (approved
                                    SP index)          drafting,     replies)
                                                       chat+tools)
```

- **PropertyAgent (Durable Object, one per SP)**: the building's "computer".
  Its own SQLite holds the inbox, threads, tickets/work orders, contacts
  (owners/lots, contractors, council), approvals, memory notes, activity log,
  and a full-text index (FTS5) of the building's documents. It has tools:
  `search_documents`, `read_document`, `create_ticket`, `update_ticket`,
  `draft_reply`, `list_contacts`, `remember`, `request_approval`.
- **ChiefOfStaffAgent (one DO)**: portfolio view, morning brief (scheduled),
  cross-building questions ("which buildings have open water leaks?"),
  escalations, and the approvals queue across all buildings.
- **R2 vault**: original files, laid out like Ikon's SharePoint
  (`/sp-26707/Insurance/…`, `/sp-26707/By-laws/…`). Text is extracted on upload
  and indexed into that building's agent.
- **D1**: portfolio registry (SP number, address, suburb, status, agent email)
  plus a light cross-building ticket index for the Chief of Staff.
- **Claude**: `ANTHROPIC_API_KEY` secret. Structured triage uses a forced tool
  call (reliable JSON); chat uses a tool-use loop.
- **Email**: inbound through Cloudflare Email Routing to the Worker. Each SP gets
  `sp<number>@<domain>`. Outbound replies are sent only after approval.

### Safety rules (designed in, not bolted on)
- Inbound email is **untrusted data**. It's quoted to the model as data and
  can never trigger a send, payment or deletion by itself.
- Every outbound action (email, contractor dispatch) goes through an
  **approval card**: *Do it / Edit / Don't*. (Same idea as Bops' "asks before it acts".)
- Emergency auto-acknowledgement (safety-only template, no commitments) is
  the one exception, and it's off by default.
- The hub sits behind Cloudflare Access (or a passcode for the demo).

## 3. Screens (command hub)

1. **Portfolio**: all 16 schemes as cards (SP, address, open items, P1 flags,
   agent status). Chief of Staff brief at the top.
2. **Building**: per-SP workspace with tabs:
   - **Inbox & triage**: threads with category, urgency, responsibility, assignee
   - **Work orders**: kanban (New → Assigned → In progress → Done)
   - **Vault**: folder tree like SharePoint, upload, preview, "indexed" badge
   - **Agent**: chat with the building's agent (answers cite docs)
   - **Computer**: live activity log of what the agent did and why, plus memory notes
   - **Contacts**: lots/owners, council, contractors
3. **Approvals**: one queue across all buildings.
4. **Simulate inbound**: send a test email or SMS into any building (for demos
   before DNS is live).

## 4. Phases

| Phase | Scope | Status |
|---|---|---|
| 0. Tonight | Repo, Worker, PropertyAgent + ChiefOfStaff, R2 vault + FTS, Claude triage + drafting, approvals, React hub, real email inbound/outbound code, SP 26707 seeded, tests | building |
| 1. Pilot | Real SP 26707 docs uploaded, real email live on Ikon domain, Cloudflare Access, staff using it daily | next |
| 2. Portfolio | All 16 SPs onboarded from the SharePoint "Master File Structure", morning brief, contractor directory | |
| 3. Channels | SMS/voice (Twilio or Cloudflare Realtime), owner portal | |
| 4. Computer | Real sandboxed computer per building (Cloudflare Sandbox containers or Orgo VMs as in Bops) for browser tasks such as portals, invoices and Landgate | |

## 5. Open questions for Daniel

1. Which domain should the building emails live on (must be on your Cloudflare account)?
2. Cloudflare API token + account ID (as environment variables, not in chat) so the agent can deploy itself.
3. `ANTHROPIC_API_KEY` for the Worker (set with `wrangler secret put`).
4. Real SP 26707 docs to replace the clearly-marked SAMPLE seed docs.
5. SP 24594's street number. It was hidden behind the cursor in the screenshot.
