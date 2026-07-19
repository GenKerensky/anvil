import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import Clutter from "gi://Clutter";

import {
  findTopmostWindowAt,
  WindowPicker,
  type WindowPickerOutcome,
} from "../../../src/lib/extension/window-picker.js";

class MockOverlay {
  private callback: ((_actor: MockOverlay, event: MockEvent) => boolean) | null = null;
  disconnect = vi.fn(() => {
    this.callback = null;
  });
  destroy = vi.fn();
  set_size = vi.fn();

  connect(_signal: string, callback: (_actor: MockOverlay, event: MockEvent) => boolean): number {
    this.callback = callback;
    return 41;
  }

  send(event: MockEvent): boolean {
    if (!this.callback) throw new Error("Picker overlay is not listening");
    return this.callback(this, event);
  }
}

type MockEvent = {
  type(): number;
  get_button(): number;
  get_key_symbol(): number;
  get_coords(): [number, number];
};

function event({
  type,
  button = 0,
  key = 0,
  coords = [0, 0],
}: {
  type: number;
  button?: number;
  key?: number;
  coords?: [number, number];
}): MockEvent {
  return {
    type: () => type,
    get_button: () => button,
    get_key_symbol: () => key,
    get_coords: () => coords,
  };
}

function windowAt({
  wmClass,
  title = "Window",
  rect = { x: 0, y: 0, width: 100, height: 100 },
  minimized = false,
  visible = true,
}: {
  wmClass: string;
  title?: string;
  rect?: { x: number; y: number; width: number; height: number };
  minimized?: boolean;
  visible?: boolean;
}) {
  return {
    minimized,
    showing_on_its_workspace: vi.fn(() => visible),
    get_frame_rect: vi.fn(() => rect),
    get_wm_class: vi.fn(() => wmClass),
    get_title: vi.fn(() => title),
  };
}

describe("findTopmostWindowAt", () => {
  beforeEach(() => {
    global.display.sort_windows_by_stacking = vi.fn((windows) => windows);
  });

  it("chooses the topmost visible window containing the stage point", () => {
    const bottom = windowAt({ wmClass: "Bottom" });
    const top = windowAt({ wmClass: "Top" });
    const minimized = windowAt({ wmClass: "Hidden", minimized: true });

    expect(findTopmostWindowAt([bottom, top, minimized] as any, 20, 20)).toBe(top);
    expect(global.display.sort_windows_by_stacking).toHaveBeenCalledWith([bottom, top]);
  });

  it("uses half-open frame bounds and ignores off-workspace windows", () => {
    const offWorkspace = windowAt({ wmClass: "Off", visible: false });
    const visible = windowAt({ wmClass: "Visible", rect: { x: 10, y: 10, width: 20, height: 20 } });

    expect(findTopmostWindowAt([offWorkspace, visible] as any, 29, 29)).toBe(visible);
    expect(findTopmostWindowAt([offWorkspace, visible] as any, 30, 30)).toBeNull();
  });
});

describe("WindowPicker", () => {
  let overlay: MockOverlay;
  let outcomes: Mock<(outcome: WindowPickerOutcome) => void>;
  let platform: any;
  let windows: any[];
  let picker: WindowPicker;

  beforeEach(() => {
    global.display.sort_windows_by_stacking = vi.fn((items) => items);
    overlay = new MockOverlay();
    outcomes = vi.fn();
    windows = [];
    platform = {
      createOverlay: vi.fn(() => overlay),
      addOverlay: vi.fn(),
      stageSize: vi.fn(() => [1920, 1080]),
      pushModal: vi.fn(() => ({ grab: true })),
      popModal: vi.fn(),
      windows: vi.fn(() => windows),
    };
    picker = new WindowPicker({ onOutcome: outcomes, platform });
  });

  it("grabs the full stage and returns the selected window identity", () => {
    windows = [windowAt({ wmClass: "org.example.App", title: "Example Document" })];
    picker.start("request-1");

    expect(overlay.set_size).toHaveBeenCalledWith(1920, 1080);
    expect(platform.addOverlay).toHaveBeenCalledWith(overlay);
    expect(platform.pushModal).toHaveBeenCalledWith(overlay);

    expect(
      overlay.send(
        event({
          type: Clutter.EventType.BUTTON_PRESS,
          button: Clutter.BUTTON_PRIMARY,
          coords: [5, 5],
        })
      )
    ).toBe(Clutter.EVENT_STOP);
    expect(outcomes).toHaveBeenCalledWith({
      id: "request-1",
      status: "selected",
      wmClass: "org.example.App",
      wmTitle: "Example Document",
    });
    expect(platform.popModal).toHaveBeenCalledOnce();
    expect(overlay.disconnect).toHaveBeenCalledWith(41);
    expect(overlay.destroy).toHaveBeenCalledOnce();
  });

  it("keeps selecting when the preferences window or empty space is clicked", () => {
    windows = [windowAt({ wmClass: "org.gnome.Shell.Extensions", title: "Anvil" })];
    picker.start("request-1");

    overlay.send(
      event({
        type: Clutter.EventType.BUTTON_PRESS,
        button: Clutter.BUTTON_PRIMARY,
        coords: [5, 5],
      })
    );
    windows = [];
    overlay.send(
      event({
        type: Clutter.EventType.BUTTON_PRESS,
        button: Clutter.BUTTON_PRIMARY,
        coords: [5, 5],
      })
    );

    expect(outcomes).not.toHaveBeenCalled();
    expect(platform.popModal).not.toHaveBeenCalled();
  });

  it("cancels on Escape, secondary click, explicit cancel, restart, and destroy", () => {
    picker.start("escape");
    overlay.send(event({ type: Clutter.EventType.KEY_PRESS, key: Clutter.KEY_Escape }));
    expect(outcomes).toHaveBeenLastCalledWith({ id: "escape", status: "cancelled" });

    overlay = new MockOverlay();
    picker.start("secondary");
    overlay.send(event({ type: Clutter.EventType.BUTTON_PRESS, button: Clutter.BUTTON_SECONDARY }));
    expect(outcomes).toHaveBeenLastCalledWith({ id: "secondary", status: "cancelled" });

    overlay = new MockOverlay();
    picker.start("explicit");
    picker.cancel("explicit");
    expect(outcomes).toHaveBeenLastCalledWith({ id: "explicit", status: "cancelled" });

    overlay = new MockOverlay();
    picker.start("old");
    overlay = new MockOverlay();
    picker.start("new");
    expect(outcomes).toHaveBeenCalledWith({ id: "old", status: "cancelled" });
    picker.destroy();
    expect(outcomes).toHaveBeenLastCalledWith({ id: "new", status: "cancelled" });
  });

  it("cancels and cleans up when the modal grab fails", () => {
    platform.pushModal.mockImplementation(() => {
      throw new Error("grab failed");
    });

    picker.start("request-1");

    expect(outcomes).toHaveBeenCalledWith({ id: "request-1", status: "cancelled" });
    expect(overlay.destroy).toHaveBeenCalledOnce();
  });
});
