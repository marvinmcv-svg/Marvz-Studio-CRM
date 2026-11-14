-- =============================================================================
-- Squad CRM — team + price catalogue (production seed data)
-- Only Letty may change catalogue rows after this (RLS: *_letty_write).
-- =============================================================================

insert into public.agents (code, name, kind, title, description, color) values
  ('letty',  'Letty',  'human', 'Owner',        'Sees everything, approves outreach batches in Grokbot, handles escalations Top G cannot solve.', '#f5b84b'),
  ('top_g',  'Top G',  'ai',    'Coordinator',  'Orchestrates the agents, receives all escalations, double-checks work, escalates to Letty only when needed.', '#a78bfa'),
  ('hunter', 'Hunter', 'ai',    'Lead finder',  'Finds leads and creates lead records.', '#60a5fa'),
  ('jordan', 'Jordan', 'ai',    'Outreach',     'Re-screens leads, writes personalised drafts, batches them for Letty, sends approved ones and logs them.', '#34d399'),
  ('quinn',  'Quinn',  'ai',    'Closer',       'Discovery with replying prospects, scope drafts, catalogue-priced proposals, moves deals to signing.', '#f472b6'),
  ('dana',   'Dana',   'ai',    'Delivery',     'Scope of work, handoff plan, progress + slippage, QA against scope, sign-off, testimonials, referrals, lessons.', '#fb923c');

insert into public.markets (code, name, currency, symbol, factor, sort) values
  ('US', 'United States / default', 'USD', '$',    1.000, 1),
  ('CA', 'Canada',                  'CAD', 'CA$',  1.350, 2),
  ('MX', 'Mexico',                  'MXN', 'MX$',  8.300, 3),
  ('UK', 'United Kingdom',          'GBP', '£',    0.820, 4),
  ('EU', 'Eurozone',                'EUR', '€',    0.920, 5),
  ('AU', 'Australia',               'AUD', 'A$',   1.500, 6);

insert into public.catalogue_care_plans (code, name, monthly_usd, hours_included, description, sort) values
  ('basic',  'Basic',          129, 1, 'Hosting, updates, backups, uptime monitoring, 1h of small edits.', 1),
  ('pro',    'Pro',            249, 3, 'Everything in Basic plus 3h of edits, monthly report, priority support.', 2),
  ('growth', 'Growth Partner', 449, 6, 'Everything in Pro plus 6h of growth work, SEO and conversion improvements.', 3);

insert into public.catalogue_packages
  (code, name, price_usd, weeks_min, weeks_max, included_care_plan, included_care_months, ai_usage_months, description, includes, sort) values
  ('base',      'Base site', 1900, 2, 3, null,    0, 0, 'Up to 5 pages, no care plan included.',
     '{"Up to 5 pages","Mobile-first design","Contact form","Basic on-page SEO"}', 1),
  ('presence',  'Presence',  2900, 2, 3, 'basic', 1, 0, 'A sharp, fast site that makes the business look established.',
     '{"Up to 5 pages","WhatsApp enquiries","Google Business setup","1 month Basic Care"}', 2),
  ('full_house','Full House',5900, 4, 5, 'pro',   3, 0, 'Conversion-focused site with bookings or a store.',
     '{"Up to 10 pages","Booking or store","Copywriting","Local SEO","3 months Pro Care"}', 3),
  ('flagship',  'Flagship', 11900, 7, 9, 'pro',   6, 3, 'Premium site + web app / AI assistant for ambitious brands.',
     '{"Custom web app features","Scroll storytelling","AI assistant","6 months Pro Care","3 months AI usage"}', 4);

-- Explicit per-market package prices (seeded from the market factor, rounded).
-- Letty: edit these rows to set the real per-market prices.
insert into public.catalogue_package_prices (package_code, market_code, price)
select p.code, m.code, case when m.code = 'US' then p.price_usd else round(p.price_usd * m.factor / 10) * 10 end
from public.catalogue_packages p cross join public.markets m;

insert into public.catalogue_addons (code, name, price_usd, monthly_usd, per_unit, unit_label, sort) values
  ('online_store',      'Online store',            1900,   0, false, null,       1),
  ('booking_deposits',  'Booking + deposits',      1200,   0, false, null,       2),
  ('online_payments',   'Online payments',          790,   0, false, null,       3),
  ('whatsapp_enquiries','WhatsApp enquiries',       490,   0, false, null,       4),
  ('gift_cards',        'Gift cards',               790,   0, false, null,       5),
  ('events',            'Events',                   590,   0, false, null,       6),
  ('local_seo',         'Local SEO',                690,   0, false, null,       7),
  ('review_booster',    'Review booster',           390,   0, false, null,       8),
  ('extra_language',    'Extra language',           390,   0, true,  'language', 9),
  ('monthly_seo',       'Monthly SEO',                0, 490, false, null,      10),
  ('analytics',         'Analytics',                290,   0, false, null,      11),
  ('extra_page',        'Extra page',               190,   0, true,  'page',    12),
  ('copywriting',       'Copywriting',              790,   0, false, null,      13),
  ('blog',              'Blog',                     490,   0, false, null,      14),
  ('scroll_storytelling','Scroll storytelling',    1900,   0, false, null,      15),
  ('brand_identity',    'Brand identity',          1900,   0, false, null,      16),
  ('ai_assistant',      'AI assistant',            1290,  69, false, null,      17),
  ('ai_whatsapp_bot',   'AI WhatsApp bot',         1900, 149, false, null,      18),
  ('installable_app',   'Installable app',          690,   0, false, null,      19),
  ('edit_panel',        'Edit panel',               790,   0, false, null,      20),
  ('domain_email',      'Domain + email',           190,   0, false, null,      21);

insert into public.catalogue_terms (key, value, description) values
  ('payment_plans', '[{"code":"50_50","split":[50,50]},{"code":"40_30_30","split":[40,30,30]}]', 'Allowed payment plans'),
  ('rush',          '{"percent":25}',                 'Rush delivery surcharge on one-off total'),
  ('capacity',      '{"projects_per_month":4}',       'Max new projects started per month'),
  ('hourly_rate',   '{"usd":95}',                     'Hourly rate without a care plan'),
  ('tax_note',      '"Prices exclude tax and payment-processor fees."', 'Shown on every quote'),
  ('base_currency', '"USD"',                          'All catalogue prices are stored in USD');
