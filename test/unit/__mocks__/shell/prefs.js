export function gettext(str) {
  return str;
}

export class ExtensionPreferences {
  constructor() {
    this.uuid = "anvil@GenKerensky.github.com";
  }

  getSettings(schema) {
    return {
      schema_id: schema ?? "org.gnome.shell.extensions.anvil",
      _values: {},
      get_value(key) {
        return this._values[key];
      },
      set_value(key, val) {
        this._values[key] = val;
      },
      connect(signal, cb) {
        return 42;
      },
    };
  }
}

export default {
  gettext,
  ExtensionPreferences,
};
