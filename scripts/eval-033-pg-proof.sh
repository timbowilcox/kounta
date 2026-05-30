#!/usr/bin/env bash
# Real-Postgres proof for migration 033 (ledger_status += 'deleted').
#   A. fresh empty UTF-8 DB -> 33 applied / 0 / 0, server starts
#   B. re-run same DB        -> 0 applied / 33 skipped / 0, server starts (033 ALTER TYPE idempotent)
#   C. ledger_status enum actually contains 'deleted' (033's special-case ran)
#   D. softDeleteLedger happy-path on real PG: deletes, hides from getLedger, keeps the other ledger
# Throwaway cluster; torn down at the end. No prod/Railway touched.
set -uo pipefail

PGBIN="$HOME/scoop/apps/postgresql/current/bin"
PORT=55491
DATADIR="/c/pg033proof"
APP_PORT=3994
ENTRY="packages/api/dist/index.js"
LOG=/tmp/pg033

fail() { echo "033 PROOF FAILED: $*"; }
teardown() {
  "$PGBIN/pg_ctl" -D "$DATADIR" -m fast stop >/dev/null 2>&1
  rm -rf "$DATADIR" 2>/dev/null
}
trap teardown EXIT

run_entry() {
  local db="$1" out="$2"; : > "$out"
  DATABASE_URL="postgres://postgres@localhost:$PORT/$db" PORT=$APP_PORT node "$ENTRY" > "$out" 2>&1 &
  local pid=$!
  for _ in $(seq 1 80); do
    if grep -q "Migrations:" "$out" 2>/dev/null; then
      sleep 1
      if grep -qiE "listening|server (started|running)|:$APP_PORT" "$out" 2>/dev/null; then
        kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; echo "RUNNING"; return 0
      fi
    fi
    if ! kill -0 "$pid" 2>/dev/null; then wait "$pid"; echo "$?"; return 0; fi
    sleep 0.5
  done
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; echo "TIMEOUT"; return 0
}

echo "=== build @kounta/api ==="
pnpm --filter @kounta/api... build >/tmp/build-033proof.log 2>&1 || { fail "build"; exit 1; }
[ -f "$ENTRY" ] || { fail "no entry"; exit 1; }

echo "=== initdb UTF-8 cluster :$PORT ==="
rm -rf "$DATADIR"
"$PGBIN/initdb" -U postgres --auth=trust -E UTF8 --locale=C -D "$DATADIR" >/tmp/initdb-033.log 2>&1 || { fail "initdb"; exit 1; }
"$PGBIN/pg_ctl" -D "$DATADIR" -o "-p $PORT" -l /tmp/pg033.log start >/dev/null 2>&1 || { fail "pg start"; exit 1; }
sleep 2
"$PGBIN/psql" -U postgres -h localhost -p $PORT -c "CREATE DATABASE k033;" >/dev/null 2>&1 || { fail "createdb"; exit 1; }

echo ""; echo "=== A: fresh DB applies 001-033 + serves ==="
RA=$(run_entry k033 "$LOG-A.log")
SUM_A=$(grep -oE "Migrations: [0-9]+ applied, [0-9]+ skipped, [0-9]+ failed" "$LOG-A.log" | tail -1)
echo "state=$RA | $SUM_A"
[ "$RA" = "RUNNING" ] && echo "$SUM_A" | grep -qE "33 applied, 0 skipped, 0 failed" && echo "A PASS" || fail "A: $RA / $SUM_A"
grep -q "033_ledger_status_deleted" "$LOG-A.log" && echo "  033 applied line present" || fail "A: 033 not in log"

echo ""; echo "=== B: idempotent re-run ==="
RB=$(run_entry k033 "$LOG-B.log")
SUM_B=$(grep -oE "Migrations: [0-9]+ applied, [0-9]+ skipped, [0-9]+ failed" "$LOG-B.log" | tail -1)
echo "state=$RB | $SUM_B"
[ "$RB" = "RUNNING" ] && echo "$SUM_B" | grep -qE "0 applied, 33 skipped, 0 failed" && echo "B PASS" || fail "B: $RB / $SUM_B"

echo ""; echo "=== C: ledger_status enum contains 'deleted' (033 ALTER TYPE ran) ==="
ENUMV=$("$PGBIN/psql" -U postgres -h localhost -p $PORT -d k033 -t -A -c \
  "SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = 'ledger_status'::regtype;")
echo "ledger_status = $ENUMV"
echo "$ENUMV" | grep -q "deleted" && echo "C PASS" || fail "C: 'deleted' missing from ledger_status"

echo ""; echo "=== D: softDeleteLedger happy-path on real PG ==="
DATABASE_URL="postgres://postgres@localhost:$PORT/k033" node scripts/eval-033-softdelete-pg.mjs || fail "D: softdelete proof failed"

echo ""; echo "=== DONE: A=$SUM_A | B=$SUM_B | enum=$ENUMV ==="
