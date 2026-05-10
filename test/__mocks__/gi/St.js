import { vi } from "vitest";

class Widget {
  constructor() {
    this.visible = true;
    this.reactive = true;
  }

  add_child() {}
  remove_child() {}
  destroy() {}
  connect() {
    return 0;
  }
  disconnect() {}
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  set_style() {}
  get_style() {
    return "";
  }
  add_style_class_name() {}
  remove_style_class_name() {}
  get_parent() {
    return null;
  }
  get_stage() {
    return null;
  }
}

class Bin extends Widget {
  constructor() {
    super();
    this.child = null;
  }

  set_child(child) {
    this.child = child;
  }
  get_child() {
    return this.child;
  }
}

class BoxLayout extends Widget {
  constructor() {
    super();
    this.vertical = false;
  }
}

class Label extends Widget {
  constructor(params = {}) {
    super();
    this.text = params.text || "";
  }

  get_text() {
    return this.text;
  }
  set_text(text) {
    this.text = text;
  }
}

class Button extends Widget {
  constructor() {
    super();
    this.label = "";
    this.checked = false;
  }
}

class Icon extends Widget {
  constructor() {
    super();
    this.icon_name = "";
    this.icon_size = 0;
  }
}

const ThemeContext = {
  get_for_stage: vi.fn(() => ({
    get_scale_factor: vi.fn(() => 1),
    connect: vi.fn(() => 0),
    disconnect: vi.fn(),
  })),
};

export default {
  Widget,
  Bin,
  BoxLayout,
  Label,
  Button,
  Icon,
  ThemeContext,
};
