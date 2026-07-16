#!/usr/bin/env bash
# Tunnel the Node app (API + WebSocket + assets), not Apache :80.
set -euo pipefail
cd "$(dirname "$0")/.."
exec ngrok http 3000
