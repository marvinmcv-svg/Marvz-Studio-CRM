# Squad CRM

Squad CRM is the internal CRM for **Marvz Studio** (web design, web apps and AI assistants; Santa Cruz, Bolivia). It is used by Letty (the owner) and five Grokbot AI agents: **Top G, Hunter, Jordan, Quinn and Dana**.

It is built on Next.js 16 and Supabase (Postgres, Auth, Row Level Security and Realtime), and deploys to Vercel. The UI is dark-mode, dense and keyboard-driven, and works on a phone.

```
Found → Screened → Draft ready → Approved → Sent → Replied → Discovery → Proposal
      → Signed → In delivery → Delivered → Care plan          (+ Lost, Do-not-contact)
```

## What's inside

| | |
|---|---|
| **Overview (Top G dashboard)** | KPIs (MRR, pipeline, win rate, average deal, capacity), a "needs attention" queue (escalations, Letty's approval batches, slipping milestones, renewals), stage funnel, agent workload and a live activity feed |
| **Pipeline** | Kanban and table views. Filter by stage, industry, service, market and owner. Drag a card to move it; a reason is required and logged |
| **Lead record** | Contact, qualification and ownership on the left. Activity, stage history, outreach, discovery (with sources) and deals/proposals tabs on the right |
| **Approvals** | Jordan's batches. Letty approves or rejects each draft; nothing can be sent unapproved |
| **Escalations** | Agent → Top G → Letty chain, with severity, proposed action and resolution notes |
| **Activity log** | Append-only record of every action by every agent, filterable by agent and action |
| **Catalogue** | Read-only price list with a market switcher (USD, CAD, MXN, GBP, EUR, AUD). Only Letty can edit it |
| **Deal builder** | Package + add-ons + market + payment plan + rush, giving a live quote and payment milestones. Saving re-quotes in the database |
| **Projects** | Capacity meter (4 per month), milestones, deliverables vs. what the client owes, slip warnings with proposed fixes, line-by-line scope check, payments |
| **Revenue** | MRR, ARR run-rate, win rate, average deal, signed value and cash collected by month, breakdown by market |
| **Care plans** | Renewals, hours used vs. included, overage |
| **Testimonials and referrals, Lessons, Do-not-contact, Team & API** | |

Keyboard: `⌘K` or `/` opens search, `n` creates a new lead, `b` opens the deal builder, `g` + a letter jumps to a page, and `?` lists all shortcuts.

## Security model

* Every squad member, human or AI, is a **Supabase Auth user** linked to a row in `public.agents`. Row Level Security reads the caller's identity from the token.
* **RLS on every table.** Hunter writes leads. Jordan writes drafts and batches. Quinn writes discovery, deals and proposals. Dana writes delivery, care, testimonials and lessons. Top G and Letty can do everything. **Only Letty can write the catalogue.**
* **Guard triggers** apply even to direct table edits:
  * Stage moves are checked per role, and every move is written to `stage_changes` with the agent, time and reason.
  * Jordan cannot approve his own drafts.
  * A draft can only be sent once it is approved in an approved batch.
  * Lessons are rejected if they mention a client or contact name, an email, a phone number, a URL or an @handle.
  * Only admins can resolve escalations.
* `activity_log` and `stage_changes` are **append-only**. Agents have no insert, update or delete rights on them; only the security-definer RPCs write there.
* The anon role has no table access.

The SQL test suite checks all of this; see [Tests](#tests).

---

## 1. Run it locally (no setup)

```bash
npm install
npm run dev        # http://localhost:3000
```

Without Supabase keys the app runs in **demo mode**. It shows realistic sample data exported from the seeded database, with timestamps shifted so it always looks current. In demo mode changes are disabled.

## 2. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the migrations in `supabase/migrations/`, either with the Supabase CLI:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   or by pasting the four files, in order, into **SQL Editor**. The fourth file seeds the team and the full price catalogue.
3. Optional demo data: run `supabase/seed.sql` in the SQL editor. Remove it before going live with `supabase/demo_cleanup.sql`, which keeps the team and catalogue.
4. Check **Database → Publications → supabase_realtime** includes `activity_log`. The migration adds it, which drives live refresh.
5. **Turn off public sign-ups** (Authentication → Sign In / Providers → *Allow new users to sign up* = off). Strangers who sign up still can't see anything (every policy and RPC requires a squad member, and the tests cover this), but there is no reason to allow it.
6. **Set the real per-market package prices.** The seed fills `catalogue_package_prices` by converting USD with each market's factor. Letty should edit those rows to the prices she actually wants to charge.

## 3. Create the squad accounts

```bash
SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
SQUAD_EMAIL_DOMAIN=marvz.studio \
LETTY_EMAIL=<letty's real email> \
SUPABASE_JWT_SECRET=<legacy JWT secret, optional> \
npm run setup-agents
```

The script creates one Auth user per squad member (`hunter@marvz.studio`, …), links each to `public.agents`, and prints the passwords. If you provide `SUPABASE_JWT_SECRET`, it also prints a **1-year API token per agent**. It is safe to re-run. Put the output straight into your password manager or Grokbot's secrets, never into chat.

Letty signs in to the web app with her email and the printed password. She can change the password from the Supabase dashboard.

## 4. Deploy to Vercel

Import the repository in Vercel and set:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
```

The service role key is **never** needed by the web app.

---

## Connecting the Grokbot agents

Each agent connects with **its own identity**, so RLS knows who is calling and every log line names the right agent. Do **not** give agents the service role key: it bypasses RLS and every action would be logged as Top G.

**Option A: long-lived agent token (recommended).** Use this if your project still has the *Legacy JWT secret* (Project Settings → API → JWT Settings). Configure each agent's Supabase connector with:

| Setting | Value |
|---|---|
| URL | `https://<ref>.supabase.co` |
| `apikey` header | the project's **anon** key |
| `Authorization` header | `Bearer <that agent's api_token from setup-agents>` |

Tokens expire after `--days` (default 365). To rotate one, re-run `npm run setup-agents -- --only hunter`.

**Option B: email and password.** Use this for projects on the new asymmetric signing keys. The agent signs in once per session:

```http
POST https://<ref>.supabase.co/auth/v1/token?grant_type=password
apikey: <anon key>
{ "email": "hunter@marvz.studio", "password": "…" }
```

It then uses the returned `access_token` as the Bearer token, and calls `grant_type=refresh_token` before the token expires (about one hour).

**Calling the API.** Each step is one RPC:

```http
POST https://<ref>.supabase.co/rest/v1/rpc/create_lead
apikey: <anon key>
Authorization: Bearer <agent token>
Content-Type: application/json

{ "p_business": "Café Altura", "p_phone": "+591 71234567", "p_industry": "Cafe",
  "p_market": "US", "p_channel": "whatsapp", "p_source": "Google Maps" }
```

**Suggested agent instructions** (paste into each Grokbot agent's system prompt):

> You work in Squad CRM through Supabase RPC functions only. Call exactly one function per step, pass arguments by name (`p_…`), and read the `status` and `message` in every response. Never invent prices: use `quote_deal` and `create_deal`, which price from the catalogue. If a call is refused, do not work around it. Fix the input or call `raise_escalation` with a proposed action.

The full per-agent reference, with every function, argument and example payload, is in **[docs/AGENT_API.md](docs/AGENT_API.md)**. A short version per agent also appears in the app under **Team & API**.

| Agent | Main functions |
|---|---|
| Hunter | `create_lead`, `find_duplicate_leads`, `update_lead` |
| Jordan | `screen_lead`, `create_draft`, `submit_draft_batch`, `log_send`, `log_reply`, `add_do_not_contact` |
| Quinn | `add_discovery_note`, `quote_deal`, `create_deal`, `create_proposal`, `sign_deal` |
| Dana | `create_scope`, `create_project`, `update_milestone`, `update_deliverable`, `record_payment`, `complete_project`, `record_testimonial`, `add_referral`, `start_care_plan`, `log_care_hours`, `add_lesson` |
| Top G | `dashboard_metrics`, `update_escalation`, `record_approval`, `advance_stage`, `get_lead_context` |
| Everyone | `advance_stage`, `raise_escalation`, `get_lead_context`, `capacity`, `check_do_not_contact` |

---

## Tests

```bash
npm run test:db     # throwaway Postgres 16: migrations + seed + permission tests
npm run lint        # TypeScript
npm run build
```

`test:db` loads Supabase-compatible auth stubs and applies every migration. It then runs `seed.sql`, which drives the entire pipeline through the agent RPCs, so it doubles as an end-to-end test. Finally, `supabase/tests/10_permissions.sql` logs in as each agent and checks:

* the RLS and role boundaries;
* the catalogue lock;
* duplicate and do-not-contact detection;
* the approval-before-send rule;
* mandatory discovery sources;
* quote arithmetic (US and MX);
* lesson anonymisation;
* the 4-per-month capacity limit;
* the escalation chain;
* that the activity log is append-only.

To refresh the demo fixtures after changing the seed, run `bash scripts/export-demo.sh`.

## Project layout

```
supabase/migrations/   schema · security (RLS + guards) · agent API (RPCs) · team + catalogue seed
supabase/seed.sql      demo data, created through the RPCs
supabase/tests/        Supabase stubs + permission/business-rule tests
src/app/(crm)/         pages (overview, pipeline, leads, approvals, escalations, …)
src/app/actions.ts     server actions: UI writes go through the same RPCs as the agents
src/lib/               data access (live or demo), quote engine, metrics, types
scripts/               setup-agents.mjs, test-db.sh, export-demo.sh
docs/AGENT_API.md      per-agent RPC reference
```

## Design notes

Before building the UI I researched reference screens on Mobbin and saved them to the private collection **"Squad CRM"**: Attio (pipeline board, record page, activity timeline, people table), Linear (dense status-grouped lists, issue detail, filters), Plain (priority kanban), Cofounder (agent workspace), Plausible and Stripe (KPI and revenue dashboards). Patterns borrowed:

* **Navigation (Attio, Linear):** a quiet left sidebar grouped by job, count badges only where action is needed, and a `⌘K` palette for everything.
* **Record page (Attio):** fields in a narrow left column, a tabbed timeline on the right, and stage history as a first-class tab.
* **Density (Linear):** 13px base text, 32px rows, small status chips with a coloured dot (status colours carry meaning; violet is the single brand accent), and tabular numbers.
* **Dashboards (Plausible, Stripe):** a KPI tile row first, then "needs attention" before charts, single-series bars with hover values and no chart junk.
* **Empty states:** one line saying what will appear and which agent or RPC fills it.
* **Mobile:** sidebar becomes a drawer, a bottom tab bar holds the five core views, and tables scroll horizontally.
