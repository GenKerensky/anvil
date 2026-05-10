UUID = anvil@GenKerensky.github.com
INSTALL_PATH = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
MSGSRC = $(wildcard po/*.po)

.PHONY: all build install uninstall clean dist debug \
        enable disable restart purge log journal \
        potfile compilemsgs metadata schemas format lint check \
        test-unit test-e2e test-e2e-build-all test-e2e-all

all: build install

dev: build debug install

prod: build install

schemas: schemas/gschemas.compiled
	touch $@

schemas/gschemas.compiled: schemas/*.gschema.xml
	glib-compile-schemas schemas

metadata:
	printf 'export const developers = Object.entries(\n' > lib/prefs/metadata.js
	printf '  /** @type {Array<Record<string, string>>} */(\n' >> lib/prefs/metadata.js
	printf '  [\n' >> lib/prefs/metadata.js
	git shortlog -sne >> lib/prefs/metadata.js || true
	awk '!/dependabot|noreply/' lib/prefs/metadata.js > lib/prefs/metadata.js.tmp && mv lib/prefs/metadata.js.tmp lib/prefs/metadata.js
	sed -i 's/^[[:space:]]*[0-9]*[[:space:]]*\(.*\) <\(.*\)>/    {name:"\1", email:"\2"},/g' lib/prefs/metadata.js
	printf '  ]\n' >> lib/prefs/metadata.js
	printf ').reduce((acc, x) => ({ ...acc, [x.email]: acc[x.email] ?? x.name }), {}))\n' >> lib/prefs/metadata.js
	printf '.map(([email, name]) => name + " <" + email + ">")\n' >> lib/prefs/metadata.js
	npx prettier --write lib/prefs/metadata.js

build: clean metadata.json schemas compilemsgs metadata
	npm run build
	mkdir -p dist
	cp metadata.json dist
	cp -r resources dist
	cp -r schemas dist
	cp -r config dist
	cp lib/prefs/metadata.js dist/lib/prefs/
	cp *.css dist
	cp LICENSE dist
	mkdir -p dist/locale
	for msg in $(MSGSRC:.po=.mo); do \
		msgf=dist/locale/`basename $$msg .mo`; \
		mkdir -p $$msgf; \
		mkdir -p $$msgf/LC_MESSAGES; \
		cp $$msg $$msgf/LC_MESSAGES/anvil.mo; \
	done;

./po/%.mo: ./po/%.po
	msgfmt -c $< -o $@

debug:
	sed -i 's/export const production = true/export const production = false/' dist/lib/shared/settings.js

potfile: ./po/anvil.pot

./po/anvil.pot: ./extension.ts ./prefs.ts ./lib/**/*.ts
	mkdir -p po
	xgettext --from-code=UTF-8 --output=po/anvil.pot --package-name "Anvil" ./extension.ts ./prefs.ts ./lib/**/*.ts

compilemsgs: potfile $(MSGSRC:.po=.mo)
	for msg in $(MSGSRC); do \
		msgmerge -U $$msg ./po/anvil.pot; \
	done;

clean:
	rm -f lib/prefs/metadata.js
	rm -f "$(UUID).zip"
	rm -rf dist schemas/gschemas.compiled

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

# Build and run E2E tests in a container
# Usage: make test-e2e                   (Fedora 44, default)
#        make test-e2e FEDORA_VERSION=43
#        make test-e2e FEDORA_VERSION=42
FEDORA_VERSION ?= 44
test-e2e: dist
	@if ! podman image exists anvil-test-pod:fedora-$(FEDORA_VERSION); then \
		echo "Container image not found. Building..."; \
		bash test/e2e/build-container.sh $(FEDORA_VERSION); \
	fi
	bash test/e2e/run-tests.sh -v $(FEDORA_VERSION)

# Build E2E container images for all supported Fedora versions
test-e2e-build-all:
	bash test/e2e/build-container.sh 42
	bash test/e2e/build-container.sh 43
	bash test/e2e/build-container.sh 44

# Run E2E tests across all supported Fedora versions
test-e2e-all: dist
	bash test/e2e/run-tests.sh -v 42
	bash test/e2e/run-tests.sh -v 43
	bash test/e2e/run-tests.sh -v 44

format:
	npm run format

lint:
	npm run lint

check:
	npx prettier --check "./**/*.{js,jsx,ts,tsx,json}"
