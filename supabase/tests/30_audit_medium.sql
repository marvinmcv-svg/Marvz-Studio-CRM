-- Regression tests for migration 20261114000006_audit_medium.sql.
\set QUIET off
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- 1. Approvals record who actually decided
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', false);
select set_config('tests.appr_lead', (
  select l.id::text from public.leads l
   where l.stage in ('found', 'screened') and jsonb_array_length(public.lead_dnc_matches(l.id)) = 0
   limit 1), false);

select tests.login('jordan');
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.create_draft(current_setting('tests.appr_lead')::uuid, 'Hola, una idea rápida para su web.', 'email');
  perform set_config('tests.appr_draft', r->>'draft_id', false);
  r := public.submit_draft_batch(array[(r->>'draft_id')::uuid], 'decider test');
  perform set_config('tests.appr_batch', r->>'batch_id', false);
end $$;
reset role;

select tests.login('top_g');
set role authenticated;
select tests.expect_error($$select public.record_approval(current_setting('tests.appr_batch')::uuid)$$,
                          'only marvin');
reset role;

select tests.login('marvin');
set role authenticated;
select tests.eq((public.record_approval(current_setting('tests.appr_batch')::uuid))->>'decided_by', 'marvin',
                'record_approval reports the real decider');
select tests.eq((select decided_by from public.approval_batches where id = current_setting('tests.appr_batch')::uuid),
                'marvin', 'batch.decided_by is Marvin when Marvin records the decision');
select tests.eq((select approved_by from public.outreach_drafts where id = current_setting('tests.appr_draft')::uuid),
                'marvin', 'draft.approved_by is Marvin when Marvin records the decision');
select tests.eq((select reason from public.stage_changes where lead_id = current_setting('tests.appr_lead')::uuid
                 and to_stage = 'approved' order by created_at desc limit 1) like 'Approved by Marvin%', true,
                'stage history names Marvin, not someone approving for him');
reset role;

select tests.eq((select count(*) from public.approval_batches b
                 where b.status <> 'pending' and b.decided_by = 'marvin'
                   and exists (select 1 from public.activity_log a where a.entity_id = b.id
                               and a.action = 'record_approval' and a.agent_code = 'marvin')) > 0, true,
                'batches Marvin decided record marvin');

-- ---------------------------------------------------------------------------
-- 2. Dashboard MRR follows care-plan read rights
-- ---------------------------------------------------------------------------
select tests.login('hunter');
set role authenticated;
select tests.eq(public.dashboard_metrics()->'mrr_usd', 'null'::jsonb, 'hunter does not see MRR');
select tests.eq(public.dashboard_metrics()->'committed_mrr_usd', 'null'::jsonb, 'hunter does not see committed MRR');
select tests.eq((public.dashboard_metrics()->>'pipeline_value_usd') is not null, true, 'hunter still sees the pipeline');
reset role;
select tests.login('quinn');
set role authenticated;
select tests.eq(public.dashboard_metrics()->'mrr_usd', 'null'::jsonb, 'quinn does not see MRR');
reset role;
select tests.login('dana');
set role authenticated;
select tests.eq((public.dashboard_metrics()->>'mrr_usd')::numeric > 0, true, 'dana sees MRR');
reset role;
select tests.login('top_g');
set role authenticated;
select tests.eq((public.dashboard_metrics()->>'mrr_usd')::numeric > 0, true, 'top_g sees MRR');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Function privileges
-- ---------------------------------------------------------------------------
-- a function added by a future migration is private until granted
create function public.zz_future_helper() returns int language sql as $$ select 1 $$;
select tests.eq(has_function_privilege('anon', 'public.zz_future_helper()', 'execute'), false,
                'new functions are not executable by anon');
select tests.eq(has_function_privilege('authenticated', 'public.zz_future_helper()', 'execute'), false,
                'new functions are not executable by authenticated until granted');
drop function public.zz_future_helper();

-- nothing in public is callable without signing in
select tests.eq((select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')),
                null, 'anon can execute no public function');

-- internals are not part of the API
select tests.eq((select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
                   and (p.proname like '\_%' or p.proname like 'guard\_%'
                        or p.proname in ('log_activity', 'log_initial_stage', 'lesson_privacy_issues',
                                         'lead_dnc_matches', 'touch_updated_at'))),
                null, 'authenticated can execute no internal helper');

-- ---------------------------------------------------------------------------
-- 4. Kill switch: a deactivated agent's existing token is refused everywhere
--    (what `npm run setup-agents -- --revoke hunter` does)
-- ---------------------------------------------------------------------------
update public.agents set active = false where code = 'hunter';
select tests.login('hunter');
set role authenticated;
select tests.expect_error($$select public.create_lead('Revoked Agent Cafe')$$, 'not a registered');
select tests.eq((select count(*) from public.leads), 0::bigint, 'revoked agent reads no leads');
select tests.eq((select count(*) from public.agents), 0::bigint, 'revoked agent is not recognised by the app');
reset role;
update public.agents set active = true where code = 'hunter';
select tests.login('hunter');
set role authenticated;
select tests.eq((select count(*) from public.leads) > 0, true, 're-activated agent works again');
reset role;

\echo '✓ audit (medium) tests passed'
