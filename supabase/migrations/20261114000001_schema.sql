-- =============================================================================
-- Squad CRM — schema
-- Marvz Studio internal CRM used by Letty (owner) and five Grokbot AI agents.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type pipeline_stage as enum (
  'found', 'screened', 'draft_ready', 'approved', 'sent', 'replied',
  'discovery', 'proposal', 'signed', 'in_delivery', 'delivered', 'care_plan',
  'lost', 'do_not_contact'
);

create type outreach_channel as enum ('whatsapp', 'email', 'instagram');
create type draft_status     as enum ('draft', 'ready', 'in_batch', 'approved', 'rejected', 'sent');
create type batch_status     as enum ('pending', 'approved', 'partially_approved', 'rejected');
create type note_source      as enum ('call', 'meeting', 'whatsapp', 'email', 'instagram', 'form', 'website', 'other');
create type deal_status      as enum ('draft', 'quoted', 'proposed', 'signed', 'lost');
create type payment_plan     as enum ('50_50', '40_30_30');
create type proposal_status  as enum ('draft', 'sent', 'accepted', 'declined');
create type scope_status     as enum ('draft', 'sent_for_signature', 'signed');
create type project_status   as enum ('planning', 'active', 'at_risk', 'delivered', 'closed');
create type milestone_status as enum ('pending', 'in_progress', 'done', 'slipped');
create type deliverable_owner as enum ('studio', 'client');
create type item_status      as enum ('pending', 'in_progress', 'done', 'blocked');
create type payment_status   as enum ('scheduled', 'invoiced', 'paid', 'overdue');
create type escalation_severity as enum ('low', 'medium', 'high', 'urgent');
create type escalation_status as enum ('open', 'in_review', 'with_letty', 'resolved', 'dismissed');
create type care_status      as enum ('active', 'paused', 'cancelled');
create type testimonial_status as enum ('to_request', 'requested', 'received', 'published', 'declined');
create type referral_status  as enum ('requested', 'received', 'contacted', 'converted', 'dead');
create type dnc_kind         as enum ('email', 'phone', 'domain', 'instagram', 'business');

-- -----------------------------------------------------------------------------
-- Normalisation helpers (used for duplicate detection + do-not-contact)
-- -----------------------------------------------------------------------------
create or replace function public.norm_text(t text) returns text
language sql immutable parallel safe as $$
  -- lower-case, fold Spanish/Portuguese/French accents, drop punctuation + spaces
  select nullif(regexp_replace(
           translate(lower(coalesce(t, '')), 'áàâäãåéèêëíìîïóòôöõúùûüñçýÿ', 'aaaaaaeeeeiiiiooooouuuuncyy'),
           '[^a-z0-9]+', '', 'g'), '')
$$;

create or replace function public.norm_phone(t text) returns text
language sql immutable parallel safe as $$
  -- digits only, keep the last 8 so "+591 71234567" and "71234567" match
  select case when length(regexp_replace(coalesce(t, ''), '\D', '', 'g')) >= 7
              then right(regexp_replace(coalesce(t, ''), '\D', '', 'g'), 8) end
$$;

create or replace function public.norm_domain(t text) returns text
language sql immutable parallel safe as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(coalesce(t, '')), '^(https?://)?(www\.)?', ''),
      '[/?#].*$', ''),
    '')
$$;

create or replace function public.norm_handle(t text) returns text
language sql immutable parallel safe as $$
  select nullif(regexp_replace(
           regexp_replace(lower(coalesce(t, '')), '^(https?://)?(www\.)?instagram\.com/', ''),
           '[^a-z0-9._]', '', 'g'), '')
$$;

-- -----------------------------------------------------------------------------
-- Team
-- -----------------------------------------------------------------------------
create table public.agents (
  code         text primary key check (code ~ '^[a-z_]+$'),
  name         text not null,
  kind         text not null check (kind in ('human', 'ai')),
  title        text not null,
  description  text,
  color        text not null default '#8b8bf5',
  auth_user_id uuid unique,             -- links to auth.users.id
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Catalogue (read-only for agents; only Letty edits)
-- -----------------------------------------------------------------------------
create table public.markets (
  code     text primary key,
  name     text not null,
  currency text not null,
  symbol   text not null,
  factor   numeric(8,3) not null check (factor > 0),
  sort     int not null default 0
);

create table public.catalogue_packages (
  code                 text primary key,
  name                 text not null,
  price_usd            numeric(12,2) not null,
  weeks_min            int,
  weeks_max            int,
  included_care_plan   text,
  included_care_months int not null default 0,
  ai_usage_months      int not null default 0,
  description          text,
  includes             text[] not null default '{}',
  sort                 int not null default 0,
  active               boolean not null default true
);

create table public.catalogue_package_prices (
  package_code text references public.catalogue_packages(code) on delete cascade,
  market_code  text references public.markets(code) on delete cascade,
  price        numeric(12,2) not null,
  primary key (package_code, market_code)
);

create table public.catalogue_addons (
  code        text primary key,
  name        text not null,
  price_usd   numeric(12,2) not null default 0,
  monthly_usd numeric(12,2) not null default 0,
  per_unit    boolean not null default false,   -- "each" (extra page, extra language)
  unit_label  text,
  description text,
  sort        int not null default 0,
  active      boolean not null default true
);

create table public.catalogue_care_plans (
  code           text primary key,
  name           text not null,
  monthly_usd    numeric(12,2) not null,
  hours_included numeric(6,2) not null default 0,
  description    text,
  sort           int not null default 0
);

create table public.catalogue_terms (
  key         text primary key,
  value       jsonb not null,
  description text
);

-- -----------------------------------------------------------------------------
-- Companies, contacts, leads
-- -----------------------------------------------------------------------------
create table public.companies (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  name_norm       text generated always as (public.norm_text(name)) stored,
  website         text,
  domain_norm     text generated always as (public.norm_domain(website)) stored,
  instagram       text,
  instagram_norm  text generated always as (public.norm_handle(instagram)) stored,
  industry        text,
  city            text,
  country         text,
  market_code     text references public.markets(code),
  notes           text,
  created_by      text references public.agents(code),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.companies (name_norm);
create index on public.companies (domain_norm);
create index on public.companies (instagram_norm);

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  full_name   text not null,
  role        text,
  email       text,
  email_norm  text generated always as (nullif(lower(trim(email)), '')) stored,
  phone       text,
  phone_norm  text generated always as (public.norm_phone(phone)) stored,
  languages   text[] not null default '{}',
  is_primary  boolean not null default true,
  created_by  text references public.agents(code),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.contacts (company_id);
create index on public.contacts (email_norm);
create index on public.contacts (phone_norm);

create table public.leads (
  id               uuid primary key default gen_random_uuid(),
  ref              bigint generated always as identity unique,   -- human friendly "SQ-12"
  company_id       uuid not null references public.companies(id) on delete cascade,
  contact_id       uuid references public.contacts(id) on delete set null,
  stage            pipeline_stage not null default 'found',
  industry         text,
  service_interest text[] not null default '{}',   -- catalogue package/addon codes or free text
  market_code      text references public.markets(code),
  budget_band      text check (budget_band in ('<2k', '2-5k', '5-10k', '10-20k', '20k+', 'unknown')),
  timeline         text,
  languages        text[] not null default '{}',
  source           text,                             -- e.g. "Google Maps", "Instagram search", "referral"
  channel          outreach_channel,
  portfolio_case   text,                             -- matching case study slug/title
  fit_score        int check (fit_score between 0 and 100),
  screen_notes     text,
  owner_agent      text references public.agents(code),
  next_action      text,
  next_action_at   timestamptz,
  lost_reason      text,
  stage_changed_at timestamptz not null default now(),
  created_by       text references public.agents(code),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.leads (stage);
create index on public.leads (company_id);
create index on public.leads (market_code);
create index on public.leads (owner_agent);

create table public.stage_changes (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  from_stage  pipeline_stage,
  to_stage    pipeline_stage not null,
  agent_code  text references public.agents(code),
  reason      text,
  created_at  timestamptz not null default now()
);
create index on public.stage_changes (lead_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Outreach (Jordan) + approval batches (Letty)
-- -----------------------------------------------------------------------------
create table public.approval_batches (
  id           uuid primary key default gen_random_uuid(),
  ref          bigint generated always as identity unique,
  status       batch_status not null default 'pending',
  submitted_by text references public.agents(code),
  submitted_at timestamptz not null default now(),
  decided_by   text references public.agents(code),
  decided_at   timestamptz,
  note         text
);

create table public.outreach_drafts (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.leads(id) on delete cascade,
  channel        outreach_channel not null,
  language       text not null default 'es',
  subject        text,
  body           text not null,
  personalisation text,                 -- why this message fits this business
  status         draft_status not null default 'draft',
  batch_id       uuid references public.approval_batches(id) on delete set null,
  reviewer_note  text,
  created_by     text references public.agents(code),
  approved_by    text references public.agents(code),
  approved_at    timestamptz,
  sent_by        text references public.agents(code),
  sent_at        timestamptz,
  external_ref   text,                  -- message id from WhatsApp / email provider
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.outreach_drafts (lead_id);
create index on public.outreach_drafts (batch_id);
create index on public.outreach_drafts (status);

-- -----------------------------------------------------------------------------
-- Discovery + deals + proposals (Quinn)
-- -----------------------------------------------------------------------------
create table public.discovery_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  topic       text not null default 'general',  -- goals, audience, content, budget, timeline, tech, ...
  question    text,
  answer      text not null,
  source      note_source not null,             -- where the answer came from (required)
  source_ref  text,                             -- message link / call date / form id
  recorded_by text references public.agents(code),
  created_at  timestamptz not null default now()
);
create index on public.discovery_notes (lead_id);

create table public.deals (
  id             uuid primary key default gen_random_uuid(),
  ref            bigint generated always as identity unique,
  lead_id        uuid not null references public.leads(id) on delete cascade,
  title          text not null,
  package_code   text references public.catalogue_packages(code),
  market_code    text not null references public.markets(code),
  currency       text not null,
  payment_plan   payment_plan not null default '50_50',
  rush           boolean not null default false,
  care_plan_code text references public.catalogue_care_plans(code),
  one_off_subtotal numeric(12,2) not null default 0,
  rush_fee       numeric(12,2) not null default 0,
  one_off_total  numeric(12,2) not null default 0,
  monthly_total  numeric(12,2) not null default 0,
  one_off_total_usd numeric(12,2) not null default 0,
  monthly_total_usd numeric(12,2) not null default 0,
  status         deal_status not null default 'draft',
  signed_at      timestamptz,
  lost_reason    text,
  created_by     text references public.agents(code),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.deals (lead_id);
create index on public.deals (status);

create table public.deal_items (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deals(id) on delete cascade,
  kind          text not null check (kind in ('package', 'addon', 'care_plan')),
  code          text not null,
  name          text not null,
  qty           int not null default 1 check (qty > 0),
  unit_price    numeric(12,2) not null default 0,
  monthly_price numeric(12,2) not null default 0,
  line_total    numeric(12,2) not null default 0
);
create index on public.deal_items (deal_id);

create table public.proposals (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references public.deals(id) on delete cascade,
  lead_id         uuid not null references public.leads(id) on delete cascade,
  version         int not null default 1,
  scope_summary   text not null,
  deliverables    jsonb not null default '[]',
  execution_plan  text,
  status          proposal_status not null default 'draft',
  sent_at         timestamptz,
  decided_at      timestamptz,
  created_by      text references public.agents(code),
  created_at      timestamptz not null default now()
);
create index on public.proposals (deal_id);

-- -----------------------------------------------------------------------------
-- Delivery (Dana)
-- -----------------------------------------------------------------------------
create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  ref            bigint generated always as identity unique,
  deal_id        uuid references public.deals(id) on delete set null,
  lead_id        uuid references public.leads(id) on delete set null,
  company_id     uuid references public.companies(id) on delete set null,
  name           text not null,
  status         project_status not null default 'planning',
  slot_month     date not null default date_trunc('month', now())::date,  -- capacity slot
  start_date     date,
  target_date    date,
  delivered_at   timestamptz,
  signed_off_at  timestamptz,
  health_note    text,
  created_by     text references public.agents(code),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on public.projects (slot_month);
create index on public.projects (status);

create table public.scopes (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  version     int not null default 1,
  lines       jsonb not null default '[]',    -- [{ "line": "...", "price": 0, "verified": false, "note": "" }]
  total       numeric(12,2) not null default 0,
  currency    text not null default 'USD',
  status      scope_status not null default 'draft',
  sent_at     timestamptz,
  signed_at   timestamptz,
  created_by  text references public.agents(code),
  created_at  timestamptz not null default now()
);

create table public.milestones (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  title         text not null,
  due_date      date not null,
  original_due  date,
  status        milestone_status not null default 'pending',
  completed_at  timestamptz,
  slip_reason   text,
  proposed_fix  text,
  sort          int not null default 0,
  created_at    timestamptz not null default now()
);
create index on public.milestones (project_id, sort);

create table public.deliverables (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  milestone_id  uuid references public.milestones(id) on delete set null,
  title         text not null,
  owner         deliverable_owner not null default 'studio',  -- 'client' = what the client owes
  due_date      date,
  status        item_status not null default 'pending',
  scope_line    text,             -- which scope line this satisfies
  verified      boolean not null default false,
  verified_note text,
  created_at    timestamptz not null default now()
);
create index on public.deliverables (project_id);

create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  label       text not null,
  percent     numeric(5,2) not null,
  amount      numeric(12,2) not null,
  currency    text not null,
  due_date    date,
  status      payment_status not null default 'scheduled',
  paid_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on public.payments (deal_id);

-- -----------------------------------------------------------------------------
-- Escalations + activity
-- -----------------------------------------------------------------------------
create table public.escalations (
  id               uuid primary key default gen_random_uuid(),
  ref              bigint generated always as identity unique,
  lead_id          uuid references public.leads(id) on delete set null,
  project_id       uuid references public.projects(id) on delete set null,
  raised_by        text not null references public.agents(code),
  title            text not null,
  detail           text,
  proposed_action  text,
  severity         escalation_severity not null default 'medium',
  status           escalation_status not null default 'open',
  assigned_to      text not null default 'top_g' references public.agents(code),
  top_g_notes      text,
  resolution_notes text,
  resolved_by      text references public.agents(code),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.escalations (status);

create table public.activity_log (
  id          bigint generated always as identity primary key,
  agent_code  text references public.agents(code),
  action      text not null,          -- rpc / verb, e.g. create_lead, advance_stage
  entity_type text,                   -- lead, draft, batch, deal, ...
  entity_id   uuid,
  lead_id     uuid references public.leads(id) on delete set null,
  summary     text not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index on public.activity_log (created_at desc);
create index on public.activity_log (lead_id, created_at desc);
create index on public.activity_log (agent_code, created_at desc);

-- -----------------------------------------------------------------------------
-- Growth
-- -----------------------------------------------------------------------------
create table public.lessons (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  category    text not null default 'general'
              check (category in ('targeting', 'outreach', 'discovery', 'pricing', 'delivery', 'general')),
  industry    text,
  audience    text[] not null default '{hunter,jordan}',
  created_by  text references public.agents(code),
  created_at  timestamptz not null default now()
);

create table public.testimonials (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid references public.projects(id) on delete set null,
  company_id            uuid references public.companies(id) on delete cascade,
  status                testimonial_status not null default 'to_request',
  quote                 text,
  author_name           text,
  author_role           text,
  rating                int check (rating between 1 and 5),
  permission_to_publish boolean not null default false,
  requested_at          timestamptz,
  received_at           timestamptz,
  created_by            text references public.agents(code),
  created_at            timestamptz not null default now()
);

create table public.referrals (
  id               uuid primary key default gen_random_uuid(),
  from_company_id  uuid references public.companies(id) on delete set null,
  from_project_id  uuid references public.projects(id) on delete set null,
  referred_name    text,
  referred_contact text,
  status           referral_status not null default 'requested',
  lead_id          uuid references public.leads(id) on delete set null,
  notes            text,
  created_by       text references public.agents(code),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.care_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete set null,
  plan_code      text not null references public.catalogue_care_plans(code),
  market_code    text not null references public.markets(code),
  currency       text not null,
  monthly_price  numeric(12,2) not null,
  monthly_usd    numeric(12,2) not null,
  hours_included numeric(6,2) not null default 0,
  included_until date,            -- covered by package, billing starts after
  start_date     date not null default current_date,
  renewal_date   date not null,
  status         care_status not null default 'active',
  notes          text,
  created_by     text references public.agents(code),
  created_at     timestamptz not null default now()
);

create table public.care_hours_log (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.care_subscriptions(id) on delete cascade,
  worked_on       date not null default current_date,
  hours           numeric(6,2) not null check (hours > 0),
  description     text not null,
  logged_by       text references public.agents(code),
  created_at      timestamptz not null default now()
);

create table public.do_not_contact (
  id         uuid primary key default gen_random_uuid(),
  kind       dnc_kind not null,
  value      text not null,
  value_norm text generated always as (
    case kind
      when 'email'     then nullif(lower(trim(value)), '')
      when 'phone'     then public.norm_phone(value)
      when 'domain'    then public.norm_domain(value)
      when 'instagram' then public.norm_handle(value)
      else public.norm_text(value)
    end) stored,
  reason     text,
  lead_id    uuid references public.leads(id) on delete set null,
  added_by   text references public.agents(code),
  created_at timestamptz not null default now(),
  unique (kind, value_norm)
);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['companies','contacts','leads','outreach_drafts','deals',
                           'projects','escalations','referrals']
  loop
    execute format('create trigger trg_touch_%1$s before update on public.%1$I
                    for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;
