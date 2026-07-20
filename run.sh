#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(command -v node || true)"
VITE_ENTRY="$PROJECT_DIR/node_modules/vite/bin/vite.js"

if [[ -z "$NODE_BIN" ]]; then
  echo "Powder Toy 3D needs Node.js 20 or newer." >&2
  exit 1
fi

if [[ ! -f "$VITE_ENTRY" ]]; then
  echo "Dependencies are missing. Run 'pnpm install' (or 'npm install') first." >&2
  exit 1
fi

exec "$NODE_BIN" "$VITE_ENTRY" --host 127.0.0.1 --port "${PORT:-5173}"
