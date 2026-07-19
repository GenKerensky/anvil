import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { PREFERENCES_WINDOW_CLASS } from "./utils/window-filters.js";

export interface WindowPickerSelection {
  id: string;
  status: "selected";
  wmClass: string;
  wmTitle?: string;
}

export interface WindowPickerCancellation {
  id: string;
  status: "cancelled";
}

export type WindowPickerOutcome = WindowPickerSelection | WindowPickerCancellation;

interface WindowPickerActor {
  connect(
    signal: string,
    callback: (_actor: WindowPickerActor, event: Clutter.Event) => boolean
  ): number;
  disconnect(id: number): void;
  destroy(): void;
  set_size(width: number, height: number): void;
}

interface WindowPickerPlatform {
  createOverlay(): WindowPickerActor;
  addOverlay(actor: WindowPickerActor): void;
  stageSize(): [width: number, height: number];
  pushModal(actor: WindowPickerActor): unknown;
  popModal(grab: unknown): void;
  windows(): Meta.Window[];
}

const shellPlatform: WindowPickerPlatform = {
  createOverlay: () =>
    new St.Widget({
      name: "anvil-window-picker",
      reactive: true,
      can_focus: true,
      cursor_type: Clutter.CursorType.CROSSHAIR,
    }) as unknown as WindowPickerActor,
  addOverlay: (actor) => Main.layoutManager.uiGroup.add_child(actor as unknown as Clutter.Actor),
  stageSize: () => [global.stage.get_width(), global.stage.get_height()],
  pushModal: (actor) => Main.pushModal(actor as unknown as Clutter.Actor),
  popModal: (grab) => Main.popModal(grab as Clutter.Grab),
  windows: () =>
    global
      .get_window_actors()
      .map((actor) => actor.get_meta_window())
      .filter((window): window is Meta.Window => window !== null),
};

/** Return the visible topmost window whose frame contains the stage point. */
export function findTopmostWindowAt(
  windows: Meta.Window[],
  x: number,
  y: number
): Meta.Window | null {
  const candidates = windows.filter(
    (window) => !window.minimized && window.showing_on_its_workspace()
  );
  const stacked = [...global.display.sort_windows_by_stacking(candidates)].reverse();
  return (
    stacked.find((window) => {
      const rect = window.get_frame_rect();
      return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
    }) ?? null
  );
}

/** Owns the Shell modal grab for the prefs-driven visible-window selector. */
export class WindowPicker {
  private readonly _onOutcome: (outcome: WindowPickerOutcome) => void;
  private readonly _platform: WindowPickerPlatform;
  private _requestId: string | null = null;
  private _overlay: WindowPickerActor | null = null;
  private _capturedEventId = 0;
  private _grab: unknown = null;

  constructor({
    onOutcome,
    platform = shellPlatform,
  }: {
    onOutcome: (outcome: WindowPickerOutcome) => void;
    platform?: WindowPickerPlatform;
  }) {
    this._onOutcome = onOutcome;
    this._platform = platform;
  }

  start(requestId: string): void {
    if (this._requestId === requestId) return;
    this._finish("cancelled");

    this._requestId = requestId;
    try {
      const overlay = this._platform.createOverlay();
      this._overlay = overlay;
      const [width, height] = this._platform.stageSize();
      overlay.set_size(width, height);
      this._platform.addOverlay(overlay);
      this._capturedEventId = overlay.connect("captured-event", (_actor, event) =>
        this._onCapturedEvent(event)
      );
      this._grab = this._platform.pushModal(overlay);
      if (!this._grab) throw new Error("Unable to acquire modal window picker grab");
    } catch {
      this._finish("cancelled");
    }
  }

  cancel(requestId: string): void {
    if (this._requestId !== requestId) return;
    this._finish("cancelled");
  }

  destroy(): void {
    this._finish("cancelled");
  }

  private _onCapturedEvent(event: Clutter.Event): boolean {
    if (event.type() === Clutter.EventType.KEY_PRESS) {
      if (event.get_key_symbol() === Clutter.KEY_Escape) this._finish("cancelled");
      return Clutter.EVENT_STOP;
    }

    if (event.type() !== Clutter.EventType.BUTTON_PRESS) return Clutter.EVENT_STOP;
    if (event.get_button() === Clutter.BUTTON_SECONDARY) {
      this._finish("cancelled");
      return Clutter.EVENT_STOP;
    }
    if (event.get_button() !== Clutter.BUTTON_PRIMARY) return Clutter.EVENT_STOP;

    const [x, y] = event.get_coords();
    const window = findTopmostWindowAt(this._platform.windows(), x, y);
    if (!window) return Clutter.EVENT_STOP;

    const wmClass = window.get_wm_class()?.trim();
    if (!wmClass || wmClass.toLowerCase() === PREFERENCES_WINDOW_CLASS.toLowerCase()) {
      return Clutter.EVENT_STOP;
    }

    this._finish("selected", {
      wmClass,
      wmTitle: window.get_title()?.trim() || undefined,
    });
    return Clutter.EVENT_STOP;
  }

  private _finish(
    status: WindowPickerOutcome["status"],
    selection?: { wmClass: string; wmTitle?: string }
  ): void {
    const requestId = this._requestId;
    const overlay = this._overlay;
    const grab = this._grab;

    this._requestId = null;
    this._overlay = null;
    this._grab = null;
    try {
      if (overlay && this._capturedEventId) overlay.disconnect(this._capturedEventId);
    } catch {
      // Continue releasing the modal grab even if the actor is already disposing.
    }
    this._capturedEventId = 0;
    try {
      if (grab) this._platform.popModal(grab);
    } catch {
      // The Shell may already have dropped the grab during session teardown.
    }
    try {
      overlay?.destroy();
    } catch {
      // Outcome delivery must not depend on actor teardown succeeding.
    }

    if (!requestId) return;
    if (status === "selected" && selection) {
      this._onOutcome({ id: requestId, status, ...selection });
    } else {
      this._onOutcome({ id: requestId, status: "cancelled" });
    }
  }
}
