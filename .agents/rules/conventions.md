# Key Conventions

- **Language**: TypeScript. `tsc` compiles to `dist/`. `module: NodeNext`, `target: ES2022`.
- **Strict mode**: `strict: true`. One `@ts-nocheck` file: `src/lib/css/index.ts`. See `TODO.md`
  for remaining `any` usage.
- **GJS imports**: `gi://Gio`, `resource:///org/gnome/shell/...`. Unit tests remap via vitest
  aliases to `test/unit/__mocks__/`.
- **Test globals**: `log`, `logError`, `print`, `global` mocked in `test/unit/setup.js`.
- **ESLint**: Flat config (`eslint.config.js`). Test files: `vitest/no-focused-tests: error`.
- **Prettier**: `printWidth: 100`, `tabWidth: 2`.
- **E2E**: host `gnome-shell --headless --virtual-monitor 1920x1080` + Jasmine via
  `--automation-script`. `export async function run()` is the entrypoint. Requires
  jasmine-gjs at `/usr/share/jasmine-gjs/`.
- **`Shell.Eval` is dead**: Returns `(false, '')` always. Use D-Bus + direct GJS APIs.
- **Extension UUID**: `anvil@GenKerensky.github.com`
- **Install path**: `~/.local/share/gnome-shell/extensions/anvil@GenKerensky.github.com/`
- **Types**: `ambient.d.ts` + `@girs/*` + `test/unit/types/gi-shell.d.ts`.
- **Build output**: `dist/` gitignored. `src/lib/prefs/metadata.js` auto-generated, gitignored.
