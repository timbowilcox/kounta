#!/usr/bin/env bash
# Real-Postgres proof for the fail-closed migration runner (Session C).
# Proves on a THROWAWAY Postgres 18.x (sql.js cannot exercise the PG error path):
#   A. fresh empty DB -> full manifest applies (32 applied, 0 failed), exit 0
#   B. same DB re-run -> 0 applied, 32 skipped, exit 0 (idempotent)
#   C. a deliberately-broken migration -> boot ABORTS non-zero, server never starts
# No prod/Railway is touched. The cluster is torn down at the end.
set -uo pipefail

PGBIN="$HOME/scoop/apps/postgresql/current/bin"
PORT=55450
DATADIR="/c/pgeval-failclosed"
APP_PORT=3997
ENTRY="packages/api/dist/index.js"
BROKEN_MIG="packages/core/src/db/migrations/032_review_items.sql"
LOG=/tmp/runner-proof

fail() { echo "PROOF FAILED: $*"; teardown; exit 1; }

teardown() {
  "$PGBIN/pg_ctl" -D "$DATADIR" -m fast stop >/dev/null 2>&1
  rm -rf "$DATADIR" 2>/dev/null
  [ -f "${BROKEN_MIG}.bak" ] && mv -f "${BROKEN_MIG}.bak" "$BROKEN_MIG"
}

# Run the entrypoint against $1 (db name); for the success case it starts a
# server, so we poll the log for the summary line then kill it. Echoes the
# captured exit code (or "RUNNING" if it started serving) via globals.
run_entry() {
  local db="$1" out="$2"
  : > "$out"
  DATABASE_URL="postgres://postgres@localhost:$PORT/$db" PORT=$APP_PORT \
    node "$ENTRY" > "$out" 2>&1 &
  local pid=$!
  for _ in $(seq 1 60); do
    if grep -q "Migrations:" "$out" 2>/dev/null; then
      sleep 1
      if grep -qiE "listening|server (started|running)|:$APP_PORT" "$out" 2>/dev/null; then
        kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; echo "RUNNING"; return 0
      fi
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"; echo "$?"; return 0   # process exited on its own
    fi
    sleep 0.5
  done
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; echo "TIMEOUT"; return 0
}

trap teardown EXIT

echo "=== build @kounta/api ==="
pnpm --filter @kounta/api... build >/tmp/build.log 2>&1 || fail "build failed (see /tmp/build.log)"
[ -f "$ENTRY" ] || fail "entrypoint $ENTRY not found after build"

echo "=== initdb throwaway cluster on :$PORT ==="
rm -rf "$DATADIR"
# UTF-8 cluster to match production (Railway/Linux defaults to UTF8). Windows
# initdb would otherwise default to WIN1252 and choke on UTF-8 chars in migration
# comments — a harness artifact, NOT a prod condition.
"$PGBIN/initdb" -U postgres --auth=trust -E UTF8 --locale=C -D "$DATADIR" >/tmp/initdb.log 2>&1 || fail "initdb failed"
"$PGBIN/pg_ctl" -D "$DATADIR" -o "-p $PORT" -l /tmp/pg.log start >/dev/null 2>&1 || fail "pg_ctl start failed"
sleep 2
"$PGBIN/psql" -U postgres -h localhost -p $PORT -c "CREATE DATABASE kounta_proof;" >/dev/null 2>&1 || fail "createdb kounta_proof failed"
"$PGBIN/psql" -U postgres -h localhost -p $PORT -c "CREATE DATABASE kounta_broken;" >/dev/null 2>&1 || fail "createdb kounta_broken failed"

echo ""
echo "=== PROOF A: fresh empty DB applies the full manifest ==="
RA=$(run_entry kounta_proof "$LOG-A.log")
grep -E "Migrations: [0-9]+ applied" "$LOG-A.log" || true
SUM_A=$(grep -oE "Migrations: [0-9]+ applied, [0-9]+ skipped, [0-9]+ failed" "$LOG-A.log" | tail -1)
echo "exit/state: $RA | summary: $SUM_A"
[ "$RA" = "RUNNING" ] || fail "A: server did not start (state=$RA) — expected a clean boot to serve"
echo "$SUM_A" | grep -qE "32 applied, 0 skipped, 0 failed" || fail "A: expected 32 applied/0 failed, got: $SUM_A"

echo ""
echo "=== PROOF B: idempotent re-run (already-applied are skipped) ==="
RB=$(run_entry kounta_proof "$LOG-B.log")
SUM_B=$(grep -oE "Migrations: [0-9]+ applied, [0-9]+ skipped, [0-9]+ failed" "$LOG-B.log" | tail -1)
echo "exit/state: $RB | summary: $SUM_B"
[ "$RB" = "RUNNING" ] || fail "B: server did not start (state=$RB)"
echo "$SUM_B" | grep -qE "0 applied, 32 skipped, 0 failed" || fail "B: expected 0 applied/32 skipped, got: $SUM_B"

echo ""
echo "=== PROOF C: a deliberately-broken migration ABORTS boot non-zero ==="
cp "$BROKEN_MIG" "${BROKEN_MIG}.bak"
printf '\n-- INJECTED FAILURE (proof only)\nSELECT this_column_does_not_exist FROM this_table_does_not_exist;\n' >> "$BROKEN_MIG"
RC=$(run_entry kounta_broken "$LOG-C.log")
mv -f "${BROKEN_MIG}.bak" "$BROKEN_MIG"   # restore immediately
SUM_C=$(grep -oE "Migrations: [0-9]+ applied, [0-9]+ skipped, [0-9]+ failed" "$LOG-C.log" | tail -1)
echo "exit/state: $RC | summary: $SUM_C"
grep -qi "refusing to start" "$LOG-C.log" || fail "C: missing 'refusing to start' abort message"
grep -qi "Fatal: server startup failed" "$LOG-C.log" || fail "C: missing fatal-exit log"
[ "$RC" = "1" ] || fail "C: expected non-zero (1) exit, got state=$RC (server must NOT serve a half-migrated DB)"
echo "$SUM_C" | grep -qE "[0-9]+ applied, [0-9]+ skipped, [1-9][0-9]* failed" || fail "C: expected failed>0, got: $SUM_C"

echo ""
echo "=== confirm nothing left listening on :$APP_PORT ==="
if grep -qi "RUNNING" <<< "$RC"; then fail "C: server was serving despite migration failure"; fi

echo ""
echo "ALL PROOFS PASSED (A: $SUM_A | B: $SUM_B | C aborted non-zero: $SUM_C)"
