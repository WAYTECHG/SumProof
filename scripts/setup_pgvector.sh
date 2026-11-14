#!/usr/bin/env bash
# One-time: PostgreSQL 18 + pgvector inside WSL Ubuntu (no Docker needed).
# Run in Ubuntu:  bash /mnt/c/<path to>/SumProof/scripts/setup_pgvector.sh
set -euo pipefail
DB=sumproof
export PAGER=cat PSQL_PAGER=cat   # print query results instead of opening a scroll viewer

echo "== install PostgreSQL 18 + pgvector =="
sudo apt-get update -y
sudo apt-get install -y postgresql postgresql-18-pgvector

echo "== start the server =="
# WSL may run without systemd, so start the cluster directly.
sudo pg_ctlcluster 18 main start 2>/dev/null || sudo service postgresql start
sudo -u postgres psql -tc "select version();"

echo "== database and role for $USER (local socket, no password) =="
sudo -u postgres psql -tc "select 1 from pg_roles where rolname='$USER'" | grep -q 1 || sudo -u postgres createuser --superuser "$USER"
psql -d postgres -tc "select 1 from pg_database where datname='$DB'" | grep -q 1 || createdb "$DB"
psql -d "$DB" -c "create extension if not exists vector;" -c "select extversion as pgvector_version from pg_extension where extname='vector';"

echo "== Python driver =="
source "$HOME/venvs/sumproof/bin/activate"
pip install "psycopg[binary]" pgvector faiss-cpu rank_bm25

echo "Done. Start Postgres after a reboot with:  sudo pg_ctlcluster 18 main start"
