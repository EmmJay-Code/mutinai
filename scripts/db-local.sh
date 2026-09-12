#!/usr/bin/env bash
# Isolated local Postgres cluster for Mutinai development (does not touch any system install).
# Usage: scripts/db-local.sh start|stop|status|reset
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="$ROOT/.data/postgres"
PORT="${MUTINAI_PG_PORT:-54329}"
LOG="$ROOT/.data/postgres.log"

init() {
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA"
    initdb -D "$PGDATA" -U mutinai --auth=trust --encoding=UTF8 --locale=C >/dev/null
  fi
}
case "${1:-start}" in
  start)
    init
    if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
      pg_ctl -D "$PGDATA" -l "$LOG" -o "-p $PORT -k /tmp" -w start >/dev/null
    fi
    for db in mutinai mutinai_test; do
      psql -h 127.0.0.1 -p "$PORT" -U mutinai -d postgres -tAc "select 1 from pg_database where datname='$db'" | grep -q 1 \
        || createdb -h 127.0.0.1 -p "$PORT" -U mutinai "$db"
    done
    echo "postgres running on 127.0.0.1:$PORT (databases: mutinai, mutinai_test)";;
  stop) pg_ctl -D "$PGDATA" -w stop ;;
  status) pg_ctl -D "$PGDATA" status ;;
  reset)
    pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1 || true
    rm -rf "$PGDATA"; "$0" start ;;
  *) echo "usage: $0 start|stop|status|reset"; exit 1;;
esac
