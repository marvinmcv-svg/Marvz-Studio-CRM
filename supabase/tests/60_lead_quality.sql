-- Lead quality, evidence and owner controls (migration 20261115000010).
-- One section per item of the CRM master fix list.
\set QUIET off
set client_min_messages = notice;

-- fixtures: two fresh leads created by Hunter, verified where needed
select tests.login('hunter');
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.create_lead(p_business => 'Quality Fixture Bakery', p_email => 'hola@qfbakery.example', p_channel => 'email',
         p_city => 'Lima', p_country => 'PE', p_street => 'Av. Larco 1150', p_source_key => 'P527-428',
         p_details => '{"domain_status": "VERIFIED", "domain_proof_url": "https://qfbakery.example", "website_problem_type": "outdated",
                        "whatsapp": "+51 999 111 222", "whatsapp_source_url": "https://qfbakery.example/contacto",
                        "rating": 4.6, "review_count": 212, "rating_source": "Google Maps",
                        "owner_name": "Rosa Quispe", "owner_role": "Owner", "email_source_url": "https://qfbakery.example/contacto"}');
  perform set_config('tests.q1', r->>'lead_id', false);
  perform tests.eq(r->>'status', 'created', 'fixture lead created');
  r := public.create_lead(p_business => 'Quality Fixture Gym', p_email => 'hi@qfgym.example', p_channel => 'email',
         p_city => 'Quito', p_country => 'EC');
  perform set_config('tests.q2', r->>'lead_id', false);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- #12 / #11 / #10 / #7 fields stored from create_lead (with checked_at stamps)
-- ---------------------------------------------------------------------------
select tests.eq((select c.whatsapp from public.companies c join public.leads l on l.company_id = c.id
                 where l.id = current_setting('tests.q1')::uuid), '+51 999 111 222', '#12 WhatsApp stored');
select tests.eq((select c.whatsapp_checked_at is not null and c.rating = 4.6 and c.review_count = 212 and c.owner_role = 'Owner'
                 from public.companies c join public.leads l on l.company_id = c.id where l.id = current_setting('tests.q1')::uuid),
                true, '#12 rating, reviews, owner and checked_at stored');
select tests.eq((select k.email_source_url is not null and k.email_checked_at is not null
                 from public.contacts k join public.leads l on l.contact_id = k.id where l.id = current_setting('tests.q1')::uuid),
                true, '#11 email source URL + checked_at stored on the contact');
select tests.eq((select source_key from public.leads where id = current_setting('tests.q1')::uuid), 'P527-428',
                '#10 source_key stored');
select tests.eq((select domain_status || '/' || website_problem_type || '/' || (last_verified_at is not null)::text
                 from public.leads where id = current_setting('tests.q1')::uuid), 'VERIFIED/outdated/true',
                '#7 #8 evidence stored and last_verified_at stamped');

select tests.login('hunter');
set role authenticated;
select tests.expect_error($$select public.create_lead(p_business => 'Bad Details Co', p_details => '{"favourite_colour": "blue"}')$$,
                          'unknown keys');
select tests.expect_error($$select public.create_lead(p_business => 'Fake Verified Co', p_details => '{"domain_status": "VERIFIED"}')$$,
                          'needs a domain_proof_url');
select tests.expect_error($$select public.update_company_details(
  (select company_id from public.leads where id = current_setting('tests.q1')::uuid), '{"rating": 7}')$$, 'rating');
select tests.expect_error($$select public.update_company_details(
  (select company_id from public.leads where id = current_setting('tests.q1')::uuid), '{"shoe_size": 7}')$$, 'Unknown company field');
do $$
declare v_company uuid := (select company_id from public.leads where id = current_setting('tests.q1')::uuid);
begin
  perform public.update_company_details(v_company, '{"telegram": "@qfbakery", "contact_form_url": "https://qfbakery.example/form"}', 'found on site');
  perform tests.eq((select telegram_checked_at is not null and contact_form_checked_at is not null from public.companies where id = v_company),
                   true, '#11 #12 telegram + contact form get checked_at automatically');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- #2 address matching
-- ---------------------------------------------------------------------------
select tests.login('hunter');
set role authenticated;
select tests.eq((public.create_lead(p_business => 'Totally Different Name', p_street => 'AV. LARCO 1150', p_city => 'lima'))->>'status',
                'duplicate', '#2 same address (different case/punctuation) is flagged as a duplicate');
select tests.eq((public.find_duplicate_leads(p_street => 'Av Larco 1150', p_city => 'Lima'))->0->'matched_on', '["address"]'::jsonb,
                '#2 duplicate reports matched_on = address');
reset role;

-- ---------------------------------------------------------------------------
-- #9 held stage + Santa Cruz exclusion
-- ---------------------------------------------------------------------------
select tests.login('hunter');
set role authenticated;
select tests.expect_error($$select public.create_lead(p_business => 'Held No Reason', p_hold => true)$$, 'p_hold_reason is required');
do $$
declare r jsonb;
begin
  r := public.create_lead(p_business => 'Parked Pizzeria Oruro', p_phone => '+591 70123456', p_city => 'Oruro', p_country => 'BO',
                          p_hold => true, p_hold_reason => 'Domain unconfirmed');
  perform tests.eq(r->>'stage', 'held', '#9 held lead is stored at stage held');
  perform set_config('tests.held', r->>'lead_id', false);
  perform tests.eq((public.create_lead(p_business => 'Parked Pizzeria Oruro'))->>'status', 'duplicate',
                   '#9 duplicate check matches against held leads');
  r := public.create_lead(p_business => 'Plaza 24 Coffee', p_city => 'Santa Cruz de la Sierra');
  perform tests.eq(r->>'status', 'excluded_region', '#9 Santa Cruz de la Sierra lead refused');
  r := public.create_lead(p_business => 'Plaza 25 Coffee', p_city => 'santa cruz', p_country => 'Bolivia');
  perform tests.eq(r->>'status', 'excluded_region', '#9 "santa cruz, Bolivia" refused too');
  perform tests.eq((select count(*) from public.companies where name like 'Plaza 2_ Coffee'), 0::bigint,
                   '#9 nothing stored for excluded leads');
  r := public.create_lead(p_business => 'Santa Cruz Surf School', p_city => 'Santa Cruz', p_country => 'US');
  perform tests.eq(r->>'status', 'created', '#9 Santa Cruz, California is fine');
end $$;
reset role;
select tests.login('jordan');
set role authenticated;
select tests.expect_error($$select public.screen_lead(current_setting('tests.held')::uuid, true)$$, 'only found/screened');
select tests.expect_error($$select public.create_draft(current_setting('tests.held')::uuid, 'Hi', 'whatsapp', p_recipient => '+591 70123456')$$,
                          'lead is held');
reset role;

-- ---------------------------------------------------------------------------
-- #5 manual check (Marvin only) gates advance_stage and drafting
-- ---------------------------------------------------------------------------
select tests.login('top_g');
set role authenticated;
select tests.expect_error($$select public.set_manual_check(current_setting('tests.q1')::uuid, 'PASS')$$, 'Only Marvin');
reset role;
select set_config('request.jwt.claims', '{}', false);
select set_config('squad.acting_agent', 'jordan', false);
select tests.expect_error($$update public.leads set manual_check = 'PASS' where id = current_setting('tests.q1')::uuid$$, 'Only Marvin');
select set_config('squad.acting_agent', '', false);

select tests.login('jordan');
set role authenticated;
select tests.expect_error($$select public.screen_lead(current_setting('tests.q1')::uuid, true, 80, 'ok')$$, 'xx-never-xx')
  where false;  -- screening itself is not gated on the manual check
select public.screen_lead(current_setting('tests.q1')::uuid, true, 80, 'Good fit');
select tests.expect_error($$select public.create_draft(current_setting('tests.q1')::uuid, 'Hola', p_recipient => 'hola@qfbakery.example')$$,
                          'manual check is PENDING');
reset role;
select tests.login('marvin');
set role authenticated;
select tests.expect_error($$select public.set_manual_check(current_setting('tests.q1')::uuid, 'MAYBE')$$, 'PASS, FAIL or PENDING');
select tests.eq((public.set_manual_check(current_setting('tests.q1')::uuid, 'PASS', 'Site and owner checked'))->>'status', 'PASS',
                '#5 Marvin sets PASS');
reset role;

-- ---------------------------------------------------------------------------
-- #4 recipient on drafts
-- ---------------------------------------------------------------------------
select tests.login('jordan');
set role authenticated;
select tests.expect_error($$select public.create_draft(current_setting('tests.q1')::uuid, 'Hola')$$, 'p_recipient is required');
select tests.expect_error($$select public.create_draft(current_setting('tests.q1')::uuid, 'Hola', p_recipient => 'the owner')$$,
                          'is not an email');
do $$
declare r jsonb;
begin
  r := public.create_draft(current_setting('tests.q1')::uuid, 'Hola Rosa, una idea para su web.', p_recipient => 'hola@qfbakery.example');
  perform tests.eq(r->>'recipient_kind', 'email', '#4 recipient stored and classified');
  perform set_config('tests.d1', r->>'draft_id', false);
  perform tests.eq((select recipient from public.outreach_drafts where id = (r->>'draft_id')::uuid), 'hola@qfbakery.example',
                   '#4 recipient on the draft');
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- #3 holds on drafts and leads; batches refuse held items
-- ---------------------------------------------------------------------------
select tests.login('jordan');
set role authenticated;
select tests.expect_error($$select public.set_draft_hold(current_setting('tests.d1')::uuid, true)$$, 'p_reason is required');
select public.set_draft_hold(current_setting('tests.d1')::uuid, true, 'Check the owner''s name spelling');
select tests.expect_error($$select public.submit_draft_batch(array[current_setting('tests.d1')::uuid])$$, 'draft on hold');
select public.set_draft_hold(current_setting('tests.d1')::uuid, false);
select public.set_lead_hold(current_setting('tests.q1')::uuid, true, 'Owner travelling until Monday');
select tests.expect_error($$select public.submit_draft_batch(array[current_setting('tests.d1')::uuid])$$, 'lead is on hold');
select public.set_lead_hold(current_setting('tests.q1')::uuid, false);
reset role;

-- ---------------------------------------------------------------------------
-- #6 two-way relation freezes both leads until Marvin clears it
-- ---------------------------------------------------------------------------
select tests.login('hunter');
set role authenticated;
select public.link_leads(current_setting('tests.q1')::uuid, current_setting('tests.q2')::uuid, 'sister', 'Same owner, two branches');
select tests.eq((select count(*) from public.lead_relations
                 where status = 'frozen' and ((lead_a = current_setting('tests.q1')::uuid and lead_b = current_setting('tests.q2')::uuid)
                                           or (lead_a = current_setting('tests.q2')::uuid and lead_b = current_setting('tests.q1')::uuid))),
                2::bigint, '#6 relation written for both sides');
reset role;
select tests.login('jordan');
set role authenticated;
select tests.expect_error($$select public.screen_lead(current_setting('tests.q2')::uuid, true)$$, 'frozen');
select tests.expect_error($$select public.submit_draft_batch(array[current_setting('tests.d1')::uuid])$$, 'frozen');
select tests.expect_error($$select public.create_draft(current_setting('tests.q1')::uuid, 'Hola', p_recipient => 'hola@qfbakery.example')$$,
                          'frozen');
select tests.expect_error($$select public.clear_lead_link(current_setting('tests.q1')::uuid, current_setting('tests.q2')::uuid, 'ok')$$,
                          'Only Marvin');
reset role;
select tests.login('marvin');
set role authenticated;
select tests.expect_error($$select public.clear_lead_link(current_setting('tests.q1')::uuid, current_setting('tests.q2')::uuid, '')$$,
                          'p_note is required');
select tests.eq((public.clear_lead_link(current_setting('tests.q1')::uuid, current_setting('tests.q2')::uuid,
                 'Different businesses, same family'))->'still_frozen', '{"a": false, "b": false}'::jsonb,
                '#6 Marvin clears the link for both leads');
reset role;
select tests.login('jordan');
set role authenticated;
select tests.eq((public.submit_draft_batch(array[current_setting('tests.d1')::uuid]))->>'status', 'pending',
                '#3 #6 batch accepted once nothing is held or frozen');
reset role;

-- ---------------------------------------------------------------------------
-- #7 UNVERIFIED domain blocks drafting; fields filterable
-- ---------------------------------------------------------------------------
select tests.login('marvin');
set role authenticated;
select public.set_manual_check(current_setting('tests.q2')::uuid, 'PASS');
reset role;
select tests.login('jordan');
set role authenticated;
select tests.expect_error($$select public.create_draft(current_setting('tests.q2')::uuid, 'Hi', p_recipient => 'hi@qfgym.example')$$,
                          'domain_status is UNVERIFIED');
select tests.eq((select count(*) > 0 from public.leads where domain_status = 'UNVERIFIED'), true,
                '#7 domain_status is a plain filterable column');
reset role;

-- ---------------------------------------------------------------------------
-- #8 stale leads
-- ---------------------------------------------------------------------------
update public.leads set last_verified_at = now() - interval '45 days' where id = current_setting('tests.q2')::uuid;
select tests.login('quinn');
set role authenticated;
select tests.eq((select bool_or(x->>'lead_id' = current_setting('tests.q2')) from jsonb_array_elements(public.stale_leads(30)) x),
                true, '#8 lead not verified for 45 days is listed as stale');
select tests.eq((select bool_or(x->>'lead_id' = current_setting('tests.q2')) from jsonb_array_elements(public.stale_leads(60)) x),
                false, '#8 but not when the window is 60 days');
reset role;
select tests.login('hunter');
set role authenticated;
select public.update_lead(current_setting('tests.q2')::uuid, '{"domain_status": "NSC", "website_problem_type": "no_site"}', 'Confirmed no site');
select tests.eq((select last_verified_at > now() - interval '1 minute' from public.leads where id = current_setting('tests.q2')::uuid),
                true, '#8 updating evidence refreshes last_verified_at');
select tests.expect_error($$select public.update_lead(current_setting('tests.q2')::uuid, '{"manual_check": "PASS"}')$$, 'Marvin only');
reset role;

-- ---------------------------------------------------------------------------
-- #1 delete (Marvin only, type-to-confirm, audit snapshot)
-- ---------------------------------------------------------------------------
select tests.login('top_g');
set role authenticated;
select tests.expect_error($$select public.delete_lead(current_setting('tests.held')::uuid, 'SQ-1', 'test')$$, 'Only Marvin');
reset role;
select tests.login('marvin');
set role authenticated;
select tests.expect_error($$select public.delete_lead(current_setting('tests.held')::uuid, 'SQ-0', 'test')$$, 'Confirmation does not match');
select tests.expect_error($$select public.delete_lead(current_setting('tests.held')::uuid,
  (select 'SQ-' || ref from public.leads where id = current_setting('tests.held')::uuid), '')$$, 'p_reason is required');
select tests.expect_error($$select public.delete_lead((select lead_id from public.deals where status = 'signed' limit 1),
  (select 'SQ-' || l.ref from public.leads l join public.deals d on d.lead_id = l.id where d.status = 'signed' limit 1), 'x')$$,
  'cannot be deleted');
do $$
declare v_id uuid := current_setting('tests.held')::uuid; v_code text; v_company uuid; r jsonb;
begin
  select 'SQ-' || ref, company_id into v_code, v_company from public.leads where id = v_id;
  r := public.delete_lead(v_id, v_code, 'Test lead, created by mistake');
  perform tests.eq(r->>'status', 'deleted', '#1 Marvin deletes with the typed code');
  perform tests.eq((select count(*) from public.leads where id = v_id), 0::bigint, '#1 lead is gone');
  perform tests.eq((select count(*) from public.companies where id = v_company), 0::bigint, '#1 orphan company removed');
  perform tests.eq((select payload->'snapshot'->'lead'->>'code' from public.activity_log
                    where action = 'delete_lead' order by id desc limit 1), v_code, '#1 audit entry keeps a full snapshot');
end $$;
reset role;

-- direct table writes on the new tables are refused
select tests.login('hunter');
set role authenticated;
select tests.expect_error($$insert into public.lead_relations (group_id, lead_a, lead_b, relation)
  values (gen_random_uuid(), current_setting('tests.q1')::uuid, current_setting('tests.q2')::uuid, 'duplicate')$$, 'permission denied');
select tests.expect_error($$insert into public.import_batches (source_file) values ('x')$$, 'permission denied');
reset role;

\echo '✓ lead quality tests passed'
