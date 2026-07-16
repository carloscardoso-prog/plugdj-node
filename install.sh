#!/usr/bin/env bash
# plug.dj — install dependencies (Linux / macOS)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}plug.dj — installer${NC}"
echo "────────────────────────────"

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Node.js was not found on this system.${NC}"
  echo ""
  echo "Install Node.js 18 or newer, then run this script again:"
  echo "  • https://nodejs.org/"
  echo "  • macOS (Homebrew): brew install node"
  echo "  • Ubuntu/Debian:    sudo apt install nodejs npm"
  echo ""
  exit 1
fi

NODE_VER="$(node -v 2>/dev/null || true)"
echo -e "Node.js detected: ${CYAN}${NODE_VER}${NC}"

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}npm was not found (it usually ships with Node.js).${NC}"
  echo "Reinstall Node from https://nodejs.org/ and try again."
  exit 1
fi

echo "Installing npm dependencies…"
if ! npm install; then
  echo -e "${RED}npm install failed.${NC}"
  echo "Check your network connection and try again."
  exit 1
fi

mkdir -p data .media-cache

echo ""
echo -e "${GREEN}Installation complete.${NC}"
echo ""
echo "Start the LAN host with:"
echo -e "  ${BOLD}./start.sh${NC}"
echo ""
echo "(If start.sh is not executable: chmod +x start.sh install.sh)"
echo ""
