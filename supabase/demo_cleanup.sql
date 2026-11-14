-- Removes the demo data loaded by supabase/seed.sql but keeps the team
-- (agents) and the price catalogue. Run once before going live:
--   psql "$DATABASE_URL" -f supabase/demo_cleanup.sql
-- (or paste into the Supabase SQL editor)
begin;
truncate table
  public.care_hours_log, public.care_subscriptions, public.referrals, public.testimonials, public.lessons,
  public.activity_log, public.escalations, public.payments, public.deliverables, public.milestones,
  public.scopes, public.projects, public.proposals, public.deal_items, public.deals,
  public.discovery_notes, public.outreach_drafts, public.approval_batches, public.stage_changes,
  public.do_not_contact, public.leads, public.contacts, public.companies
restart identity;
commit;
