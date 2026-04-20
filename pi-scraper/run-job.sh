#!/bin/bash
# Wrapper that loads env and runs a scraper job.
# Usage: run-job.sh <uniqlo|arket|cos|mango|sales>

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load env
set -a
# shellcheck disable=SC1091
source "$SCRIPT_DIR/.env"
set +a

mkdir -p "$SCRIPT_DIR/logs"

case "$1" in
  uniqlo) /usr/bin/node src/jobs/check-uniqlo.js ;;
  arket)  /usr/bin/node src/jobs/check-arket.js ;;
  cos)    /usr/bin/node src/jobs/check-cos.js ;;
  mango)  /usr/bin/node src/jobs/check-mango.js ;;
  sales)  /usr/bin/node src/jobs/check-uniqlo-sales.js ;;
  cache)  /usr/bin/node src/jobs/refresh-product-cache.js ;;
  *) echo "Usage: $0 <uniqlo|arket|cos|mango|sales|cache>"; exit 1 ;;
esac
