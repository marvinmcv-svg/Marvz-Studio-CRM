-- =============================================================================
-- Squad CRM — Agent API (Supabase RPC functions)
--
-- Grokbot agents call ONE function per step:  POST /rest/v1/rpc/<name>
-- Every function: checks the caller's role, validates input, writes the change,
-- and writes a row to activity_log. All return jsonb so agents get a
-- predictable, self-describing result.
--
-- See docs/AGENT_API.md for per-agent documentation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------
create or replace function public._move_stage(p_lead_id uuid, p_stage pipeline_stage, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('squad.reason', coalesce(p_reason, ''), true);
  update public.leads set stage = p_stage where id = p_lead_id and stage is distinct from p_stage;
  perform set_config('squad.reason', '', true);
end $$;

create or replace function public._lead_name(p_lead_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select c.name from public.leads l join public.companies c on c.id = l.company_id where l.id = p_lead_id
$$;

create or replace function public._term(p_key text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from public.catalogue_terms where key = p_key
$$;

-- Market price for a USD catalogue amount (rounded to a clean number).
create or replace function public.market_price(p_usd numeric, p_market text) returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(p_usd, 0) = 0 then 0
    when upper(p_market) = 'US' then p_usd
    else round(p_usd * m.factor / 10) * 10
  end
  from public.markets m where m.code = upper(p_market)
$$;

-- -----------------------------------------------------------------------------
-- Read helpers for agents
-- -----------------------------------------------------------------------------

-- Everything an agent needs to know about one lead, in one call.
create or replace function public.get_lead_context(p_lead_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_member() then raise exception 'Not a registered Squad CRM agent' using errcode = '42501'; end if;
  select jsonb_build_object(
    'lead', to_jsonb(l) || jsonb_build_object('code', 'SQ-' || l.ref),
    'company', to_jsonb(c),
    'contact', to_jsonb(k),
    'stage_history', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.stage_changes s where s.lead_id = l.id), '[]'),
    'drafts', coalesce((select jsonb_agg(to_jsonb(d) order by d.created_at) from public.outreach_drafts d where d.lead_id = l.id), '[]'),
    'discovery_notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from public.discovery_notes n where n.lead_id = l.id), '[]'),
    'deals', coalesce((select jsonb_agg(to_jsonb(dl) order by dl.created_at) from public.deals dl where dl.lead_id = l.id), '[]'),
    'proposals', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at) from public.proposals p where p.lead_id = l.id), '[]'),
    'open_escalations', coalesce((select jsonb_agg(to_jsonb(e)) from public.escalations e where e.lead_id = l.id and e.status not in ('resolved', 'dismissed')), '[]')
  ) into v
  from public.leads l
  join public.companies c on c.id = l.company_id
  left join public.contacts k on k.id = l.contact_id
  where l.id = p_lead_id;
  if v is null then raise exception 'Lead % not found', p_lead_id; end if;
  return v;
end $$;

-- Is this business / contact on the do-not-contact list?
create or replace function public.check_do_not_contact(
  p_business text default null, p_email text default null, p_phone text default null,
  p_website text default null, p_instagram text default null
) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', d.kind, 'value', d.value, 'reason', d.reason)), '[]')
  from public.do_not_contact d
  where public.is_member() and ((d.kind = 'business'  and d.value_norm = public.norm_text(p_business))
     or (d.kind = 'email'     and d.value_norm = nullif(lower(trim(p_email)), ''))
     or (d.kind = 'phone'     and d.value_norm = public.norm_phone(p_phone))
     or (d.kind = 'domain'    and (d.value_norm = public.norm_domain(p_website)
                                   or d.value_norm = split_part(nullif(lower(trim(p_email)), ''), '@', 2)))
     or (d.kind = 'instagram' and d.value_norm = public.norm_handle(p_instagram)))
$$;

-- Possible duplicates of a new lead (by business name, domain, email, phone, Instagram).
create or replace function public.find_duplicate_leads(
  p_business text default null, p_email text default null, p_phone text default null,
  p_website text default null, p_instagram text default null
) returns jsonb
language sql stable security definer set search_path = public as $$
  with hits as (
    select l.id as lead_id, 'SQ-' || l.ref as code, c.name as business, l.stage::text as stage,
           array_remove(array[
             case when c.name_norm = public.norm_text(p_business) then 'business name'
                  when length(public.norm_text(p_business)) >= 6 and length(c.name_norm) >= 6
                       and (position(public.norm_text(p_business) in c.name_norm) > 0
                            or position(c.name_norm in public.norm_text(p_business)) > 0) then 'similar name' end,
             case when c.domain_norm is not null and c.domain_norm = public.norm_domain(p_website) then 'website' end,
             case when c.instagram_norm is not null and c.instagram_norm = public.norm_handle(p_instagram) then 'instagram' end,
             case when exists (select 1 from public.contacts k where k.company_id = c.id
                               and k.email_norm = nullif(lower(trim(p_email)), '')) then 'email' end,
             case when exists (select 1 from public.contacts k where k.company_id = c.id
                               and k.phone_norm = public.norm_phone(p_phone)) then 'phone' end
           ], null) as matched_on
    from public.leads l join public.companies c on c.id = l.company_id
  )
  select coalesce(jsonb_agg(to_jsonb(h)), '[]') from hits h where cardinality(h.matched_on) > 0 and public.is_member()
$$;

-- -----------------------------------------------------------------------------
-- HUNTER — create_lead
-- -----------------------------------------------------------------------------
create or replace function public.create_lead(
  p_business         text,
  p_contact_name     text default null,
  p_email            text default null,
  p_phone            text default null,
  p_website          text default null,
  p_instagram        text default null,
  p_industry         text default null,
  p_city             text default null,
  p_country          text default null,
  p_market           text default 'US',
  p_service_interest text[] default '{}',
  p_budget_band      text default 'unknown',
  p_timeline         text default null,
  p_languages        text[] default '{es}',
  p_source           text default null,
  p_channel          outreach_channel default null,
  p_portfolio_case   text default null,
  p_notes            text default null,
  p_force            boolean default false   -- create even if possible duplicates exist
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('hunter');
  v_dnc jsonb; v_dupes jsonb;
  v_company uuid; v_contact uuid; v_lead uuid; v_ref bigint;
begin
  if coalesce(trim(p_business), '') = '' then
    raise exception 'p_business is required';
  end if;

  v_dnc := public.check_do_not_contact(p_business, p_email, p_phone, p_website, p_instagram);
  if jsonb_array_length(v_dnc) > 0 then
    perform public.log_activity('create_lead_blocked', 'lead', null, null,
      format('Blocked lead "%s": on do-not-contact list', p_business), jsonb_build_object('matches', v_dnc));
    return jsonb_build_object('status', 'do_not_contact', 'created', false, 'matches', v_dnc,
      'message', 'This business is on the do-not-contact list. Do not create or contact it.');
  end if;

  v_dupes := public.find_duplicate_leads(p_business, p_email, p_phone, p_website, p_instagram);
  if jsonb_array_length(v_dupes) > 0 and not p_force then
    return jsonb_build_object('status', 'duplicate', 'created', false, 'matches', v_dupes,
      'message', 'Possible duplicate. Review matches; call again with p_force => true only if it is genuinely a different business.');
  end if;

  insert into public.companies (name, website, instagram, industry, city, country, market_code, notes, created_by)
  values (trim(p_business), p_website, p_instagram, p_industry, p_city, p_country, upper(p_market), p_notes, me)
  returning id into v_company;

  if coalesce(p_contact_name, p_email, p_phone) is not null then
    insert into public.contacts (company_id, full_name, email, phone, languages, created_by)
    values (v_company, coalesce(p_contact_name, 'Unknown contact'), p_email, p_phone, coalesce(p_languages, '{}'), me)
    returning id into v_contact;
  end if;

  perform set_config('squad.reason', coalesce('Found via ' || p_source, 'Lead created'), true);
  insert into public.leads (company_id, contact_id, stage, industry, service_interest, market_code, budget_band,
                            timeline, languages, source, channel, portfolio_case, owner_agent, created_by)
  values (v_company, v_contact, 'found', p_industry, coalesce(p_service_interest, '{}'), upper(p_market),
          coalesce(p_budget_band, 'unknown'), p_timeline, coalesce(p_languages, '{}'), p_source, p_channel,
          p_portfolio_case, 'jordan', me)
  returning id, ref into v_lead, v_ref;
  perform set_config('squad.reason', '', true);

  perform public.log_activity('create_lead', 'lead', v_lead, v_lead,
    format('Created lead SQ-%s %s (%s, %s)', v_ref, p_business, coalesce(p_industry, 'industry n/a'), upper(p_market)),
    jsonb_build_object('source', p_source, 'channel', p_channel, 'forced_despite_duplicates',
                       case when jsonb_array_length(v_dupes) > 0 then v_dupes end));

  return jsonb_build_object('status', 'created', 'created', true, 'lead_id', v_lead, 'code', 'SQ-' || v_ref,
                            'company_id', v_company, 'contact_id', v_contact,
                            'possible_duplicates', v_dupes);
end $$;

-- HUNTER / any — update lead fields (not the stage; use advance_stage)
create or replace function public.update_lead(p_lead_id uuid, p_fields jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana');
begin
  if p_fields ? 'stage' then raise exception 'Use advance_stage to change the stage'; end if;
  update public.leads l set
    industry         = coalesce(p_fields->>'industry', l.industry),
    service_interest = coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'service_interest') x), l.service_interest),
    market_code      = coalesce(upper(p_fields->>'market_code'), l.market_code),
    budget_band      = coalesce(p_fields->>'budget_band', l.budget_band),
    timeline         = coalesce(p_fields->>'timeline', l.timeline),
    languages        = coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'languages') x), l.languages),
    source           = coalesce(p_fields->>'source', l.source),
    channel          = coalesce((p_fields->>'channel')::outreach_channel, l.channel),
    portfolio_case   = coalesce(p_fields->>'portfolio_case', l.portfolio_case),
    next_action      = coalesce(p_fields->>'next_action', l.next_action),
    next_action_at   = coalesce((p_fields->>'next_action_at')::timestamptz, l.next_action_at),
    owner_agent      = coalesce(p_fields->>'owner_agent', l.owner_agent)
  where l.id = p_lead_id;
  if not found then raise exception 'Lead % not found', p_lead_id; end if;
  perform public.log_activity('update_lead', 'lead', p_lead_id, p_lead_id,
    format('Updated %s (%s)', public._lead_name(p_lead_id),
           (select string_agg(k, ', ') from jsonb_object_keys(p_fields) k)) || coalesce(': ' || p_reason, ''),
    p_fields);
  return jsonb_build_object('status', 'updated', 'lead_id', p_lead_id);
end $$;

-- -----------------------------------------------------------------------------
-- JORDAN — screen_lead, create_draft, submit_draft_batch, log_send, log_reply
-- -----------------------------------------------------------------------------
create or replace function public.screen_lead(
  p_lead_id        uuid,
  p_passes         boolean,
  p_fit_score      int default null,
  p_notes          text default null,
  p_portfolio_case text default null,
  p_channel        outreach_channel default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); v_stage pipeline_stage;
begin
  select stage into v_stage from public.leads where id = p_lead_id;
  if v_stage is null then raise exception 'Lead % not found', p_lead_id; end if;
  if v_stage not in ('found', 'screened') then
    raise exception 'Lead is at stage %, only found/screened leads can be screened', v_stage;
  end if;

  update public.leads set fit_score = coalesce(p_fit_score, fit_score),
                          screen_notes = coalesce(p_notes, screen_notes),
                          portfolio_case = coalesce(p_portfolio_case, portfolio_case),
                          channel = coalesce(p_channel, channel),
                          lost_reason = case when p_passes then lost_reason else coalesce(p_notes, 'Failed screening') end
  where id = p_lead_id;

  perform public._move_stage(p_lead_id, case when p_passes then 'screened' else 'lost' end::pipeline_stage,
                             coalesce(p_notes, case when p_passes then 'Passed screening' else 'Failed screening' end));

  perform public.log_activity('screen_lead', 'lead', p_lead_id, p_lead_id,
    format('Screened %s: %s (fit %s)', public._lead_name(p_lead_id),
           case when p_passes then 'pass' else 'reject' end, coalesce(p_fit_score::text, 'n/a')),
    jsonb_build_object('passes', p_passes, 'fit_score', p_fit_score, 'notes', p_notes));
  return jsonb_build_object('status', case when p_passes then 'screened' else 'lost' end, 'lead_id', p_lead_id);
end $$;

create or replace function public.create_draft(
  p_lead_id         uuid,
  p_body            text,
  p_channel         outreach_channel default null,
  p_subject         text default null,
  p_language        text default 'es',
  p_personalisation text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); v_lead record; v_id uuid;
begin
  select * into v_lead from public.leads where id = p_lead_id;
  if v_lead is null then raise exception 'Lead % not found', p_lead_id; end if;
  if v_lead.stage in ('lost', 'do_not_contact') then
    raise exception 'Lead is %, outreach not allowed', v_lead.stage;
  end if;
  if coalesce(p_channel, v_lead.channel) is null then
    raise exception 'Channel required (whatsapp, email or instagram)';
  end if;

  insert into public.outreach_drafts (lead_id, channel, subject, body, language, personalisation, status, created_by)
  values (p_lead_id, coalesce(p_channel, v_lead.channel), p_subject, p_body, coalesce(p_language, 'es'),
          p_personalisation, 'ready', me)
  returning id into v_id;

  if v_lead.stage in ('found', 'screened') then
    perform public._move_stage(p_lead_id, 'draft_ready', 'Personalised draft written');
  end if;

  perform public.log_activity('create_draft', 'draft', v_id, p_lead_id,
    format('Draft ready for %s via %s', public._lead_name(p_lead_id), coalesce(p_channel, v_lead.channel)),
    jsonb_build_object('language', p_language));
  return jsonb_build_object('status', 'ready', 'draft_id', v_id);
end $$;

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
    format('Batch #%s submitted for Letty''s approval (%s drafts)', v_ref, v_n),
    jsonb_build_object('draft_ids', p_draft_ids, 'note', p_note));
  return jsonb_build_object('status', 'pending', 'batch_id', v_batch, 'batch_ref', v_ref, 'drafts', v_n);
end $$;

-- LETTY / TOP G — record Letty's decision taken in Grokbot
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
  select ref, status into v_ref, v_status from public.approval_batches where id = p_batch_id;
  if v_ref is null then raise exception 'Batch % not found', p_batch_id; end if;
  if v_status <> 'pending' then raise exception 'Batch #% already decided (%)', v_ref, v_status; end if;

  for d in select * from public.outreach_drafts where batch_id = p_batch_id and status = 'in_batch' loop
    if d.id = any(coalesce(p_rejected_ids, '{}')) or (p_approved_ids is not null and not d.id = any(p_approved_ids)) then
      update public.outreach_drafts set status = 'rejected', reviewer_note = coalesce(p_feedback->>d.id::text, p_note)
      where id = d.id;
    else
      update public.outreach_drafts set status = 'approved', approved_by = 'letty', approved_at = now(),
             reviewer_note = p_feedback->>d.id::text
      where id = d.id;
      perform public._move_stage(d.lead_id, 'approved', format('Approved by Letty in batch #%s', v_ref));
    end if;
  end loop;

  select count(*) filter (where status = 'approved'), count(*) filter (where status = 'rejected')
    into v_appr, v_rej from public.outreach_drafts where batch_id = p_batch_id;

  update public.approval_batches
     set status = case when v_rej = 0 then 'approved' when v_appr = 0 then 'rejected' else 'partially_approved' end::batch_status,
         decided_by = 'letty', decided_at = now(), note = coalesce(p_note, note)
   where id = p_batch_id;

  perform public.log_activity('record_approval', 'batch', p_batch_id, null,
    format('Batch #%s decided: %s approved, %s rejected%s', v_ref, v_appr, v_rej,
           case when me = 'top_g' then ' (recorded by Top G for Letty)' else '' end),
    jsonb_build_object('approved', v_appr, 'rejected', v_rej, 'note', p_note));
  return jsonb_build_object('status', 'decided', 'batch_ref', v_ref, 'approved', v_appr, 'rejected', v_rej);
end $$;

create or replace function public.log_send(p_draft_id uuid, p_external_ref text default null, p_sent_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan'); d record;
begin
  select * into d from public.outreach_drafts where id = p_draft_id;
  if d is null then raise exception 'Draft % not found', p_draft_id; end if;
  if d.status <> 'approved' then
    raise exception 'Draft is "%" — only drafts approved by Letty in a batch can be sent', d.status;
  end if;

  update public.outreach_drafts set status = 'sent', sent_by = me, sent_at = coalesce(p_sent_at, now()),
         external_ref = p_external_ref where id = p_draft_id;

  perform public._move_stage(d.lead_id, 'sent', format('Outreach sent via %s', d.channel));
  update public.leads set next_action = 'Follow up if no reply', next_action_at = now() + interval '3 days'
   where id = d.lead_id;

  perform public.log_activity('log_send', 'draft', p_draft_id, d.lead_id,
    format('Sent %s outreach to %s', d.channel, public._lead_name(d.lead_id)),
    jsonb_build_object('external_ref', p_external_ref));
  return jsonb_build_object('status', 'sent', 'draft_id', p_draft_id, 'lead_id', d.lead_id);
end $$;

create or replace function public.log_reply(p_lead_id uuid, p_summary text, p_channel outreach_channel default null,
                                            p_hand_to_quinn boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('jordan', 'quinn');
begin
  perform public._move_stage(p_lead_id, 'replied', 'Prospect replied: ' || left(p_summary, 120));
  if p_hand_to_quinn then
    update public.leads set owner_agent = 'quinn', next_action = 'Start discovery', next_action_at = now()
     where id = p_lead_id;
  end if;
  perform public.log_activity('log_reply', 'lead', p_lead_id, p_lead_id,
    format('%s replied%s', public._lead_name(p_lead_id), coalesce(' via ' || p_channel::text, '')),
    jsonb_build_object('summary', p_summary));
  return jsonb_build_object('status', 'replied', 'lead_id', p_lead_id, 'owner', case when p_hand_to_quinn then 'quinn' end);
end $$;

-- -----------------------------------------------------------------------------
-- QUINN — discovery, quotes, deals, proposals, signing
-- -----------------------------------------------------------------------------
create or replace function public.add_discovery_note(
  p_lead_id    uuid,
  p_answer     text,
  p_source     note_source,          -- REQUIRED: where the answer came from
  p_question   text default null,
  p_topic      text default 'general',
  p_source_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('quinn'); v_id uuid; v_stage pipeline_stage;
begin
  if p_source is null then raise exception 'p_source is required (where did this answer come from?)'; end if;
  select stage into v_stage from public.leads where id = p_lead_id;
  if v_stage is null then raise exception 'Lead % not found', p_lead_id; end if;

  insert into public.discovery_notes (lead_id, topic, question, answer, source, source_ref, recorded_by)
  values (p_lead_id, coalesce(p_topic, 'general'), p_question, p_answer, p_source, p_source_ref, me)
  returning id into v_id;

  if v_stage in ('sent', 'replied') then
    perform public._move_stage(p_lead_id, 'discovery', 'Discovery started');
  end if;

  perform public.log_activity('add_discovery_note', 'discovery_note', v_id, p_lead_id,
    format('Discovery note on %s [%s] (source: %s)', public._lead_name(p_lead_id), coalesce(p_topic, 'general'), p_source),
    jsonb_build_object('question', p_question));
  return jsonb_build_object('status', 'saved', 'note_id', v_id);
end $$;

-- Pure calculation, quoting ONLY from the catalogue.
-- p_addons: [{"code": "booking", "qty": 1}, {"code": "extra_page", "qty": 3}]
create or replace function public.quote_deal(
  p_package      text,
  p_addons       jsonb default '[]',
  p_market       text default 'US',
  p_payment_plan payment_plan default '50_50',
  p_rush         boolean default false,
  p_care_plan    text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  m public.markets;
  pk record; ad record; cp record; a record;
  v_lines jsonb := '[]';
  v_sub numeric := 0; v_sub_usd numeric := 0;
  v_mon numeric := 0; v_mon_usd numeric := 0;
  v_rush_pct numeric := coalesce((public._term('rush')->>'percent')::numeric, 25);
  v_rush numeric := 0; v_rush_usd numeric := 0;
  v_total numeric; v_total_usd numeric;
  v_unit numeric; v_mon_unit numeric; v_qty int;
  v_sched jsonb := '[]'; v_split numeric[]; v_labels text[]; v_acc numeric := 0; v_amt numeric; i int;
  v_included jsonb := '[]';
  v_weeks jsonb;
begin
  if not public.is_member() then raise exception 'Not a registered Squad CRM agent' using errcode = '42501'; end if;

  select * into m from public.markets where code = upper(coalesce(p_market, 'US'));
  if m.code is null then raise exception 'Unknown market % (use US, CA, MX, UK, EU, AU)', p_market; end if;

  if p_package is not null then
    select p.*, coalesce(pp.price, public.market_price(p.price_usd, m.code)) as local_price
      into pk
      from public.catalogue_packages p
      left join public.catalogue_package_prices pp on pp.package_code = p.code and pp.market_code = m.code
     where p.code = p_package and p.active;
    if pk.code is null then raise exception 'Unknown package "%": quote only from the catalogue', p_package; end if;
    v_lines := v_lines || jsonb_build_object('kind', 'package', 'code', pk.code, 'name', pk.name, 'qty', 1,
      'unit_price', pk.local_price, 'monthly_price', 0, 'line_total', pk.local_price, 'unit_price_usd', pk.price_usd);
    v_sub := v_sub + pk.local_price; v_sub_usd := v_sub_usd + pk.price_usd;
    v_weeks := jsonb_build_array(pk.weeks_min, pk.weeks_max);
    if pk.included_care_months > 0 then
      v_included := v_included || jsonb_build_object('item', format('%s month(s) %s Care', pk.included_care_months, initcap(pk.included_care_plan)));
    end if;
    if pk.ai_usage_months > 0 then
      v_included := v_included || jsonb_build_object('item', format('%s month(s) AI usage', pk.ai_usage_months));
    end if;
  end if;

  for a in select * from jsonb_to_recordset(coalesce(p_addons, '[]')) as x(code text, qty int) loop
    select * into ad from public.catalogue_addons where code = a.code and active;
    if ad.code is null then raise exception 'Unknown add-on "%": quote only from the catalogue', a.code; end if;
    v_qty := case when ad.per_unit then greatest(coalesce(a.qty, 1), 1) else 1 end;
    v_unit := public.market_price(ad.price_usd, m.code);
    v_mon_unit := public.market_price(ad.monthly_usd, m.code);
    v_lines := v_lines || jsonb_build_object('kind', 'addon', 'code', ad.code, 'name', ad.name, 'qty', v_qty,
      'unit_price', v_unit, 'monthly_price', v_mon_unit * v_qty, 'line_total', v_unit * v_qty,
      'unit_price_usd', ad.price_usd);
    v_sub := v_sub + v_unit * v_qty;      v_sub_usd := v_sub_usd + ad.price_usd * v_qty;
    v_mon := v_mon + v_mon_unit * v_qty;  v_mon_usd := v_mon_usd + ad.monthly_usd * v_qty;
  end loop;

  if p_care_plan is not null then
    select * into cp from public.catalogue_care_plans where code = p_care_plan;
    if cp.code is null then raise exception 'Unknown care plan "%"', p_care_plan; end if;
    v_unit := public.market_price(cp.monthly_usd, m.code);
    v_lines := v_lines || jsonb_build_object('kind', 'care_plan', 'code', cp.code, 'name', cp.name || ' Care', 'qty', 1,
      'unit_price', 0, 'monthly_price', v_unit, 'line_total', 0, 'unit_price_usd', 0);
    v_mon := v_mon + v_unit; v_mon_usd := v_mon_usd + cp.monthly_usd;
  end if;

  if jsonb_array_length(v_lines) = 0 then raise exception 'Nothing to quote: pick a package and/or add-ons'; end if;

  if p_rush then
    v_rush := round(v_sub * v_rush_pct / 100, 2);
    v_rush_usd := round(v_sub_usd * v_rush_pct / 100, 2);
  end if;
  v_total := v_sub + v_rush; v_total_usd := v_sub_usd + v_rush_usd;

  if p_payment_plan = '40_30_30' then
    v_split := array[40, 30, 30]; v_labels := array['Kickoff deposit', 'Design approval', 'Launch'];
  else
    v_split := array[50, 50];     v_labels := array['Kickoff deposit', 'Launch'];
  end if;
  for i in 1 .. cardinality(v_split) loop
    v_amt := case when i = cardinality(v_split) then v_total - v_acc else round(v_total * v_split[i] / 100, 2) end;
    v_acc := v_acc + v_amt;
    v_sched := v_sched || jsonb_build_object('label', v_labels[i], 'percent', v_split[i], 'amount', v_amt);
  end loop;

  return jsonb_build_object(
    'market', m.code, 'currency', m.currency, 'symbol', m.symbol,
    'lines', v_lines,
    'one_off_subtotal', v_sub, 'rush', p_rush, 'rush_percent', v_rush_pct, 'rush_fee', v_rush,
    'one_off_total', v_total, 'monthly_total', v_mon,
    'one_off_total_usd', v_total_usd, 'monthly_total_usd', v_mon_usd,
    'payment_plan', p_payment_plan, 'payment_schedule', v_sched,
    'included', v_included,
    'timeline_weeks', v_weeks,
    'notes', 'Prices exclude tax and payment-processor fees.');
end $$;

create or replace function public.create_deal(
  p_lead_id      uuid,
  p_package      text,
  p_addons       jsonb default '[]',
  p_market       text default null,          -- defaults to the lead's market
  p_payment_plan payment_plan default '50_50',
  p_rush         boolean default false,
  p_care_plan    text default null,
  p_title        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('quinn');
  v_market text; q jsonb; v_deal uuid; v_ref bigint; li jsonb; s jsonb;
begin
  select market_code into v_market from public.leads where id = p_lead_id;
  if not found then raise exception 'Lead % not found', p_lead_id; end if;
  v_market := upper(coalesce(p_market, v_market, 'US'));
  q := public.quote_deal(p_package, p_addons, v_market, p_payment_plan, p_rush, p_care_plan);

  insert into public.deals (lead_id, title, package_code, market_code, currency, payment_plan, rush, care_plan_code,
                            one_off_subtotal, rush_fee, one_off_total, monthly_total, one_off_total_usd,
                            monthly_total_usd, status, created_by)
  values (p_lead_id, coalesce(p_title, public._lead_name(p_lead_id) || ' — ' ||
            coalesce((select name from public.catalogue_packages where code = p_package), 'Custom')),
          p_package, v_market, q->>'currency', p_payment_plan, p_rush, p_care_plan,
          (q->>'one_off_subtotal')::numeric, (q->>'rush_fee')::numeric, (q->>'one_off_total')::numeric,
          (q->>'monthly_total')::numeric, (q->>'one_off_total_usd')::numeric, (q->>'monthly_total_usd')::numeric,
          'quoted', me)
  returning id, ref into v_deal, v_ref;

  for li in select * from jsonb_array_elements(q->'lines') loop
    insert into public.deal_items (deal_id, kind, code, name, qty, unit_price, monthly_price, line_total)
    values (v_deal, li->>'kind', li->>'code', li->>'name', (li->>'qty')::int, (li->>'unit_price')::numeric,
            (li->>'monthly_price')::numeric, (li->>'line_total')::numeric);
  end loop;

  for s in select * from jsonb_array_elements(q->'payment_schedule') loop
    insert into public.payments (deal_id, label, percent, amount, currency)
    values (v_deal, s->>'label', (s->>'percent')::numeric, (s->>'amount')::numeric, q->>'currency');
  end loop;

  perform public.log_activity('create_deal', 'deal', v_deal, p_lead_id,
    format('Quoted D-%s for %s: %s %s one-off%s', v_ref, public._lead_name(p_lead_id), q->>'currency',
           to_char((q->>'one_off_total')::numeric, 'FM999,999,990'),
           case when (q->>'monthly_total')::numeric > 0
                then format(' + %s/mo', to_char((q->>'monthly_total')::numeric, 'FM999,990')) else '' end),
    q);
  return jsonb_build_object('status', 'quoted', 'deal_id', v_deal, 'deal_ref', 'D-' || v_ref, 'quote', q);
end $$;

create or replace function public.create_proposal(
  p_deal_id        uuid,
  p_scope_summary  text,
  p_deliverables   jsonb default '[]',      -- ["Home page", "Booking flow", ...]
  p_execution_plan text default null,
  p_mark_sent      boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('quinn'); d record; v_id uuid; v_ver int;
begin
  select * into d from public.deals where id = p_deal_id;
  if d is null then raise exception 'Deal % not found', p_deal_id; end if;
  if d.status in ('signed', 'lost') then raise exception 'Deal is already %', d.status; end if;

  select coalesce(max(version), 0) + 1 into v_ver from public.proposals where deal_id = p_deal_id;
  insert into public.proposals (deal_id, lead_id, version, scope_summary, deliverables, execution_plan,
                                status, sent_at, created_by)
  values (p_deal_id, d.lead_id, v_ver, p_scope_summary, coalesce(p_deliverables, '[]'), p_execution_plan,
          case when p_mark_sent then 'sent' else 'draft' end::proposal_status,
          case when p_mark_sent then now() end, me)
  returning id into v_id;

  update public.deals set status = 'proposed' where id = p_deal_id;
  perform public._move_stage(d.lead_id, 'proposal', format('Proposal v%s drafted (%s %s)', v_ver, d.currency,
                             to_char(d.one_off_total, 'FM999,999,990')));

  perform public.log_activity('create_proposal', 'proposal', v_id, d.lead_id,
    format('Proposal v%s for %s (%s %s)%s', v_ver, public._lead_name(d.lead_id), d.currency,
           to_char(d.one_off_total, 'FM999,999,990'), case when p_mark_sent then ', sent' else '' end),
    jsonb_build_object('deal_id', p_deal_id));
  return jsonb_build_object('status', case when p_mark_sent then 'sent' else 'draft' end, 'proposal_id', v_id, 'version', v_ver);
end $$;

-- -----------------------------------------------------------------------------
-- Capacity (4 new projects / month)
-- -----------------------------------------------------------------------------
create or replace function public.capacity(p_month date default current_date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_member() then jsonb_build_object(
    'month', to_char(date_trunc('month', p_month), 'YYYY-MM'),
    'limit', coalesce((public._term('capacity')->>'projects_per_month')::int, 4),
    'used', (select count(*) from public.projects where slot_month = date_trunc('month', p_month)::date),
    'remaining', greatest(coalesce((public._term('capacity')->>'projects_per_month')::int, 4)
                   - (select count(*) from public.projects where slot_month = date_trunc('month', p_month)::date), 0)) end
$$;

create or replace function public.sign_deal(p_deal_id uuid, p_reason text default 'Client signed the proposal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('quinn'); d record; v_cap jsonb;
begin
  select * into d from public.deals where id = p_deal_id;
  if d is null then raise exception 'Deal % not found', p_deal_id; end if;
  update public.deals set status = 'signed', signed_at = now() where id = p_deal_id;
  update public.proposals set status = 'accepted', decided_at = now()
   where deal_id = p_deal_id and status in ('draft', 'sent');
  perform public._move_stage(d.lead_id, 'signed', p_reason);
  update public.leads set owner_agent = 'dana', next_action = 'Draft scope of work + handoff plan', next_action_at = now()
   where id = d.lead_id;
  v_cap := public.capacity(current_date);
  perform public.log_activity('sign_deal', 'deal', p_deal_id, d.lead_id,
    format('%s signed (%s %s) — handed to Dana', public._lead_name(d.lead_id), d.currency,
           to_char(d.one_off_total, 'FM999,999,990')),
    jsonb_build_object('capacity', v_cap));
  return jsonb_build_object('status', 'signed', 'deal_id', p_deal_id, 'capacity', v_cap,
    'warning', case when (v_cap->>'remaining')::int = 0 then 'No project slots left this month: schedule the start for next month or escalate.' end);
end $$;

-- -----------------------------------------------------------------------------
-- Any agent — advance_stage, raise_escalation
-- -----------------------------------------------------------------------------
create or replace function public.advance_stage(p_lead_id uuid, p_to_stage pipeline_stage, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana'); v_from pipeline_stage;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'p_reason is required for every stage change'; end if;
  select stage into v_from from public.leads where id = p_lead_id;
  if v_from is null then raise exception 'Lead % not found', p_lead_id; end if;
  if v_from = p_to_stage then return jsonb_build_object('status', 'unchanged', 'stage', v_from); end if;

  if p_to_stage = 'lost' then
    update public.leads set lost_reason = p_reason where id = p_lead_id;
    update public.deals set status = 'lost', lost_reason = p_reason
     where lead_id = p_lead_id and status not in ('signed', 'lost');
  end if;

  perform public._move_stage(p_lead_id, p_to_stage, p_reason);   -- guard trigger checks + logs
  return jsonb_build_object('status', 'moved', 'lead_id', p_lead_id, 'from', v_from, 'to', p_to_stage);
end $$;

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
          case when me = 'top_g' then 'with_letty' else 'open' end::escalation_status,
          case when me = 'top_g' then 'letty' else 'top_g' end)
  returning id, ref into v_id, v_ref;
  perform public.log_activity('raise_escalation', 'escalation', v_id, p_lead_id,
    format('Escalation E-%s (%s): %s', v_ref, coalesce(p_severity, 'medium'), p_title),
    jsonb_build_object('detail', p_detail, 'proposed_action', p_proposed_action));
  return jsonb_build_object('status', 'open', 'escalation_id', v_id, 'ref', 'E-' || v_ref,
                            'assigned_to', case when me = 'top_g' then 'letty' else 'top_g' end);
end $$;

-- TOP G — review / pass to Letty / resolve
create or replace function public.update_escalation(
  p_escalation_id uuid,
  p_action        text,               -- 'review' | 'escalate_to_letty' | 'resolve' | 'dismiss'
  p_notes         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent(variadic array[]::text[]); e record;   -- admins only
begin
  select * into e from public.escalations where id = p_escalation_id;
  if e is null then raise exception 'Escalation % not found', p_escalation_id; end if;

  case p_action
    when 'review' then
      update public.escalations set status = 'in_review', top_g_notes = coalesce(p_notes, top_g_notes) where id = e.id;
    when 'escalate_to_letty' then
      update public.escalations set status = 'with_letty', assigned_to = 'letty',
             top_g_notes = coalesce(p_notes, top_g_notes) where id = e.id;
    when 'resolve' then
      if coalesce(trim(p_notes), '') = '' then raise exception 'Resolution notes are required'; end if;
      update public.escalations set status = 'resolved', resolution_notes = p_notes, resolved_by = me,
             resolved_at = now() where id = e.id;
    when 'dismiss' then
      update public.escalations set status = 'dismissed', resolution_notes = p_notes, resolved_by = me,
             resolved_at = now() where id = e.id;
    else raise exception 'Unknown action % (review, escalate_to_letty, resolve, dismiss)', p_action;
  end case;

  perform public.log_activity('update_escalation', 'escalation', e.id, e.lead_id,
    format('E-%s %s: %s', e.ref, replace(p_action, '_', ' '), e.title) || coalesce(' — ' || p_notes, ''),
    jsonb_build_object('action', p_action));
  return jsonb_build_object('status', p_action, 'escalation_id', e.id);
end $$;

-- -----------------------------------------------------------------------------
-- DANA — scope, project, milestones, verification, payments, care, growth
-- -----------------------------------------------------------------------------
create or replace function public.create_scope(p_deal_id uuid, p_extra_lines jsonb default '[]', p_send boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('dana'); d record; v_lines jsonb; v_total numeric; v_id uuid; v_ver int;
begin
  select * into d from public.deals where id = p_deal_id;
  if d is null then raise exception 'Deal % not found', p_deal_id; end if;
  if d.status <> 'signed' then raise exception 'Deal must be signed before drafting the scope of work'; end if;

  -- Scope lines priced in USD straight from the catalogue
  select coalesce(jsonb_agg(jsonb_build_object(
           'line', i.name || case when i.qty > 1 then ' × ' || i.qty else '' end,
           'code', i.code, 'kind', i.kind,
           'price_usd', case i.kind
                          when 'package' then (select p.price_usd from public.catalogue_packages p where p.code = i.code)
                          when 'addon'   then (select a.price_usd * i.qty from public.catalogue_addons a where a.code = i.code)
                          else 0 end,
           'monthly_usd', case i.kind
                          when 'addon' then (select a.monthly_usd * i.qty from public.catalogue_addons a where a.code = i.code)
                          when 'care_plan' then (select c.monthly_usd from public.catalogue_care_plans c where c.code = i.code)
                          else 0 end,
           'verified', false) order by i.kind desc, i.name), '[]')
    into v_lines from public.deal_items i where i.deal_id = p_deal_id;

  v_lines := v_lines || coalesce(p_extra_lines, '[]');
  select coalesce(sum((x->>'price_usd')::numeric), 0) into v_total from jsonb_array_elements(v_lines) x;
  if d.rush then
    v_lines := v_lines || jsonb_build_object('line', 'Rush delivery (+25%)', 'code', 'rush',
                 'price_usd', round(v_total * 0.25, 2), 'verified', false);
    v_total := v_total + round(v_total * 0.25, 2);
  end if;

  select coalesce(max(version), 0) + 1 into v_ver from public.scopes where deal_id = p_deal_id;
  insert into public.scopes (deal_id, version, lines, total, currency, status, sent_at, created_by)
  values (p_deal_id, v_ver, v_lines, v_total, 'USD',
          case when p_send then 'sent_for_signature' else 'draft' end::scope_status,
          case when p_send then now() end, me)
  returning id into v_id;

  perform public.log_activity('create_scope', 'scope', v_id, d.lead_id,
    format('Scope of work v%s for %s: USD %s%s', v_ver, public._lead_name(d.lead_id),
           to_char(v_total, 'FM999,999,990'), case when p_send then ' — sent for signature' else '' end),
    jsonb_build_object('lines', jsonb_array_length(v_lines)));
  return jsonb_build_object('status', case when p_send then 'sent_for_signature' else 'draft' end,
                            'scope_id', v_id, 'total_usd', v_total, 'lines', v_lines);
end $$;

-- p_plan: [{ "title": "Design", "due_date": "2026-12-01",
--            "deliverables": [{"title": "Homepage mockup", "owner": "studio", "scope_line": "Presence"}],
--            "client_owes":  [{"title": "Logo + photos", "due_date": "2026-11-20"}] }]
create or replace function public.create_project(
  p_deal_id     uuid,
  p_plan        jsonb,
  p_start_date  date default current_date,
  p_slot_month  date default null,
  p_name        text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('dana');
  d record; v_proj uuid; v_ref bigint; m jsonb; it jsonb; v_ms uuid; i int := 0;
  v_slot date := date_trunc('month', coalesce(p_slot_month, p_start_date, current_date))::date;
  v_cap jsonb := public.capacity(v_slot); v_target date;
begin
  select dl.*, l.company_id into d from public.deals dl join public.leads l on l.id = dl.lead_id where dl.id = p_deal_id;
  if d is null then raise exception 'Deal % not found', p_deal_id; end if;
  if d.status <> 'signed' then raise exception 'Deal must be signed first'; end if;
  if (v_cap->>'remaining')::int <= 0 then
    raise exception 'Capacity full for % (% of % slots used). Pick another p_slot_month or escalate to Top G.',
      v_cap->>'month', v_cap->>'used', v_cap->>'limit';
  end if;

  select max((x->>'due_date')::date) into v_target from jsonb_array_elements(coalesce(p_plan, '[]')) x;

  insert into public.projects (deal_id, lead_id, company_id, name, status, slot_month, start_date, target_date, created_by)
  values (p_deal_id, d.lead_id, d.company_id, coalesce(p_name, d.title), 'active', v_slot, p_start_date, v_target, me)
  returning id, ref into v_proj, v_ref;

  update public.payments set project_id = v_proj where deal_id = p_deal_id;
  update public.scopes set project_id = v_proj where deal_id = p_deal_id;

  for m in select * from jsonb_array_elements(coalesce(p_plan, '[]')) loop
    i := i + 1;
    insert into public.milestones (project_id, title, due_date, original_due, sort)
    values (v_proj, m->>'title', (m->>'due_date')::date, (m->>'due_date')::date, i)
    returning id into v_ms;
    for it in select * from jsonb_array_elements(coalesce(m->'deliverables', '[]')) loop
      insert into public.deliverables (project_id, milestone_id, title, owner, due_date, scope_line)
      values (v_proj, v_ms, it->>'title', coalesce(it->>'owner', 'studio')::deliverable_owner,
              coalesce((it->>'due_date')::date, (m->>'due_date')::date), it->>'scope_line');
    end loop;
    for it in select * from jsonb_array_elements(coalesce(m->'client_owes', '[]')) loop
      insert into public.deliverables (project_id, milestone_id, title, owner, due_date)
      values (v_proj, v_ms, it->>'title', 'client', coalesce((it->>'due_date')::date, (m->>'due_date')::date));
    end loop;
  end loop;

  perform public._move_stage(d.lead_id, 'in_delivery', format('Project P-%s kicked off', v_ref));
  perform public.log_activity('create_project', 'project', v_proj, d.lead_id,
    format('Project P-%s started for %s (%s milestones, slot %s)', v_ref, public._lead_name(d.lead_id), i,
           to_char(v_slot, 'Mon YYYY')),
    jsonb_build_object('capacity', public.capacity(v_slot)));
  return jsonb_build_object('status', 'active', 'project_id', v_proj, 'ref', 'P-' || v_ref,
                            'capacity', public.capacity(v_slot));
end $$;

create or replace function public.update_milestone(
  p_milestone_id uuid,
  p_status       milestone_status default null,
  p_due_date     date default null,
  p_slip_reason  text default null,
  p_proposed_fix text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('dana'); ms record; v_lead uuid;
begin
  select m.*, p.lead_id, p.name as project_name into ms
    from public.milestones m join public.projects p on p.id = m.project_id where m.id = p_milestone_id;
  if ms is null then raise exception 'Milestone % not found', p_milestone_id; end if;
  if p_status = 'slipped' and (p_slip_reason is null or p_proposed_fix is null) then
    raise exception 'Flagging slippage needs p_slip_reason and p_proposed_fix';
  end if;

  update public.milestones set
    status = coalesce(p_status, status),
    due_date = coalesce(p_due_date, due_date),
    slip_reason = coalesce(p_slip_reason, slip_reason),
    proposed_fix = coalesce(p_proposed_fix, proposed_fix),
    completed_at = case when p_status = 'done' then now() else completed_at end
  where id = p_milestone_id;

  if p_status = 'slipped' then
    update public.projects set status = 'at_risk', health_note = p_slip_reason where id = ms.project_id;
  end if;

  perform public.log_activity('update_milestone', 'milestone', p_milestone_id, ms.lead_id,
    format('%s · %s → %s', ms.project_name, ms.title, coalesce(p_status::text, ms.status::text))
      || case when p_due_date is not null then format(' (due %s)', p_due_date) else '' end
      || coalesce(': ' || p_slip_reason, ''),
    jsonb_build_object('proposed_fix', p_proposed_fix));
  return jsonb_build_object('status', coalesce(p_status, ms.status), 'milestone_id', p_milestone_id);
end $$;

create or replace function public.update_deliverable(
  p_deliverable_id uuid,
  p_status         item_status default null,
  p_verified       boolean default null,    -- checked line by line against scope
  p_note           text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('dana'); dv record;
begin
  select d.*, p.lead_id, p.name as project_name into dv
    from public.deliverables d join public.projects p on p.id = d.project_id where d.id = p_deliverable_id;
  if dv is null then raise exception 'Deliverable % not found', p_deliverable_id; end if;
  update public.deliverables set status = coalesce(p_status, status), verified = coalesce(p_verified, verified),
         verified_note = coalesce(p_note, verified_note) where id = p_deliverable_id;
  perform public.log_activity('update_deliverable', 'deliverable', p_deliverable_id, dv.lead_id,
    format('%s · %s%s%s', dv.project_name, dv.title, coalesce(' → ' || p_status::text, ''),
           case when p_verified then ' ✓ verified against scope' when p_verified = false then ' ✗ fails scope check' else '' end),
    jsonb_build_object('note', p_note));
  return jsonb_build_object('status', 'updated', 'deliverable_id', p_deliverable_id);
end $$;

create or replace function public.record_payment(p_payment_id uuid, p_status payment_status, p_due_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('dana'); pm record; v_lead uuid;
begin
  select * into pm from public.payments where id = p_payment_id;
  if pm is null then raise exception 'Payment % not found', p_payment_id; end if;
  update public.payments set status = p_status, due_date = coalesce(p_due_date, due_date),
         paid_at = case when p_status = 'paid' then now() else paid_at end where id = p_payment_id;
  select lead_id into v_lead from public.deals where id = pm.deal_id;
  perform public.log_activity('record_payment', 'payment', p_payment_id, v_lead,
    format('%s %s %s for %s → %s', pm.label, pm.currency, to_char(pm.amount, 'FM999,999,990'),
           public._lead_name(v_lead), p_status), '{}');
  return jsonb_build_object('status', p_status, 'payment_id', p_payment_id);
end $$;

create or replace function public.complete_project(p_project_id uuid, p_client_signed_off boolean default true,
                                                   p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('dana'); pr record; v_open int; v_unverified int;
begin
  select * into pr from public.projects where id = p_project_id;
  if pr is null then raise exception 'Project % not found', p_project_id; end if;
  select count(*) filter (where status <> 'done'), count(*) filter (where owner = 'studio' and not verified)
    into v_open, v_unverified from public.deliverables where project_id = p_project_id;
  if v_unverified > 0 then
    raise exception '% studio deliverable(s) not yet verified against scope', v_unverified;
  end if;

  update public.projects set status = 'delivered', delivered_at = now(),
         signed_off_at = case when p_client_signed_off then now() end, health_note = p_note
   where id = p_project_id;
  perform public._move_stage(pr.lead_id, 'delivered', coalesce(p_note, 'Delivered and signed off'));

  -- queue the testimonial ask
  insert into public.testimonials (project_id, company_id, status, created_by)
  select p_project_id, pr.company_id, 'to_request', me
  where not exists (select 1 from public.testimonials t where t.project_id = p_project_id);

  perform public.log_activity('complete_project', 'project', p_project_id, pr.lead_id,
    format('P-%s %s delivered%s', pr.ref, pr.name, case when p_client_signed_off then ' and signed off' else '' end),
    jsonb_build_object('open_items', v_open));
  return jsonb_build_object('status', 'delivered', 'project_id', p_project_id, 'next', 'Request testimonial + referral');
end $$;

create or replace function public.record_testimonial(
  p_project_id uuid, p_status testimonial_status, p_quote text default null, p_author_name text default null,
  p_author_role text default null, p_rating int default null, p_permission boolean default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('dana'); pr record; v_id uuid;
begin
  select * into pr from public.projects where id = p_project_id;
  if pr is null then raise exception 'Project % not found', p_project_id; end if;
  select id into v_id from public.testimonials where project_id = p_project_id order by created_at desc limit 1;
  if v_id is null then
    insert into public.testimonials (project_id, company_id, status, created_by)
    values (p_project_id, pr.company_id, p_status, me) returning id into v_id;
  end if;
  update public.testimonials set status = p_status, quote = coalesce(p_quote, quote),
         author_name = coalesce(p_author_name, author_name), author_role = coalesce(p_author_role, author_role),
         rating = coalesce(p_rating, rating), permission_to_publish = coalesce(p_permission, permission_to_publish),
         requested_at = case when p_status = 'requested' then now() else requested_at end,
         received_at = case when p_status = 'received' then now() else received_at end
   where id = v_id;
  perform public.log_activity('record_testimonial', 'testimonial', v_id, pr.lead_id,
    format('Testimonial for %s → %s', pr.name, p_status), jsonb_build_object('rating', p_rating));
  return jsonb_build_object('status', p_status, 'testimonial_id', v_id);
end $$;

create or replace function public.add_referral(
  p_from_project_id uuid, p_referred_name text default null, p_referred_contact text default null,
  p_status referral_status default 'requested', p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('dana'); pr record; v_id uuid;
begin
  select * into pr from public.projects where id = p_from_project_id;
  insert into public.referrals (from_company_id, from_project_id, referred_name, referred_contact, status, notes, created_by)
  values (pr.company_id, p_from_project_id, p_referred_name, p_referred_contact, p_status, p_notes, me)
  returning id into v_id;
  perform public.log_activity('add_referral', 'referral', v_id, pr.lead_id,
    format('Referral %s from %s%s', p_status, coalesce(pr.name, 'client'), coalesce(': ' || p_referred_name, '')), '{}');
  return jsonb_build_object('status', p_status, 'referral_id', v_id);
end $$;

create or replace function public.start_care_plan(
  p_project_id uuid, p_plan_code text, p_included_months int default null, p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('dana'); pr record; cp record; m record; dl record; v_id uuid;
  v_included int; v_start date := current_date;
begin
  select * into pr from public.projects where id = p_project_id;
  if pr is null then raise exception 'Project % not found', p_project_id; end if;
  select * into cp from public.catalogue_care_plans where code = p_plan_code;
  if cp is null then raise exception 'Unknown care plan %', p_plan_code; end if;
  select * into dl from public.deals where id = pr.deal_id;
  select * into m from public.markets where code = coalesce(dl.market_code, 'US');
  select coalesce(p_included_months, pk.included_care_months, 0) into v_included
    from (select 1) x left join public.catalogue_packages pk on pk.code = dl.package_code;

  insert into public.care_subscriptions (company_id, project_id, plan_code, market_code, currency, monthly_price,
                                         monthly_usd, hours_included, included_until, start_date, renewal_date,
                                         status, notes, created_by)
  values (pr.company_id, p_project_id, cp.code, m.code, m.currency, public.market_price(cp.monthly_usd, m.code),
          cp.monthly_usd, cp.hours_included,
          case when v_included > 0 then (v_start + make_interval(months => v_included))::date end,
          v_start, (v_start + interval '1 month')::date, 'active', p_notes, me)
  returning id into v_id;

  perform public._move_stage(pr.lead_id, 'care_plan', format('%s Care started', cp.name));
  perform public.log_activity('start_care_plan', 'care_subscription', v_id, pr.lead_id,
    format('%s Care started for %s (%s %s/mo%s)', cp.name, pr.name, m.currency,
           to_char(public.market_price(cp.monthly_usd, m.code), 'FM999,990'),
           case when v_included > 0 then format(', first %s month(s) included', v_included) else '' end), '{}');
  return jsonb_build_object('status', 'active', 'subscription_id', v_id);
end $$;

create or replace function public.log_care_hours(p_subscription_id uuid, p_hours numeric, p_description text,
                                                 p_worked_on date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('dana'); s record; v_used numeric;
begin
  select cs.*, c.name as company into s from public.care_subscriptions cs
    join public.companies c on c.id = cs.company_id where cs.id = p_subscription_id;
  if s is null then raise exception 'Subscription % not found', p_subscription_id; end if;
  insert into public.care_hours_log (subscription_id, worked_on, hours, description, logged_by)
  values (p_subscription_id, p_worked_on, p_hours, p_description, me);
  select coalesce(sum(hours), 0) into v_used from public.care_hours_log
   where subscription_id = p_subscription_id and worked_on >= date_trunc('month', p_worked_on);
  perform public.log_activity('log_care_hours', 'care_subscription', p_subscription_id, null,
    format('%sh care work for %s (%s/%sh this month)', p_hours, s.company, v_used, s.hours_included),
    jsonb_build_object('description', p_description));
  return jsonb_build_object('status', 'logged', 'hours_used_this_month', v_used, 'hours_included', s.hours_included,
    'over_allowance', v_used > s.hours_included,
    'overage_rate_usd', (public._term('hourly_rate')->>'usd')::numeric);
end $$;

create or replace function public.add_lesson(
  p_title text, p_body text, p_category text default 'general', p_industry text default null,
  p_audience text[] default '{hunter,jordan}'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('dana'); v_issues text[]; v_id uuid;
begin
  v_issues := public.lesson_privacy_issues(coalesce(p_title, '') || ' ' || coalesce(p_body, ''));
  if cardinality(v_issues) > 0 then
    return jsonb_build_object('status', 'rejected', 'issues', to_jsonb(v_issues),
      'message', 'Lessons must be anonymised. Remove client names and private data, then try again.');
  end if;
  insert into public.lessons (title, body, category, industry, audience, created_by)
  values (p_title, p_body, coalesce(p_category, 'general'), p_industry, coalesce(p_audience, '{hunter,jordan}'), me)
  returning id into v_id;
  perform public.log_activity('add_lesson', 'lesson', v_id, null,
    format('New %s lesson for %s: %s', coalesce(p_category, 'general'), array_to_string(p_audience, ' & '), p_title), '{}');
  return jsonb_build_object('status', 'saved', 'lesson_id', v_id);
end $$;

create or replace function public.add_do_not_contact(
  p_kind dnc_kind, p_value text, p_reason text, p_lead_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := public.require_agent('hunter', 'jordan', 'quinn', 'dana'); v_id uuid;
begin
  insert into public.do_not_contact (kind, value, reason, lead_id, added_by)
  values (p_kind, p_value, p_reason, p_lead_id, me)
  on conflict (kind, value_norm) do update set reason = excluded.reason
  returning id into v_id;
  if p_lead_id is not null then
    perform public._move_stage(p_lead_id, 'do_not_contact', p_reason);
    update public.outreach_drafts set status = 'rejected', reviewer_note = 'Do not contact'
     where lead_id = p_lead_id and status in ('draft', 'ready', 'in_batch', 'approved');
  end if;
  perform public.log_activity('add_do_not_contact', 'do_not_contact', v_id, p_lead_id,
    format('Do-not-contact (%s): %s — %s', p_kind, p_value, p_reason), '{}');
  return jsonb_build_object('status', 'added', 'id', v_id);
end $$;

-- -----------------------------------------------------------------------------
-- TOP G — one-call overview
-- -----------------------------------------------------------------------------
create or replace function public.dashboard_metrics() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_won int; v_lost int;
begin
  if not public.is_member() then raise exception 'Not a registered Squad CRM agent' using errcode = '42501'; end if;
  select count(*) filter (where status = 'signed'), count(*) filter (where status = 'lost')
    into v_won, v_lost from public.deals;
  select jsonb_build_object(
    'mrr_usd', (select coalesce(sum(monthly_usd), 0) from public.care_subscriptions
                where status = 'active' and (included_until is null or included_until <= current_date)),
    'committed_mrr_usd', (select coalesce(sum(monthly_usd), 0) from public.care_subscriptions where status = 'active'),
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
-- Grants: authenticated members may call the API; internals stay private.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
-- internals: not callable through the API
revoke execute on function public._move_stage(uuid, pipeline_stage, text) from authenticated;
revoke execute on function public._lead_name(uuid) from authenticated;
revoke execute on function public._term(text) from authenticated;
revoke execute on function public.lesson_privacy_issues(text) from authenticated;
revoke execute on function public.guard_lead_stage() from authenticated;
revoke execute on function public.log_initial_stage() from authenticated;
revoke execute on function public.guard_draft() from authenticated;
revoke execute on function public.guard_batch() from authenticated;
revoke execute on function public.guard_lesson() from authenticated;
revoke execute on function public.guard_escalation() from authenticated;
revoke execute on function public.touch_updated_at() from authenticated;
revoke execute on function public.log_activity(text, text, uuid, uuid, text, jsonb) from authenticated;
