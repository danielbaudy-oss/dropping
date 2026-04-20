#!/bin/bash
# Deploy the scraper to the Pi.
# Run from the pi-scraper directory on your local machine:
#   bash deploy.sh
# Or on the Pi (if you pulled the repo there), just skip the scp step.

set -e

PI_HOST="${PI_HOST:-baudy@baudypi.local}"
REMOTE_DIR="/home/baudy/dropping-scraper"

echo "=== Deploying to $PI_HOST ==="

# Copy files
ssh "$PI_HOST" "mkdir -p $REMOTE_DIR"
scp -r src package.json "$PI_HOST:$REMOTE_DIR/"

# Install deps on Pi
ssh "$PI_HOST" "cd $REMOTE_DIR && npm install --production --silent"

echo "=== Deployed. Next: set env vars and install cron on the Pi ==="
echo "SSH to the Pi and run:"
echo "  sudo nano /etc/systemd/system/dropping-scraper.env"
echo "  (add SUPABASE_URL and SUPABASE_SERVICE_KEY)"
