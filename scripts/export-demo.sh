#!/usr/bin/env bash
# Regenerates src/lib/demo/data.json from a freshly seeded throwaway database,
# so the app's demo mode (no Supabase env vars) shows realistic data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEEP_DB=1 bash "$ROOT/scripts/test-db.sh" >/dev/null
PSQL="psql -h /tmp -p ${PGPORT_TEST:-54329} -U postgres -d squad -At -X"
TABLES="agents markets catalogue_packages catalogue_package_prices catalogue_addons catalogue_care_plans catalogue_terms
companies contacts leads stage_changes approval_batches outreach_drafts discovery_notes deals deal_items proposals
projects scopes milestones deliverables payments escalations activity_log lessons testimonials referrals
care_subscriptions care_hours_log do_not_contact"
mkdir -p "$ROOT/src/lib/demo"
{
  echo "{\"exported_at\": \"$($PSQL -c "select now()")\""
  for t in $TABLES; do
    echo ", \"$t\": $($PSQL -c "select coalesce(json_agg(t), '[]') from public.$t t")"
  done
  echo "}"
} > "$ROOT/src/lib/demo/data.json"
runuser -u postgres -- pkill -f "postgres -D /tmp/tmp" 2>/dev/null || pkill -u postgres postgres || true
echo "wrote src/lib/demo/data.json ($(wc -c < "$ROOT/src/lib/demo/data.json") bytes)"
