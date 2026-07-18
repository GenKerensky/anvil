export const FontSlant = {
  NORMAL: 0,
  ITALIC: 1,
  OBLIQUE: 2,
};

export const FontWeight = {
  NORMAL: 0,
  BOLD: 1,
};

class Context {
  constructor() {
    this._state = {};
  }

  setSourceRGBA(r, g, b, a) {
    this._state.fillRGBA = { r, g, b, a };
    this._state.sources ??= [];
    this._state.sources.push({ r, g, b, a });
  }

  newSubPath() {
    this._state.newSubPaths = (this._state.newSubPaths ?? 0) + 1;
  }

  arc(x, y, radius, angle1, angle2) {
    this._state.arcs ??= [];
    this._state.arcs.push({ x, y, radius, angle1, angle2 });
  }

  closePath() {
    this._state.closedPaths = (this._state.closedPaths ?? 0) + 1;
  }

  save() {
    this._state.saved = (this._state.saved ?? 0) + 1;
  }

  restore() {
    this._state.restored = (this._state.restored ?? 0) + 1;
  }

  clip() {
    this._state.clipped = (this._state.clipped ?? 0) + 1;
  }

  rectangle(x, y, w, h) {
    this._state.rect = { x, y, w, h };
  }

  fill() {
    this._state.filled = true;
  }

  stroke() {
    this._state.stroked = true;
  }

  setLineWidth(w) {
    this._state.lineWidth = w;
  }

  moveTo(x, y) {
    this._state.pos = { x, y };
  }

  showText(text) {
    this._state.text = text;
  }

  textExtents(text) {
    return { x: 0, y: 0, width: text.length * 7, height: 14, xAdvance: 7, yAdvance: 14 };
  }

  setFontSize(size) {
    this._state.fontSize = size;
  }

  selectFontFace(family, slant, weight) {
    this._state.fontFace = { family, slant, weight };
  }
}

export { Context };

export default {
  Context,
  FontSlant,
  FontWeight,
};
