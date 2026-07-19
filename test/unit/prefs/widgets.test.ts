import { describe, expect, it, vi } from "vitest";

import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

import { AddButton, ColorRow } from "../../../src/lib/prefs/widgets.js";

interface MockColorChooserDialog extends Gtk.ColorChooserDialog {
  presented: boolean;
  respond(response: Gtk.ResponseType): void;
  select_rgba(rgba: Gdk.RGBA): void;
}

describe("ColorRow", () => {
  it("exposes the alpha editor and reports RGBA property changes immediately", () => {
    const onChange = vi.fn();
    const row = new ColorRow({
      title: "Shadow color",
      init: "rgba(0, 0, 0, 0.35)",
      onChange,
    });

    row.colorButton.emit("clicked");

    const dialog = (
      Gtk.ColorChooserDialog as typeof Gtk.ColorChooserDialog & {
        lastCreated: MockColorChooserDialog | null;
      }
    ).lastCreated;
    expect(dialog).not.toBeNull();
    if (!dialog) throw new Error("Expected the color chooser dialog to open");
    expect(dialog.use_alpha).toBe(true);
    expect(dialog.show_editor).toBe(true);
    expect(dialog.presented).toBe(true);

    const rgba = new Gdk.RGBA();
    rgba.parse("rgba(128, 0, 255, 0.6)");
    dialog.select_rgba(rgba);

    expect(onChange).toHaveBeenCalledExactlyOnceWith("rgba(128, 0, 255, 0.6)");

    dialog.respond(Gtk.ResponseType.CANCEL);
    expect(onChange).toHaveBeenLastCalledWith("rgba(0, 0, 0, 0.35)");
    expect(row.colorButton.get_rgba().to_string()).toBe("rgba(0, 0, 0, 0.35)");
  });

  it("does not report a change when the editor is cancelled untouched", () => {
    const onChange = vi.fn();
    const row = new ColorRow({
      title: "Shadow color",
      init: "rgba(0, 0, 0, 0.35)",
      onChange,
    });

    row.colorButton.emit("clicked");
    const dialog = (
      Gtk.ColorChooserDialog as typeof Gtk.ColorChooserDialog & {
        lastCreated: MockColorChooserDialog | null;
      }
    ).lastCreated;
    if (!dialog) throw new Error("Expected the color chooser dialog to open");
    dialog.respond(Gtk.ResponseType.CANCEL);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("AddWindowButton", () => {
  it("uses an add icon and exposes selection mode without a text label", () => {
    const onAdd = vi.fn();
    const button = new AddButton({ onAdd });

    expect(button.icon_name).toBe("list-add-symbolic");
    expect(button.label).toBeUndefined();
    expect(button.tooltip_text).toBe("Add Window");

    button.emit("clicked");
    expect(onAdd).toHaveBeenCalledOnce();

    button.setSelecting(true);
    expect(button.icon_name).toBe("selection-mode-symbolic");
    expect(button.tooltip_text).toBe("Press Esc or right-click to cancel");

    button.setSelecting(false);
    expect(button.icon_name).toBe("list-add-symbolic");
  });
});
