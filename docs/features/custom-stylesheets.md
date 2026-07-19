# Custom stylesheets

Anvil loads its packaged GNOME Shell stylesheet first, then applies a user stylesheet as an override:

```text
~/.config/anvil/stylesheet/anvil/stylesheet.css
```

The Appearance preferences page edits this same file. Direct CSS edits therefore remain visible in the UI whenever the parser can represent the property.

## Safe customization

1. Open the user stylesheet in a text editor.
2. Change only the Anvil selectors you want to override.
3. Save the file.
4. Reopen preferences or reload the extension if the Shell does not pick up the change immediately.

Keep a copy of substantial custom work in version control. Invalid GNOME Shell CSS can cause missing or incomplete Anvil decorations even when window tiling continues to work.

## Updates and recovery

Anvil preserves customized user bytes during package updates. When a shipped default must be migrated, Anvil only upgrades an exact old default after creating a verified recovery backup. Backup names include the stylesheet migration version and a digest of the previous default.

The maintainer-facing guarantees are documented in the [stylesheet versioning contract](../theme/stylesheet-versioning.md).
