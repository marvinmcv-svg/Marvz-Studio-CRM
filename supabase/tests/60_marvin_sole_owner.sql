-- Marvin is the sole owner and the sole approver (migration 20261115000009).
-- Letty has no approval authority. Top G cannot approve or decide for Marvin.
\set QUIET off
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- 1. Identity: owner = marvin, admin = marvin + top_g, letty is deactivated
-- ---------------------------------------------------------------------------
select tests.eq((select active from public.agents where code = 'letty'), false, 'letty is deactivated');
select tests.eq((select count(*) from public.agents where code = 'letty'), 1::bigint, 'letty historical row is kept');
select tests.eq((select title from public.agents where code = 'marvin'), 'Owner', 'marvin is titled owner');

select tests.login('marvin');
set role authenticated;
select tests.eq(public.is_owner(), true, 'marvin is the owner');
select tests.eq(public.is_admin(), true, 'marvin is an admin');
reset role;

select tests.login('top_g');
set role authenticated;
select tests.eq(public.is_owner(), false, 'top_g is not the owner');
select tests.eq(public.is_admin(), true, 'top_g stays an admin for coordination');
reset role;

-- Rights are gone even if the account is switched back on. Deactivate again after.
update public.agents set active = true where code = 'letty';
select tests.login('letty');
set role authenticated;
select tests.eq(public.is_owner(), false, 'letty is not the owner');
select tests.eq(public.is_admin(), false, 'letty is not an admin');
reset role;

-- ---------------------------------------------------------------------------
-- 2. Approvals: only marvin. decided_by / approved_by are the caller.
-- ---------------------------------------------------------------------------
select set_config('tests.sole_lead', (
  select l.id::text from public.leads l
   where l.stage in ('found', 'screened') and l.channel is not null
     and jsonb_array_length(public.lead_dnc_matches(l.id)) = 0
     and not exists (select 1 from public.outreach_drafts d where d.lead_id = l.id)
   limit 1), false);
select tests.login('jordan');
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.create_draft(current_setting('tests.sole_lead')::uuid, 'Hola, una idea para su web.');
  r := public.submit_draft_batch(array[(r->>'draft_id')::uuid], 'sole owner test');
  perform set_config('tests.sole_batch', r->>'batch_id', false);
  perform set_config('tests.sole_draft', (select id::text from public.outreach_drafts where batch_id = (r->>'batch_id')::uuid limit 1), false);
end $$;
reset role;

select tests.login('letty');
set role authenticated;
select tests.expect_error(
  $$select public.record_approval(current_setting('tests.sole_batch')::uuid)$$,
  'only marvin');
do $$
declare n int;
begin
  update public.catalogue_addons set price_usd = 1 where code = 'blog';
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'letty cannot write the catalogue');
  update public.agents set title = 'Hijacked' where code = 'hunter';
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'letty cannot edit the team directory');
end $$;
select tests.expect_error(
  $$insert into public.catalogue_addons (code, name, price_usd) values ('letty_hack', 'Hack', 1)$$,
  'row-level security');
reset role;

select tests.login('top_g');
set role authenticated;
select tests.expect_error(
  $$select public.record_approval(current_setting('tests.sole_batch')::uuid)$$,
  'only marvin');
do $$
declare n int;
begin
  update public.catalogue_addons set description = 'Top G edit' where code = 'blog';
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'top_g cannot write the catalogue');
  update public.agents set title = 'Hijacked' where code = 'hunter';
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'top_g cannot edit the team directory');
end $$;
reset role;

select set_config('request.jwt.claims', '{}', false);
select set_config('squad.acting_agent', 'top_g', false);
select tests.expect_error(
  $$update public.outreach_drafts set status = 'approved' where id = current_setting('tests.sole_draft')::uuid$$,
  'only marvin');
select set_config('squad.acting_agent', 'letty', false);
select tests.expect_error(
  $$update public.approval_batches set status = 'approved', decided_by = 'letty', decided_at = now()
     where id = current_setting('tests.sole_batch')::uuid$$,
  'only marvin');
select set_config('squad.acting_agent', '', false);

select tests.login('marvin');
set role authenticated;
select tests.eq((public.record_approval(current_setting('tests.sole_batch')::uuid, null, '{}', 'Marvin approved'))->>'decided_by',
                'marvin', 'marvin records the batch under his own name');
select tests.eq((select decided_by from public.approval_batches where id = current_setting('tests.sole_batch')::uuid),
                'marvin', 'batch.decided_by is marvin');
select tests.eq((select approved_by from public.outreach_drafts where id = current_setting('tests.sole_draft')::uuid),
                'marvin', 'draft.approved_by is marvin');
select tests.eq((select agent_code from public.activity_log where entity_id = current_setting('tests.sole_batch')::uuid
                  and action = 'record_approval' order by id desc limit 1),
                'marvin', 'activity log names marvin');
select tests.eq((select summary like '%for Letty%' from public.activity_log
                  where entity_id = current_setting('tests.sole_batch')::uuid and action = 'record_approval'
                  order by id desc limit 1),
                false, 'activity log does not say Top G decided for Letty');
do $$
declare n int;
begin
  update public.catalogue_packages set description = coalesce(description, '') where code = 'base';
  get diagnostics n = row_count;
  perform tests.eq(n, 1, 'marvin can write the catalogue');
  update public.agents set description = description where code = 'hunter';
  get diagnostics n = row_count;
  perform tests.eq(n, 1, 'marvin can edit the team directory');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 3. Escalations that need a human go to Marvin. Old action name still works.
-- ---------------------------------------------------------------------------
select tests.eq((select status::text from public.escalations where title like 'Green Leaf%'),
                'with_owner', 'open with_letty escalation is now with_owner');
select tests.eq((select assigned_to from public.escalations where title like 'Green Leaf%'),
                'marvin', 'that escalation is reassigned to marvin');
select tests.eq((select exists (
  select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'escalation_status' and e.enumlabel = 'with_letty')),
  false, 'escalation status with_letty is renamed away');

select tests.login('hunter');
set role authenticated;
select set_config('tests.sole_esc', (public.raise_escalation('Sole owner escalation', 'needs a human', 'high'))->>'escalation_id', false);
reset role;

select tests.login('top_g');
set role authenticated;
select public.update_escalation(current_setting('tests.sole_esc')::uuid, 'escalate_to_letty', 'Old action name');
select tests.eq((select status::text from public.escalations where id = current_setting('tests.sole_esc')::uuid),
                'with_owner', 'escalate_to_letty maps to with_owner');
select tests.eq((select assigned_to from public.escalations where id = current_setting('tests.sole_esc')::uuid),
                'marvin', 'escalate_to_letty assigns marvin');
select tests.expect_error(
  $$select public.update_escalation(current_setting('tests.sole_esc')::uuid, 'resolve', 'Top G decides for Marvin')$$,
  'only marvin');
reset role;

select tests.login('letty');
set role authenticated;
select tests.expect_error(
  $$select public.update_escalation(current_setting('tests.sole_esc')::uuid, 'resolve', 'Letty tries')$$,
  'not allowed');
reset role;

select tests.login('hunter');
set role authenticated;
select set_config('tests.sole_esc2', (public.raise_escalation('Canonical owner escalation', 'needs Marvin', 'medium'))->>'escalation_id', false);
reset role;
select tests.login('top_g');
set role authenticated;
select public.update_escalation(current_setting('tests.sole_esc2')::uuid, 'escalate_to_owner', 'Needs Marvin');
select tests.eq((select assigned_to from public.escalations where id = current_setting('tests.sole_esc2')::uuid),
                'marvin', 'escalate_to_owner assigns marvin');
reset role;
select tests.login('marvin');
set role authenticated;
select public.update_escalation(current_setting('tests.sole_esc2')::uuid, 'resolve', 'Marvin decided');
select tests.eq((select resolved_by from public.escalations where id = current_setting('tests.sole_esc2')::uuid),
                'marvin', 'marvin resolves an owner escalation');
reset role;

-- ---------------------------------------------------------------------------
-- 4. Owner-gated lead actions: signed client → lost, and deletes
-- ---------------------------------------------------------------------------
select tests.login('top_g');
set role authenticated;
select tests.expect_error($$select public.advance_stage(
  (select id from public.leads where stage in ('signed', 'in_delivery', 'delivered', 'care_plan') limit 1),
  'lost', 'coordinator tries')$$, 'only marvin');
reset role;

select tests.login('marvin');
set role authenticated;
do $$
declare v_lead uuid; v_from text;
begin
  select id, stage::text into v_lead, v_from from public.leads
   where stage in ('signed', 'in_delivery', 'delivered', 'care_plan') limit 1;
  perform public.advance_stage(v_lead, 'lost', 'Owner marks a signed client lost');
  perform tests.eq((select stage::text from public.leads where id = v_lead), 'lost', 'marvin can mark a signed client lost');
  perform public.advance_stage(v_lead, v_from::pipeline_stage, 'Restore after owner-only lost test');
  perform tests.eq((select stage::text from public.leads where id = v_lead), v_from, 'signed client restored');
end $$;
reset role;

select tests.login('hunter');
set role authenticated;
select set_config('tests.sole_lead', (public.create_lead(p_business => 'Delete Gate Studio', p_market => 'US', p_source => 'test')->>'lead_id'), false);
reset role;
select set_config('request.jwt.claims', '{}', false);
select set_config('squad.acting_agent', 'top_g', false);
select tests.expect_error($$delete from public.leads where id = current_setting('tests.sole_lead')::uuid$$, 'only marvin');
select set_config('squad.acting_agent', 'letty', false);
select tests.expect_error($$delete from public.leads where id = current_setting('tests.sole_lead')::uuid$$, 'only marvin');
select set_config('squad.acting_agent', 'marvin', false);
delete from public.leads where id = current_setting('tests.sole_lead')::uuid;
select tests.eq((select count(*) from public.leads where id = current_setting('tests.sole_lead')::uuid), 0::bigint,
                'marvin can delete a lead');
select set_config('squad.acting_agent', '', false);

-- ---------------------------------------------------------------------------
-- 5. Dashboard keys: new names, old names kept as aliases
-- ---------------------------------------------------------------------------
select tests.login('marvin');
set role authenticated;
select tests.eq(public.dashboard_metrics()->'escalations_for_owner',
                public.dashboard_metrics()->'escalations_for_letty',
                'escalations_for_letty aliases escalations_for_owner');
select tests.eq(public.dashboard_metrics()->'batches_awaiting_owner',
                public.dashboard_metrics()->'batches_awaiting_letty',
                'batches_awaiting_letty aliases batches_awaiting_owner');
select tests.eq(public.dashboard_metrics()->'drafts_awaiting_owner',
                public.dashboard_metrics()->'drafts_awaiting_letty',
                'drafts_awaiting_letty aliases drafts_awaiting_owner');
select tests.eq((public.dashboard_metrics()->>'escalations_for_marvin') is not null, true,
                'escalations_for_marvin is present');
reset role;

-- Leave Letty deactivated, matching production.
update public.agents set active = false where code = 'letty';
select tests.login('letty');
set role authenticated;
select tests.eq((select count(*) from public.leads), 0::bigint, 'deactivated letty reads nothing');
reset role;

\echo '✓ marvin sole owner tests passed'
