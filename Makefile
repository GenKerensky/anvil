UUID = anvil@GenKerensky.github.com
INSTALL_PATH = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
MSGSRC = $(wildcard src/po/*.po)

.PHONY: all build install uninstall clean dist debug \
        enable disable restart purge log journal \
        potfile compilemsgs metadata schemas format lint check \
        test-unit test-e2e test-e2e-monitor-churn test-e2e-cross-surface-swap test-e2e-preferences \
        test-e2e-stylesheet test-e2e-icons test-debug-loop-lib

all: build install

dev: build debug install

prod: build install

schemas: src/schemas/gschemas.compiled
	touch $@

src/schemas/gschemas.compiled: src/schemas/*.gschema.xml
	glib-compile-schemas src/schemas

metadata:
	node scripts/generate-contributor-metadata.mjs
	npx prettier --write src/lib/prefs/metadata.js

build: clean metadata.json schemas compilemsgs metadata
	npm run build
	# Strip TypeScript build artifacts not needed at runtime
	find dist -type f \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.tsbuildinfo' \) -delete
	mkdir -p dist
	cp metadata.json dist
	cp assets/org.gnome.shell.extensions.anvil-regular.svg dist/
	cp assets/org.gnome.shell.extensions.anvil-symbolic.svg dist/
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
	bash scripts/install-extension.sh dist "$(INSTALL_PATH)"

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

# Host headless E2E tests (gnome-shell --headless --virtual-monitor)
# Requires host GNOME Shell + jasmine-gjs at /usr/share/jasmine-gjs/
# Usage: make test-e2e
#        python3 test/e2e/run.py --tag resize
#        python3 test/e2e/run.py --no-build
test-e2e: dist
	python3 test/e2e/run.py

# Mutter 50.1 mirror churn must run in a fresh Shell process. Accumulated window
# move/resize state can crash its logical-monitor neighbor lookup during collapse.
test-e2e-monitor-churn: dist
	python3 test/e2e/run.py --no-build --tag monitor-churn --virtual-monitors 2
	python3 test/e2e/run.py --no-build --engine core --tag monitor-churn --virtual-monitors 2

# Cross-surface legacy swap gets its own fresh Shell process so monitor-moving
# signal traffic cannot contaminate or be contaminated by other E2E suites.
test-e2e-cross-surface-swap: dist
	python3 test/e2e/run.py --no-build --tag cross-surface-swap --virtual-monitors 2 --results-timeout 120

test-e2e-preferences: dist
	python3 test/e2e/run.py --no-build --tag preferences

test-e2e-stylesheet: dist
	python3 test/e2e/run.py --no-build --tag stylesheet

test-e2e-icons: dist
	python3 test/e2e/run.py --no-build --tag icons

# Backward-compatible alias for the deterministic Python tooling suite.
test-debug-loop-lib:
	npm run test:tooling

format:
	npm run format

lint:
	npm run lint

check:
	npx prettier --check "./**/*.{js,jsx,ts,tsx,json}"
