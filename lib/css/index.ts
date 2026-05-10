// @ts-nocheck
// Credits: https://github.com/reworkcss/css/tree/master/lib/parse
//
// Copyright (c) 2012 TJ Holowaychuk <tj@vision-media.ca>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// Anvil (2026): modified while{} loop declarations on some lines to reduce errors on logging

// http://www.w3.org/TR/CSS21/grammar.html
// https://github.com/visionmedia/css-parse/pull/49#issuecomment-30088027
const commentre = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g;

export function parse(css, options) {
  options = options || {};

  /**
   * Positional.
   */

  let lineno = 1;
  let column = 1;

  /**
   * Update lineno and column based on `str`.
   */

  function updatePosition(str) {
    const lines = str.match(/\n/g);
    if (lines) lineno += lines.length;
    const i = str.lastIndexOf("\n");
    column = ~i ? str.length - i : column + str.length;
  }

  /**
   * Mark position and patch `node.position`.
   */

  function position() {
    const start = { line: lineno, column: column };
    return function (node) {
      node.position = new Position(start);
      whitespace();
      return node;
    };
  }

  /**
   * Store position information for a node
   */

  class Position {
    /**
     * Non-enumerable source string
     */
    content = css;

    constructor(start) {
      this.start = start;
      this.end = { line: lineno, column: column };
      this.source = options.source;
    }
  }

  /**
   * Error `msg`.
   */

  const errorsList = [];

  function error(msg) {
    const err = /** @type {any} */ new Error(
      options.source + ":" + lineno + ":" + column + ": " + msg
    );
    err.reason = msg;
    err.filename = options.source;
    err.line = lineno;
    err.column = column;
    err.source = css;

    if (options.silent) {
      errorsList.push(err);
    } else {
      throw err;
    }
  }

  /**
   * Parse stylesheet.
   */

  function stylesheet() {
    const rulesList = rules();

    return {
      type: "stylesheet",
      stylesheet: {
        source: options.source,
        rules: rulesList,
        parsingErrors: errorsList,
      },
    };
  }

  /**
   * Opening brace.
   */

  function open() {
    return match(/^{\s*/);
  }

  /**
   * Closing brace.
   */

  function close() {
    return match(/^}/);
  }

  /**
   * Parse ruleset.
   */

  function rules() {
    let node;
    const rules = [];
    whitespace();
    comments(rules);
    while (css.length && css.charAt(0) != "}" && (node = atrule() || rule())) {
      if (node !== false) {
        rules.push(node);
        comments(rules);
      }
    }
    return rules;
  }

  /**
   * Match `re` and return captures.
   */

  function match(re) {
    const m = re.exec(css);
    if (!m) return;
    const str = m[0];
    updatePosition(str);
    css = css.slice(str.length);
    return m;
  }

  /**
   * Parse whitespace.
   */

  function whitespace() {
    match(/^\s*/);
  }

  /**
   * Parse comments;
   */

  function comments(rules) {
    rules = rules || [];
    for (var c; (c = comment()); ) {
      if (c !== false) {
        rules.push(c);
      }
    }
    return rules;
  }

  /**
   * Parse comment.
   */

  function comment() {
    const pos = position();
    if ("/" != css.charAt(0) || "*" != css.charAt(1)) return;

    let i = 2;
    while ("" != css.charAt(i) && ("*" != css.charAt(i) || "/" != css.charAt(i + 1))) ++i;
    i += 2;

    if ("" === css.charAt(i - 1)) {
      return error("End of comment missing");
    }

    const str = css.slice(2, i - 2);
    column += 2;
    updatePosition(str);
    css = css.slice(i);
    column += 2;

    return pos({
      type: "comment",
      comment: str,
    });
  }

  /**
   * Parse selector.
   */

  function selector() {
    const m = match(/^([^{]+)/);
    if (!m) return;
    /* @fix Remove all comments from selectors
     * http://ostermiller.org/findcomment.html */
    return trim(m[0])
      .replace(/\/\*([^*]|[\r\n]|(\*+([^*/]|[\r\n])))*\*\/+/g, "")
      .replace(/"(?:\\"|[^"])*"|'(?:\\'|[^'])*'/g, function (m) {
        return m.replace(/,/g, "\u200C");
      })
      .split(/\s*(?![^(]*\)),\s*/)
      .map(function (s) {
        return s.replace(/\u200C/g, ",");
      });
  }

  /**
   * Parse declaration.
   */

  function declaration() {
    const pos = position();

    // prop
    let prop = match(/^(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/);
    if (!prop) return;
    prop = trim(prop[0]);

    // :
    if (!match(/^:\s*/)) return error("property missing ':'");

    // val
    const val = match(/^((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^)]*?\)|[^};])+)/);

    const ret = pos({
      type: "declaration",
      property: prop.replace(commentre, ""),
      value: val ? trim(val[0]).replace(commentre, "") : "",
    });

    // ;
    match(/^[;\s]*/);

    return ret;
  }

  /**
   * Parse declarations.
   */

  function declarations() {
    const decls = [];

    if (!open()) return error("missing '{'");
    comments(decls);

    // declarations
    for (var decl; (decl = declaration()); ) {
      if (decl !== false) {
        decls.push(decl);
        comments(decls);
      }
    }

    if (!close()) return error("missing '}'");
    return decls;
  }

  /**
   * Parse keyframe.
   */

  function keyframe() {
    const vals = [];
    const pos = position();

    for (var m; (m = match(/^((\d+\.\d+|\.\d+|\d+)%?|[a-z]+)\s*/)); ) {
      vals.push(m[1]);
      match(/^,\s*/);
    }

    if (!vals.length) return;

    return pos({
      type: "keyframe",
      values: vals,
      declarations: declarations(),
    });
  }

  /**
   * Parse keyframes.
   */

  function atkeyframes() {
    const pos = position();
    let m = match(/^@([-\w]+)?keyframes\s*/);

    if (!m) return;
    const vendor = m[1];

    // identifier
    m = match(/^([-\w]+)\s*/);
    if (!m) return error("@keyframes missing name");
    const name = m[1];

    if (!open()) return error("@keyframes missing '{'");

    let frames = comments();
    for (var frame; (frame = keyframe()); ) {
      frames.push(frame);
      frames = frames.concat(comments());
    }

    if (!close()) return error("@keyframes missing '}'");

    return pos({
      type: "keyframes",
      name: name,
      vendor: vendor,
      keyframes: frames,
    });
  }

  /**
   * Parse supports.
   */

  function atsupports() {
    const pos = position();
    const m = match(/^@supports *([^{]+)/);

    if (!m) return;
    const supports = trim(m[1]);

    if (!open()) return error("@supports missing '{'");

    const style = comments().concat(rules());

    if (!close()) return error("@supports missing '}'");

    return pos({
      type: "supports",
      supports: supports,
      rules: style,
    });
  }

  /**
   * Parse host.
   */

  function athost() {
    const pos = position();
    const m = match(/^@host\s*/);

    if (!m) return;

    if (!open()) return error("@host missing '{'");

    const style = comments().concat(rules());

    if (!close()) return error("@host missing '}'");

    return pos({
      type: "host",
      rules: style,
    });
  }

  /**
   * Parse media.
   */

  function atmedia() {
    const pos = position();
    const m = match(/^@media *([^{]+)/);

    if (!m) return;
    const media = trim(m[1]);

    if (!open()) return error("@media missing '{'");

    const style = comments().concat(rules());

    if (!close()) return error("@media missing '}'");

    return pos({
      type: "media",
      media: media,
      rules: style,
    });
  }

  /**
   * Parse custom-media.
   */

  function atcustommedia() {
    const pos = position();
    const m = match(/^@custom-media\s+(--[^\s]+)\s*([^{;]+);/);
    if (!m) return;

    return pos({
      type: "custom-media",
      name: trim(m[1]),
      media: trim(m[2]),
    });
  }

  /**
   * Parse paged media.
   */

  function atpage() {
    const pos = position();
    const m = match(/^@page */);
    if (!m) return;

    const sel = selector() || [];

    if (!open()) return error("@page missing '{'");
    let decls = comments();

    // declarations
    for (var decl; (decl = declaration()); ) {
      decls.push(decl);
      decls = decls.concat(comments());
    }

    if (!close()) return error("@page missing '}'");

    return pos({
      type: "page",
      selectors: sel,
      declarations: decls,
    });
  }

  /**
   * Parse document.
   */

  function atdocument() {
    const pos = position();
    const m = match(/^@([-\w]+)?document *([^{]+)/);
    if (!m) return;

    const vendor = trim(m[1]);
    const doc = trim(m[2]);

    if (!open()) return error("@document missing '{'");

    const style = comments().concat(rules());

    if (!close()) return error("@document missing '}'");

    return pos({
      type: "document",
      document: doc,
      vendor: vendor,
      rules: style,
    });
  }

  /**
   * Parse font-face.
   */

  function atfontface() {
    const pos = position();
    const m = match(/^@font-face\s*/);
    if (!m) return;

    if (!open()) return error("@font-face missing '{'");
    let decls = comments();

    // declarations
    for (var decl; (decl = declaration()); ) {
      decls.push(decl);
      decls = decls.concat(comments());
    }

    if (!close()) return error("@font-face missing '}'");

    return pos({
      type: "font-face",
      declarations: decls,
    });
  }

  /**
   * Parse import
   */

  const atimport = _compileAtrule("import");

  /**
   * Parse charset
   */

  const atcharset = _compileAtrule("charset");

  /**
   * Parse namespace
   */

  const atnamespace = _compileAtrule("namespace");

  /**
   * Parse non-block at-rules
   */

  function _compileAtrule(name) {
    const re = new RegExp("^@" + name + "\\s*([^;]+);");
    return function () {
      const pos = position();
      const m = match(re);
      if (!m) return;
      const ret = { type: name };
      ret[name] = m[1].trim();
      return pos(ret);
    };
  }

  /**
   * Parse at rule.
   */

  function atrule() {
    if (css[0] != "@") return;

    return (
      atkeyframes() ||
      atmedia() ||
      atcustommedia() ||
      atsupports() ||
      atimport() ||
      atcharset() ||
      atnamespace() ||
      atdocument() ||
      atpage() ||
      athost() ||
      atfontface()
    );
  }

  /**
   * Parse rule.
   */

  function rule() {
    const pos = position();
    const sel = selector();

    if (!sel) return error("selector missing");
    comments();

    return pos({
      type: "rule",
      selectors: sel,
      declarations: declarations(),
    });
  }

  return addParent(stylesheet());
}

/**
 * Trim `str`.
 */

export function trim(str) {
  return str ? str.replace(/^\s+|\s+$/g, "") : "";
}

/**
 * Adds non-enumerable parent node reference to each node.
 */

export function addParent(obj, parent) {
  const isNode = obj && typeof obj.type === "string";
  const childParent = isNode ? obj : parent;

  for (const k in obj) {
    const value = obj[k];
    if (Array.isArray(value)) {
      value.forEach(function (v) {
        addParent(v, childParent);
      });
    } else if (value && typeof value === "object") {
      addParent(value, childParent);
    }
  }

  if (isNode) {
    Object.defineProperty(obj, "parent", {
      configurable: true,
      writable: true,
      enumerable: false,
      value: parent || null,
    });
  }

  return obj;
}

// Credits: https://github.com/reworkcss/css/blob/master/lib/stringify
// Anvil: derived the identity.js module only

export class Compiler {
  constructor(options) {
    options ||= {};
    this.indentation = typeof options.indent === "string" ? options.indent : "  ";
  }

  /**
   * Emit `str`
   * @param {string} str
   * @param {any} [_pos]
   */

  emit(str, _pos) {
    return str;
  }

  /**
   * Visit `node`.
   */

  visit(node) {
    return this[node.type](node);
  }

  /**
   * Map visit over array of `nodes`, optionally using a `delim`
   */

  mapVisit(nodes, delim) {
    let buf = "";
    delim = delim || "";

    for (let i = 0, length = nodes.length; i < length; i++) {
      buf += this.visit(nodes[i]);
      if (delim && i < length - 1) buf += this.emit(delim);
    }

    return buf;
  }

  /**
   * Compile `node`.
   */

  compile(node) {
    return this.stylesheet(node);
  }

  /**
   * Visit stylesheet node.
   */

  stylesheet(node) {
    return this.mapVisit(node.stylesheet.rules, "\n\n");
  }

  /**
   * Visit comment node.
   */

  comment(node) {
    return this.emit(this.indent() + "/*" + node.comment + "*/", node.position);
  }

  /**
   * Visit import node.
   */

  import(node) {
    return this.emit("@import " + node.import + ";", node.position);
  }

  /**
   * Visit media node.
   */

  media(node) {
    return (
      this.emit("@media " + node.media, node.position) +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(node.rules, "\n\n") +
      this.emit(this.indent(-1) + "\n}")
    );
  }

  /**
   * Visit document node.
   */

  document(node) {
    const doc = "@" + (node.vendor || "") + "document " + node.document;

    return (
      this.emit(doc, node.position) +
      this.emit(" " + " {\n" + this.indent(1)) +
      this.mapVisit(node.rules, "\n\n") +
      this.emit(this.indent(-1) + "\n}")
    );
  }

  /**
   * Visit charset node.
   */
  charset(node) {
    return this.emit("@charset " + node.charset + ";", node.position);
  }

  /**
   * Visit namespace node.
   */
  namespace(node) {
    return this.emit("@namespace " + node.namespace + ";", node.position);
  }

  /**
   * Visit supports node.
   */

  supports(node) {
    return (
      this.emit("@supports " + node.supports, node.position) +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(node.rules, "\n\n") +
      this.emit(this.indent(-1) + "\n}")
    );
  }

  /**
   * Visit keyframes node.
   */

  keyframes(node) {
    return (
      this.emit("@" + (node.vendor || "") + "keyframes " + node.name, node.position) +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(node.keyframes, "\n") +
      this.emit(this.indent(-1) + "}")
    );
  }

  /**
   * Visit keyframe node.
   */

  keyframe(node) {
    const decls = node.declarations;

    return (
      this.emit(this.indent()) +
      this.emit(node.values.join(", "), node.position) +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(decls, "\n") +
      this.emit(this.indent(-1) + "\n" + this.indent() + "}\n")
    );
  }

  /**
   * Visit page node.
   */

  page(node) {
    const sel = node.selectors.length ? node.selectors.join(", ") + " " : "";

    return (
      this.emit("@page " + sel, node.position) +
      this.emit("{\n") +
      this.emit(this.indent(1)) +
      this.mapVisit(node.declarations, "\n") +
      this.emit(this.indent(-1)) +
      this.emit("\n}")
    );
  }

  /**
   * Visit font-face node.
   */

  ["font-face"] = function (node) {
    const _this = /** @type {any} */ this;
    return (
      _this.emit("@font-face ", node.position) +
      _this.emit("{\n") +
      _this.emit(_this.indent(1)) +
      _this.mapVisit(node.declarations, "\n") +
      _this.emit(_this.indent(-1)) +
      _this.emit("\n}")
    );
  };

  /**
   * Visit host node.
   */

  host(node) {
    return (
      this.emit("@host", node.position) +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(node.rules, "\n\n") +
      this.emit(this.indent(-1) + "\n}")
    );
  }

  /**
   * Visit custom-media node.
   */

  ["custom-media"] = function (node) {
    const _this = /** @type {any} */ this;
    return _this.emit("@custom-media " + node.name + " " + node.media + ";", node.position);
  };

  /**
   * Visit rule node.
   */

  rule(node) {
    const indent = this.indent();
    const decls = node.declarations;
    if (!decls.length) return "";

    return (
      this.emit(
        node.selectors
          .map(function (s) {
            return indent + s;
          })
          .join(",\n"),
        node.position
      ) +
      this.emit(" {\n") +
      this.emit(this.indent(1)) +
      this.mapVisit(decls, "\n") +
      this.emit(this.indent(-1)) +
      this.emit("\n" + this.indent() + "}")
    );
  }

  /**
   * Visit declaration node.
   */

  declaration(node) {
    return (
      this.emit(this.indent()) +
      this.emit(node.property + ": " + node.value, node.position) +
      this.emit(";")
    );
  }

  /**
   * Increase, decrease or return current indentation.
   */

  indent(level) {
    this.level = this.level || 1;

    if (null != level) {
      this.level += level;
      return "";
    }

    return Array(this.level).join(this.indentation);
  }
}

// Credits: https://github.com/reworkcss/css/tree/master/lib/stringify
//
// Copyright (c) 2012 TJ Holowaychuk <tj@vision-media.ca>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.
//
// Anvil (2026): removed unused options

/**
 * Stringfy the given AST `node`.
 *
 * @param {Object} node
 * @param {Object} [_options]
 * @return {String}
 * @api public
 */

export function stringify(node, _options) {
  _options ||= {};
  const compiler = new Compiler(_options);
  const code = compiler.compile(node);
  return code;
}
