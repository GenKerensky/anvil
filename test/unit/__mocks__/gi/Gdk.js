import { vi } from "vitest";

class Monitor {
  constructor(config = {}) {
    this._geometry = config.geometry || { x: 0, y: 0, width: 1920, height: 1080 };
    this._connector = config.connector ?? "DP-1";
    this._description = config.description ?? null;
    this._manufacturer = config.manufacturer ?? null;
    this._model = config.model ?? null;
  }

  get geometry() {
    return { ...this._geometry };
  }

  get connector() {
    return this._connector;
  }

  get description() {
    return this._description;
  }

  get manufacturer() {
    return this._manufacturer;
  }

  get model() {
    return this._model;
  }
}

let _defaultDisplay = null;

class Display {
  constructor() {
    this._monitors = [];
  }

  get_monitors() {
    return {
      get_n_items: () => this._monitors.length,
      get_item: (i) => this._monitors[i] ?? null,
    };
  }

  _addMonitor(config) {
    this._monitors.push(new Monitor(config));
  }

  static get_default() {
    if (!_defaultDisplay) {
      _defaultDisplay = new Display();
    }
    return _defaultDisplay;
  }
}

export function _resetDisplay() {
  _defaultDisplay = new Display();
}

export { Display, Monitor };

export default {
  Display,
  Monitor,
  _resetDisplay,
};
