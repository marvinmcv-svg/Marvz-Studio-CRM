-- =============================================================================
-- Squad CRM — bulk lead upload
--
-- create_leads_bulk(p_leads jsonb) takes an array of up to 100 leads and runs
-- each one through create_lead, so every lead gets the same do-not-contact
-- check, duplicate detection (including against earlier rows in the same
-- batch), stage logging and activity log entry as a single create_lead call.
-- One bad row never stops the batch: it is reported and the rest continue.
-- =============================================================================

create or replace function public.create_leads_bulk(p_leads jsonb, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me text := public.require_agent('hunter');
  v_max constant int := 100;
  r jsonb; v_res jsonb; v_out jsonb := '[]'; i int := 0;
  n_created int := 0; n_dup int := 0; n_dnc int := 0; n_err int := 0;
  v_services text[]; v_langs text[];
begin
  if p_leads is null or jsonb_typeof(p_leads) <> 'array' then
    raise exception 'p_leads must be a JSON array of lead objects';
  end if;
  if jsonb_array_length(p_leads) = 0 then
    raise exception 'p_leads is empty';
  end if;
  if jsonb_array_length(p_leads) > v_max then
    raise exception 'Too many leads in one call (% > %). Send them in chunks of % or fewer.',
      jsonb_array_length(p_leads), v_max, v_max;
  end if;

  for r in select value from jsonb_array_elements(p_leads) loop
    i := i + 1;
    begin
      if jsonb_typeof(r) <> 'object' then
        raise exception 'row is not a JSON object';
      end if;
      -- accept arrays or a single comma-separated string for the two list fields
      v_services := case jsonb_typeof(r->'service_interest')
                      when 'array' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(r->'service_interest') x)
                      when 'string' then string_to_array(regexp_replace(r->>'service_interest', '\s*,\s*', ',', 'g'), ',')
                      else '{}' end;
      v_langs := case jsonb_typeof(r->'languages')
                   when 'array' then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(r->'languages') x)
                   when 'string' then string_to_array(regexp_replace(r->>'languages', '\s*,\s*', ',', 'g'), ',')
                   else '{es}' end;

      v_res := public.create_lead(
        p_business         => r->>'business',
        p_contact_name     => nullif(trim(r->>'contact_name'), ''),
        p_email            => nullif(trim(r->>'email'), ''),
        p_phone            => nullif(trim(r->>'phone'), ''),
        p_website          => nullif(trim(r->>'website'), ''),
        p_instagram        => nullif(trim(r->>'instagram'), ''),
        p_industry         => nullif(trim(r->>'industry'), ''),
        p_city             => nullif(trim(r->>'city'), ''),
        p_country          => nullif(trim(r->>'country'), ''),
        p_market           => coalesce(nullif(trim(r->>'market'), ''), 'US'),
        p_service_interest => v_services,
        p_budget_band      => coalesce(nullif(trim(r->>'budget_band'), ''), 'unknown'),
        p_timeline         => nullif(trim(r->>'timeline'), ''),
        p_languages        => v_langs,
        p_source           => nullif(trim(r->>'source'), ''),
        p_channel          => nullif(lower(trim(r->>'channel')), '')::outreach_channel,
        p_portfolio_case   => nullif(trim(r->>'portfolio_case'), ''),
        p_notes            => nullif(trim(r->>'notes'), ''),
        p_force            => coalesce((r->>'force')::boolean, p_force));

      case v_res->>'status'
        when 'created'        then n_created := n_created + 1;
        when 'duplicate'      then n_dup := n_dup + 1;
        when 'do_not_contact' then n_dnc := n_dnc + 1;
        else null;
      end case;
      v_out := v_out || jsonb_build_object('row', i, 'business', r->>'business', 'status', v_res->>'status',
        'code', v_res->>'code', 'lead_id', v_res->>'lead_id', 'matches', v_res->'matches');
    exception when others then
      n_err := n_err + 1;
      v_out := v_out || jsonb_build_object('row', i, 'business', r->>'business', 'status', 'error', 'error', sqlerrm);
    end;
  end loop;

  perform public.log_activity('create_leads_bulk', 'lead', null, null,
    format('Bulk upload: %s rows → %s created, %s duplicates, %s do-not-contact, %s errors',
           i, n_created, n_dup, n_dnc, n_err),
    jsonb_build_object('rows', i, 'created', n_created, 'duplicates', n_dup, 'do_not_contact', n_dnc, 'errors', n_err));

  return jsonb_build_object('status', 'done', 'total', i, 'created', n_created, 'duplicates', n_dup,
                            'do_not_contact', n_dnc, 'errors', n_err, 'results', v_out);
end $$;

revoke execute on function public.create_leads_bulk(jsonb, boolean) from public, anon;
grant  execute on function public.create_leads_bulk(jsonb, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Faster duplicate check (same results): normalise the input once, find
-- candidate companies through the indexed columns, and only then build the
-- "matched_on" list. The old version re-evaluated every check for every lead,
-- so bulk uploads slowed down linearly as the CRM grew.
-- -----------------------------------------------------------------------------
create or replace function public.find_duplicate_leads(
  p_business text default null, p_email text default null, p_phone text default null,
  p_website text default null, p_instagram text default null
) returns jsonb
language sql stable security definer set search_path = public as $$
  with q as (
    select public.norm_text(p_business) as b, public.norm_domain(p_website) as d,
           public.norm_handle(p_instagram) as ig, nullif(lower(trim(p_email)), '') as e,
           public.norm_phone(p_phone) as ph
  ),
  cand as (
    select c.id from public.companies c, q where c.name_norm = q.b
    union
    select c.id from public.companies c, q
     where length(q.b) >= 6 and length(c.name_norm) >= 6
       and (position(q.b in c.name_norm) > 0 or position(c.name_norm in q.b) > 0)
    union
    select c.id from public.companies c, q where c.domain_norm = q.d
    union
    select c.id from public.companies c, q where c.instagram_norm = q.ig
    union
    select k.company_id from public.contacts k, q where k.email_norm = q.e
    union
    select k.company_id from public.contacts k, q where k.phone_norm = q.ph
  ),
  hits as (
    select l.id as lead_id, 'SQ-' || l.ref as code, c.name as business, l.stage::text as stage,
           array_remove(array[
             case when c.name_norm = q.b then 'business name'
                  when length(q.b) >= 6 and length(c.name_norm) >= 6
                       and (position(q.b in c.name_norm) > 0 or position(c.name_norm in q.b) > 0) then 'similar name' end,
             case when c.domain_norm is not null and c.domain_norm = q.d then 'website' end,
             case when c.instagram_norm is not null and c.instagram_norm = q.ig then 'instagram' end,
             case when exists (select 1 from public.contacts k where k.company_id = c.id and k.email_norm = q.e) then 'email' end,
             case when exists (select 1 from public.contacts k where k.company_id = c.id and k.phone_norm = q.ph) then 'phone' end
           ], null) as matched_on
    from cand join public.companies c on c.id = cand.id
    join public.leads l on l.company_id = c.id
    cross join q
  )
  select coalesce(jsonb_agg(to_jsonb(h)), '[]') from hits h where cardinality(h.matched_on) > 0 and public.is_member()
$$;
