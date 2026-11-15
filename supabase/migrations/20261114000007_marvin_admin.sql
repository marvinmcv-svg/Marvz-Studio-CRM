-- =============================================================================
-- Squad CRM — Marvin as a human admin
--
-- Adds the squad member `marvin` with the same rights as Letty (owner): full
-- read/write, decides approval batches, resolves escalations, edits the
-- catalogue and the team directory. Every action is logged as Marvin.
--
-- Admin checks now go through public.is_admin() instead of repeating the
-- ('letty', 'top_g') list, so adding another admin later is a one-line change.
-- =============================================================================

insert into public.agents (code, name, kind, title, description, color) values
  ('marvin', 'Marvin', 'human', 'Admin',
   'Studio admin: same access as Letty — approvals, escalations, catalogue and team.', '#38bdf8')
on conflict (code) do nothing;

-- Owners: may also edit the catalogue and the team directory.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_agent() in ('letty', 'marvin')
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_agent() in ('letty', 'top_g', 'marvin')
$$;

-- Raises unless the caller is one of the given agents (admins always pass).
create or replace function public.require_agent(variadic roles text[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare me text := public.current_agent();
begin
  if me is null then
    raise exception 'Not a registered Squad CRM agent' using errcode = '42501';
  end if;
  if public.is_admin() or me = any(roles) then
    return me;
  end if;
  raise exception 'Agent % is not allowed to perform this action (allowed: %, or an admin)',
    me, array_to_string(roles, ', ') using errcode = '42501';
end $$;

create or replace function public.allowed_target_stages(p_agent text) returns pipeline_stage[]
language sql immutable as $$
  select case p_agent
    when 'letty'  then enum_range(null::pipeline_stage)
    when 'top_g'  then enum_range(null::pipeline_stage)
    when 'marvin' then enum_range(null::pipeline_stage)
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

  -- Outreach can only be "sent" once an approved draft has actually been sent.
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

create or replace function public.record_approval(
  p_batch_id     uuid,
  p_approved_ids uuid[] default null,     -- null = approve everything in the batch
  p_rejected_ids uuid[] default '{}',
  p_note         text default null,
  p_feedback     jsonb default '{}'       -- optional { "<draft_id>": "change X" }
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent(variadic array[]::text[]);   -- admins only
  v_who text := case when me = 'top_g' then 'Top G for Letty'
                     else coalesce((select name from public.agents where code = me), me) end;
  v_ref bigint; v_status batch_status; v_appr int; v_rej int; d record;
begin
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
      perform public._move_stage(d.lead_id, 'approved', format('Approved by %s in batch #%s', v_who, v_ref));
    end if;
  end loop;

  select count(*) filter (where status = 'approved'), count(*) filter (where status = 'rejected')
    into v_appr, v_rej from public.outreach_drafts where batch_id = p_batch_id;

  update public.approval_batches
     set status = case when v_rej = 0 then 'approved' when v_appr = 0 then 'rejected' else 'partially_approved' end::batch_status,
         decided_by = me, decided_at = now(), note = coalesce(p_note, note)
   where id = p_batch_id;

  perform public.log_activity('record_approval', 'batch', p_batch_id, null,
    format('Batch #%s decided: %s approved, %s rejected%s', v_ref, v_appr, v_rej,
           case when me = 'top_g' then ' (recorded by Top G for Letty)' else '' end),
    jsonb_build_object('approved', v_appr, 'rejected', v_rej, 'note', p_note, 'decided_by', me));
  return jsonb_build_object('status', 'decided', 'batch_ref', v_ref, 'approved', v_appr, 'rejected', v_rej,
                            'decided_by', me);
end $$;

create or replace function public.dashboard_metrics() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_won int; v_lost int; v_money boolean;
begin
  if not public.is_member() then raise exception 'Not a registered Squad CRM agent' using errcode = '42501'; end if;
  v_money := public.is_admin() or public.current_agent() = 'dana';   -- same readers as care_subscriptions
  select count(*) filter (where status = 'signed'), count(*) filter (where status = 'lost')
    into v_won, v_lost from public.deals;
  select jsonb_build_object(
    'mrr_usd', case when v_money then (select coalesce(sum(monthly_usd), 0) from public.care_subscriptions
                where status = 'active' and (included_until is null or included_until <= current_date)) end,
    'committed_mrr_usd', case when v_money then
                (select coalesce(sum(monthly_usd), 0) from public.care_subscriptions where status = 'active') end,
    'pipeline_value_usd', (select coalesce(sum(one_off_total_usd), 0) from public.deals where status in ('draft', 'quoted', 'proposed')),
    'win_rate', case when v_won + v_lost = 0 then null else round(v_won::numeric / (v_won + v_lost), 3) end,
    'avg_deal_usd', (select round(avg(one_off_total_usd), 0) from public.deals where status = 'signed'),
    'stage_counts', (select jsonb_object_agg(stage, n) from (select stage, count(*) n from public.leads group by stage) s),
    'open_escalations', (select count(*) from public.escalations where status in ('open', 'in_review', 'with_letty')),
    'escalations_for_letty', (select count(*) from public.escalations where status = 'with_letty'),
    'batches_awaiting_letty', (select count(*) from public.approval_batches where status = 'pending'),
    'drafts_awaiting_letty', (select count(*) from public.outreach_drafts where status = 'in_batch'),
    'slipping_milestones', (select count(*) from public.milestones
                            where status = 'slipped' or (status <> 'done' and due_date < current_date)),
    'capacity', public.capacity(current_date),
    'renewals_next_30d', (select count(*) from public.care_subscriptions
                          where status = 'active' and renewal_date <= current_date + 30)
  ) into v;
  return v;
end $$;

-- Catalogue + team directory: owners (Letty, Marvin) write; everyone reads.
do $$
declare t text;
begin
  foreach t in array array['markets','catalogue_packages','catalogue_package_prices','catalogue_addons',
                           'catalogue_care_plans','catalogue_terms']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_letty_write', t);
    execute format('create policy %I on public.%I for all to authenticated
                     using (public.is_owner()) with check (public.is_owner())', t || '_owner_write', t);
  end loop;
end $$;
drop policy if exists agents_letty on public.agents;
create policy agents_owner on public.agents for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- New function: explicit grants (functions are private by default since migration 6).
revoke execute on function public.is_owner() from public, anon;
grant  execute on function public.is_owner() to authenticated, service_role;
