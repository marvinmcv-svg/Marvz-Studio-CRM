-- create_leads_bulk (migration 20261115000008)
\set QUIET off
set client_min_messages = notice;

select tests.login('hunter');
set role authenticated;
do $$
declare r jsonb;
begin
  r := public.create_leads_bulk($j$[
    {"business": "Bulk Bakery One", "contact_name": "Ana Pérez", "phone": "+591 70000001", "city": "Santa Cruz",
     "country": "BO", "industry": "Bakery", "service_interest": ["presence"], "languages": "es, en",
     "source": "Google Maps", "channel": "WhatsApp"},
    {"business": "Bulk Gym Two", "email": "hello@bulkgymtwo.example", "market": "MX", "budget_band": "5-10k"},
    {"business": "bulk bakery one!!"},
    {"business": "Ferreteria Central"},
    {"business": "Bad Channel Co", "channel": "fax"},
    {"contact_name": "No business name"},
    "not an object"
  ]$j$);
  perform tests.eq((r->>'total')::int, 7, 'bulk: all rows processed');
  perform tests.eq((r->>'created')::int, 2, 'bulk: two leads created');
  perform tests.eq((r->>'duplicates')::int, 1, 'bulk: duplicate inside the same batch detected');
  perform tests.eq((r->>'do_not_contact')::int, 1, 'bulk: do-not-contact row skipped');
  perform tests.eq((r->>'errors')::int, 3, 'bulk: bad rows reported, batch continues');
  perform tests.eq(r->'results'->0->>'code' like 'SQ-%', true, 'bulk: created rows return their SQ code');
  perform tests.eq((select array_to_string(languages, ',') from public.leads
                    where id = (r->'results'->0->>'lead_id')::uuid), 'es,en', 'bulk: comma-separated languages accepted');
  perform tests.eq((select channel::text from public.leads
                    where id = (r->'results'->0->>'lead_id')::uuid), 'whatsapp', 'bulk: channel is case-insensitive');
  perform tests.eq((select market_code from public.leads
                    where id = (r->'results'->1->>'lead_id')::uuid), 'MX', 'bulk: market respected');
end $$;
select tests.expect_error($$select public.create_leads_bulk((select jsonb_agg(jsonb_build_object('business', 'Biz ' || g)) from generate_series(1, 101) g))$$,
                          'chunks of 100');
select tests.expect_error($$select public.create_leads_bulk('{}'::jsonb)$$, 'must be a JSON array');
reset role;

select tests.login('quinn');
set role authenticated;
select tests.expect_error($$select public.create_leads_bulk('[{"business":"Nope"}]')$$, 'not allowed');
reset role;

\echo '✓ bulk lead tests passed'
