# GDB Debugging

Start GNOME Shell under GDB:

```bash
export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all
dbus-run-session -- gdb --args gnome-shell --devkit --wayland
(gdb) run
```

## Useful commands

Print the JavaScript call stack:

```
(gdb) call (void)gjs_dumpstack()
```

Break on warnings/criticals:

```
(gdb) set env G_DEBUG=fatal-criticals
(gdb) set env G_DEBUG=fatal-warnings
```

## JS breakpoint from extension code

```js
import { System } from "gi://Gjs";
System.breakpoint(); // SIGTRAP — halts under GDB
```

## Gotchas

- GJS cannot unload code — restart the shell (or nested session) after every code change.
- On Wayland, `Alt+F2` → `restart` does not work while logged in; use devkit or log out.
