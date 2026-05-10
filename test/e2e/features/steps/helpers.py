import os
import subprocess
import time

os.environ["DOGTAIL_PONYTALL_WARN"] = "0"

UUID = "anvil@GenKerensky.github.com"
SCHEMA_ID = "org.gnome.shell.extensions.anvil"
SCHEMA_DIR = f"/home/gnomeshell/.local/share/gnome-shell/extensions/{UUID}/schemas"


def run_shell(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def gsetting_get(key):
    _, out, _ = run_shell(
        f"gsettings --schemadir {SCHEMA_DIR} get {SCHEMA_ID} {key}"
    )
    return out


def gsetting_set(key, value):
    run_shell(
        f"gsettings --schemadir {SCHEMA_DIR} set {SCHEMA_ID} {key} {value}"
    )


def gsetting_toggle(key):
    current = gsetting_get(key)
    new = "false" if current == "true" else "true"
    gsetting_set(key, new)
    time.sleep(0.3)
    return new


def open_prefs():
    run_shell(
        f"gdbus call --session "
        f"--dest org.gnome.Shell "
        f"--object-path /org/gnome/Shell "
        f"--method org.gnome.Shell.Extensions.OpenExtensionPrefs "
        f"'{UUID}' '' '@a{{sv}} {{}}'"
    )


def find_prefs_window():
    from dogtail.tree import root
    open_prefs()
    time.sleep(5)
    for app in root.children:
        try:
            for child in app.children:
                if child.roleName in ("frame", "window") and "Anvil" in child.name:
                    return child
        except Exception:
            pass
    return None


SWITCH_TO_KEY = {
    "Focus on Hover": "focus-on-hover-enabled",
    "Move pointer with focused window": "move-pointer-focus-enabled",
    "Quarter tiling": "auto-split-enabled",
    "Stacked tiling": "stacked-tiling-mode-enabled",
    "Tabbed tiling": "tabbed-tiling-mode-enabled",
    "Auto exit tabbed tiling": "auto-exit-tabbed",
    "Always on Top mode for floating windows": "float-always-on-top-enabled",
    "Preview hint": "preview-hint-enabled",
    "Border around focused window": "focus-border-toggle",
    "Window split hint border": "split-border-toggle",
    "Anvil in quick settings": "quick-settings-enabled",
    "Disable gaps for single window": "window-gap-hidden-on-single",
}

SWITCH_TO_TAB = {
    "Focus on Hover": "Tiling",
    "Move pointer with focused window": "Tiling",
    "Quarter tiling": "Tiling",
    "Stacked tiling": "Tiling",
    "Tabbed tiling": "Tiling",
    "Auto exit tabbed tiling": "Tiling",
    "Preview hint": "Appearance",
    "Border around focused window": "Appearance",
    "Window split hint border": "Appearance",
    "Anvil in quick settings": "Appearance",
    "Always on Top mode for floating windows": "Windows",
    "Disable gaps for single window": "Windows",
}


def get_switch_node(prefs_window, name):
    from dogtail.predicate import GenericPredicate
    for role in ("switch", "toggle button", "check box"):
        switches = prefs_window.findChildren(GenericPredicate(roleName=role))
        for sw in switches:
            if sw.name == name:
                return sw
    children = prefs_window.findChildren(
        GenericPredicate(name=name, showing=True)
    )
    for child in children:
        if hasattr(child, "checked"):
            return child
    return None


def get_page_tabs(prefs_window):
    from dogtail.predicate import GenericPredicate
    nodes = prefs_window.findChildren(GenericPredicate(roleName="page tab"))
    seen = set()
    tabs = []
    for t in nodes:
        if t.name and t.name not in seen:
            seen.add(t.name)
            tabs.append(t)
    return tabs


def navigate_to_tab(prefs_window, tab_name):
    tabs = get_page_tabs(prefs_window)
    for t in tabs:
        if t.name == tab_name:
            t.doActionNamed("click")
            time.sleep(1)
            return
    raise AssertionError(f"Page tab '{tab_name}' not found")


def dump_atspi_tree(node=None, max_depth=8):
    from dogtail.tree import root
    target = node or root
    lines = []
    def walk(n, depth=0):
        if depth > max_depth:
            return
        prefix = "  " * depth
        try:
            name = (n.name or "").replace("\n", "\\n")
            role = n.roleName or "?"
            parts = [f"{prefix}{name} [{role}]"]
            try:
                if n.showing:
                    parts.append("showing")
                if hasattr(n, 'checked') and n.checked is not None:
                    parts.append(f"checked={n.checked}")
            except Exception:
                pass
            lines.append(" ".join(parts))
        except Exception:
            lines.append(f"{prefix}(inaccessible)")
            return
        try:
            for child in n.children:
                walk(child, depth + 1)
        except Exception:
            pass
    walk(target)
    return "\n".join(lines) if lines else "(empty tree)"
