UUID = anvil@GenKerensky.github.com
INSTALL_PATH = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
MSGSRC = $(wildcard src/po/*.po)

.PHONY: all build install uninstall clean dist debug \
        enable disable restart purge log journal \
        potfile compilemsgs metadata schemas format lint check \
        test-unit test-integration test-integration-build-all test-integration-all \
        test-e2e-container test-e2e-all-container test-e2e-build-container test-e2e

all: build install

dev: build debug install

prod: build install

schemas: src/schemas/gschemas.compiled
	touch $@

src/schemas/gschemas.compiled: src/schemas/*.gschema.xml
	glib-compile-schemas src/schemas

metadata:
	printf 'export const developers = Object.entries(\n' > src/lib/prefs/metadata.js
	printf '  /** @type {Array<Record<string, string>>} */(\n' >> src/lib/prefs/metadata.js
	printf '  [\n' >> src/lib/prefs/metadata.js
	git shortlog -sne >> src/lib/prefs/metadata.js || true
	awk '!/dependabot|noreply/' src/lib/prefs/metadata.js > src/lib/prefs/metadata.js.tmp && mv src/lib/prefs/metadata.js.tmp src/lib/prefs/metadata.js
	sed -i 's/^[[:space:]]*[0-9]*[[:space:]]*\(.*\) <\(.*\)>/    {name:"\1", email:"\2"},/g' src/lib/prefs/metadata.js
	printf '  ]\n' >> src/lib/prefs/metadata.js
	printf ').reduce((acc, x) => ({ ...acc, [x.email]: acc[x.email] ?? x.name }), {}))\n' >> src/lib/prefs/metadata.js
	printf '.map(([email, name]) => name + " <" + email + ">")\n' >> src/lib/prefs/metadata.js
	npx prettier --write src/lib/prefs/metadata.js

build: clean metadata.json schemas compilemsgs metadata
	npm run build
	# Strip TypeScript build artifacts not needed at runtime
	find dist -type f \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.tsbuildinfo' \) -delete
	mkdir -p dist
	cp metadata.json dist
	cp -r src/resources dist
	cp -r src/schemas dist
	cp -r src/config dist
	cp src/lib/prefs/metadata.js dist/lib/prefs/
	cp src/*.css dist
	cp LICENSE dist
	mkdir -p dist/locale
	for msg in $(MSGSRC:.po=.mo); do \
		msgf=dist/locale/`basename $$msg .mo`; \
		mkdir -p $$msgf; \
		mkdir -p $$msgf/LC_MESSAGES; \
		cp $$msg $$msgf/LC_MESSAGES/anvil.mo; \
	done;

./src/po/%.mo: ./src/po/%.po
	msgfmt -c $< -o $@

debug:
	sed -i 's/export const production = true/export const production = false/' dist/lib/shared/settings.js

potfile: ./src/po/anvil.pot

./src/po/anvil.pot: ./src/extension.ts ./src/prefs.ts ./src/lib/**/*.ts
	mkdir -p src/po
	xgettext --from-code=UTF-8 --output=src/po/anvil.pot --package-name "Anvil" ./src/extension.ts ./src/prefs.ts ./src/lib/**/*.ts

compilemsgs: potfile $(MSGSRC:.po=.mo)
	for msg in $(MSGSRC); do \
		msgmerge -U $$msg ./src/po/anvil.pot; \
	done;

clean:
	rm -f src/lib/prefs/metadata.js
	rm -f "$(UUID).zip"
	rm -rf dist src/schemas/gschemas.compiled

enable:
	gnome-extensions enable "$(UUID)" 2>/dev/null || true

disable:
	gnome-extensions disable "$(UUID)" 2>/dev/null || true

install: build
	mkdir -p "$(INSTALL_PATH)"
	cp -r dist/* "$(INSTALL_PATH)"

uninstall:
	rm -rf "$(INSTALL_PATH)"

purge:
	rm -rf .config/anvil

dist: build
	cd dist && \
	zip -qr "../$(UUID).zip" .

restart:
	@echo "GNOME Shell cannot be restarted in-place on Wayland."
	@echo "Log out and back in, or press Alt+F2 then type 'r' and press Enter."

log:
	@echo 'HINT: type [Ctrl]+[C] to return to the prompt.'
	journalctl --user --follow --output=short-iso --lines=10 --since='10 seconds ago' --grep 'warning|g_variant' "$$(command -v gnome-shell)"

journal:
	journalctl -b 0 -r --since "1 hour ago"

# Run vitest unit tests
test-unit:
	npm run test:unit

# Build and run Integration tests in a container (formerly test-e2e)
# Usage: make test-integration             (Fedora 44, default)
#        make test-integration FEDORA_VERSION=43
#        make test-integration FEDORA_VERSION=42
FEDORA_VERSION ?= 44
# Optional: run only specific spec(s). Omit to run all specs.
#   SPEC=resize make test-integration          -> run resize.js only
#   SPEC=focus,keyboard make test-integration   -> run focus.js + keyboard.js
SPEC ?=
test-integration: dist
	@if ! podman image exists anvil-test-pod:fedora-$(FEDORA_VERSION); then \
		echo "Container image not found. Building..."; \
		bash test/integration/build-container.sh $(FEDORA_VERSION); \
	fi
	python3 test/integration/run.py -v $(FEDORA_VERSION) $(if $(SPEC),--spec $(SPEC),)

# Build Integration container images for all supported Fedora versions
test-integration-build-all:
	bash test/integration/build-container.sh 42
	bash test/integration/build-container.sh 43
	bash test/integration/build-container.sh 44

# Run Integration tests across all supported Fedora versions
# Uses run-all.py to launch all versions in parallel, cutting wall-clock
# time from ~210 s to ~75 s.
test-integration-all: dist
	python3 test/integration/run-all.py

# Backward-compat aliases for old test-e2e targets
test-e2e-container: test-integration
test-e2e-all-container: test-integration-all
test-e2e-build-container: test-integration-build-all

# Devkit-based E2E tests (local Wayland devkit compositor)
# Usage: make test-e2e
test-e2e: dist
	python3 test/e2e/run.py

format:
	npm run format

lint:
	npm run lint

check:
	npx prettier --check "./**/*.{js,jsx,ts,tsx,json}"
