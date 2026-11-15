-- Regression tests for the audit fixes (migration 20261114000005_hardening.sql).
-- Each block reproduces a bypass that used to work and checks it is now refused.
-- Uses tests.login / tests.eq / tests.expect_error from 10_permissions.sql.
\set QUIET off
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- 1. No direct writes to pipeline-critical tables (every agent, admins too)
-- ---------------------------------------------------------------------------
select tests.login('jordan');
set role authenticated;
select tests.expect_error($$insert into public.approval_batches (status, submitted_by) values ('approved', 'jordan')$$,
                          'permission denied');
select tests.expect_error($$insert into public.outreach_drafts (lead_id, channel, body, status)
                            select id, 'whatsapp', 'unapproved', 'sent' from public.leads limit 1$$, 'permission denied');
select tests.expect_error($$update public.outreach_drafts set body = 'edited after approval' where status = 'approved'$$,
                          'permission denied');
select tests.expect_error($$update public.leads set stage = 'sent'$$, 'permission denied');
reset role;

select tests.login('quinn');
set role authenticated;
select tests.expect_error($$update public.deals set one_off_total = 1$$, 'permission denied');
select tests.expect_error($$update public.deal_items set unit_price = 1$$, 'permission denied');
reset role;

select tests.login('dana');
set role authenticated;
select tests.expect_error($$update public.payments set amount = 0, status = 'paid'$$, 'permission denied');
select tests.expect_error($$insert into public.projects (name) values ('Sneaky project')$$, 'permission denied');
reset role;

select tests.login('hunter');
set role authenticated;
select tests.expect_error($$delete from public.do_not_contact$$, 'permission denied');
reset role;

select tests.login('top_g');
set role authenticated;
select tests.expect_error($$update public.outreach_drafts set status = 'sent'$$, 'permission denied');
reset role;

-- ---------------------------------------------------------------------------
-- 2. Guards still hold for writes that bypass grants (definer code, SQL editor).
--    Runs as postgres acting as an agent via squad.acting_agent.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', false);
select set_config('squad.acting_agent', 'jordan', false);
select tests.expect_error($$insert into public.approval_batches (status, submitted_by) values ('approved', 'jordan')$$,
                          'new batches start as pending');
select tests.expect_error($$insert into public.outreach_drafts (lead_id, channel, body, status)
                            select id, 'whatsapp', 'x', 'sent' from public.leads limit 1$$, 'start as draft/ready');
select tests.expect_error($$insert into public.outreach_drafts (lead_id, channel, body, status, batch_id)
                            select (select id from public.leads limit 1), 'whatsapp', 'x', 'ready', id
                            from public.approval_batches where status = 'approved' limit 1$$, 'start as draft/ready');
select tests.expect_error($$update public.outreach_drafts set body = 'edited' where status in ('approved', 'sent', 'in_batch')$$,
                          'content is locked');
select tests.expect_error($$update public.outreach_drafts set status = 'rejected' where status = 'ready'$$, 'only letty');
-- even Top G cannot change what Letty approved
select set_config('squad.acting_agent', 'top_g', false);
select tests.expect_error($$update public.outreach_drafts set body = 'edited' where status = 'approved'$$, 'content is locked');
select tests.expect_error($$update public.outreach_drafts set status = 'approved' where status = 'sent'$$, 'already sent');
select tests.expect_error($$update public.approval_batches set status = 'pending' where status = 'approved'$$, 'already decided');
select set_config('squad.acting_agent', '', false);

-- ---------------------------------------------------------------------------
-- 3. Stage moves are checked against the CURRENT stage
-- ---------------------------------------------------------------------------
select tests.login('hunter');
set role authenticated;
select tests.expect_error($$select public.advance_stage(
  (select id from public.leads where stage in ('signed', 'in_delivery', 'delivered', 'care_plan') limit 1), 'lost', 'oops')$$,
  'cannot move a lead from');
select tests.expect_error($$select public.advance_stage(
  (select id from public.leads where stage = 'replied' limit 1), 'found', 'restart')$$, 'cannot move a lead from replied to found');
reset role;

select tests.login('quinn');
set role authenticated;
select tests.expect_error($$select public.advance_stage(
  (select id from public.leads where stage in ('in_delivery', 'delivered', 'care_plan') limit 1), 'replied', 'back')$$,
  'cannot move a lead from');
select tests.expect_error($$select public.advance_stage(
  (select id from public.leads where stage = 'screened' limit 1), 'proposal', 'skip ahead')$$, 'cannot move a lead from');
select tests.expect_error($$select public.advance_stage(
  (select id from public.leads where stage = 'discovery' and not public.lead_is_frozen(id) limit 1), 'signed', 'no deal')$$, 'without a signed deal');
select tests.expect_error($$select public.advance_stage(
  (select id from public.leads where stage = 'lost' limit 1), 'discovery', 'revive')$$, 'cannot move a lead from');
-- a late reply never drags a client back down the pipeline
do $$
declare v_lead uuid; v_stage text; r jsonb;
begin
  select id, stage::text into v_lead, v_stage from public.leads where stage = 'in_delivery' limit 1;
  r := public.log_reply(v_lead, 'Thanks for the update!');
  perform tests.eq((select stage::text from public.leads where id = v_lead), v_stage, 'log_reply leaves an in-delivery lead in place');
  perform tests.eq((select owner_agent from public.leads where id = v_lead), 'dana', 'log_reply does not steal the lead from Dana');
end $$;
reset role;

select tests.login('dana');
set role authenticated;
select tests.expect_error($$select public.advance_stage(
  (select id from public.leads where stage = 'proposal' limit 1), 'in_delivery', 'skip')$$, 'cannot move a lead from');
reset role;

-- Admins can still correct anything, once Marvin's manual check is PASS (migration 10)
select set_config('tests.lost_lead', (select id::text from public.leads where stage = 'lost' limit 1), false);
select tests.login('top_g');
set role authenticated;
select tests.expect_error($$select public.advance_stage(current_setting('tests.lost_lead')::uuid, 'found', 'Re-open')$$,
                          'manual check is PENDING');
reset role;
select tests.login('marvin');
set role authenticated;
select public.set_manual_check(current_setting('tests.lost_lead')::uuid, 'PASS', 'Referral confirmed');
reset role;
select tests.login('top_g');
set role authenticated;
do $$
begin
  perform public.advance_stage(current_setting('tests.lost_lead')::uuid, 'found', 'Re-opened by Top G after a referral');
  perform tests.eq((select stage::text from public.leads where id = current_setting('tests.lost_lead')::uuid), 'found',
                   'Top G can re-open a lost lead after Marvin''s PASS');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Do-not-contact is enforced at draft and send time
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', false);
do $$
declare v_draft uuid; v_lead uuid; v_phone text; v_found uuid; v_email text;
begin
  -- an approved, unsent draft whose contact has a phone number
  select d.id, d.lead_id, k.phone into v_draft, v_lead, v_phone
    from public.outreach_drafts d join public.leads l on l.id = d.lead_id
    join public.contacts k on k.id = l.contact_id
   where d.status = 'approved' and k.phone is not null limit 1;
  perform tests.eq(v_draft is not null, true, 'fixture: an approved draft exists');
  perform set_config('tests.dnc_draft', v_draft::text, false);
  perform set_config('tests.dnc_lead', v_lead::text, false);
  perform set_config('tests.dnc_phone', v_phone, false);

  -- simulate an entry that landed without the clean-up (e.g. imported in the SQL editor)
  insert into public.do_not_contact (kind, value, reason, added_by) values ('phone', v_phone, 'Imported', 'top_g');

  select l.id, k.email into v_found, v_email from public.leads l join public.contacts k on k.id = l.contact_id
   where l.stage in ('found', 'screened') and k.email is not null limit 1;
  insert into public.do_not_contact (kind, value, reason, added_by) values ('email', v_email, 'Imported', 'top_g');
  perform set_config('tests.dnc_found', v_found::text, false);
end $$;

select tests.login('jordan');
set role authenticated;
select tests.expect_error($$select public.log_send(current_setting('tests.dnc_draft')::uuid)$$, 'do-not-contact');
select tests.expect_error($$select public.create_draft(current_setting('tests.dnc_found')::uuid, 'Hi!', 'email', p_recipient => 'someone@else.example')$$, 'do-not-contact');
do $$
declare r jsonb;
begin
  -- adding (or re-adding) an entry without naming a lead blocks every matching lead
  r := public.add_do_not_contact('phone', current_setting('tests.dnc_phone'), 'Asked us to stop');
  perform tests.eq((r->>'leads_blocked')::int >= 1, true, 'add_do_not_contact blocks matching leads');
  perform tests.eq((select stage::text from public.leads where id = current_setting('tests.dnc_lead')::uuid),
                   'do_not_contact', 'matching lead moved to do-not-contact');
  perform tests.eq((select status::text from public.outreach_drafts where id = current_setting('tests.dnc_draft')::uuid),
                   'rejected', 'approved draft cancelled');
end $$;
select tests.expect_error($$select public.log_send(current_setting('tests.dnc_draft')::uuid)$$, 'only drafts approved');
select tests.expect_error($$select public.log_reply(current_setting('tests.dnc_lead')::uuid, 'hi again')$$, 'do-not-contact');
reset role;

-- ---------------------------------------------------------------------------
-- 5. Capacity is enforced on the table, not only in create_project
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{}', false);
select set_config('squad.acting_agent', 'dana', false);
do $$
declare v_month date := (date_trunc('month', current_date) + interval '9 months')::date; i int;
begin
  for i in 1..4 loop
    insert into public.projects (name, slot_month) values ('Direct capacity test ' || i, v_month + 3);
  end loop;
  perform tests.eq((select count(*) from public.projects where slot_month = v_month), 4::bigint,
                   'slot_month is normalised to the first of the month');
  begin
    insert into public.projects (name, slot_month) values ('Direct capacity test 5', v_month);
    raise exception 'fifth project should fail';
  exception when others then
    perform tests.eq(position('Capacity full' in sqlerrm) > 0, true, 'fifth project refused even on a direct insert');
  end;
  begin
    update public.projects set slot_month = v_month
     where id = (select id from public.projects where slot_month <> v_month limit 1);
    raise exception 'moving a project into a full month should fail';
  exception when others then
    perform tests.eq(position('Capacity full' in sqlerrm) > 0, true, 'cannot move a project into a full month');
  end;
end $$;
select set_config('squad.acting_agent', '', false);

-- ---------------------------------------------------------------------------
-- 6. Signing: only quoted/proposed deals, once; other quotes are superseded
-- ---------------------------------------------------------------------------
select tests.login('quinn');
set role authenticated;
do $$
declare v_lead uuid; a uuid; b uuid; r jsonb;
begin
  select id into v_lead from public.leads where stage = 'discovery' limit 1;
  a := (public.create_deal(v_lead, 'presence') ->> 'deal_id')::uuid;
  b := (public.create_deal(v_lead, 'full_house')->> 'deal_id')::uuid;
  perform public.create_proposal(a, 'Presence site', '[]', null, true);
  r := public.sign_deal(a);
  perform tests.eq(r->>'status', 'signed', 'proposed deal can be signed');
  perform tests.eq((select stage::text from public.leads where id = v_lead), 'signed', 'lead moves to signed');
  perform tests.eq((select status::text from public.deals where id = b), 'lost', 'other open quote is superseded');
  perform set_config('tests.deal_signed', a::text, false);
  perform set_config('tests.deal_superseded', b::text, false);
end $$;
select tests.expect_error($$select public.sign_deal(current_setting('tests.deal_signed')::uuid)$$, 'only quoted or proposed');
select tests.expect_error($$select public.sign_deal(current_setting('tests.deal_superseded')::uuid)$$, 'only quoted or proposed');
select tests.expect_error($$select public.sign_deal(gen_random_uuid())$$, 'not found');
reset role;

\echo '✓ hardening tests passed'
