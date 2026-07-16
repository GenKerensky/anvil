# Stylesheet overrides and versioning

Anvil treats the stylesheet in the extension package and the stylesheet in the user's configuration
directory as different kinds of data:

- `src/stylesheet.css` is the shipped base stylesheet. A package update may replace it.
- `$XDG_CONFIG_HOME/anvil/stylesheet/anvil/stylesheet.css` is the durable user override. Anvil must
  not rewrite customized bytes merely because the package changed.

At runtime, GNOME Shell loads the shipped base first and the user file second. Normal CSS cascade
rules therefore preserve existing user choices, while selectors introduced by a newer Anvil release
remain available from the shipped base.

## Migration contract

[`stylesheet-migration.ts`](../../src/lib/shared/stylesheet-migration.ts) identifies stylesheet
contents by SHA-256 over the exact file bytes. Parsing or reformatting never participates in
customization detection.

The `css-last-update` setting records the migration version that Anvil successfully evaluated. It
does **not** assert that the user file equals a shipped default. The `css-default-digest` setting
records the shipped base from which an unmodified user file originated; an empty value means that
the origin of a legacy customized file is unknown.

Initialization handles the file states as follows:

| User file state                         | Result                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing                                 | Stage the current shipped bytes in a unique file, then move it into place without overwriting a file created concurrently. If creation fails, use the shipped base.             |
| Exact current default                   | Record/repair the current identity without rewriting the file.                                                                                                                  |
| Exact known old default                 | Verify a versioned backup, atomically replace the file, then advance migration state.                                                                                           |
| Customized or unknown legacy bytes      | Preserve the bytes unchanged and load them after the current shipped base.                                                                                                      |
| Unreadable                              | Preserve the file, omit it from preferences editing, and use the shipped base.                                                                                                  |
| Parse failure in the preferences parser | Preserve the file and make stylesheet editing read-only for that process. Shell still attempts the override and falls back to the already-loaded shipped base if St rejects it. |

Existing custom files are deliberately not auto-merged. Loading the shipped base beneath them is
the compatibility mechanism for new selectors and defaults.

First-install creation uses a unique staged file and a no-replace move. If another process creates
the user file first, migration reclassifies that file and preserves it. All replacement writes use
the etag read with the source bytes, so a concurrent edit fails instead of being silently replaced.
Migration markers advance only after required file writes and verification succeed. If the file
replacement succeeds but marker persistence fails, the next initialization recognizes the current
bytes and repairs the markers without another destructive migration.

## Recovery backups

Before replacing an exact old shipped default, Anvil creates a deterministic recovery file beside
the user stylesheet:

```text
stylesheet.css.bak-v<VERSION>-<SOURCE_DIGEST_PREFIX>
```

An existing backup is never overwritten. It must contain the exact pre-migration bytes before Anvil
will proceed. To restore one manually:

```bash
CSS_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/anvil/stylesheet/anvil"
BACKUP="$(find "${CSS_DIR}" -maxdepth 1 -type f -name 'stylesheet.css.bak-v*' -print -quit)"
test -n "${BACKUP}"
cp -- "${CSS_DIR}/stylesheet.css" "${CSS_DIR}/stylesheet.css.before-recovery"
cp -- "${BACKUP}" "${CSS_DIR}/stylesheet.css"
```

Then disable and enable Anvil or make one Appearance change to request a Shell stylesheet reload.
Restoring an old shipped file is safe, but it will be treated as customized if its origin is no
longer known.

## Changing the shipped stylesheet

Every intentional edit to `src/stylesheet.css` must update `CURRENT_STYLESHEET_MANIFEST`:

1. increment `version`;
2. move the previous `currentDigest` into `knownDefaultDigests` (never remove still-supported
   historical identities);
3. calculate SHA-256 over the new file's raw bytes and set `currentDigest`;
4. add fixtures for the old default, new default, and a custom derivative; and
5. run `npm test`, `make test-e2e-stylesheet`, and the installed-package stylesheet smoke.

The manifest governance test fails when the packaged stylesheet bytes change without this record.
This is intentionally independent of the GNOME extension version or unrelated schema changes.
