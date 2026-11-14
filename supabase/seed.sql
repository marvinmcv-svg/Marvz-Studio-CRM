-- =============================================================================
-- Squad CRM — DEMO data (optional). Run after migrations to see a living CRM.
-- Every record is created through the same RPCs the Grokbot agents use, so the
-- activity log, stage history and guards behave exactly as in production.
--   supabase db reset            (local: runs migrations + this file)
--   psql "$DB_URL" -f supabase/seed.sql   (remote, optional)
-- Remove demo data later with:  supabase/demo_cleanup.sql
-- =============================================================================

create or replace function pg_temp.act(p_agent text) returns void language sql as $$
  select set_config('squad.acting_agent', p_agent, false) $$;

do $$
declare
  r jsonb; lead uuid; d uuid; b1 uuid; b2 uuid; proj uuid; ms uuid; sub uuid;
  ids uuid[] := '{}'; drafts_b1 uuid[] := '{}'; drafts_b2 uuid[] := '{}';
  l record;
  -- business, contact, email, phone, website, instagram, industry, city, country, market, services, budget, timeline, langs, source, channel, case, target stage
  leads jsonb := $j$[
    ["Café Altura","Mariela Rojas","hola@cafealtura.bo","+591 71234567","cafealtura.bo","@cafealtura","Cafe","Santa Cruz","BO","US",["presence","whatsapp_enquiries"],"2-5k","This month",["es"],"Google Maps","whatsapp","Café Tropero","found"],
    ["Clínica Dental Sonrisa","Dr. Andrés Vaca","contacto@sonrisa.bo","+591 76543210","sonrisadental.bo",null,"Dental","Cochabamba","BO","US",["full_house","booking_deposits"],"5-10k","Next quarter",["es"],"Instagram search","whatsapp","Dental Smile Co.","screened"],
    ["Brava Fitness Studio","Jess Navarro","jess@bravafit.com","+1 512 555 0144","bravafit.com","@bravafitatx","Fitness","Austin","US","US",["full_house","booking_deposits"],"5-10k","6-8 weeks",["en","es"],"Google Maps","email","Core Collective","draft_ready"],
    ["Maple & Oak Interiors","Claire Dubois","claire@mapleoak.ca","+1 416 555 0190","mapleoak.ca","@mapleoakinteriors","Interior design","Toronto","CA","CA",["presence","scroll_storytelling"],"5-10k","Spring",["en","fr"],"Houzz","email","Atelier Nord","draft_ready"],
    ["Taquería El Güero","Luis Ortega","luis@elguero.mx","+52 33 5555 0123","elguero.mx","@taqueriaelguero","Restaurant","Guadalajara","MX","MX",["presence","whatsapp_enquiries"],"2-5k","ASAP",["es"],"Instagram search","whatsapp","Pollos Brasa","draft_ready"],
    ["Casa Tajibo Boutique Hotel","Valeria Suárez","reservas@casatajibo.com","+591 70011223","casatajibo.com","@casatajibo","Hospitality","Santa Cruz","BO","US",["flagship","ai_whatsapp_bot","extra_language"],"10-20k","Before high season",["es","en"],"Booking.com","email","Selva Lodge","approved"],
    ["Northside Physio","Tom Whitaker","tom@northsidephysio.co.uk","+44 161 555 0101","northsidephysio.co.uk",null,"Healthcare","Manchester","UK","UK",["full_house","booking_deposits","local_seo"],"5-10k","Q1",["en"],"Google Maps","email","Dental Smile Co.","sent"],
    ["Bloom Florist Co.","Ava Chen","ava@bloomflorist.com.au","+61 3 5550 1234","bloomflorist.com.au","@bloomflorist.co","Retail","Melbourne","AU","AU",["presence","online_store"],"5-10k","Before Mother's Day",["en"],"Instagram search","instagram","Petal & Stem","sent"],
    ["Vela Yoga Barcelona","Núria Puig","hola@velayoga.es","+34 93 555 0177","velayoga.es","@velayogabcn","Wellness","Barcelona","ES","EU",["full_house","booking_deposits","extra_language"],"5-10k","2 months",["es","ca","en"],"Google Maps","email","Core Collective","replied"],
    ["Kinetic Auto Detailing","Marcus Reed","marcus@kineticdetail.com","+1 305 555 0110","kineticdetail.com","@kineticdetailmia","Automotive","Miami","US","US",["presence","booking_deposits","review_booster"],"2-5k","This month",["en","es"],"Yelp","whatsapp","Shine Garage","discovery"],
    ["Panadería San Miguel","Rosa Mamani","pedidos@sanmiguel.bo","+591 72233445",null,"@panaderiasanmiguel","Bakery","La Paz","BO","US",["presence","online_payments"],"<2k","Flexible",["es"],"Referral","whatsapp","Café Tropero","discovery"],
    ["Studio Lumen Architects","Ethan Park","ethan@studiolumen.ca","+1 604 555 0188","studiolumen.ca","@studiolumen","Architecture","Vancouver","CA","CA",["flagship","scroll_storytelling","brand_identity"],"20k+","Q2",["en"],"Awwwards","email","Atelier Nord","proposal"],
    ["Green Leaf Dental","Priya Shah","priya@greenleafdental.co.uk","+44 113 555 0166","greenleafdental.co.uk",null,"Dental","Leeds","UK","UK",["full_house","booking_deposits","ai_assistant"],"10-20k","8 weeks",["en"],"Google Maps","email","Dental Smile Co.","proposal"],
    ["Andes Trek Expeditions","Diego Fernández","diego@andestrek.com","+591 77788990","andestrek.com","@andestrek","Tourism","Santa Cruz","BO","US",["flagship","online_payments","extra_language"],"10-20k","Before July",["es","en"],"TripAdvisor","email","Selva Lodge","signed"],
    ["Sabor Cruceño Catering","Carla Justiniano","eventos@saborcruceno.bo","+591 73344556","saborcruceno.bo","@saborcruceno","Catering","Santa Cruz","BO","US",["full_house","events","online_payments"],"5-10k","Wedding season",["es"],"Instagram search","whatsapp","Pollos Brasa","in_delivery"],
    ["Pulse Pilates","Fernanda Garza","fer@pulsepilates.mx","+52 81 5555 0144","pulsepilates.mx","@pulsepilatesmty","Fitness","Monterrey","MX","MX",["presence","booking_deposits"],"2-5k","ASAP",["es"],"Google Maps","whatsapp","Core Collective","in_delivery"],
    ["Harbour Legal","James O'Neill","james@harbourlegal.com.au","+61 2 5550 9876","harbourlegal.com.au",null,"Legal","Sydney","AU","AU",["full_house","copywriting"],"10-20k","Q4",["en"],"LinkedIn","email","Counsel & Co","delivered"],
    ["Nido Kids Academy","Lucía Paz","direccion@nidokids.bo","+591 75566778","nidokids.bo","@nidokidsscz","Education","Santa Cruz","BO","US",["presence","whatsapp_enquiries"],"2-5k","Before enrolment",["es"],"Facebook groups","whatsapp","Little Steps","care_plan"],
    ["Ruta 4 Coffee Roasters","Sam Ortiz","sam@ruta4coffee.com","+1 720 555 0133","ruta4coffee.com","@ruta4coffee","Cafe","Denver","US","US",["full_house","online_store","monthly_seo"],"5-10k","6 weeks",["en","es"],"Instagram search","instagram","Café Tropero","care_plan"],
    ["QuickFix Plumbing","Dan Miller","dan@quickfixplumb.com","+1 214 555 0102","quickfixplumb.com",null,"Trades","Dallas","US","US",["base"],"<2k","ASAP",["en"],"Google Maps","email",null,"lost"],
    ["Ferretería Central","Jorge Peña","ventas@ferreteriacentral.bo","+591 70099887","ferreteriacentral.bo",null,"Retail","Santa Cruz","BO","US",["presence"],"<2k","Unknown",["es"],"Google Maps","whatsapp",null,"do_not_contact"]
  ]$j$;
  item jsonb; target text; i int := 0;
  stage_order text[] := array['found','screened','draft_ready','approved','sent','replied','discovery','proposal','signed','in_delivery','delivered','care_plan'];
  t int;
begin
  ----------------------------------------------------------------------------
  -- Hunter finds everything
  ----------------------------------------------------------------------------
  perform pg_temp.act('hunter');
  for item in select * from jsonb_array_elements(leads) loop
    r := public.create_lead(
      p_business => item->>0, p_contact_name => item->>1, p_email => item->>2, p_phone => item->>3,
      p_website => item->>4, p_instagram => item->>5, p_industry => item->>6, p_city => item->>7,
      p_country => item->>8, p_market => item->>9,
      p_service_interest => array(select jsonb_array_elements_text(item->10)),
      p_budget_band => item->>11, p_timeline => item->>12,
      p_languages => array(select jsonb_array_elements_text(item->13)),
      p_source => item->>14, p_channel => (item->>15)::outreach_channel, p_portfolio_case => item->>16);
    ids := ids || (r->>'lead_id')::uuid;
  end loop;

  -- duplicate detection demo (returns status=duplicate, nothing created)
  r := public.create_lead(p_business => 'Cafe Altura', p_phone => '71234567');
  if r->>'status' <> 'duplicate' then raise exception 'duplicate detection failed: %', r; end if;

  ----------------------------------------------------------------------------
  -- Walk each lead to its target stage using the right agent for each step
  ----------------------------------------------------------------------------
  for i in 1 .. cardinality(ids) loop
    lead := ids[i];
    target := leads->(i-1)->>17;
    t := coalesce(array_position(stage_order, target), 0);

    if target = 'lost' then
      perform pg_temp.act('jordan');
      perform public.screen_lead(lead, false, 22, 'Budget under $1k and wants a template site; not a fit for our catalogue.');
      continue;
    elsif target = 'do_not_contact' then
      perform pg_temp.act('jordan');
      perform public.add_do_not_contact('business', leads->(i-1)->>0, 'Owner asked by phone not to be contacted again.', lead);
      continue;
    end if;

    if t >= 2 then
      perform pg_temp.act('jordan');
      perform public.screen_lead(lead, true, 60 + (i * 7) % 38,
        'Outdated site, strong reviews, active Instagram. Clear fit for ' || (leads->(i-1)->10->>0) || '.');
    end if;
    if t >= 3 then
      r := public.create_draft(lead,
        format('Hola %s, vi %s y me encantó lo que hacen. Armamos un sitio para %s que duplicó sus reservas — ¿te muestro cómo se vería el tuyo? 3 ideas concretas, sin compromiso.',
               split_part(leads->(i-1)->>1, ' ', 1), leads->(i-1)->>0, coalesce(leads->(i-1)->>16, 'un negocio similar')),
        null, 'Una idea para ' || (leads->(i-1)->>0), (leads->(i-1)->13->>0),
        'References their ' || coalesce(leads->(i-1)->>16, 'industry') || ' case study and recent Instagram activity.');
      if t = 3 then
        if i in (4, 5) then drafts_b2 := drafts_b2 || (r->>'draft_id')::uuid; end if;
      else
        drafts_b1 := drafts_b1 || (r->>'draft_id')::uuid;
      end if;
    end if;
  end loop;

  -- Batch 1: everything beyond draft_ready → approved by Letty
  perform pg_temp.act('jordan');
  r := public.submit_draft_batch(drafts_b1, 'Weekly batch: hospitality, health and retail.');
  b1 := (r->>'batch_id')::uuid;
  perform pg_temp.act('top_g');
  perform public.record_approval(b1, null, '{}', 'Approved in Grokbot by Letty — love the hotel one.');

  -- Batch 2: still waiting for Letty
  perform pg_temp.act('jordan');
  r := public.submit_draft_batch(drafts_b2, 'Toronto + Guadalajara, both bilingual.');

  for i in 1 .. cardinality(ids) loop
    lead := ids[i];
    target := leads->(i-1)->>17;
    t := coalesce(array_position(stage_order, target), 0);
    if t < 5 then continue; end if;

    perform pg_temp.act('jordan');
    select od.id into d from public.outreach_drafts od where od.lead_id = lead and od.status = 'approved';
    perform public.log_send(d, 'msg_' || substr(md5(lead::text), 1, 10));

    if t >= 6 then
      perform public.log_reply(lead, 'Interested — asked about price and how long it takes.', null);
    end if;
    if t >= 7 then
      perform pg_temp.act('quinn');
      perform public.add_discovery_note(lead, 'Wants more direct bookings; today everything goes through DMs and they lose track.', 'whatsapp',
        'What is the main goal for the new site?', 'goals', 'WA thread ' || to_char(now(), 'DD Mon'));
      perform public.add_discovery_note(lead, 'Budget approved by owner, prefers paying in two parts.', 'call',
        'What budget have you set aside?', 'budget', 'Discovery call');
      perform public.add_discovery_note(lead, 'Has logo and photos; needs help with copy in two languages.', 'email',
        'What content do you already have?', 'content', 'Email from contact');
    end if;
    if t >= 8 then
      r := public.create_deal(lead,
        (select x from jsonb_array_elements_text(leads->(i-1)->10) x where x in ('base','presence','full_house','flagship') limit 1),
        (select coalesce(jsonb_agg(jsonb_build_object('code', x, 'qty', case when x = 'extra_language' then 1 else 1 end)), '[]')
           from jsonb_array_elements_text(leads->(i-1)->10) x where x not in ('base','presence','full_house','flagship')),
        null,
        case when i % 2 = 0 then '40_30_30' else '50_50' end::payment_plan,
        i = 13, null);
      d := (r->>'deal_id')::uuid;
      perform public.create_proposal(d, 'New conversion-focused website with online bookings and bilingual content.',
        '["Strategy & sitemap","Design system + 5 key pages","Booking flow with deposits","Launch + training"]',
        'Week 1 strategy, weeks 2-3 design, weeks 4-5 build, week 6 QA + launch.', true);
    end if;
    if t >= 9 then
      perform public.sign_deal(d, 'Signed proposal + paid deposit');
    end if;
    if t >= 10 then
      perform pg_temp.act('dana');
      perform public.create_scope(d, '[]', true);
      update public.scopes set status = 'signed', signed_at = now() where deal_id = d;
      r := public.create_project(d, jsonb_build_array(
        jsonb_build_object('title', 'Kickoff & content', 'due_date', current_date - 20,
          'deliverables', jsonb_build_array(jsonb_build_object('title', 'Sitemap + moodboard', 'scope_line', 'Strategy & sitemap')),
          'client_owes', jsonb_build_array(jsonb_build_object('title', 'Logo, photos and menu/prices'))),
        jsonb_build_object('title', 'Design', 'due_date', current_date - 5,
          'deliverables', jsonb_build_array(jsonb_build_object('title', 'Homepage + 4 key pages designed', 'scope_line', 'Design system + 5 key pages')),
          'client_owes', jsonb_build_array(jsonb_build_object('title', 'Design feedback (one round)'))),
        jsonb_build_object('title', 'Build', 'due_date', current_date + 9,
          'deliverables', jsonb_build_array(jsonb_build_object('title', 'Booking flow with deposits', 'scope_line', 'Booking flow with deposits'))),
        jsonb_build_object('title', 'QA & launch', 'due_date', current_date + 16,
          'deliverables', jsonb_build_array(jsonb_build_object('title', 'Launch + owner training', 'scope_line', 'Launch + training')))
      ), current_date - 28,
      case when i = 18 then (date_trunc('month', current_date) - interval '2 months')::date
           when i in (17, 19) then (date_trunc('month', current_date) - interval '1 month')::date
           else current_date end);
      proj := (r->>'project_id')::uuid;
      perform public.record_payment((select id from public.payments where deal_id = d order by percent desc, label limit 1), 'paid');

      -- first two milestones done
      for ms in select id from public.milestones where project_id = proj and sort <= 2 loop
        perform public.update_milestone(ms, 'done');
      end loop;
      update public.deliverables set status = 'done', verified = true, verified_note = 'Matches scope line'
       where project_id = proj and milestone_id in (select id from public.milestones where project_id = proj and sort <= 2);

      if i = 15 then  -- catering project slips
        perform public.update_milestone((select id from public.milestones where project_id = proj and sort = 3),
          'slipped', current_date + 16, 'Client still owes event photos and price list (5 days late).',
          'Launch with stock photography now, swap in real photos in week 1 of care plan; move build due date +7 days.');
        perform pg_temp.act('dana');
        perform public.raise_escalation('Sabor Cruceño: client content 5 days late',
          'Build milestone slipped because the client has not sent event photos or the catering price list.',
          'high', lead, proj, 'Top G to approve launching with stock photos; Dana to send a friendly deadline reminder.');
      end if;
    end if;
    if t >= 11 then
      perform pg_temp.act('dana');
      update public.milestones set status = 'done', completed_at = now() where project_id = proj;
      update public.deliverables set status = 'done', verified = true, verified_note = 'Checked line by line against signed scope'
       where project_id = proj;
      perform public.complete_project(proj, true, 'Client signed off on launch call.');
      perform public.record_testimonial(proj, 'requested');
    end if;
    if t >= 12 then
      perform pg_temp.act('dana');
      perform public.record_testimonial(proj, 'received',
        'They understood our business in one call and the new site paid for itself in the first month.',
        leads->(i-1)->>1, 'Owner', 5, true);
      perform public.start_care_plan(proj, case when i = 19 then 'pro' else 'basic' end);
      select id into sub from public.care_subscriptions where project_id = proj;
      perform public.log_care_hours(sub, 0.75, 'Updated opening hours and holiday banner', current_date - 3);
      if i = 19 then
        perform public.log_care_hours(sub, 2.5, 'New wholesale page + product photos', current_date - 1);
        perform public.add_referral(proj, 'Mesa Verde Bistro', 'owner@mesaverde.example', 'received', 'Owner mentioned them on the sign-off call.');
      else
        perform public.add_referral(proj, null, null, 'requested', 'Asked for referral after launch.');
      end if;
    end if;
  end loop;

  -- Care plans that are past the included period (count towards MRR)
  update public.care_subscriptions set included_until = current_date - 10, start_date = current_date - 70,
         renewal_date = current_date + 6;

  ----------------------------------------------------------------------------
  -- Escalations, lessons, extra DNC
  ----------------------------------------------------------------------------
  perform pg_temp.act('quinn');
  r := public.raise_escalation('Green Leaf Dental asks us to waive the rush fee',
    'Prospect will sign this week if we drop the 25% rush surcharge but still launch in 4 weeks.',
    'medium', ids[13], null, 'Keep catalogue price; offer standard timeline without rush, or move AI assistant to Phase 2.');
  perform pg_temp.act('top_g');
  perform public.update_escalation((r->>'escalation_id')::uuid, 'escalate_to_letty',
    'Discounts are Letty-only. My recommendation: keep price, offer 40/30/30.');

  perform pg_temp.act('jordan');
  r := public.raise_escalation('Vela Yoga wants the site in Catalan too',
    'Is Catalan a third "extra language" add-on, or included because they are in the EU market?',
    'low', ids[9], null, 'Quote it as one extra language add-on (€360).');
  perform pg_temp.act('top_g');
  perform public.update_escalation((r->>'escalation_id')::uuid, 'resolve',
    'Catalogue rule: each extra language is an add-on. Quinn to quote 2 × extra language.');

  perform pg_temp.act('hunter');
  perform public.raise_escalation('Several Instagram leads have no website or email',
    'Should I still create leads that only have an Instagram handle?', 'low', null, null,
    'Create them with channel = instagram; Jordan screens them.');

  perform pg_temp.act('dana');
  perform public.add_lesson('Restaurants reply faster on WhatsApp than email',
    'Across the last food & beverage projects, WhatsApp openers got replies within a day while email took a week or never. Lead with a short voice-friendly message and one concrete idea.',
    'outreach', 'Restaurant');
  perform public.add_lesson('Ask for photos at signing, not at kickoff',
    'Two projects slipped because client photos arrived late. Make photos and price lists part of the deposit checklist and offer stock photography as a fallback in the proposal.',
    'delivery', null);
  perform public.add_lesson('Dental clinics care about booking deposits',
    'No-shows are the top pain for clinics. Leading with the booking + deposits add-on and a no-show cost estimate moved two clinics from discovery to proposal.',
    'targeting', 'Dental');
  r := public.add_lesson('Harbour Legal loved the copywriting', 'Leaked client name test.', 'general', null);
  if r->>'status' <> 'rejected' then raise exception 'lesson anonymisation guard failed'; end if;

  perform pg_temp.act('jordan');
  perform public.add_do_not_contact('domain', 'spammy-leads.example', 'Bounced + complaint');

  perform pg_temp.act('top_g');
end $$;

-- -----------------------------------------------------------------------------
-- Spread timestamps over the past ~6 weeks so dashboards look lived-in
-- -----------------------------------------------------------------------------
do $$
declare v_max bigint; v_n bigint;
begin
  select max(id), count(*) into v_max, v_n from public.activity_log;
  update public.activity_log set created_at = now() - ((v_max - id) * (interval '42 days' / greatest(v_n, 1)))
    - (random() * interval '40 minutes');
  select max(id), count(*) into v_max, v_n from public.stage_changes;
  update public.stage_changes set created_at = now() - ((v_max - id) * (interval '42 days' / greatest(v_n, 1)));
  update public.leads l set created_at = s.first_at,
         stage_changed_at = s.last_at
    from (select lead_id, min(created_at) first_at, max(created_at) last_at from public.stage_changes group by lead_id) s
   where s.lead_id = l.id;
  update public.companies c set created_at = l.created_at from public.leads l where l.company_id = c.id;
  update public.deals d set created_at = (select min(a.created_at) from public.activity_log a where a.entity_id = d.id),
         signed_at = case when d.signed_at is not null then
                     (select max(a.created_at) from public.activity_log a where a.entity_id = d.id and a.action = 'sign_deal') end;
  update public.escalations e set created_at = (select min(a.created_at) from public.activity_log a where a.entity_id = e.id);
  update public.approval_batches b set submitted_at = (select min(a.created_at) from public.activity_log a where a.entity_id = b.id);
  update public.outreach_drafts o set created_at = (select min(a.created_at) from public.activity_log a where a.entity_id = o.id),
         sent_at = case when o.sent_at is not null then
                   (select max(a.created_at) from public.activity_log a where a.entity_id = o.id and a.action = 'log_send') end;
end $$;

select set_config('squad.acting_agent', '', false);
