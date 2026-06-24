#!/bin/bash
# Quick debug build - bypasses schema compilation which is broken on this system
set -e

cd /var/home/falco/Projects/anvil

echo "=== Quick Debug Build ==="

# Clean only the JS output, not schemas
rm -rf dist
rm -f src/lib/prefs/metadata.js

# Generate metadata.js
printf 'export const developers = Object.entries(\n' > src/lib/prefs/metadata.js
printf '  /** @type {Array<Record<string, string>>} */(\n' >> src/lib/prefs/metadata.js
printf '  [\n' >> src/lib/prefs/metadata.js
git shortlog -sne >> src/lib/prefs/metadata.js || true
awk '!/dependabot|noreply/' src/lib/prefs/metadata.js > src/lib/prefs/metadata.js.tmp && mv src/lib/prefs/metadata.js.tmp src/lib/prefs/metadata.js
sed -i 's/^[[:space:]]*[0-9]*[[:space:]]*\(.*\) <\(.*\)>/    {name:"\1", email:"\2"},/g' src/lib/prefs/metadata.js
printf '  ]\n' >> src/lib/prefs/metadata.js
printf ').reduce((acc, x) => ({ ...acc, [x.email]: acc[x.email] ?? x.name }), {})\n' >> src/lib/prefs/metadata.js
printf '.map(([email, name]) => name + " <" + email + ">")\n' >> src/lib/prefs/metadata.js
npx prettier --write src/lib/prefs/metadata.js 2>/dev/null || true

# Build TypeScript only
echo "Building TypeScript..."
npm run build

# Strip TypeScript build artifacts
find dist -type f \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.tsbuildinfo' \) -delete

# Copy static assets
mkdir -p dist
cp metadata.json dist
cp -r src/resources dist
mkdir -p dist/schemas

# Copy existing compiled schema from installed extension
cp ~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/schemas/gschemas.compiled dist/schemas/
cp src/schemas/org.gnome.shell.extensions.anvil.gschema.xml dist/schemas/

cp -r src/config dist
cp src/lib/prefs/metadata.js dist/lib/prefs/
cp src/*.css dist
cp LICENSE dist

# Enable debug mode
sed -i 's/export const production = true/export const production = false/' dist/lib/shared/settings.js

echo "=== Installing to GNOME Shell ==="
mkdir -p ~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com
cp -r dist/* ~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/

echo "=== Debug build complete ==="
echo "Extension installed with debug logging enabled"
