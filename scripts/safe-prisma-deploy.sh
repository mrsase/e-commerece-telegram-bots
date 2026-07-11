#!/bin/sh

set -eu

PROJECT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DATABASE_FILE="$PROJECT_ROOT/prisma/dev.db"
BACKUP_DIR="${DATABASE_BACKUP_DIR:-$PROJECT_ROOT/backups/database}"
TIMESTAMP=$(date -u '+%Y%m%dT%H%M%SZ')
BACKUP_FILE="$BACKUP_DIR/dev-$TIMESTAMP-$$.db"

if [ ! -f "$DATABASE_FILE" ]; then
  echo "Error: SQLite database not found at $DATABASE_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
cp -p "$DATABASE_FILE" "$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  echo "Error: database backup was not created correctly." >&2
  exit 1
fi

echo "Database backup created: $BACKUP_FILE"

if [ "${1:-}" = "--backup-only" ]; then
  exit 0
fi

cd "$PROJECT_ROOT"
export DATABASE_URL="${DATABASE_URL:-file:./dev.db}"
npx prisma generate
npx prisma migrate deploy

echo "Prisma client generated and migrations applied successfully."
