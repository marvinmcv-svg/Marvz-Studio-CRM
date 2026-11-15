-- =============================================================================
-- Squad CRM — Marvin is the sole owner and the sole approver
--
-- Owner decision (Marvin, 14 Nov 2026): Marvin is the only owner. Letty has no
-- approval authority of any kind. Top G stays a coordinator (admin for read and
-- non-approval work) but cannot approve or decide on Marvin's behalf.
--
-- This migration does not rewrite historical approvals, activity, or audit
-- rows, and it does not delete Letty's row. It deactivates her login.
-- =============================================================================

-- Human-decision status. The old label `with_letty` is renamed in place, so
-- existing rows keep their history and now read as `with_owner`.
alter type public.escalation_status rename value 'with_letty' to 'with_owner';

-- Open items that were waiting on Letty now wait on Marvin.
update public.escalations
   set assigned_to = 'marvin'
 where status = 'with_owner'
   and assigned_to = 'letty';

do $$
begin
  if exists (select 1 from public.escalations where status = 'with_owner' and assigned_to = 'letty') then
    raise exception 'with_owner escalations are still assigned to letty';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Who is who
-- ---------------------------------------------------------------------------
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_agent() = 'marvin'
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_agent() in ('marvin', 'top_g')
$$;

create or replace function public.allowed_target_stages(p_agent text) returns pipeline_stage[]
language sql immutable as $$
  select case p_agent
    when 'marvin' then enum_range(null::pipeline_stage)
    when 'top_g'  then enum_range(null::pipeline_stage)
    when 'hunter' then array['found', 'lost', 'do_not_contact']::pipeline_stage[]
    when 'jordan' then array['found', 'screened', 'draft_ready', 'sent', 'replied', 'lost', 'do_not_contact']::pipeline_stage[]
    when 'quinn'  then array['replied', 'discovery', 'proposal', 'signed', 'lost', 'do_not_contact']::pipeline_stage[]
    when 'dana'   then array['signed', 'in_delivery', 'delivered', 'care_plan', 'lost', 'do_not_contact']::pipeline_stage[]
    else array[]::pipeline_stage[]
  end
$$;

-- ---------------------------------------------------------------------------
-- Directory. Letty stays in the table (history points at her) but cannot sign in.
-- ---------------------------------------------------------------------------
update public.agents
   set title = 'Owner',
       description = 'Sole owner and the only person who can approve outreach, decide owner escalations, edit the catalogue and team, or take owner-gated lead actions. No agent approves on his behalf.'
 where code = 'marvin';

update public.agents
   set active = false,
       title = 'Former member',
       description = 'No approval authority. Historical actions stay in the audit log. Marvin is the sole owner.'
 where code = 'letty';

update public.agents
   set description = 'Coordinates the squad and handles routine escalations. Cannot approve batches, edit the catalogue or team, or decide for Marvin.'
 where code = 'top_g';

update public.agents
   set description = 'Re-screens leads, writes personalised drafts, batches them for Marvin, sends approved ones and logs them.'
 where code = 'jordan';

-- ---------------------------------------------------------------------------
-- Stage guard. Admins may still correct the pipeline. Marking a signed client
-- lost is owner-only, and so is deleting a lead.
-- ---------------------------------------------------------------------------
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

  -- Admins may correct the pipeline. Losing a client who has already signed is owner-only.
  if tg_op = 'UPDATE'
     and new.stage = 'lost'
     and old.stage in ('signed', 'in_delivery', 'delivered', 'care_plan')
     and not public.is_owner() then
    raise exception 'Only Marvin can mark a signed client lost' using errcode = '42501';
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

create or replace function public.guard_owner_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then
    raise exception 'Only Marvin can delete a % row', tg_table_name using errcode = '42501';
  end if;
  return old;
end $$;

revoke all on function public.guard_owner_delete() from public, anon, authenticated;

drop trigger if exists trg_guard_lead_delete on public.leads;
create trigger trg_guard_lead_delete
  before delete on public.leads
  for each row execute function public.guard_owner_delete();

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated
  using (public.is_owner());

-- ---------------------------------------------------------------------------
-- Drafts and batches: Marvin approves. The caller is recorded as himself.
-- ---------------------------------------------------------------------------
create or replace function public.guard_draft() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_batch batch_status;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'ready') or new.batch_id is not null then
      raise exception 'New drafts start as draft/ready outside any batch (use create_draft, then submit_draft_batch)'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- What Marvin reviewed is what goes out: content is frozen once submitted.
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

  if new.status = 'approved' and not public.is_owner() then
    raise exception 'Only Marvin can approve or reject outreach' using errcode = '42501';
  end if;
  if new.status = 'rejected' and not public.is_owner()
     and coalesce(current_setting('squad.dnc_cleanup', true), '') <> 'on' then
    raise exception 'Only Marvin can approve or reject outreach' using errcode = '42501';
  end if;

  if new.status = 'sent' then
    select b.status into v_batch from public.approval_batches b where b.id = new.batch_id;
    if old.status <> 'approved' or v_batch is null or v_batch not in ('approved', 'partially_approved') then
      raise exception 'Draft % cannot be sent: it is not approved in an approved batch', new.id;
    end if;
  end if;
  return new;
end $$;

create or replace function public.guard_batch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.is_owner()
       and (new.status <> 'pending' or new.decided_by is not null or new.decided_at is not null) then
      raise exception 'Only Marvin can decide an approval batch: new batches start as pending'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status or new.decided_by is distinct from old.decided_by then
    if not public.is_owner() then
      raise exception 'Only Marvin can decide an approval batch' using errcode = '42501';
    end if;
    if old.status <> 'pending' and new.status is distinct from old.status then
      raise exception 'Batch #% was already decided (%)', old.ref, old.status;
    end if;
  end if;
  return new;
end $$;

create or replace function public.record_approval(
  p_batch_id     uuid,
  p_approved_ids uuid[] default null,     -- null = approve everything in the batch
  p_rejected_ids uuid[] default '{}',
  p_note         text default null,
  p_feedback     jsonb default '{}'       -- optional { "<draft_id>": "change X" }
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.current_agent();
  v_name text;
  v_ref bigint; v_status batch_status; v_appr int; v_rej int; d record;
begin
  if me is null then
    raise exception 'Not a registered Squad CRM agent' using errcode = '42501';
  end if;
  if not public.is_owner() then
    raise exception 'Agent % is not allowed to approve outreach batches; only Marvin can approve', me
      using errcode = '42501';
  end if;
  v_name := coalesce((select name from public.agents where code = me), me);

  select ref, status into v_ref, v_status from public.approval_batches where id = p_batch_id for update;
  if v_ref is null then raise exception 'Batch % not found', p_batch_id; end if;
  if v_status <> 'pending' then raise exception 'Batch #% already decided (%)', v_ref, v_status; end if;

  for d in select * from public.outreach_drafts where batch_id = p_batch_id and status = 'in_batch' loop
    if d.id = any(coalesce(p_rejected_ids, '{}')) or (p_approved_ids is not null and not d.id = any(p_approved_ids)) then
      update public.outreach_drafts set status = 'rejected', reviewer_note = coalesce(p_feedback->>d.id::text, p_note)
      where id = d.id;
    else
      update public.outreach_drafts set status = 'approved', approved_by = me, approved_at = now(),
             reviewer_note = p_feedback->>d.id::text
      where id = d.id;
      perform public._move_stage(d.lead_id, 'approved', format('Approved by %s in batch #%s', v_name, v_ref));
    end if;
  end loop;

  select count(*) filter (where status = 'approved'), count(*) filter (where status = 'rejected')
    into v_appr, v_rej from public.outreach_drafts where batch_id = p_batch_id;

  update public.approval_batches
     set status = case when v_rej = 0 then 'approved' when v_appr = 0 then 'rejected' else 'partially_approved' end::batch_status,
         decided_by = me, decided_at = now(), note = coalesce(p_note, note)
   where id = p_batch_id;

  perform public.log_activity('record_approval', 'batch', p_batch_id, null,
    format('Batch #%s decided: %s approved, %s rejected', v_ref, v_appr, v_rej),
    jsonb_build_object('approved', v_appr, 'rejected', v_rej, 'note', p_note, 'decided_by', me));
  return jsonb_build_object('status', 'decided', 'batch_ref', v_ref, 'approved', v_appr, 'rejected', v_rej,
                            'decided_by', me);
end $$;

-- ---------------------------------------------------------------------------
-- Escalations. escalate_to_letty remains accepted and means escalate_to_owner.
-- ---------------------------------------------------------------------------
create or replace function public.raise_escalation(
  p_title           text,
  p_detail          text default null,
  p_severity        escalation_severity default 'medium',
  p_lead_id         uuid default null,
  p_project_id      uuid default null,
  p_proposed_action text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana'); v_id uuid; v_ref bigint;
begin
  insert into public.escalations (lead_id, project_id, raised_by, title, detail, proposed_action, severity,
                                  status, assigned_to)
  values (p_lead_id, p_project_id, me, p_title, p_detail, p_proposed_action, coalesce(p_severity, 'medium'),
          case when me = 'top_g' then 'with_owner' else 'open' end::escalation_status,
          case when me = 'top_g' then 'marvin' else 'top_g' end)
  returning id, ref into v_id, v_ref;
  perform public.log_activity('raise_escalation', 'escalation', v_id, p_lead_id,
    format('Escalation E-%s (%s): %s', v_ref, coalesce(p_severity, 'medium'), p_title),
    jsonb_build_object('detail', p_detail, 'proposed_action', p_proposed_action));
  return jsonb_build_object('status', 'open', 'escalation_id', v_id, 'ref', 'E-' || v_ref,
                            'assigned_to', case when me = 'top_g' then 'marvin' else 'top_g' end);
end $$;

create or replace function public.update_escalation(
  p_escalation_id uuid,
  p_action        text,               -- 'review' | 'escalate_to_owner' | 'escalate_to_letty' (alias) | 'resolve' | 'dismiss'
  p_notes         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent(variadic array[]::text[]);   -- admins (coordination); owner checks below
  e record;
  v_action text := case when p_action = 'escalate_to_letty' then 'escalate_to_owner' else p_action end;
begin
  select * into e from public.escalations where id = p_escalation_id;
  if e is null then raise exception 'Escalation % not found', p_escalation_id; end if;

  case v_action
    when 'review' then
      update public.escalations set status = 'in_review', top_g_notes = coalesce(p_notes, top_g_notes) where id = e.id;
    when 'escalate_to_owner' then
      update public.escalations set status = 'with_owner', assigned_to = 'marvin',
             top_g_notes = coalesce(p_notes, top_g_notes) where id = e.id;
    when 'resolve' then
      if coalesce(trim(p_notes), '') = '' then raise exception 'Resolution notes are required'; end if;
      if e.status = 'with_owner' and not public.is_owner() then
        raise exception 'Only Marvin can decide an escalation that needs the owner' using errcode = '42501';
      end if;
      update public.escalations set status = 'resolved', resolution_notes = p_notes, resolved_by = me,
             resolved_at = now() where id = e.id;
    when 'dismiss' then
      if e.status = 'with_owner' and not public.is_owner() then
        raise exception 'Only Marvin can decide an escalation that needs the owner' using errcode = '42501';
      end if;
      update public.escalations set status = 'dismissed', resolution_notes = p_notes, resolved_by = me,
             resolved_at = now() where id = e.id;
    else raise exception 'Unknown action % (review, escalate_to_owner, resolve, dismiss)', p_action;
  end case;

  perform public.log_activity('update_escalation', 'escalation', e.id, e.lead_id,
    format('E-%s %s: %s', e.ref, replace(v_action, '_', ' '), e.title) || coalesce(' — ' || p_notes, ''),
    jsonb_build_object('action', v_action, 'requested_action', p_action));
  return jsonb_build_object('status', v_action, 'escalation_id', e.id);
end $$;

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
    raise exception 'Only Top G or Marvin can update escalations' using errcode = '42501';
  end if;
  return new;
end $$;

-- User-facing copy that still named Letty as the approver.
create or replace function public.submit_draft_batch(p_draft_ids uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); v_batch uuid; v_ref bigint; v_bad int; v_n int;
begin
  if coalesce(cardinality(p_draft_ids), 0) = 0 then raise exception 'p_draft_ids is empty'; end if;

  select count(*) into v_bad from public.outreach_drafts
  where id = any(p_draft_ids) and status not in ('draft', 'ready');
  if v_bad > 0 then raise exception '% draft(s) are not in draft/ready status', v_bad; end if;

  select count(*) into v_n from public.outreach_drafts where id = any(p_draft_ids);
  if v_n <> cardinality(p_draft_ids) then raise exception 'Some draft ids were not found'; end if;

  insert into public.approval_batches (status, submitted_by, note) values ('pending', me, p_note)
  returning id, ref into v_batch, v_ref;

  update public.outreach_drafts set status = 'in_batch', batch_id = v_batch where id = any(p_draft_ids);

  perform public.log_activity('submit_draft_batch', 'batch', v_batch, null,
    format('Batch #%s submitted for Marvin''s approval (%s drafts)', v_ref, v_n),
    jsonb_build_object('draft_ids', p_draft_ids, 'note', p_note));
  return jsonb_build_object('status', 'pending', 'batch_id', v_batch, 'batch_ref', v_ref, 'drafts', v_n);
end $$;

create or replace function public.log_send(p_draft_id uuid, p_external_ref text default null, p_sent_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); d record; v_stage pipeline_stage; v_dnc jsonb;
begin
  select * into d from public.outreach_drafts where id = p_draft_id for update;
  if d is null then raise exception 'Draft % not found', p_draft_id; end if;
  if d.status <> 'approved' then
    raise exception 'Draft is "%" — only drafts approved by Marvin in a batch can be sent', d.status;
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

-- ---------------------------------------------------------------------------
-- Dashboard. New keys are canonical. The *_letty keys stay as aliases.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_metrics() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_won int; v_lost int; v_money boolean;
        v_for_owner bigint; v_batches bigint; v_drafts bigint;
begin
  if not public.is_member() then raise exception 'Not a registered Squad CRM agent' using errcode = '42501'; end if;
  v_money := public.is_admin() or public.current_agent() = 'dana';
  select count(*) filter (where status = 'signed'), count(*) filter (where status = 'lost')
    into v_won, v_lost from public.deals;
  select count(*) into v_for_owner from public.escalations where status = 'with_owner';
  select count(*) into v_batches from public.approval_batches where status = 'pending';
  select count(*) into v_drafts from public.outreach_drafts where status = 'in_batch';
  select jsonb_build_object(
    'mrr_usd', case when v_money then (select coalesce(sum(monthly_usd), 0) from public.care_subscriptions
                where status = 'active' and (included_until is null or included_until <= current_date)) end,
    'committed_mrr_usd', case when v_money then
                (select coalesce(sum(monthly_usd), 0) from public.care_subscriptions where status = 'active') end,
    'pipeline_value_usd', (select coalesce(sum(one_off_total_usd), 0) from public.deals where status in ('draft', 'quoted', 'proposed')),
    'win_rate', case when v_won + v_lost = 0 then null else round(v_won::numeric / (v_won + v_lost), 3) end,
    'avg_deal_usd', (select round(avg(one_off_total_usd), 0) from public.deals where status = 'signed'),
    'stage_counts', (select jsonb_object_agg(stage, n) from (select stage, count(*) n from public.leads group by stage) s),
    'open_escalations', (select count(*) from public.escalations where status in ('open', 'in_review', 'with_owner')),
    'escalations_for_owner', v_for_owner,
    'escalations_for_marvin', v_for_owner,
    'escalations_for_letty', v_for_owner,
    'batches_awaiting_owner', v_batches,
    'batches_awaiting_marvin', v_batches,
    'batches_awaiting_letty', v_batches,
    'drafts_awaiting_owner', v_drafts,
    'drafts_awaiting_marvin', v_drafts,
    'drafts_awaiting_letty', v_drafts,
    'slipping_milestones', (select count(*) from public.milestones
                            where status = 'slipped' or (status <> 'done' and due_date < current_date)),
    'capacity', public.capacity(current_date),
    'renewals_next_30d', (select count(*) from public.care_subscriptions
                          where status = 'active' and renewal_date <= current_date + 30)
  ) into v;
  return v;
end $$;
