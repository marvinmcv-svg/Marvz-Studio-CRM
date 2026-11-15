# Squad CRM — API Reference (for Grok agents)

Squad CRM is Marvz Studio's CRM. Grok agents read and change it **only** through this HTTP API.
This file is self-contained: it has everything an agent needs to connect, call every function,
and handle errors. Function signatures were taken from the live database.

---

## 1. Connection

| Setting | Value |
|---|---|
| Base URL | `https://lqebhdqfeyulkpxoiljw.supabase.co` |
| Public API key (header `apikey`, on every request) | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxxZWJoZHFmZXl1bGtweG9pbGp3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2ODg5NzYsImV4cCI6MjExMDI2NDk3Nn0.6UF8aiukd7QuWadS1gNV1sKVJ0nswGPrN4VATqbdHpk` |
| Web app (for humans) | `https://squad-crm-eosin.vercel.app` |

The public key is safe to share: by itself it can read or change nothing. Access comes from each
agent's **own** email and password (kept in the agent's secrets, never in prompts or logs).

### 1.1 Sign in (once per session)

```http
POST https://lqebhdqfeyulkpxoiljw.supabase.co/auth/v1/token?grant_type=password
apikey: <public key>
Content-Type: application/json

{ "email": "<agent email>", "password": "<agent password>" }
```

Response (shortened):
```json
{ "access_token": "eyJ…", "token_type": "bearer", "expires_in": 3600, "refresh_token": "abc123…" }
```

### 1.2 Refresh (before 60 minutes are up)

```http
POST https://lqebhdqfeyulkpxoiljw.supabase.co/auth/v1/token?grant_type=refresh_token
apikey: <public key>
Content-Type: application/json

{ "refresh_token": "<refresh_token>" }
```
Each refresh returns a new `access_token` **and a new `refresh_token`**; always keep the newest one.
If you get HTTP 401 with "JWT expired", refresh and retry once. If refresh fails, sign in again.

### 1.3 Call a function (all changes)

```http
POST https://lqebhdqfeyulkpxoiljw.supabase.co/rest/v1/rpc/<function_name>
apikey: <public key>
Authorization: Bearer <access_token>
Content-Type: application/json

{ "p_argument": "value", "p_other": 123 }
```
* Pass arguments **by name**. Every argument starts with `p_`.
* Leave optional arguments out instead of sending `null`.
* Arrays are JSON arrays (`["es","en"]`); `jsonb` arguments are JSON objects/arrays.
* Dates: `"2026-12-01"`. Timestamps: ISO 8601, e.g. `"2026-11-15T14:30:00Z"`.
* IDs are UUIDs (`"3f0c…-…"`). Human codes like `SQ-12` (lead), `D-4` (deal), `P-2` (project),
  `E-7` (escalation) are for display; functions take the UUID.

### 1.4 Read data (no changes)

```http
GET https://lqebhdqfeyulkpxoiljw.supabase.co/rest/v1/<table>?select=<columns>&<filters>
apikey: <public key>
Authorization: Bearer <access_token>
```
Filter syntax: `column=eq.value`, `neq`, `gt`, `gte`, `lt`, `lte`, `like.*text*`, `ilike.*text*`,
`in.(a,b,c)`, `is.null`. Sorting: `order=created_at.desc`. Paging: `limit=100&offset=100`
(max 1000 rows per request). Examples:
```
GET /rest/v1/leads?select=id,ref,stage,owner_agent,next_action&stage=eq.found&order=created_at.desc&limit=50
GET /rest/v1/companies?select=id,name,website,city&name=ilike.*cafe*
GET /rest/v1/outreach_drafts?select=id,status,lead_id&id=eq.<draft_id>
GET /rest/v1/leads?select=id,ref,stage,companies(name,city),contacts(full_name,phone)&limit=20
```
You only see rows your role may read (e.g. only Dana and admins see care plans; only Quinn, Dana
and admins see payments).

### 1.5 Check who you are

```http
POST /rest/v1/rpc/current_agent        body: {}
→ "hunter"
```
A `null` result means the login isn't linked to a squad member; stop and tell a human.

---

## 2. Responses and errors

Successful calls return HTTP 200 and JSON, almost always an object with a `status` field.

Errors return HTTP 4xx with:
```json
{ "code": "42501", "message": "Agent hunter is not allowed to perform this action (allowed: jordan, or an admin)", "details": null, "hint": null }
```
**Always read `message`: it says exactly what to fix.**

| HTTP / code | Meaning | What to do |
|---|---|---|
| 401 `JWT expired` | Access token older than 60 min | Refresh (1.2), retry once |
| 401/403 `42501` "not allowed" / "permission denied" | Your role can't do this | Don't retry. Ask the right agent, or `raise_escalation` |
| 401 `42501` "Not a registered Squad CRM agent" | Login not linked or access revoked | Stop; tell a human |
| 400 `P0001` (custom message) | Business rule refused it (wrong stage, not approved, capacity full, unknown catalogue code, …) | Fix the input per the message, or `raise_escalation` |
| 400 `23514` | Data rule (e.g. lesson not anonymised, capacity) | Fix the input |
| 404 `PGRST202` | Function name or argument names wrong | Check spelling against this file |
| 409 / `23505` | Duplicate value | Look up the existing record |
| 429 / 5xx | Rate limit / server hiccup | Wait 10 seconds, retry once, then escalate |

Never work around a refusal (e.g. by trying another function to force the same result).

---

## 3. Who can do what

| Login | Role | Can call |
|---|---|---|
| `letty` | Owner (human) | everything; edits catalogue and team |
| `marvin` | Admin (human) | everything; edits catalogue and team |
| `top_g` | Coordinator (AI admin) | every function; cannot edit catalogue/team |
| `hunter` | Lead finder | `create_lead`, `create_leads_bulk`, `update_lead`, `add_do_not_contact` + shared |
| `jordan` | Outreach | `screen_lead`, `create_draft`, `submit_draft_batch`, `log_send`, `log_reply`, `update_lead`, `add_do_not_contact` + shared |
| `quinn` | Closer | `add_discovery_note`, `create_deal`, `create_proposal`, `sign_deal`, `log_reply`, `update_lead`, `add_do_not_contact` + shared |
| `dana` | Delivery | `create_scope`, `create_project`, `update_milestone`, `update_deliverable`, `record_payment`, `complete_project`, `record_testimonial`, `add_referral`, `start_care_plan`, `log_care_hours`, `add_lesson`, `update_lead`, `add_do_not_contact` + shared |
| everyone | shared | `advance_stage` (within role), `raise_escalation`, `get_lead_context`, `capacity`, `check_do_not_contact`, `find_duplicate_leads`, `quote_deal`, `dashboard_metrics`, `current_agent` |
| admins only | | `record_approval`, `update_escalation` |

Admins = Letty, Marvin, Top G. Every action is logged with the caller's name, so **each agent must use
its own login**.

---

## 4. Pipeline

```
found → screened → draft_ready → approved → sent → replied → discovery → proposal → signed
      → in_delivery → delivered → care_plan                         (+ lost, do_not_contact)
```

| Stage | Who moves a lead here | How | Allowed only from |
|---|---|---|---|
| `found` | Hunter | `create_lead` | (new leads) |
| `screened` | Jordan | `screen_lead` (pass) | `found` |
| `draft_ready` | Jordan | `create_draft` | `found`, `screened` |
| `approved` | Letty / Marvin (Top G records it) | `record_approval` | `found`, `screened`, `draft_ready` |
| `sent` | Jordan | `log_send` (approved draft only) | `approved` |
| `replied` | Jordan / Quinn | `log_reply` | `sent` |
| `discovery` | Quinn | `add_discovery_note` (auto) or `advance_stage` | `sent`, `replied` |
| `proposal` | Quinn | `create_proposal` | `replied`, `discovery` |
| `signed` | Quinn | `sign_deal` (needs a signed deal) | `discovery`, `proposal` |
| `in_delivery` | Dana | `create_project` (needs a project) | `signed` |
| `delivered` | Dana | `complete_project` | `in_delivery` |
| `care_plan` | Dana | `start_care_plan` | `in_delivery`, `delivered` |
| `lost` | anyone | `advance_stage`, `screen_lead` (fail) | any stage **before** `signed` |
| `do_not_contact` | anyone | `add_do_not_contact`, `advance_stage` | any stage |

Leads never move backwards, and `lost` / `do_not_contact` leads can't be revived, except by an admin.
Workflow functions only move a lead **forward** (a late reply never drags a client back).
Every manual move needs a reason and is recorded in `stage_changes`.

---

## 5. Allowed values

| Type | Values |
|---|---|
| market (`p_market`) | `US` (USD, default — also used for Bolivia/LatAm clients billed in dollars), `CA` (CAD), `MX` (MXN), `UK` (GBP), `EU` (EUR), `AU` (AUD) |
| channel | `whatsapp`, `email`, `instagram` |
| budget band | `<2k`, `2-5k`, `5-10k`, `10-20k`, `20k+`, `unknown` |
| discovery source (`p_source`) | `call`, `meeting`, `whatsapp`, `email`, `instagram`, `form`, `website`, `other` |
| payment plan | `50_50`, `40_30_30` |
| escalation severity | `low`, `medium`, `high`, `urgent` |
| escalation action | `review`, `escalate_to_letty`, `resolve`, `dismiss` |
| do-not-contact kind | `business`, `email`, `phone`, `domain`, `instagram` |
| milestone status | `pending`, `in_progress`, `done`, `slipped` |
| deliverable status | `pending`, `in_progress`, `done`, `blocked` |
| payment status | `scheduled`, `invoiced`, `paid`, `overdue` |
| testimonial status | `to_request`, `requested`, `received`, `published`, `declined` |
| referral status | `requested`, `received`, `contacted`, `converted`, `dead` |
| lesson category | `targeting`, `outreach`, `discovery`, `pricing`, `delivery`, `general` |

### Catalogue codes (prices in USD; other markets are converted)

**Packages** (`p_package`): `base` Base site $1,900 (2–3 wks) · `presence` Presence $2,900 (2–3 wks, 1 mo Basic Care) ·
`full_house` Full House $5,900 (4–5 wks, 3 mo Pro Care) · `flagship` Flagship $11,900 (7–9 wks, 6 mo Pro Care + 3 mo AI usage)

**Add-ons** (`p_addons` / `p_service_interest`): `online_store` 1,900 · `booking_deposits` 1,200 · `online_payments` 790 ·
`whatsapp_enquiries` 490 · `gift_cards` 790 · `events` 590 · `local_seo` 690 · `review_booster` 390 ·
`extra_language` 390 each (qty) · `monthly_seo` 490/mo · `analytics` 290 · `extra_page` 190 each (qty) ·
`copywriting` 790 · `blog` 490 · `scroll_storytelling` 1,900 · `brand_identity` 1,900 · `ai_assistant` 1,290 + 69/mo ·
`ai_whatsapp_bot` 1,900 + 149/mo · `installable_app` 690 · `edit_panel` 790 · `domain_email` 190

**Care plans** (`p_care_plan` / `p_plan_code`): `basic` $129/mo (1 h) · `pro` $249/mo (3 h) · `growth` $449/mo (6 h)

Rush delivery: +25% of the one-off total. Capacity: max **4 new projects per month**. Hourly rate without a plan: $95.
The live catalogue is readable at `GET /rest/v1/catalogue_packages`, `/catalogue_addons`, `/catalogue_care_plans`,
`/catalogue_package_prices`, `/markets`. **Never quote a price yourself; use `quote_deal`.**

---

## 6. Functions

Signature notation: `name(required, optional?)`. Types: `text`, `uuid`, `int`, `numeric`, `boolean`,
`date`, `text[]` (array), `jsonb` (JSON). Defaults shown after `=`.

### 6.1 Shared (every agent)

#### `current_agent()`
Returns your agent code (`"top_g"`, `"hunter"`, …). Use it to test the connection.

#### `dashboard_metrics()`
One-call overview:
```json
{ "mrr_usd": 0, "committed_mrr_usd": 0, "pipeline_value_usd": 0, "win_rate": null, "avg_deal_usd": null,
  "stage_counts": { "found": 12 }, "open_escalations": 0, "escalations_for_letty": 0,
  "batches_awaiting_letty": 0, "drafts_awaiting_letty": 0, "slipping_milestones": 0,
  "capacity": { "month": "2026-11", "limit": 4, "used": 0, "remaining": 4 }, "renewals_next_30d": 0 }
```
`mrr_usd` / `committed_mrr_usd` are `null` unless you are an admin or Dana.

#### `get_lead_context(p_lead_id uuid)`
Everything about one lead: `lead` (with `code` "SQ-…"), `company`, `contact`, `stage_history`, `drafts`,
`discovery_notes`, `deals`, `proposals`, `open_escalations`.

#### `advance_stage(p_lead_id uuid, p_to_stage text, p_reason text)`
Manual stage move; `p_reason` required. Refused if your role can't move into that stage or the lead isn't
at an allowed previous stage (table in §4). Moving to `lost` also marks the lead's open deals lost.
```json
{ "p_lead_id": "…", "p_to_stage": "discovery", "p_reason": "Booked a discovery call for Tuesday" }
→ { "status": "moved", "lead_id": "…", "from": "replied", "to": "discovery" }
```

#### `raise_escalation(p_title text, p_detail text?, p_severity text = 'medium', p_lead_id uuid?, p_project_id uuid?, p_proposed_action text?)`
Raise a problem for Top G (Top G's own escalations go straight to Letty). Always propose an action.
```json
{ "p_title": "Prospect asks for 15% discount", "p_severity": "medium", "p_lead_id": "…",
  "p_proposed_action": "Offer the 40/30/30 plan instead of a discount" }
→ { "status": "open", "escalation_id": "…", "ref": "E-7", "assigned_to": "top_g" }
```

#### `capacity(p_month date = today)`
`{ "month": "2026-12", "limit": 4, "used": 3, "remaining": 1 }`

#### `check_do_not_contact(p_business text?, p_email text?, p_phone text?, p_website text?, p_instagram text?)`
Returns an array of matching do-not-contact entries (`[]` = clear). Matching ignores case, accents,
punctuation and phone formatting.

#### `find_duplicate_leads(p_business text?, p_email text?, p_phone text?, p_website text?, p_instagram text?)`
Returns an array of possible duplicates: `[{ "lead_id", "code", "business", "stage", "matched_on": ["phone"] }]`.

#### `quote_deal(p_package text, p_addons jsonb = [], p_market text = 'US', p_payment_plan text = '50_50', p_rush boolean = false, p_care_plan text?)`
Read-only price calculation from the catalogue. Unknown codes are refused.
`p_addons`: `[{"code":"booking_deposits"},{"code":"extra_page","qty":2}]` (`qty` only for `extra_page`, `extra_language`).
```json
{ "p_package": "full_house", "p_addons": [{"code":"booking_deposits"},{"code":"extra_page","qty":2}],
  "p_market": "US", "p_payment_plan": "40_30_30", "p_rush": true }
→ { "market": "US", "currency": "USD", "lines": [ … ], "one_off_subtotal": 7480, "rush_fee": 1870,
    "one_off_total": 9350, "monthly_total": 0, "one_off_total_usd": 9350, "monthly_total_usd": 0,
    "payment_schedule": [ {"label":"Kickoff deposit","percent":40,"amount":3740},
                          {"label":"Design approval","percent":30,"amount":2805},
                          {"label":"Launch","percent":30,"amount":2805} ],
    "included": [{"item":"3 month(s) Pro Care"}], "timeline_weeks": [4,5],
    "notes": "Prices exclude tax and payment-processor fees." }
```

### 6.2 Hunter — leads

#### `create_lead(p_business text, p_contact_name text?, p_email text?, p_phone text?, p_website text?, p_instagram text?, p_industry text?, p_city text?, p_country text?, p_market text = 'US', p_service_interest text[] = [], p_budget_band text = 'unknown', p_timeline text?, p_languages text[] = ['es'], p_source text?, p_channel text?, p_portfolio_case text?, p_notes text?, p_force boolean = false)`
Creates company + contact + lead at stage `found` (owner: Jordan). Checks the do-not-contact list and
duplicates first.
```json
{ "p_business": "Café Altura", "p_contact_name": "Mariela Rojas", "p_phone": "+591 71234567",
  "p_website": "cafealtura.bo", "p_instagram": "@cafealtura", "p_industry": "Cafe",
  "p_city": "Santa Cruz", "p_country": "BO", "p_market": "US", "p_service_interest": ["presence"],
  "p_budget_band": "2-5k", "p_languages": ["es"], "p_source": "Google Maps", "p_channel": "whatsapp" }
```
Results:
```json
{ "status": "created", "created": true, "lead_id": "…", "code": "SQ-42", "company_id": "…", "contact_id": "…", "possible_duplicates": [] }
{ "status": "duplicate", "created": false, "matches": [{ "code": "SQ-1", "business": "Café Altura", "matched_on": ["phone"] }], "message": "…" }
{ "status": "do_not_contact", "created": false, "matches": [{ "kind": "business", "value": "…", "reason": "…" }], "message": "…" }
```
`duplicate` → don't create; only resend with `"p_force": true` if you're sure it's a different business.
`do_not_contact` → skip permanently.

#### `create_leads_bulk(p_leads jsonb, p_force boolean = false)` — bulk upload
Uploads **up to 100 leads in one call**. Each row goes through exactly the same checks as `create_lead`
(do-not-contact, duplicates — including against earlier rows in the same batch — logging). A bad row
never stops the batch; it is reported with its error and the rest continue. Takes ~0.3 s per 100 leads.

Each row is an object with the `create_lead` fields **without the `p_` prefix**. Only `business` is required.
`service_interest` and `languages` may be arrays or comma-separated strings; `channel` is case-insensitive;
`"force": true` on a row overrides the duplicate check for that row only.
```json
{ "p_leads": [
  { "business": "Café Altura", "contact_name": "Mariela Rojas", "phone": "+591 71234567",
    "website": "cafealtura.bo", "instagram": "@cafealtura", "industry": "Cafe", "city": "Santa Cruz",
    "country": "BO", "market": "US", "service_interest": ["presence"], "budget_band": "2-5k",
    "languages": "es", "source": "Google Maps", "channel": "whatsapp", "notes": "Busy on weekends" },
  { "business": "Brava Fitness Studio", "email": "jess@bravafit.com", "city": "Austin", "country": "US" }
] }
→ { "status": "done", "total": 2, "created": 1, "duplicates": 1, "do_not_contact": 0, "errors": 0,
    "results": [
      { "row": 1, "business": "Café Altura", "status": "created", "code": "SQ-64", "lead_id": "…", "matches": null },
      { "row": 2, "business": "Brava Fitness Studio", "status": "duplicate", "code": null, "lead_id": null,
        "matches": [{ "code": "SQ-12", "business": "Brava Fitness", "matched_on": ["similar name"] }] } ] }
```
Row `status` is `created`, `duplicate`, `do_not_contact` or `error` (with an `error` message, e.g. a
missing business name or an invalid channel). More than 100 rows → the call is refused; split the list.

#### `update_lead(p_lead_id uuid, p_fields jsonb, p_reason text?)`
Update lead fields (not the stage). Allowed keys in `p_fields`: `industry`, `service_interest` (array),
`market_code`, `budget_band`, `timeline`, `languages` (array), `source`, `channel`, `portfolio_case`,
`next_action`, `next_action_at` (timestamp), `owner_agent`.
```json
{ "p_lead_id": "…", "p_fields": { "budget_band": "5-10k", "next_action": "Call Tuesday" }, "p_reason": "Owner confirmed budget" }
→ { "status": "updated", "lead_id": "…" }
```

### 6.3 Jordan — outreach

#### `screen_lead(p_lead_id uuid, p_passes boolean, p_fit_score int?, p_notes text?, p_portfolio_case text?, p_channel text?)`
Lead must be `found`/`screened`. Pass → `screened`; fail → `lost` (notes become the lost reason).
`p_fit_score` is 0–100. → `{ "status": "screened" | "lost", "lead_id": "…" }`

#### `create_draft(p_lead_id uuid, p_body text, p_channel text?, p_subject text?, p_language text = 'es', p_personalisation text?)`
Writes a personalised message (status `ready`); moves `found`/`screened` leads to `draft_ready`.
Refused for lost/do-not-contact leads and contacts on the do-not-contact list. Channel defaults to the lead's.
→ `{ "status": "ready", "draft_id": "…" }`

#### `submit_draft_batch(p_draft_ids uuid[], p_note text?)`
Sends drafts (status `draft`/`ready`) to Letty for approval. Drafts are locked from now on.
→ `{ "status": "pending", "batch_id": "…", "batch_ref": 3, "drafts": 5 }`

#### `log_send(p_draft_id uuid, p_external_ref text?, p_sent_at timestamp = now)`
Records that an **approved** draft was sent (`p_external_ref` = WhatsApp/email message id). Refused if the
draft isn't approved, the lead is lost/do-not-contact, or the contact is on the do-not-contact list.
**Right before sending, re-read the draft and send only if `status` is still `approved`.**
→ `{ "status": "sent", "draft_id": "…", "lead_id": "…" }`

#### `log_reply(p_lead_id uuid, p_summary text, p_channel text?, p_hand_to_quinn boolean = true)`
Records a prospect's reply. A `sent` lead moves to `replied` and is handed to Quinn; for other stages
the reply is just logged. Refused for do-not-contact leads.
→ `{ "status": "replied", "lead_id": "…", "stage": "replied", "owner": "quinn", "message": null }`

#### `add_do_not_contact(p_kind text, p_value text, p_reason text, p_lead_id uuid?)`
Adds a do-not-contact entry, moves **every matching lead** (plus `p_lead_id`) to `do_not_contact`, and
cancels their unsent drafts.
→ `{ "status": "added", "id": "…", "leads_blocked": 1, "drafts_cancelled": 2 }`

### 6.4 Letty / Marvin / Top G — approvals and escalations (admins only)

#### `record_approval(p_batch_id uuid, p_approved_ids uuid[]?, p_rejected_ids uuid[] = [], p_note text?, p_feedback jsonb = {})`
Records the human decision on a pending batch. Leave out `p_approved_ids` to approve everything not
rejected. `p_feedback`: `{ "<draft_id>": "Shorter, mention the bakery photos" }`. Top G may only record a
decision Letty/Marvin actually made.
→ `{ "status": "decided", "batch_ref": 3, "approved": 4, "rejected": 1, "decided_by": "top_g" }`

#### `update_escalation(p_escalation_id uuid, p_action text, p_notes text?)`
`review` (take it) · `escalate_to_letty` (needs a human) · `resolve` (`p_notes` required) · `dismiss`.
→ `{ "status": "resolve", "escalation_id": "…" }`

### 6.5 Quinn — discovery, deals, proposals

#### `add_discovery_note(p_lead_id uuid, p_answer text, p_source text, p_question text?, p_topic text = 'general', p_source_ref text?)`
`p_source` is **required** (where the answer came from); put the message link or call date in
`p_source_ref`. Topics: `goals`, `audience`, `content`, `budget`, `timeline`, `tech`, `general`, …
The first note moves a `sent`/`replied` lead to `discovery`. → `{ "status": "saved", "note_id": "…" }`

#### `create_deal(p_lead_id uuid, p_package text, p_addons jsonb = [], p_market text?, p_payment_plan text = '50_50', p_rush boolean = false, p_care_plan text?, p_title text?)`
Same inputs as `quote_deal`; saves the deal (status `quoted`), line items and payment milestones.
`p_market` defaults to the lead's market.
→ `{ "status": "quoted", "deal_id": "…", "deal_ref": "D-4", "quote": { … } }`

#### `create_proposal(p_deal_id uuid, p_scope_summary text, p_deliverables jsonb = [], p_execution_plan text?, p_mark_sent boolean = false)`
`p_deliverables`: `["Strategy & sitemap","Design system + 5 pages","Booking flow","Launch + training"]`.
Versions are numbered automatically. Moves the lead to `proposal`, the deal to `proposed`.
→ `{ "status": "draft" | "sent", "proposal_id": "…", "version": 1 }`

#### `sign_deal(p_deal_id uuid, p_reason text = 'Client signed the proposal')`
Signs a `quoted`/`proposed` deal (once only). Other open quotes for the lead become lost
("Superseded by D-…"). Moves the lead to `signed` and hands it to Dana.
→ `{ "status": "signed", "deal_id": "…", "capacity": { … }, "superseded_deal_ids": [], "warning": null }`

### 6.6 Dana — delivery, quality, growth

#### `create_scope(p_deal_id uuid, p_extra_lines jsonb = [], p_send boolean = false)`
Scope of work from the signed deal, priced in USD from the catalogue (+ rush).
`p_extra_lines`: `[{"line":"Menu photo shoot","price_usd":0,"verified":false}]`.
→ `{ "status": "draft" | "sent_for_signature", "scope_id": "…", "total_usd": 5900, "lines": [ … ] }`

#### `create_project(p_deal_id uuid, p_plan jsonb, p_start_date date = today, p_slot_month date?, p_name text?)`
Deal must be signed; refused when the month already has 4 projects (pick another `p_slot_month`).
Moves the lead to `in_delivery`.
```json
"p_plan": [
  { "title": "Kickoff & content", "due_date": "2026-12-01",
    "deliverables": [{ "title": "Sitemap + moodboard", "scope_line": "Full House" }],
    "client_owes":  [{ "title": "Logo, photos, price list", "due_date": "2026-11-26" }] },
  { "title": "Design", "due_date": "2026-12-10", "deliverables": [{ "title": "Homepage + 4 pages" }] }
]
→ { "status": "active", "project_id": "…", "ref": "P-2", "capacity": { … } }
```

#### `update_milestone(p_milestone_id uuid, p_status text?, p_due_date date?, p_slip_reason text?, p_proposed_fix text?)`
`slipped` needs both `p_slip_reason` and `p_proposed_fix` and marks the project at risk.
→ `{ "status": "done", "milestone_id": "…" }`

#### `update_deliverable(p_deliverable_id uuid, p_status text?, p_verified boolean?, p_note text?)`
`p_verified: true` = checked line-by-line against the scope. → `{ "status": "updated", "deliverable_id": "…" }`

#### `record_payment(p_payment_id uuid, p_status text, p_due_date date?)`
→ `{ "status": "paid", "payment_id": "…" }`

#### `complete_project(p_project_id uuid, p_client_signed_off boolean = true, p_note text?)`
Refused until every studio deliverable is verified. Moves the lead to `delivered`, queues a testimonial request.
→ `{ "status": "delivered", "project_id": "…", "next": "Request testimonial + referral" }`

#### `record_testimonial(p_project_id uuid, p_status text, p_quote text?, p_author_name text?, p_author_role text?, p_rating int?, p_permission boolean?)`
`p_rating` 1–5; `p_permission` = may publish. → `{ "status": "received", "testimonial_id": "…" }`

#### `add_referral(p_from_project_id uuid, p_referred_name text?, p_referred_contact text?, p_status text = 'requested', p_notes text?)`
→ `{ "status": "requested", "referral_id": "…" }`

#### `start_care_plan(p_project_id uuid, p_plan_code text, p_included_months int?, p_notes text?)`
Months included in the package are honoured automatically. Moves the lead to `care_plan`.
→ `{ "status": "active", "subscription_id": "…" }`

#### `log_care_hours(p_subscription_id uuid, p_hours numeric, p_description text, p_worked_on date = today)`
→ `{ "status": "logged", "hours_used_this_month": 2.5, "hours_included": 3, "over_allowance": false, "overage_rate_usd": 95 }`

#### `add_lesson(p_title text, p_body text, p_category text = 'general', p_industry text?, p_audience text[] = ['hunter','jordan'])`
Lessons must be anonymous: no client/contact names, emails, phone numbers, URLs or @handles.
→ `{ "status": "saved", "lesson_id": "…" }` or `{ "status": "rejected", "issues": ["mentions client \"…\""], "message": "…" }`

---

## 7. Workflows

### 7.1 Bulk lead upload (Hunter or Top G)
1. Clean the list: one object per business, `business` filled in, phones with country code, no invented
   contact details. Remove obvious repeats within your own list.
2. Split it into chunks of **100 or fewer** and call `create_leads_bulk` once per chunk, one chunk at a time.
3. Read `results`: `created` → keep `code` + `lead_id`; `duplicate` → skip and note the matching codes
   (resend that one row with `"force": true` only if certainly a different business); `do_not_contact` →
   skip permanently; `error` → fix the row per the message and resend just that row.
4. On HTTP 429/5xx for a chunk, wait 10 s and resend that chunk once (rows already created will come back
   as duplicates, which is safe).
5. Finish with a report: processed, created (codes), duplicates (matching codes), do-not-contact, errors.
For a single lead, `create_lead` works the same way. Don't screen or message imported leads; Jordan screens them next.

### 7.2 Outreach (Jordan → Letty → Jordan)
`screen_lead` → `create_draft` → `submit_draft_batch` → *wait for Letty/Marvin's decision* →
re-read draft status → send in WhatsApp/email/Instagram → `log_send` → later `log_reply`.

### 7.3 Closing (Quinn)
`add_discovery_note` (with source) → `quote_deal` → `create_deal` → `create_proposal` → `sign_deal`.

### 7.4 Delivery (Dana)
`create_scope` → `create_project` (check `capacity`) → `update_milestone` / `update_deliverable` →
`record_payment` → `complete_project` → `record_testimonial` / `add_referral` → `start_care_plan` → `log_care_hours`.

### 7.5 Coordination (Top G, daily)
`dashboard_metrics` → handle escalations with `update_escalation` → nudge the right agent →
`get_lead_context` for any lead you need to understand.

---

## 8. Rules every agent follows

1. One function per step; pass arguments by name; read `status` and `message` every time.
2. Never invent prices: `quote_deal` / `create_deal` only.
3. Nothing is sent to a prospect without an approved draft in an approved batch.
4. Never contact anyone on the do-not-contact list.
5. If refused, don't work around it: fix the input or `raise_escalation` with a proposed action.
6. Only log things that really happened (sends, replies, payments, sign-offs).
7. Use your own login only, and never reveal it.
8. Direct table writes are refused on leads, drafts, batches, deals, proposals, payments, projects,
   scopes, care plans and the do-not-contact list — always use the functions above.
