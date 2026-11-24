#!/usr/bin/env bash
# build_deploy.sh — build the packages that replace the stock keyboard entry
# through the apps service (no root).
#
# The trick: the apps service derives an install's name from
# b2g_features.origin when present (apps_registry::get_unique_name). Setting
# `"origin": "keyboard"` makes installPackage treat the package as an UPDATE of
# the preloaded `keyboard` app instead of deduping it to keyboard1. The
# service then removes the vroot/keyboard symlink into /system and points it at
# the newly installed copy under /data/local/webapps/installed/keyboard.
#
# Produces:
#   build/deploy/application.zip        our patched keyboard (pink marker build)
#   build/deploy/m                      update manifest (absolute package_path)
#   build/deploy_selfcontained.js is generated separately by
#   tools/build_selfcontained_deploy.py from build/deploy/application.zip.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF="$ROOT/tools/ref-zigbert.rsa"
BASE_URL="${BASE_URL:-http://127.0.0.1:8088}"

[ -f "$REF" ] || { echo "error: missing $REF"; exit 1; }

inject_origin() {
  python3 -I - "$1" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
b = m.setdefault("b2g_features", {})
b["origin"] = "keyboard"
json.dump(m, open(p, "w"), separators=(",", ":"))
PY
}

build_one() {
  local name="$1" src="$2" out="$ROOT/build/$3"
  local work="$ROOT/build/.work-$name"

  rm -rf "$out" "$work"
  mkdir -p "$out" "$work"
  cp -R "$src"/. "$work"/
  find "$work" -name '.DS_Store' -delete
  inject_origin "$work/manifest.webmanifest"

  ( cd "$work" && zip -r -X -q "$out/application.plain.zip" . )
  python3 -I "$ROOT/tools/add_meta_inf.py" \
    "$out/application.plain.zip" "$REF" "$out/application.zip" >/dev/null

  local size
  size=$(stat -f %z "$out/application.zip" 2>/dev/null || stat -c %s "$out/application.zip")
  cat > "$out/m" <<JSON
{
  "name": "Keyboard",
  "version": "1.0",
  "package_path": "$BASE_URL/${out#$ROOT/}/application.zip",
  "size": $size,
  "developer": { "name": "local" }
}
JSON

  ( cd "$out" && shasum -a 256 application.zip m > SHA256SUMS.txt )
  echo "$name: $out/application.zip ($size bytes)"
  unzip -p "$out/application.zip" manifest.webmanifest | head -c 400; echo
}

build_one ours "$ROOT/app" deploy

rm -rf "$ROOT/build/.work-ours" "$ROOT/build/.work-stock"
echo
echo "Serve with: python3 tools/serve.py --bind 0.0.0.0"
echo "Deploy:     javascript:import('$BASE_URL/d')  (after JScalated loader)"
