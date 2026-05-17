import os
import time

os.environ["DOGTAIL_PONYTALL_WARN"] = "0"

REPORT_DIR = "/tmp/behave-reports"


def before_all(context):
    os.makedirs(REPORT_DIR, exist_ok=True)


def before_scenario(context, scenario):
    context.start_time = time.time()


def after_step(context, step):
    if step.status == "failed":
        embed_atspi_tree(context, f"AT-SPI Tree after step: {step.name}")


def after_scenario(context, scenario):
    duration = time.time() - context.start_time
    if scenario.status == "failed":
        embed_atspi_tree(context, f"AT-SPI Tree at end of scenario ({duration:.1f}s)")


def embed_atspi_tree(context, caption):
    try:
        from steps.helpers import dump_atspi_tree
        tree = dump_atspi_tree()
        if tree and tree != "(empty tree)":
            context.attach("text/plain", tree, caption)
    except Exception as e:
        context.attach("text/plain", f"Could not dump AT-SPI tree: {e}", caption)
