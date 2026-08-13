#!/usr/bin/env bash
# FLARE-Lab / merge_pdf — serve the site locally.
# Thumbnails need a real HTTP origin (browsers block pdf.js workers on file://),
# so use this instead of double-clicking index.html.
set -euo pipefail

PORT="${1:-8080}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="http://localhost:${PORT}/"

echo "FLARE-Lab / merge_pdf  →  ${URL}"
echo "Serving ${ROOT}  (Ctrl+C to stop)"

if command -v open >/dev/null 2>&1; then
  (sleep 1 && open "${URL}") &
fi

exec python3 -m http.server "${PORT}" --directory "${ROOT}"
