-- =============================================================================
-- Squad CRM — identity, guard triggers and Row Level Security
--
-- Every human / agent is a Supabase Auth user linked to a row in public.agents
-- (agents.auth_user_id). Policies resolve the caller with public.current_agent().
--
--   letty  owner        full read/write, only one who edits the catalogue
--   top_g  coordinator  full read/write
--   hunter              create + edit leads, companies, contacts
--   jordan              screen leads, outreach drafts, submit approval batches
--   quinn               discovery notes, deals, proposals
--   dana                scopes, projects, milestones, payments, testimonials,
--                       referrals, care plans, lessons, client clean-up
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity helpers
-- -----------------------------------------------------------------------------
create or replace function public.current_agent() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.code from public.agents a where a.auth_user_id = auth.uid() and a.active),
    -- service_role (server scripts, SQL editor): act as the agent named in
    -- the transaction setting squad.acting_agent, default top_g
    -- (session_user, not current_user: inside a security definer function
    --  current_user is the function owner). A session that switched to the
    --  authenticated/anon role never gets this fallback.
    case when coalesce(auth.role(), '') = 'service_role'
           or (session_user in ('postgres', 'supabase_admin')
               and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon'))
         then coalesce(nullif(current_setting('squad.acting_agent', true), ''), 'top_g') end
  )
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_agent() = any(roles)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_agent() in ('letty', 'top_g')
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_agent() is not null
$$;

-- Raises unless the caller is one of the given agents (admins always pass).
create or replace function public.require_agent(variadic roles text[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare me text := public.current_agent();
begin
  if me is null then
    raise exception 'Not a registered Squad CRM agent' using errcode = '42501';
  end if;
  if me in ('letty', 'top_g') or me = any(roles) then
    return me;
  end if;
  raise exception 'Agent % is not allowed to perform this action (allowed: %, letty, top_g)',
    me, array_to_string(roles, ', ') using errcode = '42501';
end $$;

-- -----------------------------------------------------------------------------
-- Activity log writer (security definer: agents never insert directly)
-- -----------------------------------------------------------------------------
create or replace function public.log_activity(
  p_action text, p_entity_type text, p_entity_id uuid, p_lead_id uuid,
  p_summary text, p_payload jsonb default '{}'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.activity_log (agent_code, action, entity_type, entity_id, lead_id, summary, payload)
  values (public.current_agent(), p_action, p_entity_type, p_entity_id, p_lead_id, p_summary, coalesce(p_payload, '{}'))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.log_activity(text, text, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Stage guard: who may move a lead into which stage, plus mandatory logging
-- -----------------------------------------------------------------------------
create or replace function public.allowed_target_stages(p_agent text) returns pipeline_stage[]
language sql immutable as $$
  select case p_agent
    when 'letty'  then enum_range(null::pipeline_stage)
    when 'top_g'  then enum_range(null::pipeline_stage)
    when 'hunter' then array['found', 'lost', 'do_not_contact']::pipeline_stage[]
    when 'jordan' then array['found', 'screened', 'draft_ready', 'sent', 'replied', 'lost', 'do_not_contact']::pipeline_stage[]
    when 'quinn'  then array['replied', 'discovery', 'proposal', 'signed', 'lost', 'do_not_contact']::pipeline_stage[]
    when 'dana'   then array['signed', 'in_delivery', 'delivered', 'care_plan', 'lost', 'do_not_contact']::pipeline_stage[]
    else array[]::pipeline_stage[]
  end
$$;

create or replace function public.guard_lead_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me text := public.current_agent();
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

  -- Outreach can only be "sent" once an approved draft has actually been sent.
  if new.stage = 'sent' and me not in ('letty', 'top_g') and not exists (
       select 1 from public.outreach_drafts d where d.lead_id = new.id and d.status = 'sent') then
    raise exception 'Lead cannot be marked sent without a sent, batch-approved draft (use log_send)';
  end if;

  new.stage_changed_at := now();

  -- AFTER-style logging done here so the reason travels with the change
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

create trigger trg_guard_lead_stage
  before insert or update of stage on public.leads
  for each row execute function public.guard_lead_stage();

-- Initial stage row for new leads (needs the row to exist → AFTER INSERT)
create or replace function public.log_initial_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.stage_changes (lead_id, from_stage, to_stage, agent_code, reason)
  values (new.id, null, new.stage, public.current_agent(),
          coalesce(nullif(current_setting('squad.reason', true), ''), 'Lead created'));
  return new;
end $$;

create trigger trg_log_initial_stage
  after insert on public.leads
  for each row execute function public.log_initial_stage();

-- -----------------------------------------------------------------------------
-- Draft + batch guards: Jordan can never approve, nothing is sent unapproved
-- -----------------------------------------------------------------------------
create or replace function public.guard_draft() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := public.current_agent(); v_batch batch_status;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status in ('approved', 'rejected') and me not in ('letty', 'top_g') then
    raise exception 'Only Letty (or Top G on her behalf) can approve or reject outreach' using errcode = '42501';
  end if;

  if new.status = 'sent' then
    select b.status into v_batch from public.approval_batches b where b.id = new.batch_id;
    if (tg_op = 'UPDATE' and old.status <> 'approved')
       or v_batch is null or v_batch not in ('approved', 'partially_approved') then
      raise exception 'Draft % cannot be sent: it is not approved in an approved batch', new.id;
    end if;
  end if;
  return new;
end $$;

create trigger trg_guard_draft
  before insert or update of status on public.outreach_drafts
  for each row execute function public.guard_draft();

create or replace function public.guard_batch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and not public.is_admin() then
    raise exception 'Only Letty (or Top G) can decide an approval batch' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_guard_batch
  before update on public.approval_batches
  for each row execute function public.guard_batch();

-- -----------------------------------------------------------------------------
-- Lessons must be anonymised: no client names, emails, phones, URLs
-- -----------------------------------------------------------------------------
create or replace function public.lesson_privacy_issues(p_text text) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_issues text[] := '{}';
  v_hit text;
  v_norm text := public.norm_text(p_text);
begin
  if p_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then
    v_issues := array_append(v_issues, 'contains an email address'::text);
  end if;
  if p_text ~ '\+?\d[\d\s().-]{6,}\d' then
    v_issues := array_append(v_issues, 'contains a phone number'::text);
  end if;
  if p_text ~* '(https?://|www\.)\S+' then
    v_issues := array_append(v_issues, 'contains a URL'::text);
  end if;
  if p_text ~* '@[a-z0-9._]{3,}' then
    v_issues := array_append(v_issues, 'contains a social handle'::text);
  end if;
  for v_hit in
    select c.name from public.companies c
    where length(c.name_norm) >= 4 and position(c.name_norm in v_norm) > 0
    union
    select k.full_name from public.contacts k
    where length(public.norm_text(k.full_name)) >= 6
      and position(public.norm_text(k.full_name) in v_norm) > 0
  loop
    v_issues := array_append(v_issues, format('mentions client "%s"', v_hit)::text);
  end loop;
  return v_issues;
end $$;

create or replace function public.guard_lesson() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_issues text[];
begin
  v_issues := public.lesson_privacy_issues(coalesce(new.title, '') || ' ' || coalesce(new.body, ''));
  if cardinality(v_issues) > 0 then
    raise exception 'Lesson is not anonymised: %', array_to_string(v_issues, '; ')
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger trg_guard_lesson
  before insert or update on public.lessons
  for each row execute function public.guard_lesson();

-- -----------------------------------------------------------------------------
-- Escalations: raised_by is always the caller; only admins resolve
-- -----------------------------------------------------------------------------
create or replace function public.guard_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_admin() then
      new.raised_by := public.current_agent();
      new.status := 'open';
      new.assigned_to := 'top_g';
    end if;
  elsif not public.is_admin() then
    raise exception 'Only Top G or Letty can update escalations' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_guard_escalation
  before insert or update on public.escalations
  for each row execute function public.guard_escalation();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'agents','markets','catalogue_packages','catalogue_package_prices','catalogue_addons',
    'catalogue_care_plans','catalogue_terms','companies','contacts','leads','stage_changes',
    'approval_batches','outreach_drafts','discovery_notes','deals','deal_items','proposals',
    'projects','scopes','milestones','deliverables','payments','escalations','activity_log',
    'lessons','testimonials','referrals','care_subscriptions','care_hours_log','do_not_contact']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- Helper to create the four standard policies quickly.
--   readers: who can select (null = every member)
--   writers: who can insert/update; deleters: who can delete
create or replace function pg_temp.policies(p_table text, p_readers text[], p_writers text[], p_deleters text[])
returns void language plpgsql as $$
declare
  v_read text := case when p_readers is null then 'public.is_member()'
                      else format('(public.is_admin() or public.current_agent() = any(%L::text[]))', p_readers) end;
  v_write text := format('(public.is_admin() or public.current_agent() = any(%L::text[]))', coalesce(p_writers, '{}'));
  v_del text := format('(public.is_admin() or public.current_agent() = any(%L::text[]))', coalesce(p_deleters, '{}'));
begin
  execute format('create policy %I on public.%I for select to authenticated using (%s)', p_table || '_read', p_table, v_read);
  execute format('create policy %I on public.%I for insert to authenticated with check (%s)', p_table || '_insert', p_table, v_write);
  execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', p_table || '_update', p_table, v_write, v_write);
  execute format('create policy %I on public.%I for delete to authenticated using (%s)', p_table || '_delete', p_table, v_del);
end $$;

-- Catalogue: everyone reads, ONLY Letty writes.
do $$
declare t text;
begin
  foreach t in array array['markets','catalogue_packages','catalogue_package_prices','catalogue_addons',
                           'catalogue_care_plans','catalogue_terms']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member())', t || '_read', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                     using (public.current_agent() = 'letty') with check (public.current_agent() = 'letty')$p$,
                   t || '_letty_write', t);
  end loop;
end $$;

-- Agents directory: everyone reads, only Letty edits.
create policy agents_read on public.agents for select to authenticated using (public.is_member());
create policy agents_letty on public.agents for all to authenticated
  using (public.current_agent() = 'letty') with check (public.current_agent() = 'letty');

--                         table             readers  writers                         deleters
do $$ begin
  perform pg_temp.policies('companies',          null, '{hunter,jordan,quinn,dana}',             '{}');
  perform pg_temp.policies('contacts',           null, '{hunter,jordan,quinn,dana}',             '{dana}');
  perform pg_temp.policies('leads',              null, '{hunter,jordan,quinn,dana}',             '{}');
  perform pg_temp.policies('approval_batches',   null, '{jordan}',                               '{}');
  perform pg_temp.policies('outreach_drafts',    null, '{jordan}',                               '{jordan}');
  perform pg_temp.policies('discovery_notes',    null, '{quinn}',                                '{quinn}');
  perform pg_temp.policies('deals',              null, '{quinn}',                                '{}');
  perform pg_temp.policies('deal_items',         null, '{quinn}',                                '{quinn}');
  perform pg_temp.policies('proposals',          null, '{quinn}',                                '{}');
  perform pg_temp.policies('projects',           null, '{dana}',                                 '{}');
  perform pg_temp.policies('scopes',             null, '{dana}',                                 '{}');
  perform pg_temp.policies('milestones',         null, '{dana}',                                 '{dana}');
  perform pg_temp.policies('deliverables',       null, '{dana}',                                 '{dana}');
  perform pg_temp.policies('payments',  '{quinn,dana}', '{dana}',                                '{}');
  perform pg_temp.policies('lessons',            null, '{dana}',                                 '{dana}');
  perform pg_temp.policies('testimonials',       null, '{dana}',                                 '{}');
  perform pg_temp.policies('referrals',          null, '{dana}',                                 '{}');
  perform pg_temp.policies('care_subscriptions', '{dana}', '{dana}',                             '{}');
  perform pg_temp.policies('care_hours_log',     '{dana}', '{dana}',                             '{dana}');
end $$;

-- Do-not-contact: any member can add (safety first); only admins remove.
do $$ begin
  perform pg_temp.policies('do_not_contact', null, '{hunter,jordan,quinn,dana}', '{}');
end $$;

-- Escalations: anyone raises (trigger pins raised_by); only admins update.
create policy escalations_read   on public.escalations for select to authenticated using (public.is_member());
create policy escalations_insert on public.escalations for insert to authenticated with check (public.is_member());
create policy escalations_update on public.escalations for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Append-only audit tables: read for members, writes only through definer functions.
create policy activity_read on public.activity_log  for select to authenticated using (public.is_member());
create policy stages_read   on public.stage_changes for select to authenticated using (public.is_member());
revoke insert, update, delete, truncate on public.activity_log, public.stage_changes from authenticated;

-- Realtime for the live dashboard
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.activity_log, public.leads, public.escalations;
  end if;
end $$;
