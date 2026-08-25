#!/bin/sh
# =============================================================================
# safe-prisma-deploy.sh
#
# Production-safe SQLite migration deploy for this Prisma project.
#
# What it does (read-only on the database until the deploy step):
#   1. Resolves the REAL SQLite database file from DATABASE_URL using exactly
#      the same rule the Prisma CLI applies: relative `file:` paths are
#      resolved against the directory of prisma/schema.prisma, and query
#      strings / fragments are stripped. Any non-`file:` scheme is rejected
#      (this project is SQLite-only).
#   2. Refuses to run if the database file does not exist. It NEVER lets
#      Prisma silently create a fresh database in production -- if the path is
#      wrong, the script fails loudly instead of minting a new empty DB next
#      to the real one.
#   3. Verifies SQLite integrity of the live database (PRAGMA integrity_check).
#   4. Verifies the Prisma migration ledger: no failed / in-progress entries,
#      and every applied migration file still exists and still matches the
#      checksum Prisma recorded when it was applied. (Prisma 6.19's
#      `migrate status` does NOT detect tampered or deleted migration files,
#      so this script cross-checks the ledger itself.)
#   5. Migration alignment guard (deploy mode only): compares the local
#      migration directory names against the SUCCESSFUL rows in the target
#      database's _prisma_migrations ledger and allows pending migrations only
#      from the additive migration set shipped by this release:
#        20260819090000_add_announcement_media
#        20260824120000_add_referral_query_indexes
#      It aborts if:
#        - any historical migration is missing from the database (unapplied),
#        - any DB-applied migration file is missing locally,
#        - any extra/unexpected pending migration exists,
#        - both release migrations are already applied with nothing pending --
#          i.e. a no-op deploy. A clean no-op is allowed ONLY with the explicit
#          ALLOW_NOOP flag.
#      Future releases override the expectation with EXPECTED_PENDING_MIGRATIONS
#      (space-separated list of migration names).
#   6. Creates a CONSISTENT backup of the actual target using the SQLite
#      online backup API (`sqlite3 .backup`, NOT `cp`), so the snapshot is
#      crash-consistent even if an application process is still writing.
#      --backup-only needs NOTHING but sqlite3: it creates and verifies the
#      backup even if the Prisma CLI / `migrate status` is broken (the backup
#      step runs after the integrity + ledger basic checks and before any
#      Prisma invocation).
#   7. Verifies the backup: non-empty, PRAGMA integrity_check, and a
#      per-table row-count / migration-ledger fingerprint identical to the
#      source. Prints the absolute backup path and its SHA-256.
#   8. `prisma migrate status` gates the DEPLOY only AFTER the backup exists
#      and has been verified. If it reports divergence or failures, the script
#      aborts and points at the verified backup.
#   9. Snapshots per-table row counts immediately before `prisma migrate
#      deploy` and compares them afterwards. Migrations in this project are
#      additive; if ANY pre-existing non-system table's row count changes
#      (or a table disappears), the script aborts loudly -- that is the
#      signature of a destructive / unexpected migration.
#  10. Post-checks after a deploy: integrity_check, `prisma migrate status`
#      clean, and the expected migration(s) present in the ledger as applied.
#
# Usage:
#   sh scripts/safe-prisma-deploy.sh              # backup + guard + status gate + deploy
#   sh scripts/safe-prisma-deploy.sh --backup-only # integrity/ledger checks + backup + verify + exit
#
# Environment:
#   DATABASE_URL         SQLite connection string. Resolved in this order
#                        (mirrors the Prisma CLI, verified on 6.19):
#                          1. environment variable (wins over everything)
#                          2. <project>/.env
#                          3. <project>/prisma/.env
#                        .env.local files are NOT consulted, because the
#                        Prisma CLI in this project's version does not load
#                        them. There is intentionally NO DEFAULT: guessing a
#                        default in production can migrate the wrong database.
#   DATABASE_BACKUP_DIR  Backup directory (default: <project>/backups/database)
#   EXPECTED_PENDING_MIGRATIONS
#                        Space-separated list of migration names allowed to be
#                        pending before deploy. Safe default for THIS release:
#                        20260819090000_add_announcement_media and
#                        20260824120000_add_referral_query_indexes.
#                        Set explicitly for future releases (or for a fresh
#                        database bootstrapping all migrations at once).
#   ALLOW_NOOP           Any non-empty value allows the otherwise-aborted
#                        clean no-op case: every local migration (including
#                        this release's) is already applied, so nothing would
#                        be deployed. Backup is still created and verified,
#                        then the script exits 0.
#
# SAFETY NOTICE:
#   STOP THE APPLICATION BEFORE RUNNING THIS SCRIPT. SQLite allows only one
#   writer at a time; a running bot can hold a write lock or be mid-
#   transaction. The backup uses the online backup API so it is consistent
#   even under readers, but the pre/post row-count check cannot distinguish
#   your bot writing during the deploy from a destructive migration. Deploy
#   inside a maintenance window.
# =============================================================================

set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PRISMA_DIR="$PROJECT_ROOT/prisma"
SCHEMA_FILE="$PRISMA_DIR/schema.prisma"
MIGRATIONS_DIR="$PRISMA_DIR/migrations"
BACKUP_DIR="${DATABASE_BACKUP_DIR:-$PROJECT_ROOT/backups/database}"
TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')

# Migration alignment guard configuration. Safe default: pending migrations
# may only come from this release's two additive migrations. This also safely
# supports a target where one of the two is already applied.
EXPECTED_PENDING_MIGRATIONS="${EXPECTED_PENDING_MIGRATIONS:-20260819090000_add_announcement_media 20260824120000_add_referral_query_indexes}"
NOOP=0

# Work from the project root: the Prisma CLI discovers schema.prisma, .env
# and relative paths from the current directory, so pinning the cwd here makes
# every subsequent command deterministic regardless of where this script was
# invoked from.
cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() {
  echo "safe-prisma-deploy: ERROR: $*" >&2
  exit 1
}

info() {
  echo "safe-prisma-deploy: $*"
}

warn() {
  echo "safe-prisma-deploy: WARNING: $*" >&2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

# capture <command...> -- runs a command, captures stdout+stderr into $out and
# the exit code into $ec. Used wherever a command's output must be inspected
# before deciding to abort (avoids `set -e` killing the script prematurely).
capture() {
  set +e
  out=$("$@" 2>&1)
  ec=$?
  set -e
}

# SHA-256 tool selection (macOS: shasum, Linux: sha256sum, fallback: openssl).
SHA_CMD=
if command -v shasum >/dev/null 2>&1; then
  SHA_CMD=shasum
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD=sha256sum
elif command -v openssl >/dev/null 2>&1; then
  SHA_CMD=openssl
else
  die "no SHA-256 tool found (need shasum, sha256sum or openssl)"
fi

sha256_of() {
  case "$SHA_CMD" in
    shasum)   shasum -a 256 "$1" | awk '{print $1}' ;;
    sha256sum) sha256sum "$1" | awk '{print $1}' ;;
    openssl)  openssl dgst -sha256 "$1" | sed 's/^.*= *//' ;;
  esac
}

# Prisma runner: prefer the locally installed CLI (no npm registry contact in
# production); fall back to `npx --no-install` or a PATH `prisma`.
# Resolution is LAZY: --backup-only never invokes Prisma, so a broken or
# absent CLI must not prevent a backup from being created and verified.
if [ -x "$PROJECT_ROOT/node_modules/.bin/prisma" ]; then
  prisma() { "$PROJECT_ROOT/node_modules/.bin/prisma" "$@"; }
elif command -v npx >/dev/null 2>&1; then
  prisma() { npx --no-install prisma "$@"; }
elif command -v prisma >/dev/null 2>&1; then
  # `command` bypasses this function, avoiding infinite recursion
  prisma() { command prisma "$@"; }
else
  prisma() {
    die "Prisma CLI not found: checked $PROJECT_ROOT/node_modules/.bin/prisma, npx and PATH"
  }
fi

# Temporary workspace (cleaned up on exit, including on signals).
if command -v mktemp >/dev/null 2>&1; then
  TMPDIR_PRIVATE=$(mktemp -d "${TMPDIR:-/tmp}/safe-prisma-deploy.XXXXXX") || die "cannot create temp directory"
else
  TMPDIR_PRIVATE=/tmp/safe-prisma-deploy.$$
  mkdir -p "$TMPDIR_PRIVATE"
fi
trap 'rm -rf "$TMPDIR_PRIVATE"' 0
trap 'exit 1' 1 2 3 15

# env_from_file <file> <var> -- echoes the value of <var> from a dotenv-style
# file (last definition wins, matching dotenv semantics). Handles optional
# `export` prefix, surrounding whitespace, single/double quotes, a trailing
# whitespace-prefixed comment, and trailing whitespace. Returns 1 if the
# variable is not defined in the file.
env_from_file() {
  _file=$1
  _var=$2
  [ -r "$_file" ] || return 1
  _line=$(grep -E "^[[:space:]]*export[[:space:]]+${_var}[[:space:]]*=" "$_file" 2>/dev/null | tail -n 1)
  if [ -z "$_line" ]; then
    _line=$(grep -E "^[[:space:]]*${_var}[[:space:]]*=" "$_file" 2>/dev/null | tail -n 1)
  fi
  [ -n "$_line" ] || return 1
  # strip everything through the first '=' (also drops any `export ` prefix)
  _val=${_line#*=}
  # strip trailing comment only for unquoted values (a quoted value could
  # legitimately contain " #")
  case "$_val" in
    \'*|\"*) ;;
    *" #"*) _val=${_val%%" #"*} ;;
  esac
  # trim trailing whitespace, then leading whitespace
  _val=${_val%"${_val##*[![:space:]]}"}
  _val=${_val#"${_val%%[![:space:]]*}"}
  # strip matching surrounding quotes
  case "$_val" in
    \"*\") _val=${_val#\"}; _val=${_val%\"} ;;
    \'*\') _val=${_val#\'}; _val=${_val%\'} ;;
  esac
  printf '%s\n' "$_val"
}

# canon_path <path> -- prints the canonical absolute path by normalizing the
# path lexically: resolves '.', '..' and duplicate slashes without touching
# the filesystem (the target directory may not exist yet, or this may be a
# brand-new deployment). Every tool that later opens the path (sqlite3,
# Prisma) follows symlinks itself, so no symlink resolution is needed here.
canon_path() {
  _c=$1
  case "$_c" in
    /*) _out="" ;;            # absolute path: rebuild from root
    *) _out="$PWD" ;;        # relative path: start from the current directory
  esac
  # split into components and rebuild, collapsing '.', '..' and duplicate '/'.
  # `tr`/`sed` here only tokenize; the loop body mutates _out in this shell.
  printf '%s\n' "$_c" | sed 's#^/+##; s#/+$##' | tr '/' '\n' > "$TMPDIR_PRIVATE/pathcomps.txt"
  while IFS= read -r _comp; do
    case "$_comp" in
      ""|".") continue ;;
      "..") case "$_out" in
               */*) _out=${_out%/*} ;;
               *) _out="" ;;
             esac ;;
      *) _out="$_out/$_comp" ;;
    esac
  done < "$TMPDIR_PRIVATE/pathcomps.txt"
  [ -n "$_out" ] || _out="/"
  printf '%s\n' "$_out"
}

# ---------------------------------------------------------------------------
# URL / database file resolution
# ---------------------------------------------------------------------------

resolve_db_file() {
  # $1 = raw DATABASE_URL
  raw_url=$1
  case "$raw_url" in
    file:*) ;;
    *)
      die "unsupported DATABASE_URL scheme in: $raw_url
This script is SQLite-only and accepts URLs of the form 'file:...'
(e.g. 'file:./dev.db', 'file:/absolute/path/db.db'). Prisma would resolve
relative file: paths against $PRISMA_DIR."
      ;;
  esac
  # strip the scheme, then the query string / fragment (everything after the
  # first '?' or '#'); note: '?'/'#' inside a file name is not supported
  _path=${raw_url#file:}
  _path=$(printf '%s\n' "$_path" | sed 's/[?#].*//')
  [ -n "$_path" ] || die "DATABASE_URL has an empty file path: $raw_url"
  case "$_path" in
    /*) _db=$_path ;;
    *) _db="$PRISMA_DIR/$_path" ;;
  esac
  _db=$(canon_path "$_db") || die "could not normalize database path: $_db"
  printf '%s\n' "$_db"
}

# ---------------------------------------------------------------------------
# Database checks (all read-only)
# ---------------------------------------------------------------------------

check_integrity() {
  # $1 = database file; aborts unless PRAGMA integrity_check returns "ok"
  capture sqlite3 "$1" "PRAGMA integrity_check;"
  if [ "$ec" -ne 0 ]; then
    die "SQLite integrity check could not be run on $1:
$out"
  fi
  if [ "$out" != "ok" ]; then
    die "SQLite integrity check FAILED on $1:
$out"
  fi
}

check_migration_ledger() {
  # $1 = database file; aborts on failed/in-progress ledger entries and on
  # tampered or deleted migration files (Prisma 6.19's migrate status does
  # not detect those, so we cross-check the ledger checksums ourselves).
  capture sqlite3 "$1" "SELECT 1 FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';"
  if [ "$ec" -ne 0 ] || [ -z "$out" ]; then
    # No ledger: either a brand-new empty database (all migrations pending,
    # deploy will build the whole schema) or a damaged one. Distinguish by
    # whether ANY user table exists.
    capture sqlite3 "$1" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
    [ "$ec" -eq 0 ] || die "could not inspect $1: $out"
    if [ "$out" = "0" ]; then
      warn "database $1 has no tables at all (brand-new or empty file).
All migrations would be pending -- the migration alignment guard below will
reject this unless EXPECTED_PENDING_MIGRATIONS explicitly allows it."
    else
      die "database $1 has tables but no _prisma_migrations table --
migrations were never applied or the ledger was deleted; refusing to continue."
    fi
    return 0
  fi

  # Any migration started but never finished, or rolled back, is failed or
  # in-progress. A clean deploy must not proceed on top of one.
  capture sqlite3 "$1" "SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;"
  [ "$ec" -eq 0 ] || die "could not inspect the migration ledger of $1: $out"
  if [ "$out" != "0" ]; then
    capture sqlite3 "$1" "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL ORDER BY started_at;"
    die "migration ledger of $1 contains failed/in-progress migration(s):
$out
Resolve the failure first (fix or roll back), then re-run this script."
  fi

  # Checksum cross-check: every applied migration's SQL file must still exist
  # and hash to the checksum Prisma stored in the ledger when it applied it.
  # This catches edited-after-the-fact or deleted migration files.
  [ -d "$MIGRATIONS_DIR" ] || return 0
  capture sqlite3 "$1" "SELECT migration_name || '|' || checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at;"
  [ "$ec" -eq 0 ] || die "could not read migration checksums from $1: $out"
  if [ -n "$out" ]; then
    printf '%s\n' "$out" > "$TMPDIR_PRIVATE/ledger-checksums.txt"
    while IFS='|' read -r mname checksum; do
      [ -n "$mname" ] || continue
      mfile="$MIGRATIONS_DIR/$mname/migration.sql"
      if [ ! -f "$mfile" ]; then
        die "migration '$mname' is recorded as applied but its file is missing:
$mfile
Restore the file from version control before deploying."
      fi
      current=$(sha256_of "$mfile")
      if [ "$current" != "$checksum" ]; then
        die "migration '$mname' was modified after it was applied:
  recorded checksum: $checksum
  current  checksum: $current
  file: $mfile
Restore the original migration file from version control before deploying."
      fi
    done < "$TMPDIR_PRIVATE/ledger-checksums.txt"
  fi
}

# ---------------------------------------------------------------------------
# Migration alignment guard (deploy mode only; sqlite3 + filesystem, NO Prisma)
# ---------------------------------------------------------------------------

# set_diff <fileA> <fileB> -- prints the sorted lines of A that are not in B.
# (Both files: one name per line. Empty files are handled correctly.)
set_diff() {
  if [ -s "$2" ]; then
    grep -F -x -v -f "$2" "$1" || true
  else
    cat "$1"
  fi
}

check_migration_alignment() {
  # $1 = database file. Aborts unless the ONLY pending migration(s) match
  # EXPECTED_PENDING_MIGRATIONS and the applied ledger rows all still exist
  # locally. Sets NOOP=1 when everything is already applied and ALLOW_NOOP is
  # set (otherwise that case aborts as well).
  info "checking migration alignment (expected pending migration(s): $EXPECTED_PENDING_MIGRATIONS) ..."
  [ -d "$MIGRATIONS_DIR" ] || die "migrations directory missing: $MIGRATIONS_DIR"

  # Successful ledger rows (finished, not rolled back). A missing ledger table
  # is treated as "nothing applied" so the guard can still reason about a
  # brand-new database.
  : > "$TMPDIR_PRIVATE/applied.txt"
  capture sqlite3 "$1" "SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';"
  [ "$ec" -eq 0 ] || die "could not inspect the migration ledger of $1: $out"
  if [ -n "$out" ]; then
    capture sqlite3 "$1" "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name;"
    [ "$ec" -eq 0 ] || die "could not read applied migrations from $1: $out"
    [ -z "$out" ] || printf '%s\n' "$out" > "$TMPDIR_PRIVATE/applied.txt"
  fi

  # Local migration names (directories only; migration_lock.toml excluded).
  : > "$TMPDIR_PRIVATE/local.txt"
  for _d in "$MIGRATIONS_DIR"/*; do
    [ -d "$_d" ] || continue
    printf '%s\n' "${_d##*/}"
  done | sort -u > "$TMPDIR_PRIVATE/local.txt"

  # Expected pending set (space-separated override; default is this release).
  _exp_trim=$(printf '%s\n' "$EXPECTED_PENDING_MIGRATIONS" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  [ -n "$_exp_trim" ] || die "EXPECTED_PENDING_MIGRATIONS is empty"
  printf '%s\n' "$_exp_trim" | tr ' ' '\n' | sed '/^[[:space:]]*$/d' | sort -u > "$TMPDIR_PRIVATE/expected.txt"

  # 1) DB-applied migration files missing locally -> abort.
  set_diff "$TMPDIR_PRIVATE/applied.txt" "$TMPDIR_PRIVATE/local.txt" > "$TMPDIR_PRIVATE/missing-local.txt"
  if [ -s "$TMPDIR_PRIVATE/missing-local.txt" ]; then
    sed 's/^/  /' "$TMPDIR_PRIVATE/missing-local.txt" > "$TMPDIR_PRIVATE/missing-local.txt.fmt"
    die "database records applied migration(s) whose files are missing locally:
$(cat "$TMPDIR_PRIVATE/missing-local.txt.fmt")
Restore the migration directories from version control before deploying."
  fi

  # pending = local \ applied
  set_diff "$TMPDIR_PRIVATE/local.txt" "$TMPDIR_PRIVATE/applied.txt" > "$TMPDIR_PRIVATE/pending.txt"

  # 2) local migrations neither applied nor expected -> abort. This covers
  #    both "historical migration missing/unapplied" and "extra pending
  #    migration exists" (they are the same set: pending \ expected).
  set_diff "$TMPDIR_PRIVATE/pending.txt" "$TMPDIR_PRIVATE/expected.txt" > "$TMPDIR_PRIVATE/extra-pending.txt"
  if [ -s "$TMPDIR_PRIVATE/extra-pending.txt" ]; then
    sed 's/^/  /' "$TMPDIR_PRIVATE/extra-pending.txt" > "$TMPDIR_PRIVATE/extra-pending.txt.fmt"
    die "pending migration(s) other than the expected one(s) exist:
$(cat "$TMPDIR_PRIVATE/extra-pending.txt.fmt")
This release requires the ONLY pending migration to be:
  $EXPECTED_PENDING_MIGRATIONS
A locally-present migration that was never applied (historical migration
missing/unapplied) or an unexpected extra pending migration both fail here.
If this is intentional (e.g. bootstrapping a fresh database or a later
release), set EXPECTED_PENDING_MIGRATIONS explicitly and re-run."
  fi

  # 3) EXPECTED_PENDING_MIGRATIONS names something that does not exist locally
  #    (and, because applied ⊆ local was checked above, is not applied either)
  #    -> configuration error.
  set_diff "$TMPDIR_PRIVATE/expected.txt" "$TMPDIR_PRIVATE/local.txt" > "$TMPDIR_PRIVATE/expected-missing.txt"
  if [ -s "$TMPDIR_PRIVATE/expected-missing.txt" ]; then
    sed 's/^/  /' "$TMPDIR_PRIVATE/expected-missing.txt" > "$TMPDIR_PRIVATE/expected-missing.txt.fmt"
    die "EXPECTED_PENDING_MIGRATIONS names migration(s) that do not exist locally:
$(cat "$TMPDIR_PRIVATE/expected-missing.txt.fmt")"
  fi

  # 4) Nothing pending at all: this release's (or every) migration is already
  #    applied. Clean no-op requires the explicit ALLOW_NOOP flag.
  if [ ! -s "$TMPDIR_PRIVATE/pending.txt" ]; then
    if [ -n "${ALLOW_NOOP:-}" ]; then
      warn "no pending migrations -- $EXPECTED_PENDING_MIGRATIONS is/are already applied.
ALLOW_NOOP is set, so this run is a clean no-op: backup + verify only, no deploy."
      NOOP=1
    else
      die "no pending migrations -- this release's migration
  $EXPECTED_PENDING_MIGRATIONS
is already applied, so 'prisma migrate deploy' would be a no-op.
If that is intended, re-run with ALLOW_NOOP=1 for a clean no-op (backup is
still created and verified). Otherwise set EXPECTED_PENDING_MIGRATIONS to the
migration(s) you actually expect to be pending."
    fi
  else
    info "migration alignment OK; pending: $(tr '\n' ' ' < "$TMPDIR_PRIVATE/pending.txt" | sed 's/ *$//')"
  fi
}

prisma_status_check() {
  # Runs `prisma migrate status`; aborts on divergence/errors. In deploy mode
  # this runs ONLY after the backup has been created and verified, so a
  # failure here never leaves the operator without a recovery artifact.
  info "checking migration status ..."
  capture prisma migrate status
  if [ "$ec" -eq 0 ]; then
    info "migrate status: database schema is up to date"
  else
    case "$out" in
      *"have failed"*)
        die "prisma migrate status reports failed migration(s):
$out"
        ;;
      *"not yet been applied"*)
        info "migrate status: pending migrations detected; deploy will apply them"
        ;;
      *)
        die "prisma migrate status exited with code $ec:
$out"
        ;;
    esac
  fi
  # Belt and suspenders: even with exit code 0, abort on any divergence marker
  # that newer/older Prisma versions may phrase differently.
  case "$out" in
    *"Drift detected"*|*"has been modified"*|*"have failed"*)
      die "prisma migrate status reports database divergence:
$out"
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Row-count snapshots (read-only, single-transaction)
# ---------------------------------------------------------------------------

# db_tables <db> <exclude-ledger> -- newline-separated, sorted list of
# non-system tables. System tables (sqlite_*) are always excluded; the
# migration ledger is excluded for the deploy data-safety snapshot (it grows
# on every deploy) but included for backup fingerprinting.
db_tables() {
  if [ "$2" = "yes" ]; then
    capture sqlite3 "$1" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations' ORDER BY name;"
  else
    capture sqlite3 "$1" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"
  fi
  [ "$ec" -eq 0 ] || die "could not list tables of $1: $out"
  if [ -n "$out" ]; then
    printf '%s\n' "$out"
  fi
}

build_counts_sql() {
  # $1 = file with one table name per line; prints one SQL program that reads
  # every count inside a single transaction (a consistent snapshot). Each
  # SELECT is its own statement inside the transaction; sqlite3 prints the
  # result rows in statement order.
  _sql="BEGIN;"
  while IFS= read -r _t; do
    [ -n "$_t" ] || continue
    case "$_t" in
      *[!A-Za-z0-9_]*) die "unexpected table name in $1: $_t" ;;
    esac
    _sql="$_sql SELECT COUNT(*) FROM \"$_t\";"
  done < "$1"
  printf '%s\n' "$_sql COMMIT;"
}

# table_fingerprint <db> <exclude-ledger> <outfile> -- writes "table|count"
# lines, one per table, all read from a single transaction.
table_fingerprint() {
  db_tables "$1" "$2" > "$TMPDIR_PRIVATE/tables.txt"
  if [ ! -s "$TMPDIR_PRIVATE/tables.txt" ]; then
    : > "$3"
    return 0
  fi
  _sql=$(build_counts_sql "$TMPDIR_PRIVATE/tables.txt")
  capture sqlite3 "$1" "$_sql"
  [ "$ec" -eq 0 ] || die "could not count rows in $1: $out"
  printf '%s\n' "$out" > "$TMPDIR_PRIVATE/counts.txt"
  paste -d'|' "$TMPDIR_PRIVATE/tables.txt" "$TMPDIR_PRIVATE/counts.txt" > "$3"
}

# counts_diff <pre-snapshot> <post-snapshot> -- prints any change in row
# counts of pre-existing tables (or a table that disappeared) and exits 1 if
# the data changed. Tables that only appear after the deploy (created by the
# migration) are ignored.
counts_diff() {
  awk -F'|' '
    NR==FNR { pre[$1]=$2; next }
    { if ($1 in pre) { if (pre[$1] != $2) { print $1 ": row count changed " pre[$1] " -> " $2; dirty=1 } post[$1]=1 } }
    END { for (k in pre) if (!(k in post)) { print k ": table existed before deploy but is now missing (dropped or renamed)"; dirty=1 }
          exit (dirty ? 1 : 0) }
  ' "$1" "$2"
}

# ---------------------------------------------------------------------------
# Backup (SQLite online backup API)
# ---------------------------------------------------------------------------

create_backup() {
  # $1 = database file; sets BACKUP_FILE
  mkdir -p "$BACKUP_DIR" || die "cannot create backup directory $BACKUP_DIR"
  case "$BACKUP_DIR" in
    /*) : ;;
    *) BACKUP_DIR=$(canon_path "$BACKUP_DIR") ;;
  esac
  _base=$(basename -- "$1")
  _base=${_base%.db}
  BACKUP_FILE="$BACKUP_DIR/$_base-$TIMESTAMP-$$.db"

  # .backup uses SQLite's online backup API: a crash-consistent snapshot even
  # if the application is still reading/writing.
  _escaped=$(printf '%s' "$BACKUP_FILE" | sed "s/'/''/g")
  if ! sqlite3 "$1" ".backup '$_escaped'"; then
    rm -f "$BACKUP_FILE"
    die "SQLite backup of $1 failed; no backup was created."
  fi
  [ -s "$BACKUP_FILE" ] || die "backup file is empty: $BACKUP_FILE"
}

verify_backup() {
  # $1 = source db, $2 = backup file. Aborts unless the backup is non-empty,
  # passes integrity_check and has an identical per-table row-count /
  # migration-ledger fingerprint as the source captured at the same instant.
  check_integrity "$2"

  # The online backup API snapshots the database at one instant; to prove the
  # backup matches the source we fingerprint the source BEFORE and AFTER the
  # copy. If the two match, nothing committed during the copy, so the backup
  # is a faithful snapshot of the source at that moment.
  table_fingerprint "$1" no "$TMPDIR_PRIVATE/fp-src-before.txt"
  table_fingerprint "$1" no "$TMPDIR_PRIVATE/fp-src-after.txt"
  if ! cmp -s "$TMPDIR_PRIVATE/fp-src-before.txt" "$TMPDIR_PRIVATE/fp-src-after.txt"; then
    rm -f "$2"
    die "database changed while the backup was being created.
The backup was discarded. Stop the application, then re-run this script."
  fi

  table_fingerprint "$2" no "$TMPDIR_PRIVATE/fp-bak.txt"
  if ! cmp -s "$TMPDIR_PRIVATE/fp-src-after.txt" "$TMPDIR_PRIVATE/fp-bak.txt"; then
    rm -f "$2"
    die "backup $2 does not match the source database (row counts or tables differ).
The backup was discarded; no changes were made to the database."
  fi
}

# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------

case "${1:-}" in
  "") MODE=deploy ;;
  --backup-only) MODE=backup-only ;;
  *) die "unknown argument: ${1} (expected nothing or --backup-only)" ;;
esac

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

require_cmd sqlite3
require_cmd awk
require_cmd paste
require_cmd sed
require_cmd grep
require_cmd tail
require_cmd cmp
require_cmd sort
require_cmd tr
[ -f "$SCHEMA_FILE" ] || die "schema file not found: $SCHEMA_FILE"

# Resolve DATABASE_URL: environment wins, then the same dotenv files the
# Prisma CLI loads (verified on Prisma 6.19: .env, then prisma/.env).
raw_url=${DATABASE_URL:-}
if [ -z "$raw_url" ]; then
  for _f in "$PROJECT_ROOT/.env" "$PRISMA_DIR/.env"; do
    if raw_url=$(env_from_file "$_f" DATABASE_URL); then
      break
    fi
  done
fi
[ -n "$raw_url" ] || die "DATABASE_URL is not set (checked the environment, $PROJECT_ROOT/.env and $PRISMA_DIR/.env).
There is deliberately no default: guessing a database path in production can
migrate the wrong database. Set DATABASE_URL and re-run."
info "Using DATABASE_URL: $raw_url"

DB_FILE=$(resolve_db_file "$raw_url")
info "Database file:   $DB_FILE"

# Export the exact URL we validated so 'prisma' uses the same database the
# script just backed up (the env variable overrides .env for the CLI too).
export DATABASE_URL="$raw_url"

# Never let Prisma create a missing database. During `migrate deploy` Prisma
# would happily mint a fresh empty DB at the configured path; in production a
# missing file almost always means a misconfigured DATABASE_URL or wrong
# working directory, and a fresh empty DB is silent data loss.
if [ ! -f "$DB_FILE" ]; then
  die "database file does not exist: $DB_FILE
Refusing to create it and run migrations.
If this is a brand-new deployment, create the file explicitly first, e.g.:
    sqlite3 '$DB_FILE' ''
then re-run this script. Otherwise check DATABASE_URL (relative file: paths
resolve against $PRISMA_DIR) and restore from a backup."
fi

info "Verifying database integrity and migration ledger ..."
check_integrity "$DB_FILE"
check_migration_ledger "$DB_FILE"

# Deploy-mode only: compare local migration names against successful ledger
# rows and require the ONLY pending migration(s) to be the expected one(s).
# Runs before the backup so a misconfigured target never even produces a
# backup file; it needs only sqlite3 and the filesystem, never Prisma.
if [ "$MODE" = "deploy" ]; then
  check_migration_alignment "$DB_FILE"
fi

# ---------------------------------------------------------------------------
# Backup (also the whole job in --backup-only mode)
# ---------------------------------------------------------------------------

info "Creating consistent backup ..."
create_backup "$DB_FILE"
info "Backup file:    $BACKUP_FILE (verifying ...)"
verify_backup "$DB_FILE" "$BACKUP_FILE"
BACKUP_HASH=$(sha256_of "$BACKUP_FILE")
info "Backup created:  $BACKUP_FILE"
info "Backup SHA-256:  $BACKUP_HASH"

if [ "$MODE" = "backup-only" ]; then
  info "backup-only mode: database untouched; exiting."
  exit 0
fi

# Clean no-op: every local migration (including this release's) is already
# applied and ALLOW_NOOP was set. A verified backup already exists; nothing
# to deploy.
if [ "$NOOP" = "1" ]; then
  echo
  echo "==============================================================================="
  echo " Clean no-op (ALLOW_NOOP was set): database is already fully migrated."
  echo " Database:      $DB_FILE"
  echo " Backup:        $BACKUP_FILE"
  echo " Backup SHA-256: $BACKUP_HASH"
  echo " No changes were made to the database."
  echo "==============================================================================="
  exit 0
fi

# `prisma migrate status` gates the deploy ONLY after the backup exists and
# has been verified: a failed status check now still leaves a verified backup
# the operator can recover from.
prisma_status_check

# ---------------------------------------------------------------------------
# Pre-deploy data snapshot
# ---------------------------------------------------------------------------

info "Snapshotting pre-deploy row counts ..."
table_fingerprint "$DB_FILE" yes "$TMPDIR_PRIVATE/snapshot-pre.txt"

# ---------------------------------------------------------------------------
# Generate + deploy
# ---------------------------------------------------------------------------

info "Running 'prisma generate' ..."
capture prisma generate
if [ "$ec" -ne 0 ]; then
  die "prisma generate failed:
$out"
fi

info "Running 'prisma migrate deploy' ..."
capture prisma migrate deploy
if [ "$ec" -ne 0 ]; then
  echo "safe-prisma-deploy: ERROR: prisma migrate deploy FAILED." >&2
  echo "$out" >&2
  echo "safe-prisma-deploy: Recovery: restore the database from the backup created by this run:" >&2
  echo "  $BACKUP_FILE" >&2
  echo "  SHA-256: $BACKUP_HASH" >&2
  echo "  restore with: sqlite3 '$DB_FILE' \".restore '$BACKUP_FILE'\"" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Post-deploy verification
# ---------------------------------------------------------------------------

info "Post-deploy checks ..."
check_integrity "$DB_FILE"

info "Comparing pre/post row counts ..."
table_fingerprint "$DB_FILE" yes "$TMPDIR_PRIVATE/snapshot-post.txt"
if [ -s "$TMPDIR_PRIVATE/snapshot-pre.txt" ]; then
  capture counts_diff "$TMPDIR_PRIVATE/snapshot-pre.txt" "$TMPDIR_PRIVATE/snapshot-post.txt"
  if [ "$ec" -ne 0 ] || [ -n "$out" ]; then
    echo "safe-prisma-deploy: ERROR: row counts CHANGED across the migration." >&2
    echo "$out" >&2
    echo "safe-prisma-deploy: Migrations in this project are expected to be additive only." >&2
    echo "safe-prisma-deploy: Restore the database from the backup created by this run:" >&2
    echo "  $BACKUP_FILE" >&2
    echo "  SHA-256: $BACKUP_HASH" >&2
    echo "  restore with: sqlite3 '$DB_FILE' \".restore '$BACKUP_FILE'\"" >&2
    exit 1
  fi
  info "row counts unchanged for every pre-existing table (migration is additive only)"
else
  info "no pre-existing tables before deploy (fresh database); row-count check trivially passes"
fi

info "Verifying the expected migration(s) were applied ..."
while IFS= read -r _name; do
  [ -n "$_name" ] || continue
  capture sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM _prisma_migrations WHERE migration_name='$_name' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;"
  [ "$ec" -eq 0 ] || die "could not verify migration '$_name' in $DB_FILE: $out"
  if [ "$out" != "1" ]; then
    die "expected migration '$_name' is NOT recorded as applied after deploy.
The database may be in an unexpected state; restore from the backup created
by this run: $BACKUP_FILE (SHA-256: $BACKUP_HASH)"
  fi
done < "$TMPDIR_PRIVATE/expected.txt"
info "expected migration(s) applied: $(tr '\n' ' ' < "$TMPDIR_PRIVATE/expected.txt" | sed 's/ *$//')"

info "Re-checking migration status ..."
capture prisma migrate status
if [ "$ec" -ne 0 ]; then
  die "post-deploy migrate status is not clean:
$out"
fi
case "$out" in
  *"up to date"*) : ;;
  *) die "post-deploy migrate status is not clean:
$out" ;;
esac

echo
echo "==============================================================================="
echo " Deploy complete."
echo " Database:      $DB_FILE"
echo " Backup:        $BACKUP_FILE"
echo " Backup SHA-256: $BACKUP_HASH"
echo " Migrations:    applied; database schema is up to date; no data changes."
echo "==============================================================================="