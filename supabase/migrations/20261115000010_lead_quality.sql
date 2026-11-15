-- =============================================================================
-- Squad CRM — lead quality, evidence and owner controls (CRM master fix list)
--
--  1  delete_lead: Marvin-only, type-to-confirm, audit snapshot in activity_log
--  2  structured address (street, city, region, postcode, country) + matching
--  3  on_hold + hold_reason on leads and drafts; batches refuse held items
--  4  recipient on drafts (required, shown in batch review)
--  5  manual_check PASS / FAIL / PENDING (Marvin only); gates advance_stage
--     and drafting
--  6  lead_relations (duplicate / sister / rename), both sides in one call,
--     frozen until Marvin clears it; frozen blocks screening, drafting, batching
--  7  evidence fields (domain_status, proofs, problem type, dates); drafting
--     refuses domain_status = UNVERIFIED
--  8  last_verified_at + stale_leads(p_days)
--  9  "held" stage (previous migration) + Santa Cruz de la Sierra never stored
-- 10  import_batches + import_batch_id / source_key on leads
-- 11  source_url / checked_at per contact method, contact_form_url
-- 12  WhatsApp, Telegram, reviews/rating, site language, owner name/role,
--     each with source_url + checked_at
--
-- No existing lead data is changed: new columns are nullable or have
-- defaults (manual_check = PENDING, domain_status = UNVERIFIED).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.companies
  add column if not exists street                    text,
  add column if not exists region                    text,
  add column if not exists postcode                  text,
  add column if not exists address_norm              text generated always as (
    case when nullif(trim(street), '') is null then null
         else public.norm_text(street) || '@' || coalesce(public.norm_text(city), '') end) stored,
  add column if not exists contact_form_url          text,
  add column if not exists contact_form_source_url   text,
  add column if not exists contact_form_checked_at   timestamptz,
  add column if not exists instagram_source_url      text,
  add column if not exists instagram_checked_at      timestamptz,
  add column if not exists facebook_url              text,
  add column if not exists tiktok_url                text,
  add column if not exists linkedin_url              text,
  add column if not exists socials_source_url        text,
  add column if not exists socials_checked_at        timestamptz,
  add column if not exists whatsapp                  text,
  add column if not exists whatsapp_source_url       text,
  add column if not exists whatsapp_checked_at       timestamptz,
  add column if not exists telegram                  text,
  add column if not exists telegram_source_url       text,
  add column if not exists telegram_checked_at       timestamptz,
  add column if not exists review_count              int check (review_count >= 0),
  add column if not exists rating                    numeric(2,1) check (rating between 0 and 5),
  add column if not exists rating_source             text,
  add column if not exists rating_source_url         text,
  add column if not exists rating_checked_at         timestamptz,
  add column if not exists site_language             text,
  add column if not exists site_language_source_url  text,
  add column if not exists site_language_checked_at  timestamptz,
  add column if not exists owner_name                text,
  add column if not exists owner_role                text,
  add column if not exists owner_source_url          text,
  add column if not exists owner_checked_at          timestamptz;
create index if not exists companies_address_norm_idx on public.companies (address_norm);

alter table public.contacts
  add column if not exists email_source_url  text,
  add column if not exists email_checked_at  timestamptz,
  add column if not exists phone_source_url  text,
  add column if not exists phone_checked_at  timestamptz;

create table if not exists public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  ref           bigint generated always as identity unique,
  source_file   text,
  note          text,
  rows_total    int not null default 0,
  rows_created  int not null default 0,
  rows_skipped  int not null default 0,
  created_by    text references public.agents(code),
  created_at    timestamptz not null default now()
);

alter table public.leads
  add column if not exists on_hold                 boolean not null default false,
  add column if not exists hold_reason             text,
  add column if not exists held_at                 timestamptz,
  add column if not exists held_by                 text references public.agents(code),
  add column if not exists manual_check            text not null default 'PENDING'
                                                   check (manual_check in ('PASS', 'FAIL', 'PENDING')),
  add column if not exists manual_check_note       text,
  add column if not exists manual_check_by         text references public.agents(code),
  add column if not exists manual_check_at         timestamptz,
  add column if not exists domain_status           text not null default 'UNVERIFIED'
                                                   check (domain_status in ('VERIFIED', 'NSC', 'UNVERIFIED')),
  add column if not exists domain_proof_url        text,
  add column if not exists website_problem_type    text check (website_problem_type in ('outdated', 'non_mobile', 'no_site')),
  add column if not exists operating_evidence_date date,
  add column if not exists evidence_checked_at     timestamptz,
  add column if not exists phone_source_url        text,
  add column if not exists last_verified_at        timestamptz,
  add column if not exists import_batch_id         uuid references public.import_batches(id) on delete set null,
  add column if not exists source_key              text;
create index if not exists leads_domain_status_idx    on public.leads (domain_status);
create index if not exists leads_manual_check_idx     on public.leads (manual_check);
create index if not exists leads_on_hold_idx          on public.leads (on_hold) where on_hold;
create index if not exists leads_last_verified_idx    on public.leads (last_verified_at);
create index if not exists leads_source_key_idx       on public.leads (source_key);
create index if not exists leads_import_batch_idx     on public.leads (import_batch_id);

alter table public.outreach_drafts
  add column if not exists recipient       text,
  add column if not exists recipient_kind  text check (recipient_kind in ('email', 'handle', 'form_url', 'phone')),
  add column if not exists on_hold         boolean not null default false,
  add column if not exists hold_reason     text;

create table if not exists public.lead_relations (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null,                     -- the two directions of one link share it
  lead_a      uuid not null references public.leads(id) on delete cascade,
  lead_b      uuid not null references public.leads(id) on delete cascade,
  relation    text not null check (relation in ('duplicate', 'sister', 'rename')),
  status      text not null default 'frozen' check (status in ('frozen', 'cleared')),
  note        text,
  created_by  text references public.agents(code),
  created_at  timestamptz not null default now(),
  cleared_by  text references public.agents(code),
  cleared_at  timestamptz,
  cleared_note text,
  check (lead_a <> lead_b),
  unique (lead_a, lead_b, relation)
);
create index if not exists lead_relations_a_idx on public.lead_relations (lead_a) where status = 'frozen';

-- Read for every squad member; writes only through the functions below.
alter table public.import_batches enable row level security;
alter table public.lead_relations enable row level security;
revoke all on public.import_batches, public.lead_relations from anon;
revoke insert, update, delete, truncate on public.import_batches, public.lead_relations from authenticated;
grant select on public.import_batches, public.lead_relations to authenticated;
create policy import_batches_read on public.import_batches for select to authenticated using (public.is_member());
create policy lead_relations_read on public.lead_relations for select to authenticated using (public.is_member());

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function public.is_marvin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_agent() = 'marvin'
$$;

create or replace function public.lead_is_frozen(p_lead_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.lead_relations r where r.lead_a = p_lead_id and r.status = 'frozen')
$$;

-- Santa Cruz de la Sierra (Bolivia) is out of scope: such leads are never stored.
create or replace function public.is_excluded_region(p_city text, p_country text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(public.norm_text(p_city), '') in ('santacruzdelasierra', 'santacruzdelasierrabolivia')
      or (coalesce(public.norm_text(p_city), '') = 'santacruz'
          and upper(coalesce(nullif(trim(p_country), ''), 'BO')) in ('BO', 'BOL', 'BOLIVIA'))
$$;

-- email · @handle · http(s) URL (contact form / social profile) · phone number
create or replace function public.recipient_kind(p_recipient text) returns text
language sql immutable as $$
  select case
    when p_recipient ~* '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then 'email'
    when p_recipient ~* '^@[a-z0-9._]{2,}$'                       then 'handle'
    when p_recipient ~* '^https?://[^\s]+\.[^\s]+'                then 'form_url'
    when p_recipient ~ '^\+?[0-9][0-9\s().-]{6,}[0-9]$'          then 'phone'
  end
$$;

-- Everything that stops outreach work on a lead, as readable reasons ([] = clear).
create or replace function public.outreach_blockers(p_lead_id uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when l.stage in ('held', 'lost', 'do_not_contact') then format('lead is %s', l.stage) end,
    case when l.on_hold then format('lead is on hold (%s)', coalesce(l.hold_reason, 'no reason given')) end,
    case when public.lead_is_frozen(l.id) then 'lead is frozen by a duplicate/sister link until Marvin clears it' end,
    case when l.manual_check <> 'PASS' then format('Marvin''s manual check is %s, not PASS', l.manual_check) end,
    case when l.domain_status = 'UNVERIFIED' then 'domain_status is UNVERIFIED (verify the domain or mark NSC first)' end
  ], null)
  from public.leads l where l.id = p_lead_id
$$;

-- -----------------------------------------------------------------------------
-- Stage rules: "held" (in and out), plus the manual-check / frozen guard
-- -----------------------------------------------------------------------------
create or replace function public.allowed_target_stages(p_agent text) returns pipeline_stage[]
language sql immutable as $$
  select case p_agent
    when 'letty'  then enum_range(null::pipeline_stage)
    when 'top_g'  then enum_range(null::pipeline_stage)
    when 'marvin' then enum_range(null::pipeline_stage)
    when 'hunter' then array['held', 'found', 'lost', 'do_not_contact']::pipeline_stage[]
    when 'jordan' then array['held', 'found', 'screened', 'draft_ready', 'sent', 'replied', 'lost', 'do_not_contact']::pipeline_stage[]
    when 'quinn'  then array['replied', 'discovery', 'proposal', 'signed', 'lost', 'do_not_contact']::pipeline_stage[]
    when 'dana'   then array['signed', 'in_delivery', 'delivered', 'care_plan', 'lost', 'do_not_contact']::pipeline_stage[]
    else array[]::pipeline_stage[]
  end
$$;

create or replace function public.stage_predecessors(p_to pipeline_stage) returns pipeline_stage[]
language sql immutable set search_path = public as $$
  select (case p_to
    when 'held'           then '{found,screened}'
    when 'found'          then '{held}'
    when 'screened'       then '{found}'
    when 'draft_ready'    then '{found,screened}'
    when 'approved'       then '{found,screened,draft_ready}'
    when 'sent'           then '{approved}'
    when 'replied'        then '{sent}'
    when 'discovery'      then '{sent,replied}'
    when 'proposal'       then '{replied,discovery}'
    when 'signed'         then '{discovery,proposal}'
    when 'in_delivery'    then '{signed}'
    when 'delivered'      then '{in_delivery}'
    when 'care_plan'      then '{in_delivery,delivered}'
    -- once a client has signed, only Letty / Marvin / Top G can mark it lost
    when 'lost'           then '{held,found,screened,draft_ready,approved,sent,replied,discovery,proposal}'
    -- safety first: anything can become do-not-contact
    when 'do_not_contact' then '{held,found,screened,draft_ready,approved,sent,replied,discovery,proposal,signed,in_delivery,delivered,care_plan,lost}'
  end)::pipeline_stage[]
$$;

create or replace function public.guard_lead_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me text := public.current_agent();
  v_admin boolean := public.is_admin();
  v_reason text := nullif(current_setting('squad.reason', true), '');
  v_name text;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return new;
  end if;

  if me is null then
    raise exception 'Not a registered Squad CRM agent' using errcode = '42501';
  end if;

  if not (new.stage = any(public.allowed_target_stages(me))) then
    raise exception 'Agent % cannot move a lead to stage %', me, new.stage using errcode = '42501';
  end if;

  if not v_admin then
    if tg_op = 'INSERT' and new.stage not in ('found', 'held') then
      raise exception 'New leads start at stage found (or held)' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and not (old.stage = any(public.stage_predecessors(new.stage))) then
      raise exception 'Agent % cannot move a lead from % to % (allowed from: %). Escalate to Top G if this is a correction.',
        me, old.stage, new.stage, coalesce(nullif(array_to_string(public.stage_predecessors(new.stage), ', '), ''), 'no stage')
        using errcode = '42501';
    end if;
    if new.stage = 'signed' and not exists (
         select 1 from public.deals d where d.lead_id = new.id and d.status = 'signed') then
      raise exception 'Lead cannot be marked signed without a signed deal (use sign_deal)' using errcode = '42501';
    end if;
    if new.stage = 'in_delivery' and not exists (select 1 from public.projects p where p.lead_id = new.id) then
      raise exception 'Lead cannot be marked in delivery without a project (use create_project)' using errcode = '42501';
    end if;
  end if;

  if new.stage = 'sent' and not v_admin and not exists (
       select 1 from public.outreach_drafts d where d.lead_id = new.id and d.status = 'sent') then
    raise exception 'Lead cannot be marked sent without a sent, batch-approved draft (use log_send)';
  end if;

  new.stage_changed_at := now();

  if tg_op = 'UPDATE' then
    insert into public.stage_changes (lead_id, from_stage, to_stage, agent_code, reason)
    values (new.id, old.stage, new.stage, me, v_reason);

    select c.name into v_name from public.companies c where c.id = new.company_id;
    perform public.log_activity('stage_change', 'lead', new.id, new.id,
      format('%s moved %s → %s', coalesce(v_name, 'lead'), old.stage, new.stage)
        || coalesce(': ' || v_reason, ''),
      jsonb_build_object('from', old.stage, 'to', new.stage, 'reason', v_reason));
  end if;
  return new;
end $$;

-- Only Marvin changes the manual check (also protects definer code paths).
create or replace function public.guard_lead_quality() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.manual_check <> 'PENDING' and not public.is_marvin() then
      raise exception 'Only Marvin can set the manual check' using errcode = '42501';
    end if;
  elsif new.manual_check is distinct from old.manual_check and not public.is_marvin() then
    raise exception 'Only Marvin can change the manual check' using errcode = '42501';
  end if;
  if new.domain_status = 'VERIFIED' and nullif(trim(coalesce(new.domain_proof_url, '')), '') is null then
    raise exception 'domain_status VERIFIED needs a domain_proof_url' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_lead_quality on public.leads;
create trigger trg_guard_lead_quality
  before insert or update on public.leads
  for each row execute function public.guard_lead_quality();

-- Drafts: recipient required on new drafts and locked once submitted.
create or replace function public.guard_draft() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_batch batch_status;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'ready') or new.batch_id is not null then
      raise exception 'New drafts start as draft/ready outside any batch (use create_draft, then submit_draft_batch)'
        using errcode = '42501';
    end if;
    if nullif(trim(coalesce(new.recipient, '')), '') is null then
      raise exception 'Drafts need a recipient (email, @handle, contact-form URL or phone)' using errcode = '23514';
    end if;
    return new;
  end if;

  -- What Marvin reviewed is what goes out: content and recipient are frozen once submitted.
  if old.status in ('in_batch', 'approved', 'sent')
     and (new.lead_id, new.channel, new.language, new.subject, new.body, new.personalisation, new.recipient)
         is distinct from (old.lead_id, old.channel, old.language, old.subject, old.body, old.personalisation, old.recipient) then
    raise exception 'Draft % is %: its content is locked. Write a new draft instead.', old.id, old.status
      using errcode = '42501';
  end if;
  if old.status in ('approved', 'sent') and new.batch_id is distinct from old.batch_id then
    raise exception 'Draft % is %: it cannot be moved to another batch', old.id, old.status using errcode = '42501';
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  if old.status = 'sent' then
    raise exception 'Draft % was already sent; sent drafts are final', old.id using errcode = '42501';
  end if;

  if new.status = 'approved' and not public.is_admin() then
    raise exception 'Only Letty (or Top G on her behalf) can approve or reject outreach' using errcode = '42501';
  end if;
  if new.status = 'rejected' and not public.is_admin()
     and coalesce(current_setting('squad.dnc_cleanup', true), '') <> 'on' then
    raise exception 'Only Letty (or Top G on her behalf) can approve or reject outreach' using errcode = '42501';
  end if;

  if new.status = 'sent' then
    select b.status into v_batch from public.approval_batches b where b.id = new.batch_id;
    if old.status <> 'approved' or v_batch is null or v_batch not in ('approved', 'partially_approved') then
      raise exception 'Draft % cannot be sent: it is not approved in an approved batch', new.id;
    end if;
  end if;
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- #1 Delete a lead (Marvin only)
-- -----------------------------------------------------------------------------
create or replace function public.delete_lead(p_lead_id uuid, p_confirm text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me text := public.current_agent();
  l record; v_code text; v_snapshot jsonb; v_company_left boolean := false;
begin
  if not public.is_marvin() then
    raise exception 'Only Marvin can delete leads (others: mark the lead lost instead)' using errcode = '42501';
  end if;
  select * into l from public.leads where id = p_lead_id for update;
  if l is null then raise exception 'Lead % not found', p_lead_id; end if;
  v_code := 'SQ-' || l.ref;
  if coalesce(trim(p_confirm), '') <> v_code then
    raise exception 'Confirmation does not match: type the lead code % to delete it', v_code;
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'p_reason is required'; end if;
  if exists (select 1 from public.deals d where d.lead_id = l.id and d.status = 'signed')
     or exists (select 1 from public.projects p where p.lead_id = l.id) then
    raise exception '% has a signed deal or a project; it cannot be deleted (mark it lost instead)', v_code;
  end if;

  v_snapshot := public.get_lead_context(l.id);
  -- audit entry first; its lead_id becomes NULL when the lead row goes, the snapshot stays
  perform public.log_activity('delete_lead', 'lead', l.id, l.id,
    format('Deleted %s %s: %s', v_code, coalesce(public._lead_name(l.id), ''), p_reason),
    jsonb_build_object('reason', p_reason, 'snapshot', v_snapshot));

  delete from public.leads where id = l.id;
  -- remove the company too when no other lead uses it (contacts cascade)
  if not exists (select 1 from public.leads where company_id = l.company_id)
     and not exists (select 1 from public.projects where company_id = l.company_id)
     and not exists (select 1 from public.care_subscriptions where company_id = l.company_id) then
    delete from public.companies where id = l.company_id;
  else
    v_company_left := true;
  end if;
  return jsonb_build_object('status', 'deleted', 'code', v_code, 'company_kept', v_company_left);
end $$;

-- -----------------------------------------------------------------------------
-- #3 Holds, #5 manual check, #6 relations
-- -----------------------------------------------------------------------------
create or replace function public.set_lead_hold(p_lead_id uuid, p_on_hold boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana');
begin
  if p_on_hold and coalesce(trim(p_reason), '') = '' then
    raise exception 'p_reason is required when putting a lead on hold';
  end if;
  update public.leads set on_hold = p_on_hold,
         hold_reason = case when p_on_hold then p_reason else null end,
         held_at = case when p_on_hold then now() end,
         held_by = case when p_on_hold then me end
   where id = p_lead_id;
  if not found then raise exception 'Lead % not found', p_lead_id; end if;
  perform public.log_activity(case when p_on_hold then 'hold_lead' else 'release_lead' end, 'lead', p_lead_id, p_lead_id,
    format('%s %s%s', public._lead_name(p_lead_id), case when p_on_hold then 'put on hold' else 'released from hold' end,
           coalesce(': ' || p_reason, '')), jsonb_build_object('on_hold', p_on_hold, 'reason', p_reason));
  return jsonb_build_object('status', case when p_on_hold then 'on_hold' else 'released' end, 'lead_id', p_lead_id);
end $$;

create or replace function public.set_draft_hold(p_draft_id uuid, p_on_hold boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); d record;
begin
  select * into d from public.outreach_drafts where id = p_draft_id;
  if d is null then raise exception 'Draft % not found', p_draft_id; end if;
  if d.status not in ('draft', 'ready') then
    raise exception 'Only drafts that are not yet in a batch can be held (this one is %)', d.status;
  end if;
  if p_on_hold and coalesce(trim(p_reason), '') = '' then
    raise exception 'p_reason is required when putting a draft on hold';
  end if;
  update public.outreach_drafts set on_hold = p_on_hold, hold_reason = case when p_on_hold then p_reason end
   where id = p_draft_id;
  perform public.log_activity(case when p_on_hold then 'hold_draft' else 'release_draft' end, 'draft', p_draft_id, d.lead_id,
    format('Draft for %s %s%s', public._lead_name(d.lead_id), case when p_on_hold then 'put on hold' else 'released' end,
           coalesce(': ' || p_reason, '')), '{}');
  return jsonb_build_object('status', case when p_on_hold then 'on_hold' else 'released' end, 'draft_id', p_draft_id);
end $$;

create or replace function public.set_manual_check(p_lead_id uuid, p_result text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_res text := upper(trim(coalesce(p_result, '')));
begin
  if not public.is_marvin() then
    raise exception 'Only Marvin can set the manual check' using errcode = '42501';
  end if;
  if v_res not in ('PASS', 'FAIL', 'PENDING') then
    raise exception 'p_result must be PASS, FAIL or PENDING';
  end if;
  update public.leads set manual_check = v_res, manual_check_note = p_note,
         manual_check_by = 'marvin', manual_check_at = now()
   where id = p_lead_id;
  if not found then raise exception 'Lead % not found', p_lead_id; end if;
  perform public.log_activity('set_manual_check', 'lead', p_lead_id, p_lead_id,
    format('Manual check %s on %s%s', v_res, public._lead_name(p_lead_id), coalesce(': ' || p_note, '')),
    jsonb_build_object('result', v_res, 'note', p_note));
  return jsonb_build_object('status', v_res, 'lead_id', p_lead_id);
end $$;

-- Links two leads in BOTH directions in one transaction and freezes both.
create or replace function public.link_leads(p_lead_a uuid, p_lead_b uuid, p_relation text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana'); v_group uuid := gen_random_uuid();
begin
  if p_relation not in ('duplicate', 'sister', 'rename') then
    raise exception 'p_relation must be duplicate, sister or rename';
  end if;
  if p_lead_a = p_lead_b then raise exception 'A lead cannot be linked to itself'; end if;
  if (select count(*) from public.leads where id in (p_lead_a, p_lead_b)) <> 2 then
    raise exception 'Both leads must exist';
  end if;
  select group_id into v_group from public.lead_relations
   where lead_a = p_lead_a and lead_b = p_lead_b and relation = p_relation;
  v_group := coalesce(v_group, gen_random_uuid());
  insert into public.lead_relations (group_id, lead_a, lead_b, relation, status, note, created_by)
  values (v_group, p_lead_a, p_lead_b, p_relation, 'frozen', p_note, me),
         (v_group, p_lead_b, p_lead_a, p_relation, 'frozen', p_note, me)
  on conflict (lead_a, lead_b, relation) do update
    set status = 'frozen', note = coalesce(excluded.note, lead_relations.note),
        cleared_by = null, cleared_at = null, cleared_note = null;
  perform public.log_activity('link_leads', 'lead', p_lead_a, p_lead_a,
    format('%s ↔ %s linked as %s and frozen%s', public._lead_name(p_lead_a), public._lead_name(p_lead_b), p_relation,
           coalesce(': ' || p_note, '')),
    jsonb_build_object('lead_b', p_lead_b, 'relation', p_relation, 'group_id', v_group));
  return jsonb_build_object('status', 'frozen', 'group_id', v_group, 'leads', jsonb_build_array(p_lead_a, p_lead_b));
end $$;

create or replace function public.clear_lead_link(p_lead_a uuid, p_lead_b uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_marvin() then
    raise exception 'Only Marvin can clear a duplicate/sister link' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'p_note is required (what did you decide?)'; end if;
  update public.lead_relations set status = 'cleared', cleared_by = 'marvin', cleared_at = now(), cleared_note = p_note
   where status = 'frozen' and ((lead_a = p_lead_a and lead_b = p_lead_b) or (lead_a = p_lead_b and lead_b = p_lead_a));
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No frozen link between these two leads'; end if;
  perform public.log_activity('clear_lead_link', 'lead', p_lead_a, p_lead_a,
    format('%s ↔ %s link cleared: %s', public._lead_name(p_lead_a), public._lead_name(p_lead_b), p_note),
    jsonb_build_object('lead_b', p_lead_b));
  return jsonb_build_object('status', 'cleared', 'rows', n,
    'still_frozen', jsonb_build_object('a', public.lead_is_frozen(p_lead_a), 'b', public.lead_is_frozen(p_lead_b)));
end $$;

-- -----------------------------------------------------------------------------
-- #8 Stale leads
-- -----------------------------------------------------------------------------
create or replace function public.stale_leads(p_days int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', l.id, 'code', 'SQ-' || l.ref, 'business', c.name, 'stage', l.stage,
           'last_verified_at', l.last_verified_at, 'domain_status', l.domain_status)
         order by l.last_verified_at nulls first), '[]')
  from public.leads l join public.companies c on c.id = l.company_id
  where public.is_member()
    and l.stage not in ('lost', 'do_not_contact')
    and (l.last_verified_at is null or l.last_verified_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 0)))
$$;

-- -----------------------------------------------------------------------------
-- Duplicate check now also matches on address (#2)
-- -----------------------------------------------------------------------------
drop function if exists public.find_duplicate_leads(text, text, text, text, text);
create function public.find_duplicate_leads(
  p_business text default null, p_email text default null, p_phone text default null,
  p_website text default null, p_instagram text default null,
  p_street text default null, p_city text default null
) returns jsonb
language sql stable security definer set search_path = public as $$
  with q as (
    select public.norm_text(p_business) as b, public.norm_domain(p_website) as d,
           public.norm_handle(p_instagram) as ig, nullif(lower(trim(p_email)), '') as e,
           public.norm_phone(p_phone) as ph,
           case when nullif(trim(p_street), '') is null then null
                else public.norm_text(p_street) || '@' || coalesce(public.norm_text(p_city), '') end as addr
  ),
  cand as (
    select c.id from public.companies c, q where c.name_norm = q.b
    union
    select c.id from public.companies c, q
     where length(q.b) >= 6 and length(c.name_norm) >= 6
       and (position(q.b in c.name_norm) > 0 or position(c.name_norm in q.b) > 0)
    union
    select c.id from public.companies c, q where c.domain_norm = q.d
    union
    select c.id from public.companies c, q where c.instagram_norm = q.ig
    union
    select c.id from public.companies c, q where c.address_norm = q.addr
    union
    select k.company_id from public.contacts k, q where k.email_norm = q.e
    union
    select k.company_id from public.contacts k, q where k.phone_norm = q.ph
  ),
  hits as (
    select l.id as lead_id, 'SQ-' || l.ref as code, c.name as business, l.stage::text as stage,
           array_remove(array[
             case when c.name_norm = q.b then 'business name'
                  when length(q.b) >= 6 and length(c.name_norm) >= 6
                       and (position(q.b in c.name_norm) > 0 or position(c.name_norm in q.b) > 0) then 'similar name' end,
             case when c.domain_norm is not null and c.domain_norm = q.d then 'website' end,
             case when c.instagram_norm is not null and c.instagram_norm = q.ig then 'instagram' end,
             case when c.address_norm is not null and c.address_norm = q.addr then 'address' end,
             case when exists (select 1 from public.contacts k where k.company_id = c.id and k.email_norm = q.e) then 'email' end,
             case when exists (select 1 from public.contacts k where k.company_id = c.id and k.phone_norm = q.ph) then 'phone' end
           ], null) as matched_on
    from cand join public.companies c on c.id = cand.id
    join public.leads l on l.company_id = c.id
    cross join q
  )
  select coalesce(jsonb_agg(to_jsonb(h)), '[]') from hits h where cardinality(h.matched_on) > 0 and public.is_member()
$$;

-- -----------------------------------------------------------------------------
-- Field whitelists (#7 #11 #12) used by create_lead / update_* functions
-- -----------------------------------------------------------------------------
create or replace function public._apply_company_details(p_company_id uuid, f jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text; v_now timestamptz := now();
begin
  if f is null or f = '{}'::jsonb then return; end if;
  for v_key in select jsonb_object_keys(f) loop
    if v_key not in ('street', 'city', 'region', 'postcode', 'country', 'website', 'instagram', 'industry', 'notes',
                 'contact_form_url', 'contact_form_source_url', 'contact_form_checked_at',
                 'instagram_source_url', 'instagram_checked_at',
                 'facebook_url', 'tiktok_url', 'linkedin_url', 'socials_source_url', 'socials_checked_at',
                 'whatsapp', 'whatsapp_source_url', 'whatsapp_checked_at',
                 'telegram', 'telegram_source_url', 'telegram_checked_at',
                 'review_count', 'rating', 'rating_source', 'rating_source_url', 'rating_checked_at',
                 'site_language', 'site_language_source_url', 'site_language_checked_at',
                 'owner_name', 'owner_role', 'owner_source_url', 'owner_checked_at') then
      raise exception 'Unknown company field "%"', v_key;
    end if;
  end loop;
  if f ? 'city' or f ? 'country' then
    if public.is_excluded_region(coalesce(f->>'city', (select city from public.companies where id = p_company_id)),
                                 coalesce(f->>'country', (select country from public.companies where id = p_company_id))) then
      raise exception 'Santa Cruz de la Sierra leads are not stored in the CRM';
    end if;
  end if;
  update public.companies c set
    street   = coalesce(f->>'street', c.street),
    city     = coalesce(f->>'city', c.city),
    region   = coalesce(f->>'region', c.region),
    postcode = coalesce(f->>'postcode', c.postcode),
    country  = coalesce(f->>'country', c.country),
    website  = coalesce(f->>'website', c.website),
    instagram = coalesce(f->>'instagram', c.instagram),
    industry = coalesce(f->>'industry', c.industry),
    notes    = coalesce(f->>'notes', c.notes),
    contact_form_url        = coalesce(f->>'contact_form_url', c.contact_form_url),
    contact_form_source_url = coalesce(f->>'contact_form_source_url', c.contact_form_source_url),
    contact_form_checked_at = coalesce((f->>'contact_form_checked_at')::timestamptz,
                                case when f ?| array['contact_form_url', 'contact_form_source_url'] then v_now end, c.contact_form_checked_at),
    instagram_source_url = coalesce(f->>'instagram_source_url', c.instagram_source_url),
    instagram_checked_at = coalesce((f->>'instagram_checked_at')::timestamptz,
                             case when f ?| array['instagram', 'instagram_source_url'] then v_now end, c.instagram_checked_at),
    facebook_url = coalesce(f->>'facebook_url', c.facebook_url),
    tiktok_url   = coalesce(f->>'tiktok_url', c.tiktok_url),
    linkedin_url = coalesce(f->>'linkedin_url', c.linkedin_url),
    socials_source_url = coalesce(f->>'socials_source_url', c.socials_source_url),
    socials_checked_at = coalesce((f->>'socials_checked_at')::timestamptz,
                           case when f ?| array['facebook_url', 'tiktok_url', 'linkedin_url', 'socials_source_url'] then v_now end, c.socials_checked_at),
    whatsapp            = coalesce(f->>'whatsapp', c.whatsapp),
    whatsapp_source_url = coalesce(f->>'whatsapp_source_url', c.whatsapp_source_url),
    whatsapp_checked_at = coalesce((f->>'whatsapp_checked_at')::timestamptz,
                            case when f ?| array['whatsapp', 'whatsapp_source_url'] then v_now end, c.whatsapp_checked_at),
    telegram            = coalesce(f->>'telegram', c.telegram),
    telegram_source_url = coalesce(f->>'telegram_source_url', c.telegram_source_url),
    telegram_checked_at = coalesce((f->>'telegram_checked_at')::timestamptz,
                            case when f ?| array['telegram', 'telegram_source_url'] then v_now end, c.telegram_checked_at),
    review_count      = coalesce((f->>'review_count')::int, c.review_count),
    rating            = coalesce((f->>'rating')::numeric, c.rating),
    rating_source     = coalesce(f->>'rating_source', c.rating_source),
    rating_source_url = coalesce(f->>'rating_source_url', c.rating_source_url),
    rating_checked_at = coalesce((f->>'rating_checked_at')::timestamptz,
                          case when f ?| array['rating', 'review_count', 'rating_source_url'] then v_now end, c.rating_checked_at),
    site_language            = coalesce(f->>'site_language', c.site_language),
    site_language_source_url = coalesce(f->>'site_language_source_url', c.site_language_source_url),
    site_language_checked_at = coalesce((f->>'site_language_checked_at')::timestamptz,
                                 case when f ?| array['site_language', 'site_language_source_url'] then v_now end, c.site_language_checked_at),
    owner_name       = coalesce(f->>'owner_name', c.owner_name),
    owner_role       = coalesce(f->>'owner_role', c.owner_role),
    owner_source_url = coalesce(f->>'owner_source_url', c.owner_source_url),
    owner_checked_at = coalesce((f->>'owner_checked_at')::timestamptz,
                         case when f ?| array['owner_name', 'owner_role', 'owner_source_url'] then v_now end, c.owner_checked_at)
  where c.id = p_company_id;
end $$;

create or replace function public._apply_contact_details(p_contact_id uuid, f jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_key text; v_now timestamptz := now();
begin
  if p_contact_id is null or f is null or f = '{}'::jsonb then return; end if;
  for v_key in select jsonb_object_keys(f) loop
    if v_key not in ('full_name', 'role', 'email', 'phone', 'email_source_url', 'email_checked_at',
                 'phone_source_url', 'phone_checked_at') then
      raise exception 'Unknown contact field "%"', v_key;
    end if;
  end loop;
  update public.contacts k set
    full_name = coalesce(f->>'full_name', k.full_name),
    role      = coalesce(f->>'role', k.role),
    email     = coalesce(f->>'email', k.email),
    phone     = coalesce(f->>'phone', k.phone),
    email_source_url = coalesce(f->>'email_source_url', k.email_source_url),
    email_checked_at = coalesce((f->>'email_checked_at')::timestamptz,
                         case when f ?| array['email', 'email_source_url'] then v_now end, k.email_checked_at),
    phone_source_url = coalesce(f->>'phone_source_url', k.phone_source_url),
    phone_checked_at = coalesce((f->>'phone_checked_at')::timestamptz,
                         case when f ?| array['phone', 'phone_source_url'] then v_now end, k.phone_checked_at)
  where k.id = p_contact_id;
end $$;

-- lead evidence fields (#7, #8); touching any evidence field refreshes last_verified_at
create or replace function public._apply_lead_evidence(p_lead_id uuid, f jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_touch boolean;
begin
  if f is null or f = '{}'::jsonb then return; end if;
  if f ? 'domain_status' and upper(f->>'domain_status') not in ('VERIFIED', 'NSC', 'UNVERIFIED') then
    raise exception 'domain_status must be VERIFIED, NSC or UNVERIFIED';
  end if;
  if f ? 'website_problem_type' and (f->>'website_problem_type') not in ('outdated', 'non_mobile', 'no_site') then
    raise exception 'website_problem_type must be outdated, non_mobile or no_site';
  end if;
  v_touch := f ?| array['domain_status', 'domain_proof_url', 'website_problem_type', 'operating_evidence_date',
                        'evidence_checked_at', 'phone_source_url'];
  update public.leads l set
    domain_status           = coalesce(upper(f->>'domain_status'), l.domain_status),
    domain_proof_url        = coalesce(f->>'domain_proof_url', l.domain_proof_url),
    website_problem_type    = coalesce(f->>'website_problem_type', l.website_problem_type),
    operating_evidence_date = coalesce((f->>'operating_evidence_date')::date, l.operating_evidence_date),
    evidence_checked_at     = coalesce((f->>'evidence_checked_at')::timestamptz, case when v_touch then now() end, l.evidence_checked_at),
    phone_source_url        = coalesce(f->>'phone_source_url', l.phone_source_url),
    last_verified_at        = coalesce((f->>'last_verified_at')::timestamptz, case when v_touch then now() end, l.last_verified_at),
    source_key              = coalesce(f->>'source_key', l.source_key)
  where l.id = p_lead_id;
end $$;

-- -----------------------------------------------------------------------------
-- create_lead: address, evidence/contact details, hold, source tracking,
-- Santa Cruz exclusion
-- -----------------------------------------------------------------------------
drop function if exists public.create_lead(text, text, text, text, text, text, text, text, text, text, text[], text, text,
                                           text[], text, outreach_channel, text, text, boolean);
create function public.create_lead(
  p_business         text,
  p_contact_name     text default null,
  p_email            text default null,
  p_phone            text default null,
  p_website          text default null,
  p_instagram        text default null,
  p_industry         text default null,
  p_city             text default null,
  p_country          text default null,
  p_market           text default 'US',
  p_service_interest text[] default '{}',
  p_budget_band      text default 'unknown',
  p_timeline         text default null,
  p_languages        text[] default '{es}',
  p_source           text default null,
  p_channel          outreach_channel default null,
  p_portfolio_case   text default null,
  p_notes            text default null,
  p_force            boolean default false,
  p_street           text default null,
  p_region           text default null,
  p_postcode         text default null,
  p_hold             boolean default false,
  p_hold_reason      text default null,
  p_source_key       text default null,
  p_import_batch_id  uuid default null,
  p_details          jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('hunter');
  v_dnc jsonb; v_dupes jsonb;
  v_company uuid; v_contact uuid; v_lead uuid; v_ref bigint;
  d jsonb := coalesce(p_details, '{}');
  v_company_f jsonb; v_contact_f jsonb; v_lead_f jsonb;
begin
  if coalesce(trim(p_business), '') = '' then
    raise exception 'p_business is required';
  end if;
  if public.is_excluded_region(p_city, p_country) then
    -- out of scope: nothing is stored or logged about this business
    return jsonb_build_object('status', 'excluded_region', 'created', false,
      'message', 'Santa Cruz de la Sierra leads are never stored in the CRM.');
  end if;
  if p_hold and coalesce(trim(p_hold_reason), '') = '' then
    raise exception 'p_hold_reason is required when creating a held lead';
  end if;

  -- split p_details into company / contact / lead fields (unknown keys are refused)
  v_company_f := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(d)
                   where key in ('contact_form_url', 'contact_form_source_url', 'contact_form_checked_at',
                                 'instagram_source_url', 'instagram_checked_at', 'facebook_url', 'tiktok_url', 'linkedin_url',
                                 'socials_source_url', 'socials_checked_at', 'whatsapp', 'whatsapp_source_url', 'whatsapp_checked_at',
                                 'telegram', 'telegram_source_url', 'telegram_checked_at', 'review_count', 'rating',
                                 'rating_source', 'rating_source_url', 'rating_checked_at', 'site_language',
                                 'site_language_source_url', 'site_language_checked_at', 'owner_name', 'owner_role',
                                 'owner_source_url', 'owner_checked_at'));
  v_contact_f := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(d)
                   where key in ('email_source_url', 'email_checked_at', 'contact_phone_source_url', 'phone_checked_at', 'contact_role'));
  v_lead_f := (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(d)
                where key in ('domain_status', 'domain_proof_url', 'website_problem_type', 'operating_evidence_date',
                              'evidence_checked_at', 'phone_source_url', 'last_verified_at'));
  if (select count(*) from jsonb_object_keys(d)) <>
     (select count(*) from jsonb_object_keys(v_company_f)) + (select count(*) from jsonb_object_keys(v_contact_f))
     + (select count(*) from jsonb_object_keys(v_lead_f)) then
    raise exception 'p_details has unknown keys: %',
      (select string_agg(k, ', ') from jsonb_object_keys(d) k
        where not (v_company_f ? k or v_contact_f ? k or v_lead_f ? k));
  end if;

  v_dnc := public.check_do_not_contact(p_business, p_email, p_phone, p_website, p_instagram);
  if jsonb_array_length(v_dnc) > 0 then
    perform public.log_activity('create_lead_blocked', 'lead', null, null,
      format('Blocked lead "%s": on do-not-contact list', p_business), jsonb_build_object('matches', v_dnc));
    return jsonb_build_object('status', 'do_not_contact', 'created', false, 'matches', v_dnc,
      'message', 'This business is on the do-not-contact list. Do not create or contact it.');
  end if;

  v_dupes := public.find_duplicate_leads(p_business, p_email, p_phone, p_website, p_instagram, p_street, p_city);
  if jsonb_array_length(v_dupes) > 0 and not p_force then
    return jsonb_build_object('status', 'duplicate', 'created', false, 'matches', v_dupes,
      'message', 'Possible duplicate (held leads included). Review matches; call again with p_force => true only if it is genuinely a different business.');
  end if;

  insert into public.companies (name, website, instagram, industry, city, country, market_code, notes, created_by,
                                street, region, postcode)
  values (trim(p_business), p_website, p_instagram, p_industry, p_city, p_country, upper(p_market), p_notes, me,
          p_street, p_region, p_postcode)
  returning id into v_company;
  perform public._apply_company_details(v_company, v_company_f);

  if coalesce(p_contact_name, p_email, p_phone) is not null then
    insert into public.contacts (company_id, full_name, email, phone, languages, created_by, role)
    values (v_company, coalesce(p_contact_name, 'Unknown contact'), p_email, p_phone, coalesce(p_languages, '{}'), me,
            v_contact_f->>'contact_role')
    returning id into v_contact;
    perform public._apply_contact_details(v_contact,
      (v_contact_f - 'contact_role' - 'contact_phone_source_url')
      || case when v_contact_f ? 'contact_phone_source_url'
              then jsonb_build_object('phone_source_url', v_contact_f->>'contact_phone_source_url') else '{}' end
      || case when p_email is not null and not v_contact_f ? 'email_checked_at' and v_contact_f ? 'email_source_url'
              then jsonb_build_object('email_checked_at', now()) else '{}' end);
  end if;

  perform set_config('squad.reason', coalesce(case when p_hold then 'Held: ' || p_hold_reason end,
                                              'Found via ' || p_source, 'Lead created'), true);
  insert into public.leads (company_id, contact_id, stage, industry, service_interest, market_code, budget_band,
                            timeline, languages, source, channel, portfolio_case, owner_agent, created_by,
                            hold_reason, held_at, held_by, source_key, import_batch_id)
  values (v_company, v_contact, case when p_hold then 'held' else 'found' end::pipeline_stage, p_industry,
          coalesce(p_service_interest, '{}'), upper(p_market),
          coalesce(p_budget_band, 'unknown'), p_timeline, coalesce(p_languages, '{}'), p_source, p_channel,
          p_portfolio_case, case when p_hold then 'hunter' else 'jordan' end, me,
          case when p_hold then p_hold_reason end, case when p_hold then now() end, case when p_hold then me end,
          p_source_key, p_import_batch_id)
  returning id, ref into v_lead, v_ref;
  perform set_config('squad.reason', '', true);
  perform public._apply_lead_evidence(v_lead, v_lead_f);

  perform public.log_activity('create_lead', 'lead', v_lead, v_lead,
    format('Created %slead SQ-%s %s (%s, %s)', case when p_hold then 'held ' else '' end, v_ref, p_business,
           coalesce(p_industry, 'industry n/a'), upper(p_market)),
    jsonb_build_object('source', p_source, 'channel', p_channel, 'source_key', p_source_key,
                       'import_batch_id', p_import_batch_id, 'held', p_hold,
                       'forced_despite_duplicates', case when jsonb_array_length(v_dupes) > 0 then v_dupes end));

  return jsonb_build_object('status', 'created', 'created', true, 'lead_id', v_lead, 'code', 'SQ-' || v_ref,
                            'stage', case when p_hold then 'held' else 'found' end,
                            'company_id', v_company, 'contact_id', v_contact,
                            'possible_duplicates', v_dupes);
end $$;

-- -----------------------------------------------------------------------------
-- Bulk upload: import batch record (#10) + new fields
-- -----------------------------------------------------------------------------
drop function if exists public.create_leads_bulk(jsonb, boolean);
create function public.create_leads_bulk(p_leads jsonb, p_force boolean default false,
                                         p_source_file text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('hunter');
  v_max constant int := 100;
  r jsonb; v_res jsonb; v_out jsonb := '[]'; i int := 0;
  n_created int := 0; n_dup int := 0; n_dnc int := 0; n_err int := 0; n_excl int := 0;
  v_services text[]; v_langs text[]; v_batch uuid; v_batch_ref bigint;
  core constant text[] := array['business', 'contact_name', 'email', 'phone', 'website', 'instagram', 'industry', 'city',
    'country', 'market', 'service_interest', 'budget_band', 'timeline', 'languages', 'source', 'channel',
    'portfolio_case', 'notes', 'force', 'street', 'region', 'postcode', 'hold', 'hold_reason', 'source_key'];
begin
  if p_leads is null or jsonb_typeof(p_leads) <> 'array' then
    raise exception 'p_leads must be a JSON array of lead objects';
  end if;
  if jsonb_array_length(p_leads) = 0 then
    raise exception 'p_leads is empty';
  end if;
  if jsonb_array_length(p_leads) > v_max then
    raise exception 'Too many leads in one call (% > %). Send them in chunks of % or fewer.',
      jsonb_array_length(p_leads), v_max, v_max;
  end if;

  insert into public.import_batches (source_file, note, created_by) values (p_source_file, p_note, me)
  returning id, ref into v_batch, v_batch_ref;

  for r in select value from jsonb_array_elements(p_leads) loop
    i := i + 1;
    begin
      if jsonb_typeof(r) <> 'object' then
        raise exception 'row is not a JSON object';
      end if;
      v_services := case jsonb_typeof(r->'service_interest')
                      when 'array' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(r->'service_interest') x)
                      when 'string' then string_to_array(regexp_replace(r->>'service_interest', '\s*,\s*', ',', 'g'), ',')
                      else '{}' end;
      v_langs := case jsonb_typeof(r->'languages')
                   when 'array' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(r->'languages') x)
                   when 'string' then string_to_array(regexp_replace(r->>'languages', '\s*,\s*', ',', 'g'), ',')
                   else '{es}' end;

      v_res := public.create_lead(
        p_business         => r->>'business',
        p_contact_name     => nullif(trim(r->>'contact_name'), ''),
        p_email            => nullif(trim(r->>'email'), ''),
        p_phone            => nullif(trim(r->>'phone'), ''),
        p_website          => nullif(trim(r->>'website'), ''),
        p_instagram        => nullif(trim(r->>'instagram'), ''),
        p_industry         => nullif(trim(r->>'industry'), ''),
        p_city             => nullif(trim(r->>'city'), ''),
        p_country          => nullif(trim(r->>'country'), ''),
        p_market           => coalesce(nullif(trim(r->>'market'), ''), 'US'),
        p_service_interest => v_services,
        p_budget_band      => coalesce(nullif(trim(r->>'budget_band'), ''), 'unknown'),
        p_timeline         => nullif(trim(r->>'timeline'), ''),
        p_languages        => v_langs,
        p_source           => nullif(trim(r->>'source'), ''),
        p_channel          => nullif(lower(trim(r->>'channel')), '')::outreach_channel,
        p_portfolio_case   => nullif(trim(r->>'portfolio_case'), ''),
        p_notes            => nullif(trim(r->>'notes'), ''),
        p_force            => coalesce((r->>'force')::boolean, p_force),
        p_street           => nullif(trim(r->>'street'), ''),
        p_region           => nullif(trim(r->>'region'), ''),
        p_postcode         => nullif(trim(r->>'postcode'), ''),
        p_hold             => coalesce((r->>'hold')::boolean, false),
        p_hold_reason      => nullif(trim(r->>'hold_reason'), ''),
        p_source_key       => nullif(trim(r->>'source_key'), ''),
        p_import_batch_id  => v_batch,
        p_details          => (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(r)
                                where not (key = any(core)) and value <> 'null'::jsonb));

      case v_res->>'status'
        when 'created'         then n_created := n_created + 1;
        when 'duplicate'       then n_dup := n_dup + 1;
        when 'do_not_contact'  then n_dnc := n_dnc + 1;
        when 'excluded_region' then n_excl := n_excl + 1;
        else null;
      end case;
      v_out := v_out || jsonb_build_object('row', i, 'business', r->>'business', 'source_key', r->>'source_key',
        'status', v_res->>'status', 'code', v_res->>'code', 'lead_id', v_res->>'lead_id', 'stage', v_res->>'stage',
        'matches', v_res->'matches');
    exception when others then
      n_err := n_err + 1;
      v_out := v_out || jsonb_build_object('row', i, 'business', r->>'business', 'source_key', r->>'source_key',
        'status', 'error', 'error', sqlerrm);
    end;
  end loop;

  update public.import_batches set rows_total = i, rows_created = n_created, rows_skipped = i - n_created
   where id = v_batch;
  perform public.log_activity('create_leads_bulk', 'import_batch', v_batch, null,
    format('Import #%s%s: %s rows → %s created, %s duplicates, %s do-not-contact, %s out of region, %s errors',
           v_batch_ref, coalesce(' (' || p_source_file || ')', ''), i, n_created, n_dup, n_dnc, n_excl, n_err),
    jsonb_build_object('rows', i, 'created', n_created, 'duplicates', n_dup, 'do_not_contact', n_dnc,
                       'excluded_region', n_excl, 'errors', n_err, 'source_file', p_source_file));

  return jsonb_build_object('status', 'done', 'import_batch_id', v_batch, 'import_ref', v_batch_ref,
                            'total', i, 'created', n_created, 'duplicates', n_dup, 'do_not_contact', n_dnc,
                            'excluded_region', n_excl, 'errors', n_err, 'results', v_out);
end $$;

-- -----------------------------------------------------------------------------
-- update_lead (evidence fields), update_company_details, update_contact_details
-- -----------------------------------------------------------------------------
create or replace function public.update_lead(p_lead_id uuid, p_fields jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana');
  v_key text;
  v_evidence constant text[] := array['domain_status', 'domain_proof_url', 'website_problem_type', 'operating_evidence_date',
                                      'evidence_checked_at', 'phone_source_url', 'last_verified_at', 'source_key'];
begin
  if p_fields ? 'stage' then raise exception 'Use advance_stage to change the stage'; end if;
  if p_fields ? 'manual_check' then raise exception 'Use set_manual_check (Marvin only)'; end if;
  if p_fields ?| array['on_hold', 'hold_reason'] then raise exception 'Use set_lead_hold to hold or release a lead'; end if;
  for v_key in select jsonb_object_keys(p_fields) loop
    if not (v_key = any(v_evidence) or v_key in ('industry', 'service_interest', 'market_code', 'budget_band', 'timeline',
            'languages', 'source', 'channel', 'portfolio_case', 'next_action', 'next_action_at', 'owner_agent')) then
      raise exception 'Unknown lead field "%" (company/contact fields: use update_company_details / update_contact_details)', v_key;
    end if;
  end loop;
  update public.leads l set
    industry         = coalesce(p_fields->>'industry', l.industry),
    service_interest = coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'service_interest') x), l.service_interest),
    market_code      = coalesce(upper(p_fields->>'market_code'), l.market_code),
    budget_band      = coalesce(p_fields->>'budget_band', l.budget_band),
    timeline         = coalesce(p_fields->>'timeline', l.timeline),
    languages        = coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'languages') x), l.languages),
    source           = coalesce(p_fields->>'source', l.source),
    channel          = coalesce((p_fields->>'channel')::outreach_channel, l.channel),
    portfolio_case   = coalesce(p_fields->>'portfolio_case', l.portfolio_case),
    next_action      = coalesce(p_fields->>'next_action', l.next_action),
    next_action_at   = coalesce((p_fields->>'next_action_at')::timestamptz, l.next_action_at),
    owner_agent      = coalesce(p_fields->>'owner_agent', l.owner_agent)
  where l.id = p_lead_id;
  if not found then raise exception 'Lead % not found', p_lead_id; end if;
  perform public._apply_lead_evidence(p_lead_id,
    (select coalesce(jsonb_object_agg(key, value), '{}') from jsonb_each(p_fields) where key = any(v_evidence)));
  perform public.log_activity('update_lead', 'lead', p_lead_id, p_lead_id,
    format('Updated %s (%s)', public._lead_name(p_lead_id),
           (select string_agg(k, ', ') from jsonb_object_keys(p_fields) k)) || coalesce(': ' || p_reason, ''),
    p_fields);
  return jsonb_build_object('status', 'updated', 'lead_id', p_lead_id);
end $$;

create or replace function public.update_company_details(p_company_id uuid, p_fields jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana'); v_lead uuid;
begin
  if not exists (select 1 from public.companies where id = p_company_id) then
    raise exception 'Company % not found', p_company_id;
  end if;
  perform public._apply_company_details(p_company_id, coalesce(p_fields, '{}'));
  select id into v_lead from public.leads where company_id = p_company_id order by created_at limit 1;
  perform public.log_activity('update_company_details', 'company', p_company_id, v_lead,
    format('Updated company details (%s)', (select string_agg(k, ', ') from jsonb_object_keys(p_fields) k))
      || coalesce(': ' || p_reason, ''), p_fields);
  return jsonb_build_object('status', 'updated', 'company_id', p_company_id);
end $$;

create or replace function public.update_contact_details(p_contact_id uuid, p_fields jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana'); v_lead uuid;
begin
  if not exists (select 1 from public.contacts where id = p_contact_id) then
    raise exception 'Contact % not found', p_contact_id;
  end if;
  perform public._apply_contact_details(p_contact_id, coalesce(p_fields, '{}'));
  select l.id into v_lead from public.leads l join public.contacts k on k.company_id = l.company_id
   where k.id = p_contact_id order by l.created_at limit 1;
  perform public.log_activity('update_contact_details', 'contact', p_contact_id, v_lead,
    format('Updated contact details (%s)', (select string_agg(k, ', ') from jsonb_object_keys(p_fields) k))
      || coalesce(': ' || p_reason, ''), p_fields);
  return jsonb_build_object('status', 'updated', 'contact_id', p_contact_id);
end $$;

-- -----------------------------------------------------------------------------
-- Gates: screening (frozen), drafting (all blockers + recipient), batching
-- (held/frozen/unchecked), advance_stage (PASS)
-- -----------------------------------------------------------------------------
create or replace function public.screen_lead(
  p_lead_id        uuid,
  p_passes         boolean,
  p_fit_score      int default null,
  p_notes          text default null,
  p_portfolio_case text default null,
  p_channel        outreach_channel default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); v_stage pipeline_stage;
begin
  select stage into v_stage from public.leads where id = p_lead_id;
  if v_stage is null then raise exception 'Lead % not found', p_lead_id; end if;
  if v_stage not in ('found', 'screened') then
    raise exception 'Lead is at stage %, only found/screened leads can be screened', v_stage;
  end if;
  if public.lead_is_frozen(p_lead_id) then
    raise exception 'Lead is frozen by a duplicate/sister link until Marvin clears it';
  end if;

  update public.leads set fit_score = coalesce(p_fit_score, fit_score),
                          screen_notes = coalesce(p_notes, screen_notes),
                          portfolio_case = coalesce(p_portfolio_case, portfolio_case),
                          channel = coalesce(p_channel, channel),
                          lost_reason = case when p_passes then lost_reason else coalesce(p_notes, 'Failed screening') end
  where id = p_lead_id;

  perform public._move_stage(p_lead_id, case when p_passes then 'screened' else 'lost' end::pipeline_stage,
                             coalesce(p_notes, case when p_passes then 'Passed screening' else 'Failed screening' end));

  perform public.log_activity('screen_lead', 'lead', p_lead_id, p_lead_id,
    format('Screened %s: %s (fit %s)', public._lead_name(p_lead_id),
           case when p_passes then 'pass' else 'reject' end, coalesce(p_fit_score::text, 'n/a')),
    jsonb_build_object('passes', p_passes, 'fit_score', p_fit_score, 'notes', p_notes));
  return jsonb_build_object('status', case when p_passes then 'screened' else 'lost' end, 'lead_id', p_lead_id);
end $$;

drop function if exists public.create_draft(uuid, text, outreach_channel, text, text, text);
create function public.create_draft(
  p_lead_id         uuid,
  p_body            text,
  p_channel         outreach_channel default null,
  p_subject         text default null,
  p_language        text default 'es',
  p_personalisation text default null,
  p_recipient       text default null          -- REQUIRED: email, @handle, contact-form URL or phone
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('jordan');
  v_lead record; v_id uuid; v_dnc jsonb; v_blockers text[]; v_kind text;
  v_recipient text := nullif(trim(coalesce(p_recipient, '')), '');
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead is null then raise exception 'Lead % not found', p_lead_id; end if;
  if v_recipient is null then
    raise exception 'p_recipient is required: the exact email, @handle, contact-form URL or phone this goes to';
  end if;
  v_kind := public.recipient_kind(v_recipient);
  if v_kind is null then
    raise exception 'p_recipient "%" is not an email, @handle, http(s) URL or phone number', v_recipient;
  end if;
  v_dnc := public.lead_dnc_matches(p_lead_id) || public.check_do_not_contact(
             p_email => case when v_kind = 'email' then v_recipient end,
             p_phone => case when v_kind = 'phone' then v_recipient end,
             p_instagram => case when v_kind = 'handle' then v_recipient end,
             p_website => case when v_kind = 'form_url' then v_recipient end);
  if jsonb_array_length(v_dnc) > 0 then
    raise exception 'This contact is on the do-not-contact list (%). Do not write to them.', v_dnc;
  end if;
  v_blockers := public.outreach_blockers(p_lead_id);
  if cardinality(v_blockers) > 0 then
    raise exception 'Cannot draft for this lead: %', array_to_string(v_blockers, '; ');
  end if;
  if coalesce(p_channel, v_lead.channel) is null then
    raise exception 'Channel required (whatsapp, email or instagram)';
  end if;

  insert into public.outreach_drafts (lead_id, channel, subject, body, language, personalisation, status, created_by,
                                      recipient, recipient_kind)
  values (p_lead_id, coalesce(p_channel, v_lead.channel), p_subject, p_body, coalesce(p_language, 'es'),
          p_personalisation, 'ready', me, v_recipient, v_kind)
  returning id into v_id;

  perform public._move_stage(p_lead_id, 'draft_ready', 'Personalised draft written');

  perform public.log_activity('create_draft', 'draft', v_id, p_lead_id,
    format('Draft ready for %s via %s → %s', public._lead_name(p_lead_id), coalesce(p_channel, v_lead.channel), v_recipient),
    jsonb_build_object('language', p_language, 'recipient', v_recipient));
  return jsonb_build_object('status', 'ready', 'draft_id', v_id, 'recipient', v_recipient, 'recipient_kind', v_kind);
end $$;

create or replace function public.submit_draft_batch(p_draft_ids uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); v_batch uuid; v_ref bigint; v_bad int; v_n int; v_problems text;
begin
  if coalesce(cardinality(p_draft_ids), 0) = 0 then raise exception 'p_draft_ids is empty'; end if;

  select count(*) into v_bad from public.outreach_drafts
  where id = any(p_draft_ids) and status not in ('draft', 'ready');
  if v_bad > 0 then raise exception '% draft(s) are not in draft/ready status', v_bad; end if;

  select count(*) into v_n from public.outreach_drafts where id = any(p_draft_ids);
  if v_n <> cardinality(p_draft_ids) then raise exception 'Some draft ids were not found'; end if;

  -- held, frozen, unchecked or recipient-less items never reach Marvin's queue
  select string_agg(format('%s (%s)', coalesce(public._lead_name(d.lead_id), d.id::text),
           array_to_string(
             case when d.on_hold then array[format('draft on hold: %s', coalesce(d.hold_reason, 'no reason'))] else '{}'::text[] end
             || case when nullif(trim(coalesce(d.recipient, '')), '') is null then array['no recipient'] else '{}'::text[] end
             || public.outreach_blockers(d.lead_id), '; ')), ' | ')
    into v_problems
    from public.outreach_drafts d
   where d.id = any(p_draft_ids)
     and (d.on_hold or nullif(trim(coalesce(d.recipient, '')), '') is null
          or cardinality(public.outreach_blockers(d.lead_id)) > 0);
  if v_problems is not null then
    raise exception 'Batch refused, these drafts are blocked: %', v_problems;
  end if;

  insert into public.approval_batches (status, submitted_by, note) values ('pending', me, p_note)
  returning id, ref into v_batch, v_ref;

  update public.outreach_drafts set status = 'in_batch', batch_id = v_batch where id = any(p_draft_ids);

  perform public.log_activity('submit_draft_batch', 'batch', v_batch, null,
    format('Batch #%s submitted for approval (%s drafts)', v_ref, v_n),
    jsonb_build_object('draft_ids', p_draft_ids, 'note', p_note));
  return jsonb_build_object('status', 'pending', 'batch_id', v_batch, 'batch_ref', v_ref, 'drafts', v_n);
end $$;

create or replace function public.advance_stage(p_lead_id uuid, p_to_stage pipeline_stage, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana'); v_from pipeline_stage; v_check text;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'p_reason is required for every stage change'; end if;
  select stage, manual_check into v_from, v_check from public.leads where id = p_lead_id;
  if v_from is null then raise exception 'Lead % not found', p_lead_id; end if;
  if v_from = p_to_stage then return jsonb_build_object('status', 'unchanged', 'stage', v_from); end if;

  -- structural rules first (clearer errors): role, then where the lead is now
  if not (p_to_stage = any(public.allowed_target_stages(me))) then
    raise exception 'Agent % cannot move a lead to stage %', me, p_to_stage using errcode = '42501';
  end if;
  if not public.is_admin() and not (v_from = any(public.stage_predecessors(p_to_stage))) then
    raise exception 'Agent % cannot move a lead from % to % (allowed from: %). Escalate to Top G if this is a correction.',
      me, v_from, p_to_stage, coalesce(nullif(array_to_string(public.stage_predecessors(p_to_stage), ', '), ''), 'no stage')
      using errcode = '42501';
  end if;

  -- Marvin's manual check gates every forward move; parking or closing a lead never needs it
  if p_to_stage not in ('lost', 'do_not_contact', 'held') and v_check <> 'PASS' then
    raise exception 'Marvin''s manual check is %, not PASS: this lead cannot be advanced yet', v_check
      using errcode = '42501';
  end if;
  if p_to_stage not in ('lost', 'do_not_contact', 'held') and public.lead_is_frozen(p_lead_id) then
    raise exception 'Lead is frozen by a duplicate/sister link until Marvin clears it' using errcode = '42501';
  end if;

  if p_to_stage = 'lost' then
    update public.leads set lost_reason = p_reason where id = p_lead_id;
    update public.deals set status = 'lost', lost_reason = p_reason
     where lead_id = p_lead_id and status not in ('signed', 'lost');
  end if;

  perform public._move_stage_strict(p_lead_id, p_to_stage, p_reason);
  return jsonb_build_object('status', 'moved', 'lead_id', p_lead_id, 'from', v_from, 'to', p_to_stage);
end $$;

-- lead context now includes relations and the import record
create or replace function public.get_lead_context(p_lead_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_member() then raise exception 'Not a registered Squad CRM agent' using errcode = '42501'; end if;
  select jsonb_build_object(
    'lead', to_jsonb(l) || jsonb_build_object('code', 'SQ-' || l.ref, 'frozen', public.lead_is_frozen(l.id),
                                              'outreach_blockers', to_jsonb(public.outreach_blockers(l.id))),
    'company', to_jsonb(c),
    'contact', to_jsonb(k),
    'relations', coalesce((select jsonb_agg(jsonb_build_object('lead_id', r.lead_b, 'code', 'SQ-' || lb.ref,
                             'business', cb.name, 'relation', r.relation, 'status', r.status, 'note', r.note,
                             'created_by', r.created_by, 'cleared_note', r.cleared_note) order by r.created_at)
                           from public.lead_relations r join public.leads lb on lb.id = r.lead_b
                           join public.companies cb on cb.id = lb.company_id where r.lead_a = l.id), '[]'),
    'import_batch', (select to_jsonb(ib) from public.import_batches ib where ib.id = l.import_batch_id),
    'stage_history', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.stage_changes s where s.lead_id = l.id), '[]'),
    'drafts', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.outreach_drafts d where d.lead_id = l.id), '[]'),
    'discovery_notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.discovery_notes n where n.lead_id = l.id), '[]'),
    'deals', coalesce((select jsonb_agg(to_jsonb(dl) order by dl.created_at) from public.deals dl where dl.lead_id = l.id), '[]'),
    'proposals', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.proposals p where p.lead_id = l.id), '[]'),
    'open_escalations', coalesce((select jsonb_agg(to_jsonb(e)) from public.escalations e where e.lead_id = l.id and e.status not in ('resolved', 'dismissed')), '[]')
  ) into v
  from public.leads l
  join public.companies c on c.id = l.company_id
  left join public.contacts k on k.id = l.contact_id
  where l.id = p_lead_id;
  if v is null then raise exception 'Lead % not found', p_lead_id; end if;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- Grants (functions are private by default since migration 6)
-- -----------------------------------------------------------------------------
grant execute on function
  public.is_marvin(), public.lead_is_frozen(uuid), public.outreach_blockers(uuid), public.recipient_kind(text),
  public.is_excluded_region(text, text),
  public.delete_lead(uuid, text, text), public.set_lead_hold(uuid, boolean, text), public.set_draft_hold(uuid, boolean, text),
  public.set_manual_check(uuid, text, text), public.link_leads(uuid, uuid, text, text), public.clear_lead_link(uuid, uuid, text),
  public.stale_leads(int), public.find_duplicate_leads(text, text, text, text, text, text, text),
  public.create_lead(text, text, text, text, text, text, text, text, text, text, text[], text, text, text[], text,
                     outreach_channel, text, text, boolean, text, text, text, boolean, text, text, uuid, jsonb),
  public.create_leads_bulk(jsonb, boolean, text, text),
  public.update_company_details(uuid, jsonb, text), public.update_contact_details(uuid, jsonb, text),
  public.create_draft(uuid, text, outreach_channel, text, text, text, text)
to authenticated, service_role;
revoke execute on function public._apply_company_details(uuid, jsonb), public._apply_contact_details(uuid, jsonb),
  public._apply_lead_evidence(uuid, jsonb), public.guard_lead_quality() from public, anon, authenticated;
