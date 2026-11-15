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
  perform public.advance_stage((r->>'lead_id')::uuid, 'discovery', 'Admin correction test');
  perform tests.eq((select stage::text from public.leads where id = (r->>'lead_id')::uuid), 'discovery',
                   'marvin can make any stage correction');
  perform tests.eq((select agent_code from public.stage_changes where lead_id = (r->>'lead_id')::uuid
                    order by created_at desc, id desc limit 1), 'marvin', 'stage change is logged as marvin');
end $$;
reset role;

-- Marvin decides an approval batch under his own name
select tests.login('jordan');
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.create_draft((select l.id from public.leads l
                             where l.stage in ('found', 'screened') and l.channel is not null
                               and not exists (select 1 from public.outreach_drafts d where d.lead_id = l.id)
                             limit 1), 'Hola, una idea para su web.');
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
