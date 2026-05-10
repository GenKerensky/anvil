from behave import when, then
from steps.helpers import (
    find_prefs_window,
    get_page_tabs,
    get_switch_node,
    navigate_to_tab,
    gsetting_get,
    gsetting_toggle,
    SWITCH_TO_KEY,
    SWITCH_TO_TAB,
)


def ensure_prefs(context):
    if not hasattr(context, "prefs_window") or context.prefs_window is None:
        context.prefs_window = find_prefs_window()
    assert context.prefs_window is not None, "Preferences window not found"


@when("the preferences window is opened via D-Bus")
def step_open_prefs(context):
    context.prefs_window = find_prefs_window()
    assert context.prefs_window is not None, (
        "Could not open or find preferences window. "
        "Ensure gnome-shell is running with toolkit-accessibility enabled."
    )


@then('the preferences window shows the "{name}" page tab')
def step_prefs_shows_page_tab(context, name):
    ensure_prefs(context)
    tabs = get_page_tabs(context.prefs_window)
    tab_names = [t.name for t in tabs]
    assert name in tab_names, (
        f"Page tab '{name}' not found. Found tabs: {tab_names}"
    )


@then('switch "{sw_name}" checked state matches gsetting "{key}"')
def step_switch_matches_gsetting(context, sw_name, key):
    ensure_prefs(context)
    tab = SWITCH_TO_TAB.get(sw_name)
    if tab:
        navigate_to_tab(context.prefs_window, tab)
    sw = get_switch_node(context.prefs_window, sw_name)
    assert sw is not None, (
        f"Switch '{sw_name}' not found in preferences window"
    )
    gs_val = gsetting_get(key)
    checked_val = str(sw.checked).lower()
    assert checked_val == gs_val, (
        f"Switch '{sw_name}' checked={checked_val} but gsetting '{key}'={gs_val}"
    )


@then('after toggling gsetting "{key}", switch "{sw_name}" state updates')
def step_toggle_gsetting_and_verify(context, key, sw_name):
    ensure_prefs(context)
    tab = SWITCH_TO_TAB.get(sw_name)
    if tab:
        navigate_to_tab(context.prefs_window, tab)
    sw = get_switch_node(context.prefs_window, sw_name)
    assert sw is not None, (
        f"Switch '{sw_name}' not found for toggle verification"
    )

    new_val = gsetting_toggle(key)
    checked_after = str(sw.checked).lower()

    gsetting_toggle(key)

    assert checked_after == new_val, (
        f"After gsetting toggle to {new_val}, switch '{sw_name}' "
        f"checked={checked_after} (expected {new_val})"
    )


@then('clicking the "{tab_name}" page tab navigates without error')
def step_click_page_tab(context, tab_name):
    ensure_prefs(context)
    tabs = get_page_tabs(context.prefs_window)
    target = None
    for t in tabs:
        if t.name == tab_name:
            target = t
            break
    assert target is not None, f"Page tab '{tab_name}' not found"
    target.doActionNamed("click")
    import time
    time.sleep(1)


@then('navigating back to the "{tab_name}" page tab')
def step_navigate_back(context, tab_name):
    ensure_prefs(context)
    tabs = get_page_tabs(context.prefs_window)
    target = None
    for t in tabs:
        if t.name == tab_name:
            target = t
            break
    if target:
        target.doActionNamed("click")
        import time
        time.sleep(1)
