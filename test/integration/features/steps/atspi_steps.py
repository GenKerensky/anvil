from behave import given, then
from steps.helpers import dump_atspi_tree


@given("gnome-shell is running")
def step_gnome_shell_running(context):
    from dogtail.tree import root
    app = root.application("gnome-shell")
    assert app is not None, "gnome-shell not found in AT-SPI tree"
    context.gnome_shell = app


@then("the gnome-shell application is accessible in the AT-SPI tree")
def step_gnome_shell_accessible(context):
    assert context.gnome_shell is not None, "gnome-shell not accessible"


@then("the main stage window exists")
def step_main_stage_exists(context):
    stage = context.gnome_shell.child("Main stage", roleName="window")
    assert stage is not None, "Main stage window not found"
    context.main_stage = stage


@then("the main stage is not showing (headless mode)")
def step_main_stage_not_showing(context):
    assert context.main_stage is not None, "No main stage to check"
    assert not context.main_stage.showing, (
        f"Expected Main stage showing=False, got showing={context.main_stage.showing}"
    )


@then("the stage has children")
def step_stage_has_children(context):
    assert context.main_stage is not None, "No main stage to check"
    count = len(context.main_stage.children)
    assert count > 0, f"Expected stage to have children, got {count}"
