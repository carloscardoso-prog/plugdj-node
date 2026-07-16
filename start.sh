#!/usr/bin/env bash
# plug.dj — start local LAN host (Linux / macOS)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PORT="${PLUGDJ_PORT:-${PORT:-3000}}"
HOST="${HOST:-0.0.0.0}"

echo ""
echo -e "${BOLD}plug.dj — starting LAN host${NC}"
echo "────────────────────────────"

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Node.js is not installed.${NC}"
  echo "Run ./install.sh first, or install Node from https://nodejs.org/"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo -e "${RED}Dependencies are missing (no node_modules/).${NC}"
  echo "Run ./install.sh first."
  exit 1
fi

mkdir -p data .media-cache

# Friendly check: is the port already in use?
if command -v ss >/dev/null 2>&1; then
  if ss -tln 2>/dev/null | grep -qE ":${PORT}\\b"; then
    echo -e "${RED}Port ${PORT} looks busy.${NC}"
    echo "Stop the other process, or start with a different port:"
    echo "  PLUGDJ_PORT=3001 ./start.sh"
    exit 1
  fi
elif command -v lsof >/dev/null 2>&1; then
  if lsof -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo -e "${RED}Port ${PORT} looks busy.${NC}"
    echo "Stop the other process, or start with a different port:"
    echo "  PLUGDJ_PORT=3001 ./start.sh"
    exit 1
  fi
fi

echo ""
echo -e "${GREEN}${BOLD}Open in your browser:${NC}"
echo -e "  ${CYAN}${BOLD}http://localhost:${PORT}/${NC}"
echo ""
echo "On the same Wi‑Fi / LAN, others can use:"
echo -e "  ${CYAN}http://<your-lan-ip>:${PORT}/<room-slug>${NC}"
echo ""
echo "Press Ctrl+C to stop the server."
echo "────────────────────────────"
echo ""

export PORT PLUGDJ_PORT="$PORT" HOST
exec npm start
