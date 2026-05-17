import { Widget } from "./Gtk.js";

class PreferencesPage extends Widget {
  constructor(params = {}) {
    super(params);
    this.title = params.title ?? "";
    this.icon_name = params.icon_name ?? "";
    this._groups = [];
  }

  add(group) {
    this._groups.push(group);
  }
}

class PreferencesGroup extends Widget {
  constructor(params = {}) {
    super(params);
    this._title = params.title ?? "";
    this._rows = [];
  }

  set title(v) {
    this._title = v;
  }

  get title() {
    return this._title;
  }

  add(row) {
    this._rows.push(row);
  }
}

class ActionRow extends Widget {
  constructor(params = {}) {
    super(params);
    this.title = params.title ?? "";
    this.subtitle = params.subtitle ?? "";
    this.activatable_widget = params.activatable_widget ?? null;
    this._suffixes = [];
  }

  add_suffix(widget) {
    this._suffixes.push(widget);
  }
}

class StyleManager {
  constructor() {
    this.accent_color_rgba = { red: 0.2, green: 0.4, blue: 0.8, alpha: 1.0 };
  }

  static get_default() {
    if (!StyleManager._instance) {
      StyleManager._instance = new StyleManager();
    }
    return StyleManager._instance;
  }
}

export { PreferencesPage, PreferencesGroup, ActionRow, StyleManager };

export default {
  PreferencesPage,
  PreferencesGroup,
  ActionRow,
  StyleManager,
};
