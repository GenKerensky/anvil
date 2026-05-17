import { vi } from "vitest";
import { withSignals } from "../../mocks/helpers/signalMixin.js";

export class Actor extends withSignals() {
  constructor(params = {}) {
    super();
    this.name = params.name || "";
    this.x = params.x || 0;
    this.y = params.y || 0;
    this.width = params.width || 0;
    this.height = params.height || 0;
    this.visible = params.visible !== false;
    this.reactive = params.reactive !== false;
  }

  get_width() {
    return this.width;
  }

  set_width(width) {
    this.width = width;
  }

  get_height() {
    return this.height;
  }

  set_height(height) {
    this.height = height;
  }

  set_position(x, y) {
    this.x = x;
    this.y = y;
  }

  set_size(width, height) {
    this.width = width;
    this.height = height;
  }

  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  destroy() {}
}

export const ActorAlign = {
  FILL: 0,
  START: 1,
  CENTER: 2,
  END: 3,
};

export const Orientation = {
  HORIZONTAL: 0,
  VERTICAL: 1,
};

export class Seat {
  constructor() {
    this.warp_pointer = vi.fn();
  }
}

export class Backend {
  constructor() {
    this._seat = new Seat();
  }

  get_default_seat() {
    return this._seat;
  }
}

const _defaultBackend = new Backend();

export function get_default_backend() {
  return _defaultBackend;
}

export default {
  Actor,
  ActorAlign,
  Orientation,
  Seat,
  Backend,
  get_default_backend,
};
