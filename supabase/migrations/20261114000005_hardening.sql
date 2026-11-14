-- =============================================================================
-- Squad CRM — hardening (audit fixes)
--
-- 1. Pipeline-critical tables are written ONLY through the RPCs. Agents keep
--    read access (RLS), but lose direct insert/update/delete on leads, drafts,
--    batches, deals, proposals, payments, projects, scopes, care plans and the
--    do-not-contact list. This closes "write the table directly and skip the
--    checks" for every rule at once.
-- 2. Defence in depth for anything that still writes those tables (security
--    definer RPCs, the SQL editor):
--      * approval batches can only be created as 'pending' (non-admins);
--      * drafts are created as draft/ready outside any batch, their content is
--        locked once submitted/approved/sent, and sent drafts are final;
--      * stage moves are checked against where the lead is NOW, not only where
--        it is going (no skipping ahead, no moving backwards, no reviving
--        lost/do-not-contact leads, no losing a signed client) — admins exempt;
--      * the 4-projects-a-month limit is enforced by a trigger with a lock.
-- 3. Do-not-contact is enforced at send time: adding an entry blocks every
--    matching lead and cancels its unsent drafts; create_draft and log_send
--    refuse contacts on the list.
-- 4. sign_deal only signs quoted/proposed deals and supersedes the lead's
--    other open deals.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. No direct writes to pipeline-critical tables
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.leads, public.approval_batches, public.outreach_drafts, public.deals, public.deal_items,
  public.proposals, public.payments, public.projects, public.scopes, public.care_subscriptions,
  public.care_hours_log, public.do_not_contact
from authenticated;

-- -----------------------------------------------------------------------------
-- 2a. Stage transitions: which stages a lead may come FROM for each target
-- -----------------------------------------------------------------------------
create or replace function public.stage_predecessors(p_to pipeline_stage) returns pipeline_stage[]
language sql immutable set search_path = public as $$
  select (case p_to
    when 'found'          then '{}'
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
    -- once a client has signed, only Letty / Top G can mark it lost
    when 'lost'           then '{found,screened,draft_ready,approved,sent,replied,discovery,proposal}'
    -- safety first: anything can become do-not-contact
    when 'do_not_contact' then '{found,screened,draft_ready,approved,sent,replied,discovery,proposal,signed,in_delivery,delivered,care_plan,lost}'
  end)::pipeline_stage[]
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

  if me not in ('letty', 'top_g') then
    if tg_op = 'INSERT' and new.stage <> 'found' then
      raise exception 'New leads start at stage found' using errcode = '42501';
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

  -- Outreach can only be "sent" once an approved draft has actually been sent.
  if new.stage = 'sent' and me not in ('letty', 'top_g') and not exists (
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

-- Strict move: the guard trigger decides, errors propagate (advance_stage, sign_deal).
create or replace function public._move_stage_strict(p_lead_id uuid, p_stage pipeline_stage, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('squad.reason', coalesce(p_reason, ''), true);
  update public.leads set stage = p_stage where id = p_lead_id and stage is distinct from p_stage;
  perform set_config('squad.reason', '', true);
end $$;

-- Workflow move used by the other RPCs: only moves the lead forward when it is
-- at a valid predecessor stage, otherwise leaves it where it is. This stops a
-- follow-up draft, a late reply or a second project from dragging a lead back.
create or replace function public._move_stage(p_lead_id uuid, p_stage pipeline_stage, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_from pipeline_stage;
begin
  select stage into v_from from public.leads where id = p_lead_id;
  if v_from is null or v_from = p_stage or not (v_from = any(public.stage_predecessors(p_stage))) then
    return;
  end if;
  perform public._move_stage_strict(p_lead_id, p_stage, p_reason);
end $$;

create or replace function public.advance_stage(p_lead_id uuid, p_to_stage pipeline_stage, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana'); v_from pipeline_stage;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'p_reason is required for every stage change'; end if;
  select stage into v_from from public.leads where id = p_lead_id;
  if v_from is null then raise exception 'Lead % not found', p_lead_id; end if;
  if v_from = p_to_stage then return jsonb_build_object('status', 'unchanged', 'stage', v_from); end if;

  if p_to_stage = 'lost' then
    update public.leads set lost_reason = p_reason where id = p_lead_id;
    update public.deals set status = 'lost', lost_reason = p_reason
     where lead_id = p_lead_id and status not in ('signed', 'lost');
  end if;

  perform public._move_stage_strict(p_lead_id, p_to_stage, p_reason);   -- guard trigger checks + logs
  return jsonb_build_object('status', 'moved', 'lead_id', p_lead_id, 'from', v_from, 'to', p_to_stage);
end $$;

-- -----------------------------------------------------------------------------
-- 2b. Drafts and batches
-- -----------------------------------------------------------------------------
create or replace function public.guard_draft() returns trigger
language plpgsql security definer set search_path = public as $$
declare me text := public.current_agent(); v_batch batch_status;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'ready') or new.batch_id is not null then
      raise exception 'New drafts start as draft/ready outside any batch (use create_draft, then submit_draft_batch)'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- What Letty reviewed is what goes out: content is frozen once submitted.
  if old.status in ('in_batch', 'approved', 'sent')
     and (new.lead_id, new.channel, new.language, new.subject, new.body, new.personalisation)
         is distinct from (old.lead_id, old.channel, old.language, old.subject, old.body, old.personalisation) then
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

  if new.status = 'approved' and me not in ('letty', 'top_g') then
    raise exception 'Only Letty (or Top G on her behalf) can approve or reject outreach' using errcode = '42501';
  end if;
  if new.status = 'rejected' and me not in ('letty', 'top_g')
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

drop trigger if exists trg_guard_draft on public.outreach_drafts;
create trigger trg_guard_draft
  before insert or update on public.outreach_drafts
  for each row execute function public.guard_draft();

create or replace function public.guard_batch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_admin()
       and (new.status <> 'pending' or new.decided_by is not null or new.decided_at is not null) then
      raise exception 'Only Letty (or Top G) can decide an approval batch: new batches start as pending'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if not public.is_admin() then
      raise exception 'Only Letty (or Top G) can decide an approval batch' using errcode = '42501';
    end if;
    if old.status <> 'pending' then
      raise exception 'Batch #% was already decided (%)', old.ref, old.status;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_batch on public.approval_batches;
create trigger trg_guard_batch
  before insert or update on public.approval_batches
  for each row execute function public.guard_batch();

-- -----------------------------------------------------------------------------
-- 3. Do-not-contact enforcement
-- -----------------------------------------------------------------------------

-- DNC entries matching a lead's business, website, Instagram or any of its contacts.
create or replace function public.lead_dnc_matches(p_lead_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(distinct m), '[]')
  from public.leads l
  join public.companies c on c.id = l.company_id
  left join public.contacts k on k.company_id = c.id or k.id = l.contact_id
  cross join lateral jsonb_array_elements(
    public.check_do_not_contact(c.name, k.email, k.phone, c.website, c.instagram)) m
  where l.id = p_lead_id
$$;

create or replace function public.create_draft(
  p_lead_id         uuid,
  p_body            text,
  p_channel         outreach_channel default null,
  p_subject         text default null,
  p_language        text default 'es',
  p_personalisation text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); v_lead record; v_id uuid; v_dnc jsonb;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead is null then raise exception 'Lead % not found', p_lead_id; end if;
  if v_lead.stage in ('lost', 'do_not_contact') then
    raise exception 'Lead is %, outreach not allowed', v_lead.stage;
  end if;
  v_dnc := public.lead_dnc_matches(p_lead_id);
  if jsonb_array_length(v_dnc) > 0 then
    raise exception 'This contact is on the do-not-contact list (%). Do not write to them.', v_dnc;
  end if;
  if coalesce(p_channel, v_lead.channel) is null then
    raise exception 'Channel required (whatsapp, email or instagram)';
  end if;

  insert into public.outreach_drafts (lead_id, channel, subject, body, language, personalisation, status, created_by)
  values (p_lead_id, coalesce(p_channel, v_lead.channel), p_subject, p_body, coalesce(p_language, 'es'),
          p_personalisation, 'ready', me)
  returning id into v_id;

  perform public._move_stage(p_lead_id, 'draft_ready', 'Personalised draft written');

  perform public.log_activity('create_draft', 'draft', v_id, p_lead_id,
    format('Draft ready for %s via %s', public._lead_name(p_lead_id), coalesce(p_channel, v_lead.channel)),
    jsonb_build_object('language', p_language));
  return jsonb_build_object('status', 'ready', 'draft_id', v_id);
end $$;

create or replace function public.log_send(p_draft_id uuid, p_external_ref text default null, p_sent_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); d record; v_stage pipeline_stage; v_dnc jsonb;
begin
  select * into d from public.outreach_drafts where id = p_draft_id for update;
  if d is null then raise exception 'Draft % not found', p_draft_id; end if;
  if d.status <> 'approved' then
    raise exception 'Draft is "%" — only drafts approved by Letty in a batch can be sent', d.status;
  end if;
  select stage into v_stage from public.leads where id = d.lead_id;
  if v_stage in ('lost', 'do_not_contact') then
    raise exception 'Lead is %: do not send. If a message already went out, call raise_escalation.', v_stage;
  end if;
  v_dnc := public.lead_dnc_matches(d.lead_id);
  if jsonb_array_length(v_dnc) > 0 then
    raise exception 'This contact is on the do-not-contact list (%): do not send. If a message already went out, call raise_escalation.', v_dnc;
  end if;

  update public.outreach_drafts set status = 'sent', sent_by = me, sent_at = coalesce(p_sent_at, now()),
         external_ref = p_external_ref where id = p_draft_id;

  perform public._move_stage(d.lead_id, 'sent', format('Outreach sent via %s', d.channel));
  if v_stage in ('approved', 'sent') then
    update public.leads set next_action = 'Follow up if no reply', next_action_at = now() + interval '3 days'
     where id = d.lead_id;
  end if;

  perform public.log_activity('log_send', 'draft', p_draft_id, d.lead_id,
    format('Sent %s outreach to %s', d.channel, public._lead_name(d.lead_id)),
    jsonb_build_object('external_ref', p_external_ref));
  return jsonb_build_object('status', 'sent', 'draft_id', p_draft_id, 'lead_id', d.lead_id);
end $$;

create or replace function public.log_reply(p_lead_id uuid, p_summary text, p_channel outreach_channel default null,
                                            p_hand_to_quinn boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan', 'quinn'); v_stage pipeline_stage; v_after pipeline_stage;
begin
  select stage into v_stage from public.leads where id = p_lead_id;
  if v_stage is null then raise exception 'Lead % not found', p_lead_id; end if;
  if v_stage = 'do_not_contact' then
    raise exception 'Lead is on the do-not-contact list: do not reply. Call raise_escalation if they contacted us again.';
  end if;

  perform public._move_stage(p_lead_id, 'replied', 'Prospect replied: ' || left(p_summary, 120));
  select stage into v_after from public.leads where id = p_lead_id;
  if p_hand_to_quinn and v_after = 'replied' then
    update public.leads set owner_agent = 'quinn', next_action = 'Start discovery', next_action_at = now()
     where id = p_lead_id;
  end if;
  perform public.log_activity('log_reply', 'lead', p_lead_id, p_lead_id,
    format('%s replied%s', public._lead_name(p_lead_id), coalesce(' via ' || p_channel::text, '')),
    jsonb_build_object('summary', p_summary, 'stage', v_after));
  return jsonb_build_object('status', 'replied', 'lead_id', p_lead_id, 'stage', v_after,
    'owner', case when p_hand_to_quinn and v_after = 'replied' then 'quinn' end,
    'message', case when v_after <> 'replied' then
      format('Reply logged; lead stays at %s.', v_after) end);
end $$;

create or replace function public.add_do_not_contact(
  p_kind dnc_kind, p_value text, p_reason text, p_lead_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana');
  v_id uuid; l record; v_leads int := 0; v_drafts int := 0; n int;
begin
  if coalesce(trim(p_value), '') = '' then raise exception 'p_value is required'; end if;
  insert into public.do_not_contact (kind, value, reason, lead_id, added_by)
  values (p_kind, p_value, p_reason, p_lead_id, me)
  on conflict (kind, value_norm) do update set reason = coalesce(excluded.reason, do_not_contact.reason)
  returning id into v_id;

  -- Block every matching lead (not just the one named) and cancel unsent drafts.
  perform set_config('squad.dnc_cleanup', 'on', true);
  for l in
    select ld.id, ld.stage from public.leads ld
    where ld.id = p_lead_id
       or (ld.stage <> 'do_not_contact' and jsonb_array_length(public.lead_dnc_matches(ld.id)) > 0)
  loop
    if l.stage <> 'do_not_contact' then
      perform public._move_stage_strict(l.id, 'do_not_contact', coalesce(p_reason, 'Do not contact'));
      v_leads := v_leads + 1;
    end if;
    update public.outreach_drafts set status = 'rejected', reviewer_note = 'Do not contact'
     where lead_id = l.id and status in ('draft', 'ready', 'in_batch', 'approved');
    get diagnostics n = row_count;
    v_drafts := v_drafts + n;
  end loop;
  perform set_config('squad.dnc_cleanup', '', true);

  perform public.log_activity('add_do_not_contact', 'do_not_contact', v_id, p_lead_id,
    format('Do-not-contact (%s): %s — %s (%s lead(s) blocked, %s draft(s) cancelled)',
           p_kind, p_value, p_reason, v_leads, v_drafts),
    jsonb_build_object('leads_blocked', v_leads, 'drafts_cancelled', v_drafts));
  return jsonb_build_object('status', 'added', 'id', v_id, 'leads_blocked', v_leads, 'drafts_cancelled', v_drafts);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Capacity: enforced on the table, serialised per month
-- -----------------------------------------------------------------------------
create or replace function public.guard_project_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_limit int := coalesce((public._term('capacity')->>'projects_per_month')::int, 4);
  v_used int;
begin
  if tg_op = 'UPDATE' and new.slot_month is not distinct from old.slot_month then
    return new;
  end if;
  new.slot_month := date_trunc('month', new.slot_month)::date;
  -- one writer per month at a time, so two concurrent create_project calls
  -- cannot both take the last slot
  perform pg_advisory_xact_lock(hashtext('squad.capacity'),
    (extract(year from new.slot_month) * 12 + extract(month from new.slot_month))::int);
  select count(*) into v_used from public.projects where slot_month = new.slot_month and id <> new.id;
  if v_used >= v_limit then
    raise exception 'Capacity full for % (% of % slots used). Pick another p_slot_month or escalate to Top G.',
      to_char(new.slot_month, 'YYYY-MM'), v_used, v_limit using errcode = '23514';
  end if;
  return new;
end $$;

create trigger trg_guard_project_capacity
  before insert or update of slot_month on public.projects
  for each row execute function public.guard_project_capacity();

-- -----------------------------------------------------------------------------
-- 5. Signing a deal
-- -----------------------------------------------------------------------------
create or replace function public.sign_deal(p_deal_id uuid, p_reason text default 'Client signed the proposal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('quinn');
  d record; v_cap jsonb; v_stage pipeline_stage; v_superseded uuid[];
begin
  select * into d from public.deals where id = p_deal_id for update;
  if d is null then raise exception 'Deal % not found', p_deal_id; end if;
  if d.status not in ('quoted', 'proposed') then
    raise exception 'Deal D-% is %: only quoted or proposed deals can be signed', d.ref, d.status;
  end if;
  select stage into v_stage from public.leads where id = d.lead_id for update;
  if v_stage in ('lost', 'do_not_contact') then
    raise exception 'Lead is %: escalate to Top G before signing', v_stage;
  end if;

  update public.deals set status = 'signed', signed_at = now() where id = p_deal_id;
  update public.proposals set status = 'accepted', decided_at = now()
   where deal_id = p_deal_id and status in ('draft', 'sent');

  -- Other open quotes for the same lead are superseded by this one.
  with s as (
    update public.deals set status = 'lost', lost_reason = format('Superseded by D-%s', d.ref)
     where lead_id = d.lead_id and id <> p_deal_id and status in ('draft', 'quoted', 'proposed')
    returning id)
  select coalesce(array_agg(id), '{}') into v_superseded from s;
  update public.proposals set status = 'declined', decided_at = now()
   where deal_id = any(v_superseded) and status in ('draft', 'sent');

  -- Upsell on an existing client: the lead is already past signed, leave it.
  if v_stage not in ('signed', 'in_delivery', 'delivered', 'care_plan') then
    perform public._move_stage_strict(d.lead_id, 'signed', p_reason);
    update public.leads set owner_agent = 'dana', next_action = 'Draft scope of work + handoff plan', next_action_at = now()
     where id = d.lead_id;
  end if;

  v_cap := public.capacity(current_date);
  perform public.log_activity('sign_deal', 'deal', p_deal_id, d.lead_id,
    format('%s signed (%s %s) — handed to Dana', public._lead_name(d.lead_id), d.currency,
           to_char(d.one_off_total, 'FM999,999,990'))
      || case when cardinality(v_superseded) > 0 then format(' · %s other quote(s) superseded', cardinality(v_superseded)) else '' end,
    jsonb_build_object('capacity', v_cap, 'superseded_deal_ids', v_superseded));
  return jsonb_build_object('status', 'signed', 'deal_id', p_deal_id, 'capacity', v_cap,
    'superseded_deal_ids', v_superseded,
    'warning', case when (v_cap->>'remaining')::int = 0 then 'No project slots left this month: schedule the start for next month or escalate.' end);
end $$;

-- -----------------------------------------------------------------------------
-- Grants for the functions added here (new functions default to PUBLIC execute)
-- -----------------------------------------------------------------------------
revoke execute on function public.stage_predecessors(pipeline_stage) from public, anon;
grant  execute on function public.stage_predecessors(pipeline_stage) to authenticated, service_role;
revoke execute on function public._move_stage_strict(uuid, pipeline_stage, text) from public, anon, authenticated;
revoke execute on function public.lead_dnc_matches(uuid) from public, anon, authenticated;
revoke execute on function public.guard_project_capacity() from public, anon, authenticated;
grant  execute on function public._move_stage_strict(uuid, pipeline_stage, text),
                           public.lead_dnc_matches(uuid),
                           public.guard_project_capacity() to service_role;
