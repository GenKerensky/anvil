import { vi } from "vitest";
import { withSignals } from "../../mocks/helpers/signalMixin.js";

class Widget extends withSignals() {
  constructor(params = {}) {
    super();
    Object.assign(this, params);
    this._parent = null;
    this._controllers = [];
    this._drawFunc = null;
  }

  add_controller(ctrl) {
    this._controllers.push(ctrl);
  }

  set_draw_func(fn) {
    this._drawFunc = fn;
  }

  get_width() {
    return this.width ?? 200;
  }

  get_height() {
    return this.height ?? 100;
  }

  show() {}
  hide() {}
  queue_draw() {}

  set_sensitive(v) {
    this.sensitive = v;
  }

  get_sensitive() {
    return this.sensitive ?? true;
  }
}

class DrawingArea extends Widget {
  constructor(params) {
    super(params);
    this.width = params?.width_request ?? 200;
    this.height = params?.height_request ?? 100;
  }
}

class Switch extends Widget {
  constructor(params) {
    super(params);
    this._active = params?.active ?? false;
  }

  get active() {
    return this._active;
  }

  set active(v) {
    const changed = this._active !== v;
    this._active = v;
    if (changed) {
      this.emit("notify::active");
    }
  }
}

class SpinButton extends Widget {
  constructor(params) {
    super(params);
    this._value = params?.value ?? 0;
    this._adjustment = params?.adjustment ?? null;
    this.xalign = params?.xalign ?? 0;
  }

  get value() {
    return this._value;
  }

  set value(v) {
    const old = this._value;
    this._value = v;
    if (old !== v) {
      this.emit("value-changed");
    }
  }

  set_value(v) {
    this.value = v;
  }

  get_value() {
    return this._value;
  }

  static new_with_range(min, max, step) {
    const btn = new SpinButton({ value: min });
    btn._min = min;
    btn._max = max;
    btn._step = step;
    return btn;
  }
}

class Box extends Widget {
  constructor(params) {
    super(params);
    this._children = [];
  }

  append(child) {
    this._children.push(child);
  }
}

class Image extends Widget {
  constructor(params) {
    super(params);
    this.icon_name = params?.icon_name ?? "";
  }

  set_tooltip_markup(text) {
    this._tooltip = text;
  }
}

class GestureClick extends withSignals() {
  constructor() {
    super();
  }
}

export const Align = {
  CENTER: 3,
  FILL: 0,
  START: 1,
  END: 2,
};

export const Orientation = {
  VERTICAL: 0,
  HORIZONTAL: 1,
};

class IconTheme {
  constructor() {
    this._searchPaths = [];
  }

  add_search_path(path) {
    this._searchPaths.push(path);
  }

  static get_for_display(_display) {
    return new IconTheme();
  }
}

export { Widget, DrawingArea, Switch, SpinButton, Box, Image, GestureClick, IconTheme };

export default {
  Widget,
  DrawingArea,
  Switch,
  SpinButton,
  Box,
  Image,
  GestureClick,
  GestureClick,
  Align,
  Orientation,
  IconTheme,
};
