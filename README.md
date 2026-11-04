# Ikon Command Hub (IkonSM)

An AI command hub for Ikon Strata Management (Perth, WA). Each strata plan has its own **building agent**. The agent has an email address, an inbox, a document vault, contacts, work orders, memory and an activity log (its "computer"). It triages every inbound message (P1/P2/P3 across 12 WA strata categories), drafts the reply and the contractor dispatch, and grounds both in the building's own documents. **Nothing is sent until a logged-in staff member approves it.** A **Chief of Staff** agent sits above all 16 buildings. It writes the portfolio brief and answers questions across the portfolio.

Everything runs on Cloudflare:
- **Compute:** one Worker. Each building is a Durable Object (Agents SDK) with its own SQLite and full-text index.
- **Files:** R2.
- **Email:** Email Routing in, Email Service out.
- **AI:** Claude, either direct or through AI Gateway, with Workers AI as a fallback.

The pilot building is **SP 26707, 34 Davies Road, Claremont**. Its records are **SAMPLE** data (fictional people, `example.com` addresses, numbers from ranges reserved for fiction) until real documents are loaded. The other 15 buildings are profiles only.

See [`DEMO.md`](DEMO.md) for the 10-minute demo script, [`PLAN.md`](PLAN.md) for the product plan and [`BUILD_SPEC.md`](BUILD_SPEC.md) for the API and module contract.

## Screens

| Screen | What it shows |
|---|---|
| Portfolio | 16 buildings with live counts, plus the Chief of Staff brief |
| Approvals | Every pending draft across the portfolio; approve, edit or reject |
| Chief of Staff | Portfolio-wide chat ("What needs my attention today?") |
| Building → Inbox | Threads with triage (priority, category, who is responsible and why), approval cards and the conversation |
| Building → Work orders | Kanban of work orders with contractor and make-safe deadline |
| Building → Vault | Documents in the Master File Structure folders (01 Plan & By-laws … 08 Sales & Disclosure) with full-text search |
| Building → Agent | Chat with the building agent, grounded in the vault, with citations |
| Building → Computer | The agent's live activity feed, memory notes and current AI engine |
| Building → Contacts | Owners, council, tenants/PMs, contractors, insurer |

## Run locally

Requirements: Node 22+.

```bash
npm ci
cp .dev.vars.example .dev.vars   # then edit: HUB_PASSCODE, SESSION_SECRET (any values work on localhost)
npm run dev                       # http://localhost:5173
```

Sign in with the `HUB_PASSCODE` from `.dev.vars` and any name. The pilot building seeds itself the first time it is opened.

- **No AI key?** Everything still works. Triage uses the rules engine and replies use templates, and both are labelled as such in the UI. To use Claude locally, set `ANTHROPIC_API_KEY` in `.dev.vars`.
- **Simulate inbound.** Use the **Simulate inbound** button on a building, which has presets such as burst pipe, levy question, s110 request, noise, renovation and a prompt-injection attempt.
- **Real email locally.** Post a raw `.eml` file to Wrangler's local email endpoint:
  ```bash
  curl -X POST "http://localhost:5173/cdn-cgi/local/email?from=jane@example.com&to=sp26707@ikon.example.com" \
       --data-binary @message.eml
  ```
  Outbound sends are written to `.wrangler/tmp/email` instead of going out.

## Tests

```bash
npm run typecheck   # app, worker and test tsconfigs
npm test            # 186 tests in workerd (vitest + @cloudflare/vitest-plugin)
```

The tests cover:
- sign-in and CSRF;
- the full burst-pipe pipeline;
- approvals, including double-approve and edits;
- prompt injection;
- email threading and duplicate deliveries;
- the vault and search;
- the email handler;
- work orders, contacts and memory;
- the Chief of Staff;
- the read-only websocket;
- 25 triage safety cases: fire, gas, alarms, threats, lift entrapment, falls, asbestos, injuries and bank-detail scams.

## Deploy

Prerequisites:
- Wrangler authenticated, with `npx wrangler login` or a `CLOUDFLARE_API_TOKEN` that has Workers, R2 and Workers AI edit permissions.
- `CLOUDFLARE_ACCOUNT_ID` set.

```bash
npx wrangler r2 bucket create ikonsm-vault          # once
npm run deploy                                      # build + wrangler deploy
npx wrangler secret put HUB_PASSCODE                # staff passcode, 12+ characters
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
```

On any host other than localhost, sign-in returns 503 until `SESSION_SECRET` is set and `HUB_PASSCODE` has at least 12 characters. Sign-in is limited to 10 attempts per minute per IP.

To sign everyone out, rotate `SESSION_SECRET`. For anything beyond a demo, put the hub behind **Cloudflare Access** (Zero Trust → Access → add an application for the Worker's hostname) so staff sign in with their Microsoft 365 accounts.

### Choosing the AI engine

`LLM_PROVIDER` is a var in `wrangler.jsonc`. Override it per deploy with `npx wrangler deploy --var LLM_PROVIDER:<mode>`.

| Mode | Uses | Needs |
|---|---|---|
| `auto` (default) | Claude direct if `ANTHROPIC_API_KEY` is set; otherwise Claude through AI Gateway if the three gateway secrets are set; otherwise `off` | — |
| `anthropic` | Claude via the Anthropic API | secret `ANTHROPIC_API_KEY` |
| `gateway` | Claude via **Cloudflare AI Gateway unified billing**, paid with Cloudflare credits, no Anthropic account | secrets `CF_AIG_TOKEN`, `CF_ACCOUNT_ID`, `AI_GATEWAY_ID` |
| `workers-ai` | Workers AI (`WORKERS_AI_MODEL`, default Llama 4 Scout) in light mode. Emergencies and contractor dispatches still use the checked templates | the `AI` binding (already configured) |
| `off` | Rules engine and templates only | — |

Models used with Claude: `MODEL_AGENT` (claude-sonnet-5-5) for drafting and chat, and `MODEL_TRIAGE` (claude-haiku-5-5) for triage.

**Which mode for a demo?** Use `off` until Claude is switched on: `npx wrangler deploy --var LLM_PROVIDER:off`. Don't rely on `auto`, which picks Claude or the gateway if any key or gateway secret is set on the Worker.

In a live test of `workers-ai`, Llama 4 Scout:
- left the water main out of emergency replies, and sometimes said it was "not in our records";
- dropped 000 from some emergency replies;
- filed a gas leak as spam;
- took up to a minute per message.

The rules engine and templates got all of these right, in under a second. The fixes since then (rules hazard categories always win, templates for emergencies and dispatches) make `workers-ai` safer, but its replies are still weaker than the templates.

**To switch on Claude through AI Gateway (no Anthropic key):**
1. Cloudflare dashboard → **AI → AI Gateway → Create gateway** (e.g. `ikonsm`).
2. Turn on **unified billing** and add credits.
3. **My Profile → API Tokens → Create token** with only the **AI Gateway: Run** permission for this account.
4. Set the secrets:
   ```bash
   npx wrangler secret put CF_AIG_TOKEN     # the token from step 3
   npx wrangler secret put CF_ACCOUNT_ID
   npx wrangler secret put AI_GATEWAY_ID    # e.g. ikonsm
   npm run deploy                           # LLM_PROVIDER=auto picks the gateway
   ```

The Computer tab and every approval card show which engine and model produced each triage and draft. Set a spend limit on the gateway: inbound mail can trigger AI work, and the Worker already caps it at 10 emails per sender and 200 per building per Perth day.

### Real email

Each building receives mail at `sp<plan number>@<EMAIL_DOMAIN>`, for example `sp26707@ikon.example.com`. `hub@` and `cos@` go to the Chief of Staff.

**Inbound (Email Routing).** This changes MX records, so use a **subdomain** that has no mailboxes today, e.g. `hub.<your-domain>`.
1. Dashboard → the zone → **Email → Email Routing → Enable** for the subdomain.
2. **Routing rules → Catch-all → Send to a Worker → `ikonsm`**.
3. Set `EMAIL_DOMAIN` in `wrangler.jsonc` to that subdomain and redeploy.

**Outbound (Email Service).**
1. Dashboard → **Compute & AI → Email Service → Onboard domain** (the same subdomain).
2. Add the SPF and DKIM records it shows.

Approved replies are sent from the building's own address with proper threading headers. Recipients are restricted to the thread's sender or the building's contacts. Until sending is set up, approving a draft records the send as failed and nothing leaves the system.

## Safety model

- **Inbound is untrusted.**
  - Email bodies and attachments are data, never instructions.
  - Prompt-injection attempts are flagged and get no auto-draft.
  - Emailed attachments are filed as "Emailed by X" and are kept out of the agents' trusted context until promoted.
  - Senders whose From: fails authentication are marked unverified and never merged into a contact's thread.
- **A human approves every outbound message.**
  - The agent drafts the reply and the contractor dispatch.
  - A staff member approves, edits or rejects each one.
  - The websocket is read-only; every change goes through the authenticated API (session cookie, JSON-only, Origin checked).
- **Safety rails run whatever the AI says.** A deterministic rules pass raises fire, gas, flooding, lift entrapment, threats, falls, asbestos and injuries to the right priority, even if the model under-calls them.
- **WA terminology** (Strata Titles Act 1985 (WA) as amended 2020):
  - Use: strata company, council, contributions, administrative and reserve funds, s110 certificates (14 days, $140).
  - Never use: "owners corporation", "strata committee" or "sinking fund".
  - Notes: [`docs/strata-wa-notes.md`](docs/strata-wa-notes.md).

## Loading real building data

1. **Vault → upload.** PDF, DOCX, HTML, email (.eml) and plain-text files (TXT, MD, CSV and similar) are text-indexed; other types are stored with metadata only.
   - Choose the Master File Structure folder for each file.
   - Mark company-wide policies as **Ikon company policies**.
2. **Contacts:** replace the SAMPLE owners, council and contractors.
3. **Building profile:** the seed lives in `worker/seed/sp26707.ts` and `worker/seed/portfolio.ts`, and is reseeded only for new buildings. Items still to confirm:
   - the SP 24594 street number;
   - the Morley Growers Market address;
   - the real after-hours line.

## Layout

```
worker/
  index.ts            fetch + email entry points, Durable Object exports
  api.ts, auth.ts     Hono API (sessions, CSRF, routes)
  agents/             PropertyAgent (one per building), ChiefOfStaffAgent
  ai/                 provider selection, triage (rules + model), drafting, agent loop, Workers AI
  email/              address routing, inbound parsing, outbound send
  docs/               text extraction, chunking, R2 vault
  seed/               portfolio, SP 26707 SAMPLE records, Ikon policies
shared/               types shared by worker and UI
src/                  React SPA (Vite + Tailwind)
public/               favicon and app icon (the logos are bundled from src/assets/brand/)
test/                 vitest specs running in workerd
```

## Branding

The UI follows the IKON SM website (ikonsm.com.au): monochrome charcoal, white and light grey, with silver and taupe accents. Corners are sharp, and headings are wide and uppercase.

- **Tokens:** colours, fonts and radii live in the `@theme` block of `src/index.css`. Primary actions, focus rings and selected states all use the charcoal `accent`. The `charcoal-*` tokens are for dark surfaces such as the sidebar.
- **Colour:** the semantic colours are kept for meaning only: red for P1 and errors, amber for P2 and for SAMPLE-data and other "check this" warnings, green for done. Everyday states, such as "Awaiting approval", stay monochrome.
- **Type:** Poppins for body and UI text, including emails and work-order numbers (with tabular figures). Headings, and the labels of action buttons (size md and up), use the `heading-display` utility in `--font-display`, which is Archivo Expanded at weight 800, a free stand-in for the website's licensed Agrandir. If Ikon provides an Adobe Fonts kit, change the family in `--font-display` and the font link in `index.html`. JetBrains Mono is only for the Computer tab's terminal. Dialog titles that show data (a file or person's name) pass `plainTitle` to `Modal`, so they keep their own case.
- **Logo:** `src/assets/brand/ikonsm-logo-reversed.webp` (white, for charcoal) and `ikonsm-logo-dark.webp` (charcoal, for light surfaces), 480 px wide, rendered by `Logo` in `src/components/Wordmark.tsx`. Vite bundles them with hashed names. The 1500 px masters are in `docs/brand/`. Never hotlink the website's Squarespace files.
