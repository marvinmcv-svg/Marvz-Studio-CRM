-- Marvin (migration 20261114000007) is a human admin with owner rights.
\set QUIET off
set client_min_messages = notice;

select tests.login('marvin');
set role authenticated;
select tests.eq(public.is_admin(), true, 'marvin is an admin');
select tests.eq((public.dashboard_metrics()->>'mrr_usd') is not null, true, 'marvin sees MRR');
do $$
declare n int; r jsonb;
begin
  update public.catalogue_addons set description = 'Monthly blog posts (edited by Marvin)' where code = 'blog';
  get diagnostics n = row_count;
  perform tests.eq(n, 1, 'marvin can edit the catalogue');
  r := public.create_lead(p_business => 'Marvin Admin Test Studio', p_market => 'US', p_source => 'test');
  perform tests.eq(r->>'status', 'created', 'marvin can create leads');
  perform public.set_manual_check((r->>'lead_id')::uuid, 'PASS', 'checked');
  perform public.advance_stage((r->>'lead_id')::uuid, 'discovery', 'Admin correction test');
  perform tests.eq((select stage::text from public.leads where id = (r->>'lead_id')::uuid), 'discovery',
                   'marvin can make any stage correction');
  perform tests.eq((select agent_code from public.stage_changes where lead_id = (r->>'lead_id')::uuid
                    order by created_at desc, id desc limit 1), 'marvin', 'stage change is logged as marvin');
end $$;
reset role;

-- Marvin decides an approval batch under his own name
select tests.login('marvin');
set role authenticated;
select set_config('tests.mlead', (public.create_lead(p_business => 'Approval Path Florist', p_channel => 'email',
  p_email => 'hello@approvalpath.example', p_city => 'Lima', p_country => 'PE',
  p_details => '{"domain_status": "VERIFIED", "domain_proof_url": "https://approvalpath.example"}'))->>'lead_id', false);
select public.set_manual_check(current_setting('tests.mlead')::uuid, 'PASS', 'test');
reset role;
select tests.login('jordan');
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.create_draft(current_setting('tests.mlead')::uuid, 'Hola, una idea para su web.',
                           p_recipient => 'owner@marvin-test.example');
  r := public.submit_draft_batch(array[(r->>'draft_id')::uuid], 'marvin test');
  perform set_config('tests.mbatch', r->>'batch_id', false);
end $$;
reset role;
select tests.login('marvin');
set role authenticated;
select tests.eq((public.record_approval(current_setting('tests.mbatch')::uuid))->>'decided_by', 'marvin',
                'marvin records approvals under his own name');
reset role;

-- Other agents still cannot edit the catalogue
select tests.login('top_g');
set role authenticated;
do $$
declare n int;
begin
  update public.catalogue_addons set price_usd = 1 where code = 'blog';
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'top_g still cannot edit the catalogue');
end $$;
reset role;

\echo '✓ marvin admin tests passed'
