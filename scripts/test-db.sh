#!/usr/bin/env bash
# Spins up a throwaway Postgres, applies every migration + seed, and runs the
# SQL test suite in supabase/tests. Usage: npm run test:db
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
export PATH="$PGBIN:$PATH"
DATA="$(mktemp -d)"; PORT="${PGPORT_TEST:-54329}"
if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; chown -R postgres "$DATA"; else RUN=""; fi
cleanup() { $RUN pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
$RUN initdb -D "$DATA" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null
$RUN pg_ctl -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=''" -l "$DATA/log" start -w >/dev/null
PSQL="psql -h /tmp -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
$PSQL -c "create database squad" >/dev/null
$PSQL -d squad -f "$ROOT/supabase/tests/00_supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "▸ migration $(basename "$f")"; $PSQL -d squad -f "$f"; done
echo "▸ seed.sql"; $PSQL -d squad -f "$ROOT/supabase/seed.sql"
[ -n "${KEEP_DB:-}" ] && { echo "DB kept on port $PORT"; trap - EXIT; exit 0; }
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do echo "▸ test $(basename "$f")"; $PSQL -d squad -f "$f"; done
echo "✓ database tests passed"
