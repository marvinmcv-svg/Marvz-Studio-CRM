# Squad CRM — Agent API reference

Every Grokbot agent talks to Squad CRM through **Supabase RPC functions**: one call per step.

```
POST https://<project>.supabase.co/rest/v1/rpc/<function>
apikey:        <anon / publishable key>
Authorization: Bearer <this agent's token>
Content-Type:  application/json

{ "p_arg": "value", ... }
```

Every function:

1. **Identifies the caller** from its token (`agents.auth_user_id` → `hunter`, `jordan`, …).
2. **Checks the role.** A wrong agent gets `42501 Agent X is not allowed…`. Letty and Top G pass every check.
3. **Validates** the input: catalogue codes, stage rules, required sources, privacy.
4. **Writes the change and a row to `activity_log`.** Stage changes also go to `stage_changes` with the agent, timestamp and reason.
5. **Returns JSON**, always with a `status` field.

Errors come back as HTTP 4xx with `{ "message": "...", "code": "..." }`. Read `message`; it says what to fix.

> Pass arguments by name (`p_…`). Leave out optional arguments rather than sending `null`.

---

## Pipeline stages and who may move a lead into them

| Stage | Set by | How | Only from |
|---|---|---|---|
| `found` | Hunter | `create_lead` | (new leads) |
| `screened` / `lost` | Jordan | `screen_lead` | `found` |
| `draft_ready` | Jordan | `create_draft` | `found`, `screened` |
| `approved` | **Letty only** (Top G may record her decision) | `record_approval` | `found`, `screened`, `draft_ready` |
| `sent` | Jordan, only for approved drafts | `log_send` | `approved` |
| `replied` | Jordan / Quinn | `log_reply` | `sent` |
| `discovery` | Quinn | `add_discovery_note` (auto) or `advance_stage` | `sent`, `replied` |
| `proposal` | Quinn | `create_proposal` | `replied`, `discovery` |
| `signed` | Quinn | `sign_deal` (needs a signed deal) | `discovery`, `proposal` |
| `in_delivery` | Dana | `create_project` (needs a project) | `signed` |
| `delivered` | Dana | `complete_project` | `in_delivery` |
| `care_plan` | Dana | `start_care_plan` | `in_delivery`, `delivered` |
| `lost` | anyone | `advance_stage` | any stage **before** `signed` |
| `do_not_contact` | anyone | `add_do_not_contact`, `advance_stage` | any stage |

The database enforces this table (`allowed_target_stages()`, `stage_predecessors()` and the `guard_lead_stage` trigger). Leads never move backwards and `lost` / `do_not_contact` leads cannot be revived, except by Letty or Top G. If a lead needs correcting, call `raise_escalation`.

Workflow functions only move a lead **forward**: a follow-up draft, a late reply or a second project never drags a lead back to an earlier stage. `advance_stage` is strict and returns an error when the move is not allowed from the lead's current stage.

---

## Shared (every agent)

### `advance_stage(p_lead_id, p_to_stage, p_reason)`
Moves a lead to a new stage. **`p_reason` is required.** The move is refused if your role may not move a lead into that stage. Moving to `lost` also marks the lead's open deals as lost.
```json
{ "p_lead_id": "…", "p_to_stage": "discovery", "p_reason": "Booked a discovery call for Tuesday" }
→ { "status": "moved", "from": "replied", "to": "discovery" }
```

### `raise_escalation(p_title, p_detail?, p_severity?, p_lead_id?, p_project_id?, p_proposed_action?)`
Raises an issue for Top G. Severity is one of `low | medium | high | urgent`. Always propose an action.
```json
{ "p_title": "Prospect asks for 15% discount", "p_severity": "medium", "p_lead_id": "…",
  "p_proposed_action": "Offer 40/30/30 instead of a discount" }
→ { "status": "open", "ref": "E-7", "assigned_to": "top_g" }
```

### `get_lead_context(p_lead_id)`
Returns everything about one lead in one call: lead, company, contact, stage history, drafts, discovery notes, deals, proposals and open escalations.

### `capacity(p_month?)` · `check_do_not_contact(...)` · `find_duplicate_leads(...)`
Read-only helpers. They take the same `p_business`, `p_email`, `p_phone`, `p_website` and `p_instagram` arguments as `create_lead`.

---

## Hunter: finds leads

### `create_lead(...)`
| arg | notes |
|---|---|
| `p_business` | **required** |
| `p_contact_name`, `p_email`, `p_phone`, `p_website`, `p_instagram` | as many as you have |
| `p_industry`, `p_city`, `p_country` | |
| `p_market` | `US` (default, USD) · `CA` · `MX` · `UK` · `EU` · `AU` (sets pricing currency) |
| `p_service_interest` | array of catalogue codes, e.g. `["presence","booking_deposits"]` |
| `p_budget_band` | `<2k` · `2-5k` · `5-10k` · `10-20k` · `20k+` · `unknown` |
| `p_timeline`, `p_languages` (`["es","en"]`), `p_source`, `p_channel` (`whatsapp`/`email`/`instagram`), `p_portfolio_case`, `p_notes` | |
| `p_force` | `true` creates the lead even when duplicates were found (only after checking them) |

Possible results:
```json
{ "status": "created", "lead_id": "…", "code": "SQ-42", "possible_duplicates": [] }
{ "status": "duplicate", "created": false, "matches": [{ "code": "SQ-1", "business": "Café Altura", "matched_on": ["phone"] }] }
{ "status": "do_not_contact", "created": false, "matches": [{ "kind": "business", "reason": "Asked not to be contacted" }] }
```
Duplicate matching ignores accents, case, punctuation and phone formatting (`+591 71234567` matches `71234567`). It checks name, similar name, website domain, Instagram handle, email and phone.

### `update_lead(p_lead_id, p_fields, p_reason?)`
`p_fields` is a JSON object of lead fields, for example `{"budget_band":"5-10k","timeline":"March"}`. It cannot change the stage.

---

## Jordan: outreach

1. `screen_lead(p_lead_id, p_passes, p_fit_score?, p_notes?, p_portfolio_case?, p_channel?)`. Pass moves the lead to `screened`; fail moves it to `lost` and records the reason.
2. `create_draft(p_lead_id, p_body, p_channel?, p_subject?, p_language?, p_personalisation?)`. Moves the lead to `draft_ready`. Say why the message fits in `p_personalisation`.
3. `submit_draft_batch(p_draft_ids[], p_note?)` returns `{ "batch_id", "batch_ref" }`. Letty reviews the batch in Grokbot or in the CRM.
4. **Wait for the decision.** `record_approval` is Letty/Top G only.
5. **Right before sending, re-read the draft** (`GET /rest/v1/outreach_drafts?id=eq.<id>&select=status`) and send only if it is still `approved`. A draft is cancelled (`rejected`, note "Do not contact") if its contact is added to the do-not-contact list after approval.
6. `log_send(p_draft_id, p_external_ref?, p_sent_at?)` works **only** for drafts with status `approved` in an approved batch, and is refused if the lead is `lost` / `do_not_contact` or the contact matches the do-not-contact list. It moves the lead to `sent` (if it was `approved`) and sets a 3-day follow-up. If a message already went out to someone on the list, call `raise_escalation`.
7. `log_reply(p_lead_id, p_summary, p_channel?, p_hand_to_quinn = true)` moves a `sent` lead to `replied` and makes Quinn the owner. For a lead that is further along (or `lost`) the reply is logged and the lead stays where it is (`"stage"` and `"message"` in the response say so). Refused for `do_not_contact` leads.

`create_draft` is refused when the lead's business, website, Instagram or any of its contacts is on the do-not-contact list.

Also: `add_do_not_contact(p_kind, p_value, p_reason, p_lead_id?)`. `p_kind` is one of `business | email | phone | domain | instagram`. It moves **every lead that matches the entry** (plus `p_lead_id`, if given) to `do_not_contact` and cancels their unsent drafts. Returns `{ "leads_blocked", "drafts_cancelled" }`.

---

## Letty / Top G: approvals and escalations

### `record_approval(p_batch_id, p_approved_ids?, p_rejected_ids?, p_note?, p_feedback?)`
* Leave out `p_approved_ids` to approve the whole batch.
* `p_feedback` takes per-draft notes: `{ "<draft_id>": "Shorter, mention the bakery photos" }`.
* Approved drafts move their leads to `approved`. The batch becomes `approved`, `partially_approved` or `rejected`.
* The caller is recorded as the decider (`decided_by`, `approved_by`): `letty`, or `top_g` when Top G records Letty's decision. The response includes `decided_by`.

### `update_escalation(p_escalation_id, p_action, p_notes?)`
`p_action` is one of:
* `review`: Top G takes it.
* `escalate_to_letty`: Top G can't solve it.
* `resolve`: notes required.
* `dismiss`

### `dashboard_metrics()`
One call returns: MRR, committed MRR, pipeline value, win rate, average deal, counts per stage, open escalations, batches and drafts waiting for Letty, slipping milestones, capacity, and renewals due in the next 30 days. `mrr_usd` and `committed_mrr_usd` are only filled in for Letty, Top G and Dana (the agents who can read care plans); for everyone else they are `null`.

---

## Quinn: discovery → proposal → signing

### `add_discovery_note(p_lead_id, p_answer, p_source, p_question?, p_topic?, p_source_ref?)`
`p_source` is **required**: `call | meeting | whatsapp | email | instagram | form | website | other`. Put the message link or call date in `p_source_ref`. The first note moves a `sent`/`replied` lead to `discovery`.

### `quote_deal(p_package, p_addons?, p_market?, p_payment_plan?, p_rush?, p_care_plan?)` (read-only)
Prices come **only** from the catalogue. Unknown codes are refused.
```json
{ "p_package": "full_house",
  "p_addons": [{ "code": "booking_deposits" }, { "code": "extra_page", "qty": 2 }],
  "p_market": "US", "p_payment_plan": "40_30_30", "p_rush": true }
→ { "currency": "USD", "one_off_subtotal": 7480, "rush_fee": 1870, "one_off_total": 9350,
    "monthly_total": 0, "payment_schedule": [
      { "label": "Kickoff deposit", "percent": 40, "amount": 3740 },
      { "label": "Design approval", "percent": 30, "amount": 2805 },
      { "label": "Launch", "percent": 30, "amount": 2805 }],
    "included": [{ "item": "3 month(s) Pro Care" }], "timeline_weeks": [4, 5], … }
```
* Packages use their explicit per-market price.
* Add-ons are USD × market factor, rounded to 10.
* Rush adds +25% to the one-off total.
* `extra_page` and `extra_language` accept `qty`.

### `create_deal(p_lead_id, p_package, p_addons?, p_market?, p_payment_plan?, p_rush?, p_care_plan?, p_title?)`
Same inputs as `quote_deal`. It saves the deal, its line items and the payment milestones. `p_market` defaults to the lead's market.

### `create_proposal(p_deal_id, p_scope_summary, p_deliverables?, p_execution_plan?, p_mark_sent?)`
Moves the lead to `proposal`. Versions are numbered automatically.

### `sign_deal(p_deal_id, p_reason?)`
Signs a `quoted` or `proposed` deal (a deal can only be signed once; lost deals cannot be signed). Accepts its proposal, marks the lead's **other open quotes as lost** ("Superseded by D-…", returned in `superseded_deal_ids`), moves the lead to `signed` and hands it to Dana. For an upsell on a client that is already in delivery or later, the lead keeps its stage. Returns capacity, with a warning when the month is full.

---

## Dana: delivery, quality, growth

| function | purpose |
|---|---|
| `create_scope(p_deal_id, p_extra_lines?, p_send?)` | Scope of work. Lines are priced in **USD from the catalogue** (rush added). The deal must be signed. |
| `create_project(p_deal_id, p_plan, p_start_date?, p_slot_month?, p_name?)` | Handoff plan. **Refused when 4 projects already start that month.** Moves the lead to `in_delivery`. |
| `update_milestone(p_milestone_id, p_status?, p_due_date?, p_slip_reason?, p_proposed_fix?)` | `slipped` requires both a reason and a proposed fix, and flags the project `at_risk`. |
| `update_deliverable(p_deliverable_id, p_status?, p_verified?, p_note?)` | Line-by-line check against scope. |
| `record_payment(p_payment_id, p_status, p_due_date?)` | `scheduled · invoiced · paid · overdue` |
| `complete_project(p_project_id, p_client_signed_off?, p_note?)` | Refused until every studio deliverable is verified. Moves the lead to `delivered` and queues a testimonial request. |
| `record_testimonial(p_project_id, p_status, p_quote?, p_author_name?, p_author_role?, p_rating?, p_permission?)` | `to_request · requested · received · published · declined` |
| `add_referral(p_from_project_id, p_referred_name?, p_referred_contact?, p_status?, p_notes?)` | |
| `start_care_plan(p_project_id, p_plan_code, p_included_months?, p_notes?)` | `basic · pro · growth`. Months included in the package are honoured. Moves the lead to `care_plan`. |
| `log_care_hours(p_subscription_id, p_hours, p_description, p_worked_on?)` | Returns hours used vs. included and flags overage at $95/h. |
| `add_lesson(p_title, p_body, p_category?, p_industry?, p_audience?)` | **Anonymised only.** Refused if it contains a client or contact name, email, phone, URL or @handle. Returns `{status:"rejected", issues:[…]}` so you can rewrite it. |

`p_plan` example for `create_project`:
```json
[
  { "title": "Kickoff & content", "due_date": "2026-12-01",
    "deliverables": [{ "title": "Sitemap + moodboard", "scope_line": "Full House" }],
    "client_owes":  [{ "title": "Logo, photos, price list", "due_date": "2026-11-26" }] },
  { "title": "Design", "due_date": "2026-12-10",
    "deliverables": [{ "title": "Homepage + 4 pages" }] }
]
```

---

## Reading data directly

Agents may also `GET /rest/v1/<table>?select=*` on any table their role can read (RLS applies). Useful tables: `leads`, `companies`, `contacts`, `outreach_drafts`, `approval_batches`, `deals`, `projects`, `milestones`, `escalations`, `lessons`, and the catalogue (`catalogue_packages`, `catalogue_addons`, `catalogue_care_plans`, `catalogue_package_prices`, `markets`, `catalogue_terms`).

**Write through the RPCs.** Direct writes are refused (`permission denied`) on `leads`, `outreach_drafts`, `approval_batches`, `deals`, `deal_items`, `proposals`, `payments`, `projects`, `scopes`, `care_subscriptions`, `care_hours_log` and `do_not_contact`, for every agent including Top G. A few low-risk tables (`companies`, `contacts`, `discovery_notes`, `milestones`, `deliverables`, `lessons`, `testimonials`, `referrals`, `escalations`) still accept direct writes within each agent's role, and the lesson and escalation guards apply there.
