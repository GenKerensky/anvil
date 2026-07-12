import { withSignals } from "../../mocks/helpers/signalMixin.js";

export const Corner = {
  TOPLEFT: 0,
  TOPRIGHT: 1,
  BOTTOMRIGHT: 2,
  BOTTOMLEFT: 3,
};

export class Widget extends withSignals() {
  constructor(params = {}) {
    super();
    this.name = params.name || "";
    this.style_class = params.style_class || "";
    this.visible = params.visible !== false;
    this._destroyed = false;
  }

  get_style_class_name() {
    return this.style_class;
  }

  set_style_class_name(name) {
    this.style_class = name;
  }

  add_style_class_name(name) {
    if (!this.style_class.includes(name)) {
      this.style_class += ` ${name}`;
    }
  }

  remove_style_class_name(name) {
    this.style_class = this.style_class.replace(name, "").trim();
  }

  show() {
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  destroy() {
    this._destroyed = true;
  }

  set_size(width, height) {
    this.width = width;
    this.height = height;
  }

  set_position(x, y) {
    this.x = x;
    this.y = y;
  }

  get_parent() {
    return this._parent || null;
  }

  get_theme_node() {
    return {
      get_border_radius: () => 18,
      get_border_width: () => 3,
    };
  }
}

export class Bin extends Widget {
  constructor(params = {}) {
    super(params);
    this.child = params.child || null;
    this.children = [];
  }

  set_child(child) {
    this.child = child;
  }

  get_child() {
    return this.child;
  }

  add_child(child) {
    this.children.push(child);
    child._parent = this;
  }

  remove_child(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child._parent = null;
    }
  }

  get_children() {
    return this.children;
  }

  get_child_at_index(index) {
    return this.children[index] || null;
  }

  contains(child) {
    return this.children.includes(child);
  }
}

export class BoxLayout extends Widget {
  constructor(params = {}) {
    super(params);
    this.children = [];
    this.vertical = params.vertical || false;
  }

  add_child(child) {
    this.children.push(child);
    child._parent = this;
  }

  remove_child(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child._parent = null;
    }
  }

  get_children() {
    return this.children;
  }

  get_child_at_index(index) {
    return this.children[index] || null;
  }

  contains(child) {
    return this.children.includes(child);
  }
}

export class Label extends Widget {
  constructor(params = {}) {
    super(params);
    this.text = params.text || "";
  }

  get_text() {
    return this.text;
  }

  set_text(text) {
    this.text = text;
  }
}

export class Button extends Widget {
  constructor(params = {}) {
    super(params);
    this.label = params.label || "";
  }
}

export class ThemeContext {
  static get_for_stage(stage) {
    return new ThemeContext();
  }

  get_theme() {
    return {
      load_stylesheet: () => {},
      unload_stylesheet: () => {},
    };
  }

  get scale_factor() {
    return 1;
  }
}

export class Icon extends Widget {
  constructor(params = {}) {
    super(params);
    this.gicon = params.gicon || null;
    this.icon_name = params.icon_name || "";
    this.icon_size = params.icon_size || 16;
  }
}

export default {
  Widget,
  Bin,
  BoxLayout,
  Label,
  Button,
  ThemeContext,
  Icon,
  Corner,
};
