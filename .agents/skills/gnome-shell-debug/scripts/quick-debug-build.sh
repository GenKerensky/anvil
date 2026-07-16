#!/usr/bin/env bash
# Quick debug build (for Devkit Seam) — TypeScript + assets only, skips schema compile.
# Use when glib-compile-schemas is broken on immutable host; otherwise prefer `make build debug`.
# See SKILL.md for the two seams (devkit default).
set -euo pipefail

SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}")"
PROJECT_ROOT="$(cd "$(dirname "$SCRIPT_PATH")/../../../.." && pwd -P)"
UUID="anvil@GenKerensky.github.com"
INSTALL_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

cd "$PROJECT_ROOT"
echo "=== Quick Debug Build ($PROJECT_ROOT) ==="

rm -rf dist
rm -f src/lib/prefs/metadata.js

node scripts/generate-contributor-metadata.mjs
npx prettier --write src/lib/prefs/metadata.js 2>/dev/null || true

echo "Building TypeScript..."
npm run build

find dist -type f \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.tsbuildinfo' \) -delete

mkdir -p dist/schemas
cp metadata.json dist/
cp -r src/resources dist/
cp -r src/config dist
cp src/lib/prefs/metadata.js dist/lib/prefs/
cp src/*.css dist/
cp LICENSE dist

if [[ -f "$INSTALL_DIR/schemas/gschemas.compiled" ]]; then
  cp "$INSTALL_DIR/schemas/gschemas.compiled" dist/schemas/
fi
cp src/schemas/org.gnome.shell.extensions.anvil.gschema.xml dist/schemas/

sed -i 's/export const production = true/export const production = false/' dist/lib/shared/settings.js

echo "=== Installing to $INSTALL_DIR ==="
mkdir -p "$INSTALL_DIR"
cp -r dist/* "$INSTALL_DIR/"

echo "=== Debug build complete (production=false) ==="
