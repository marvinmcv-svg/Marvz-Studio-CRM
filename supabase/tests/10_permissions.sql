-- Permission + business-rule tests. Each block "logs in" as an agent by setting
-- the JWT claims exactly like PostgREST does, then switches to the
-- authenticated role so Row Level Security applies.
\set QUIET on
create schema if not exists tests;
grant usage on schema tests to authenticated, anon;

create or replace function tests.login(p_agent text) returns void language plpgsql as $$
declare v uuid;
begin
  select auth_user_id into v from public.agents where code = p_agent;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v, 'role', case when p_agent = 'anon' then 'anon' else 'authenticated' end)::text, false);
end $$;

create or replace function tests.expect_error(p_sql text, p_fragment text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(lower(p_fragment) in lower(sqlerrm)) = 0 then
      raise exception 'Expected error containing "%" but got: %', p_fragment, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected error containing "%" but statement succeeded: %', p_fragment, p_sql;
end $$;

create or replace function tests.eq(p_actual anyelement, p_expected anyelement, p_msg text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_msg, p_expected, p_actual;
  end if;
  raise notice 'ok - %', p_msg;
end $$;
grant execute on all functions in schema tests to authenticated, anon;

-- Link every agent to an auth user
insert into auth.users (id, email)
select gen_random_uuid(), code || '@squad.test' from public.agents where auth_user_id is null;
update public.agents a set auth_user_id = u.id from auth.users u where u.email = a.code || '@squad.test';

\set QUIET off
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- 1. Anonymous users see nothing
-- ---------------------------------------------------------------------------
select tests.login('anon');
set role anon;
select tests.expect_error('select count(*) from public.leads', 'permission denied');
select tests.expect_error($$select public.dashboard_metrics()$$, 'permission denied');
reset role;

-- ---------------------------------------------------------------------------
-- 2. Hunter: creates leads, nothing else
-- ---------------------------------------------------------------------------
select tests.login('hunter');
set role authenticated;
do $$
declare r jsonb; n_before bigint; n_after bigint;
begin
  select count(*) into n_before from public.activity_log;
  r := public.create_lead(p_business => 'Test Barber Club', p_email => 'barber@test.example', p_market => 'UK',
                          p_industry => 'Barber', p_channel => 'email', p_source => 'test');
  perform tests.eq(r->>'status', 'created', 'hunter creates a lead');
  select count(*) into n_after from public.activity_log;
  perform tests.eq(n_after - n_before, 1::bigint, 'create_lead writes exactly one activity row');
  perform tests.eq((select count(*) from public.stage_changes where lead_id = (r->>'lead_id')::uuid), 1::bigint,
                   'initial stage change recorded');

  r := public.create_lead(p_business => 'TEST barber club!!');
  perform tests.eq(r->>'status', 'duplicate', 'duplicate detected by normalised name');
  r := public.create_lead(p_business => 'Another', p_phone => '0161 555 0101');
  perform tests.eq(r->>'status', 'duplicate', 'duplicate detected by phone in a different format');
  r := public.create_lead(p_business => 'Ferreteria Central');
  perform tests.eq(r->>'status', 'do_not_contact', 'do-not-contact blocks lead creation');
  r := public.create_lead(p_business => 'Some Biz', p_email => 'x@spammy-leads.example');
  perform tests.eq(r->>'status', 'do_not_contact', 'do-not-contact domain blocks email');
end $$;
select tests.expect_error($$select public.create_proposal((select id from public.deals limit 1), 'x')$$, 'not allowed');
select tests.expect_error($$select public.screen_lead((select id from public.leads limit 1), true)$$, 'not allowed');
select tests.expect_error($$select public.advance_stage((select id from public.leads where stage = 'found' limit 1), 'signed', 'yolo')$$,
                          'cannot move a lead to stage signed');
select tests.expect_error($$select public.add_lesson('x', 'y')$$, 'not allowed');
-- direct table writes on another agent's domain are blocked by RLS
select tests.expect_error($$insert into public.lessons (title, body) values ('t', 'b')$$, 'row-level security');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Catalogue: only Letty edits
-- ---------------------------------------------------------------------------
select tests.login('top_g');
set role authenticated;
do $$
declare n int;
begin
  update public.catalogue_addons set price_usd = 1 where code = 'blog';
  get diagnostics n = row_count;
  perform tests.eq(n, 0, 'Top G cannot edit the catalogue (RLS filters the update)');
end $$;
select tests.expect_error($$insert into public.catalogue_addons (code, name, price_usd) values ('hack', 'Hack', 1)$$, 'row-level security');
reset role;

select tests.login('letty');
set role authenticated;
do $$
declare n int;
begin
  update public.catalogue_addons set description = 'Monthly blog posts' where code = 'blog';
  get diagnostics n = row_count;
  perform tests.eq(n, 1, 'Letty can edit the catalogue');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Jordan: drafts + batches, never approves, never sends unapproved
-- ---------------------------------------------------------------------------
select tests.login('jordan');
set role authenticated;
do $$
declare v_lead uuid; r jsonb; v_draft uuid; v_batch uuid;
begin
  select id into v_lead from public.leads l
   where l.company_id = (select id from public.companies where name = 'Test Barber Club');
  r := public.screen_lead(v_lead, true, 80, 'Good fit');
  perform tests.eq(r->>'status', 'screened', 'jordan screens a lead');
  r := public.create_draft(v_lead, 'Hi! Quick idea for your site.', 'email', 'Idea', 'en');
  v_draft := (r->>'draft_id')::uuid;
  perform tests.eq((select stage::text from public.leads where id = v_lead), 'draft_ready', 'lead moves to draft_ready');

  begin
    perform public.log_send(v_draft);
    raise exception 'log_send should have failed';
  exception when others then
    perform tests.eq(position('only drafts approved' in sqlerrm) > 0, true, 'cannot send an unapproved draft');
  end;

  begin
    update public.outreach_drafts set status = 'approved' where id = v_draft;
    raise exception 'self-approval should have failed';
  exception when others then
    perform tests.eq(position('only letty' in lower(sqlerrm)) > 0, true, 'jordan cannot self-approve');
  end;

  r := public.submit_draft_batch(array[v_draft], 'test batch');
  v_batch := (r->>'batch_id')::uuid;
  perform tests.eq(r->>'status', 'pending', 'batch submitted');

  begin
    perform public.record_approval(v_batch);
    raise exception 'jordan approval should have failed';
  exception when others then
    perform tests.eq(position('not allowed' in sqlerrm) > 0, true, 'jordan cannot record approval');
  end;

  begin
    update public.leads set stage = 'sent' where id = v_lead;
    raise exception 'direct stage jump should have failed';
  exception when others then
    perform tests.eq(position('without a sent' in sqlerrm) > 0, true, 'cannot mark sent by editing the table');
  end;
  perform set_config('tests.batch', v_batch::text, false);
  perform set_config('tests.draft', v_draft::text, false);
  perform set_config('tests.lead', v_lead::text, false);
end $$;
reset role;

select tests.login('letty');
set role authenticated;
select tests.eq((public.record_approval(current_setting('tests.batch')::uuid))->>'approved', '1', 'Letty approves the batch');
reset role;

select tests.login('jordan');
set role authenticated;
select tests.eq((public.log_send(current_setting('tests.draft')::uuid, 'msg_1'))->>'status', 'sent', 'approved draft can be sent');
select tests.eq((select stage::text from public.leads where id = current_setting('tests.lead')::uuid), 'sent', 'lead is now sent');
select tests.eq((select count(*) from public.stage_changes where lead_id = current_setting('tests.lead')::uuid), 5::bigint,
                'every stage change is in stage_changes (found, screened, draft_ready, approved, sent)');
select tests.eq((select count(*) from public.stage_changes where lead_id = current_setting('tests.lead')::uuid
                 and (agent_code is null or reason is null)), 0::bigint, 'every stage change has agent + reason');
reset role;

-- ---------------------------------------------------------------------------
-- 5. Quinn: discovery needs a source; quotes only from the catalogue
-- ---------------------------------------------------------------------------
select tests.login('quinn');
set role authenticated;
select tests.expect_error($$select public.add_discovery_note(current_setting('tests.lead')::uuid, 'answer', null)$$, 'source is required');
select tests.expect_error($$select public.quote_deal('mega_package')$$, 'quote only from the catalogue');
select tests.expect_error($$select public.quote_deal('presence', '[{"code":"free_logo"}]')$$, 'quote only from the catalogue');
do $$
declare q jsonb;
begin
  q := public.quote_deal('full_house', '[{"code":"booking_deposits"},{"code":"extra_page","qty":2}]', 'US', '40_30_30', true);
  perform tests.eq((q->>'one_off_subtotal')::numeric, 7480::numeric, 'subtotal = 5900 + 1200 + 2×190');
  perform tests.eq((q->>'rush_fee')::numeric, 1870::numeric, 'rush = +25%');
  perform tests.eq((q->>'one_off_total')::numeric, 9350::numeric, 'total with rush');
  perform tests.eq((q->'payment_schedule'->0->>'amount')::numeric, 3740::numeric, '40% kickoff');
  perform tests.eq((q->'payment_schedule'->2->>'amount')::numeric, 2805::numeric, '30% launch');

  q := public.quote_deal('presence', '[{"code":"ai_assistant"}]', 'MX', '50_50', false, 'basic');
  perform tests.eq(q->>'currency', 'MXN', 'MX quotes in pesos');
  perform tests.eq((q->>'one_off_total')::numeric, 24070::numeric + 10710, 'MX package price + converted add-on');
  perform tests.eq((q->>'monthly_total')::numeric, 570::numeric + 1070, 'monthly AI fee + care plan in MXN');
end $$;
select tests.expect_error($$select public.update_escalation((select id from public.escalations limit 1), 'resolve', 'done')$$, 'not allowed');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Dana: lessons must be anonymous; capacity is enforced
-- ---------------------------------------------------------------------------
select tests.login('dana');
set role authenticated;
select tests.eq((public.add_lesson('Call Mariela at +591 71234567', 'She liked it'))->>'status', 'rejected', 'lesson with phone rejected');
select tests.eq((public.add_lesson('Nido Kids Academy feedback', 'They liked it'))->>'status', 'rejected', 'lesson with client name rejected');
select tests.eq((public.add_lesson('Short videos beat carousels', 'Prospects respond better to 20s Loom walkthroughs.'))->>'status',
                'saved', 'anonymous lesson saved');
select tests.expect_error($$insert into public.lessons (title, body) values ('Harbour Legal said', 'x')$$, 'not anonymised');
do $$
declare v_deal uuid; i int; r jsonb; v_month date := (date_trunc('month', current_date) + interval '6 months')::date;
begin
  select id into v_deal from public.deals where status = 'signed' limit 1;
  for i in 1..4 loop
    r := public.create_project(v_deal, '[]', v_month, v_month, 'Capacity test ' || i);
  end loop;
  perform tests.eq((public.capacity(v_month))->>'remaining', '0', 'four projects fill the month');
  begin
    perform public.create_project(v_deal, '[]', v_month, v_month, 'Capacity test 5');
    raise exception 'fifth project should fail';
  exception when others then
    perform tests.eq(position('Capacity full' in sqlerrm) > 0, true, 'fifth project in a month is refused');
  end;
end $$;
select tests.expect_error($$select public.record_approval((select id from public.approval_batches limit 1))$$, 'not allowed');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Escalation chain: agent → Top G → Letty
-- ---------------------------------------------------------------------------
select tests.login('hunter');
set role authenticated;
select set_config('tests.esc', (public.raise_escalation('Test escalation', 'detail', 'high'))->>'escalation_id', false);
update public.escalations set status = 'resolved' where id = current_setting('tests.esc')::uuid;
select tests.eq((select status::text from public.escalations where id = current_setting('tests.esc')::uuid), 'open',
                'agents cannot resolve their own escalations');
reset role;
select tests.login('top_g');
set role authenticated;
select public.update_escalation(current_setting('tests.esc')::uuid, 'escalate_to_letty', 'Needs Letty');
select tests.eq((select status::text from public.escalations where id = current_setting('tests.esc')::uuid), 'with_letty', 'Top G passes to Letty');
reset role;
select tests.login('letty');
set role authenticated;
select tests.expect_error($$select public.update_escalation(current_setting('tests.esc')::uuid, 'resolve', '')$$, 'resolution notes');
select public.update_escalation(current_setting('tests.esc')::uuid, 'resolve', 'Handled by Letty');
select tests.eq((select resolved_by from public.escalations where id = current_setting('tests.esc')::uuid), 'letty', 'Letty resolves');

-- ---------------------------------------------------------------------------
-- 8. Dashboard + activity log integrity
-- ---------------------------------------------------------------------------
select tests.eq((public.dashboard_metrics()->>'mrr_usd')::numeric > 0, true, 'MRR is computed from care plans');
select tests.eq((select count(*) from public.activity_log where agent_code is null), 0::bigint, 'every activity row has an agent');
select tests.expect_error($$delete from public.activity_log$$, 'permission denied');
reset role;
select tests.login('jordan');
set role authenticated;
select tests.expect_error($$update public.activity_log set summary = 'x'$$, 'permission denied');
select tests.expect_error($$insert into public.stage_changes (lead_id, to_stage) select id, 'signed' from public.leads limit 1$$, 'permission denied');
reset role;

-- ---------------------------------------------------------------------------
-- 9. A signed-up stranger (authenticated, but not a squad member) sees nothing
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, false);
set role authenticated;
select tests.eq((select count(*) from public.leads), 0::bigint, 'stranger reads no leads');
select tests.eq((select count(*) from public.catalogue_addons), 0::bigint, 'stranger reads no catalogue');
select tests.eq(jsonb_array_length(public.find_duplicate_leads('Café Altura')), 0, 'stranger gets no duplicate info');
select tests.eq(jsonb_array_length(public.check_do_not_contact('Ferretería Central')), 0, 'stranger gets no DNC info');
select tests.expect_error($$select public.create_lead('Sneaky')$$, 'not a registered');
select tests.expect_error($$select public.dashboard_metrics()$$, 'not a registered');
select tests.expect_error($$select public._lead_name(gen_random_uuid())$$, 'permission denied');
reset role;
