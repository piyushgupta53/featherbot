#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$HOME/featherbot"
WORKSPACE_DIR="$HOME/.featherbot/workspace"
SERVICE_NAME="featherbot"

SYNC_FILES=("AGENTS.md" "TOOLS.md" "SOUL.md")

echo "=== FeatherBot Deploy ==="

cd "$REPO_DIR"

echo "[1/5] Pulling latest code..."
git pull

echo "[2/5] Installing dependencies..."
pnpm install

echo "[3/5] Building..."
pnpm build

echo "[4/5] Syncing workspace files..."
for file in "${SYNC_FILES[@]}"; do
  if [ -f "workspace/$file" ]; then
    cp "workspace/$file" "$WORKSPACE_DIR/$file"
    echo "  Copied $file"
  fi
done

echo "[5/5] Restarting service..."
sudo systemctl restart "$SERVICE_NAME"

echo ""
echo "=== Deploy complete ==="
sudo systemctl status "$SERVICE_NAME" --no-pager -l
