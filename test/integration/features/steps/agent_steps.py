import json
import time

from behave import given, when, then
from steps.helpers import (
    call_agent,
    eval_test_state,
    get_ext_state,
    get_extension_errors,
    gsetting_get,
    gsetting_set,
    run_shell,
    UUID,
)


@given("the Anvil extension is active")
def step_extension_active(context):
    state = get_ext_state()
    assert state == "1", f"Expected extension state 1 (ACTIVE), got {state}"


@then("the extension has no errors")
def step_no_errors(context):
    errors = get_extension_errors()
    assert errors == "(@as [],)", f"Extension has errors: {errors}"


@then('test-mode is enabled')
def step_test_mode_enabled(context):
    val = gsetting_get("test-mode")
    assert val == "true", f"Expected test-mode=true, got {val}"


@when("the extension is disabled")
def step_disable_extension(context):
    run_shell(
        f"gdbus call --session "
        f"--dest org.gnome.Shell "
        f"--object-path /org/gnome/Shell "
        f"--method org.gnome.Shell.Extensions.DisableExtension "
        f"'{UUID}'"
    )
    time.sleep(3)


@when("the extension is enabled")
def step_enable_extension(context):
    run_shell(
        f"gdbus call --session "
        f"--dest org.gnome.Shell "
        f"--object-path /org/gnome/Shell "
        f"--method org.gnome.Shell.Extensions.EnableExtension "
        f"'{UUID}'"
    )
    time.sleep(4)


@then("the extension is inactive")
def step_extension_inactive(context):
    state = get_ext_state()
    assert state == "2", f"Expected extension state 2 (INACTIVE), got {state}"


@then("the extension is active state")
def step_extension_active_state(context):
    state = get_ext_state()
    assert state == "1", f"Expected extension state 1 (ACTIVE), got {state}"


@when("a window is opened")
def step_open_window(context):
    run_shell("nohup gnome-text-editor --new-window >/dev/null 2>&1 &")
    time.sleep(5)


@then("the tree structure exists")
def step_tree_exists(context):
    val = eval_test_state("treeExists")
    assert val == "true", f"Expected treeExists=true, got {val}"


@when("the window is closed")
def step_close_window(context):
    run_shell("wtype -M alt -k F4 -m alt 2>/dev/null || true")
    time.sleep(2)


@when('gsetting "{key}" is set to "{value}"')
def step_gsetting_set(context, key, value):
    gsetting_set(key, value)
    time.sleep(0.3)


@then('gsetting "{key}" is "{value}"')
def step_gsetting_is(context, key, value):
    actual = gsetting_get(key)
    assert actual == value, (
        f"Expected gsetting '{key}' = '{value}', got '{actual}'"
    )


@then('gsetting "{key}" exists')
def step_gsetting_exists(context, key):
    val = gsetting_get(key)
    assert val and val not in ("", "null"), (
        f"Expected gsetting '{key}' to be readable, got '{val}'"
    )
