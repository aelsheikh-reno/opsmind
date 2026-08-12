#!/bin/bash
# Backup Postgres → S3
# Schedule via cron:  0 2 * * *  /opt/opsmind/scripts/backup-db.sh
# Requires: docker, awscli (pip install awscli)

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-opsmind-db-1}"
S3_BUCKET="${S3_BUCKET}"          # e.g. my-opsmind-backups
S3_PREFIX="${S3_PREFIX:-db}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

DATE=$(date +%Y-%m-%dT%H-%M-%S)
FILE="opsmind-${DATE}.sql.gz"

echo "[backup] Dumping postgres..."
docker exec "$DB_CONTAINER" \
  pg_dump -U opsmind opsmind | gzip > "/tmp/${FILE}"

echo "[backup] Uploading to s3://${S3_BUCKET}/${S3_PREFIX}/${FILE}..."
aws s3 cp "/tmp/${FILE}" "s3://${S3_BUCKET}/${S3_PREFIX}/${FILE}"
rm "/tmp/${FILE}"

echo "[backup] Pruning backups older than ${RETAIN_DAYS} days..."
CUTOFF=$(date -d "-${RETAIN_DAYS} days" +%Y-%m-%dT%H-%M-%S 2>/dev/null \
         || date -v-${RETAIN_DAYS}d +%Y-%m-%dT%H-%M-%S)   # macOS fallback
aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" \
  | awk '{print $4}' \
  | while read -r key; do
      stamp="${key#opsmind-}"; stamp="${stamp%.sql.gz}"
      [[ "$stamp" < "$CUTOFF" ]] && \
        aws s3 rm "s3://${S3_BUCKET}/${S3_PREFIX}/${key}"
    done

echo "[backup] Done."
