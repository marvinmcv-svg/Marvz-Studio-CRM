-- =============================================================================
-- Squad CRM — "held" pipeline stage (master fix #9)
--
-- Held = found but parked (unverified, waiting on a check, or flagged). Held
-- leads are stored in the CRM so the team can see them and duplicate checks
-- match against them, but they can never be screened, drafted or batched.
-- (Own migration: a new enum value must be committed before it can be used.)
-- =============================================================================
alter type public.pipeline_stage add value if not exists 'held' before 'found';
