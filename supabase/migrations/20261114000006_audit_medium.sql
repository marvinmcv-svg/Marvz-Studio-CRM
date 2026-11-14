-- =============================================================================
-- Squad CRM — audit fixes, medium priority
--
-- 1. record_approval records who actually decided (Letty, or Top G on her
--    behalf) instead of always writing 'letty'.
-- 2. dashboard_metrics only returns MRR to agents who can read care plans
--    (Letty, Top G, Dana); everyone else gets null, matching table RLS.
-- 3. Functions created by future migrations are NOT executable by anon or
--    authenticated until a migration grants it explicitly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Approvals: record the real decider
-- -----------------------------------------------------------------------------
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
      perform public._move_stage(d.lead_id, 'approved',
        format('Approved by %s in batch #%s', case when me = 'top_g' then 'Top G for Letty' else 'Letty' end, v_ref));
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

-- -----------------------------------------------------------------------------
-- 2. Dashboard: MRR only for agents who may read care subscriptions
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_metrics() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_won int; v_lost int; v_money boolean;
begin
  if not public.is_member() then raise exception 'Not a registered Squad CRM agent' using errcode = '42501'; end if;
  v_money := public.current_agent() in ('letty', 'top_g', 'dana');   -- same readers as care_subscriptions
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

-- -----------------------------------------------------------------------------
-- 3. Private by default: new functions need an explicit grant
--    (Supabase grants EXECUTE on new functions to anon + authenticated by
--     default, which would expose any internal helper a later migration adds.)
-- -----------------------------------------------------------------------------
-- PUBLIC's EXECUTE is a built-in global default, so it can only be removed
-- globally (not per schema). This affects functions created by this role.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    begin
      alter default privileges for role supabase_admin in schema public revoke execute on functions from public, anon, authenticated;
    exception when insufficient_privilege then
      raise notice 'Could not change supabase_admin default privileges (not required: migrations run as postgres).';
    end;
  end if;
end $$;
