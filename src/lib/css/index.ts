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

// http://www.w4.org/TR/CSS21/grammar.html
// https://github.com/visionmedia/css-parse/pull/50#issuecomment-30088027
const commentre = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g;

// Internal types
import type {
  ParseOptions,
  SourcePoint,
  ParseError,
  StringifyOptions,
  Stylesheet,
  BaseNode,
  Node,
  Rule,
  Declaration,
  Comment,
  FontFace,
  KeyFrames,
  KeyFrame,
  Media,
  Supports,
  Document,
  Page,
  Host,
  CustomMedia,
  Import,
  Charset,
  Namespace,
  AtRule,
} from "./types.js";

/**
 * Union of all node types that can appear directly in a stylesheet's
 * top-level `rules` array (the return type of `rules()`).
 */
type StylesheetChild = Rule | Comment | AtRule;

/**
 * Union of all at-rule node types returned by the parser.
 * (KeyFrame is NOT an at-rule — it lives inside `keyframes` arrays.)
 */
type AtRuleNode =
  | KeyFrames
  | Media
  | CustomMedia
  | Supports
  | Import
  | Charset
  | Namespace
  | Document
  | Page
  | Host
  | FontFace;

/**
 * Nodes that can appear in a `declarations` list (declaration or comment).
 */
type DeclChild = Declaration | Comment;

/**
 * Nodes that can appear in a `keyframes` list.
 */
type KeyframeChild = KeyFrame | Comment;

/**
 * All parser-internal return values: a concrete node, `false` (no match),
 * or `undefined` (consumed but no node produced, e.g. error).
 */
type ParseResult<T> = T | false | undefined;

export function parse(css: string, options: ParseOptions = {}): Stylesheet {
  let _css = css;

  /**
   * Positional.
   */

  let lineno = 1;
  let column = 1;

  /**
   * Update lineno and column based on `str`.
   */
  function updatePosition(str: string): void {
    const lines = str.match(/\n/g);
    if (lines) lineno += lines.length;
    const i = str.lastIndexOf("\n");
    column = ~i ? str.length - i : column + str.length;
  }

  /**
   * Mark position and patch `node.position`.
   */
  function position(): <T>(node: T) => T {
    const start: SourcePoint = { line: lineno, column: column };
    return function <U>(node: U): U {
      (node as BaseNode).position = new Position(start);
      whitespace();
      return node;
    };
  }

  /**
   * Store position information for a node
   */

  class Position {
    /** Non-enumerable source string. Initialised below. */
    content!: string;

    start: SourcePoint;
    end: SourcePoint;
    source: string | undefined;

    constructor(start: SourcePoint) {
      this.start = start;
      this.end = { line: lineno, column: column };
      this.source = options.source;
    }
  }

  /**
   * Error `msg`.  Logs the error and returns `undefined` so that callers
   * that `return error(...)` produce the same falsy sentinel as the old
   * "return error()" pattern without actually returning the throw-site.
   */
  const errorsList: ParseError[] = [];

  function error(msg: string): undefined {
    const err: ParseError = new Error(
      (options.source ?? "") + ":" + lineno + ":" + column + ": " + msg
    ) as ParseError;
    err.reason = msg;
    err.filename = options.source;
    err.line = lineno;
    err.column = column;
    err.source = css;

    if (options.silent) {
      errorsList.push(err);
      return;
    }
    throw err;
  }

  /**
   * Parse stylesheet.
   */
  function stylesheet(): Stylesheet {
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
  function open(): RegExpExecArray | undefined {
    return match(/^{\s*/);
  }

  /**
   * Closing brace.
   */
  function close(): RegExpExecArray | undefined {
    return match(/^}/);
  }

  /**
   * Parse ruleset.
   */
  function rules(): StylesheetChild[] {
    let node: AtRuleNode | Rule | false | undefined;
    const rules: StylesheetChild[] = [];
    whitespace();
    comments(rules);
    while (_css.length && _css.charAt(0) !== "}" && (node = atrule() || rule())) {
      if (node) {
        rules.push(node);
        comments(rules);
      }
    }
    return rules;
  }

  /**
   * Match `re` and return captures.
   */
  function match(re: RegExp): RegExpExecArray | undefined {
    const m = re.exec(_css);
    if (!m) return;
    const str = m[0];
    updatePosition(str);
    _css = _css.slice(str.length);
    return m;
  }

  /**
   * Parse whitespace.
   */
  function whitespace(): void {
    match(/^\s*/);
  }

  /**
   * Parse comments;
   */
  function comments(rules?: StylesheetChild[]): StylesheetChild[] {
    rules ||= [];
    let c: Comment | undefined;
    while ((c = comment())) {
      rules.push(c);
    }
    return rules;
  }

  /**
   * Parse comment.
   */
  function comment(): Comment | undefined {
    const pos = position();
    if ("/" !== _css.charAt(0) || "*" !== _css.charAt(1)) return;

    let i = 2;
    while ("" !== _css.charAt(i) && ("*" !== _css.charAt(i) || "/" !== _css.charAt(i + 1))) ++i;
    i += 2;

    if ("" === _css.charAt(i - 1)) {
      error("End of comment missing");
      return;
    }

    const str = _css.slice(2, i - 2);
    column += 2;
    updatePosition(str);
    _css = _css.slice(i);
    column += 2;

    return pos({
      type: "comment",
      comment: str,
    });
  }

  /**
   * Parse selector.
   */
  function selector(): string[] | undefined {
    const m = match(/^([^{]+)/);
    if (!m) return;
    /* @fix Remove all comments from selectors
     * http://ostermiller.org/findcomment.html */
    return m[0]
      .trim()
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
  function declaration(): Declaration | undefined {
    const pos = position();

    // prop
    const propMatch = match(/^(\*?[-#/*\\\w]+(\[[0-9a-z_-]+\])?)\s*/);
    if (!propMatch) return;
    const prop = propMatch[1].trim();

    // :
    if (!match(/^:\s*/)) {
      error("property missing ':'");
      return;
    }

    // val
    const valMatch = match(/^((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^)]*?\)|[^};])+)/);

    // ;
    match(/^[;\s]*/);

    return pos({
      type: "declaration",
      property: prop.replace(commentre, ""),
      value: valMatch ? valMatch[1].trim().replace(commentre, "") : "",
    });
  }

  /**
   * Parse declarations.
   */
  function declarations(): DeclChild[] {
    const decls: DeclChild[] = [];

    if (!open()) {
      error("missing '{'");
      return decls;
    }
    commentsForDecls(decls);

    // declarations
    let decl: Declaration | undefined;
    while ((decl = declaration())) {
      decls.push(decl);
      commentsForDecls(decls);
    }

    if (!close()) {
      error("missing '}'");
    }
    return decls;
  }

  /**
   * Parse comments into a declarations-style list (Declaration | Comment).
   * This is the same as `comments()` but pushes into a `DeclChild[]`.
   */
  function commentsForDecls(rules?: DeclChild[]): DeclChild[] {
    rules ||= [];
    let c: Comment | undefined;
    while ((c = comment())) {
      rules.push(c);
    }
    return rules;
  }

  /**
   * Parse keyframe.
   */
  function keyframe(): KeyFrame | undefined {
    const vals: string[] = [];
    const pos = position();

    let m: RegExpExecArray | undefined;
    while ((m = match(/^((\d+\.\d+|\.\d+|\d+)%?|[a-z]+)\s*/))) {
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
  function atkeyframes(): KeyFrames | undefined {
    const pos = position();
    let m = match(/^@([-\w]+)?keyframes\s*/);

    if (!m) return;
    const vendor = m[1];

    // identifier
    m = match(/^([-\w]+)\s*/);
    if (!m) {
      error("@keyframes missing name");
      return;
    }
    const name = m[1];

    if (!open()) {
      error("@keyframes missing '{'");
      return;
    }

    let frames: KeyframeChild[] = commentsForKeyframes();
    let frame: KeyFrame | undefined;
    while ((frame = keyframe())) {
      frames.push(frame);
      frames = frames.concat(commentsForKeyframes());
    }

    if (!close()) {
      error("@keyframes missing '}'");
      return;
    }

    return pos({
      type: "keyframes",
      name: name,
      vendor: vendor,
      keyframes: frames,
    });
  }

  /** Comments helper that returns `KeyframeChild[]`. */
  function commentsForKeyframes(rules?: KeyframeChild[]): KeyframeChild[] {
    rules ||= [];
    let c: Comment | undefined;
    while ((c = comment())) {
      rules.push(c);
    }
    return rules;
  }

  /**
   * Parse supports.
   */
  function atsupports(): Supports | undefined {
    const pos = position();
    const m = match(/^@supports *([^{]+)/);

    if (!m) return;
    const supports = m[1].trim();

    if (!open()) {
      error("@supports missing '{'");
      return;
    }

    const style: StylesheetChild[] = comments().concat(rules());

    if (!close()) {
      error("@supports missing '}'");
      return;
    }

    return pos({
      type: "supports",
      supports: supports,
      rules: style,
    });
  }

  /**
   * Parse host.
   */
  function athost(): Host | undefined {
    const pos = position();
    const m = match(/^@host\s*/);

    if (!m) return;

    if (!open()) {
      error("@host missing '{'");
      return;
    }

    const style: StylesheetChild[] = comments().concat(rules());

    if (!close()) {
      error("@host missing '}'");
      return;
    }

    return pos({
      type: "host",
      rules: style,
    });
  }

  /**
   * Parse media.
   */
  function atmedia(): Media | undefined {
    const pos = position();
    const m = match(/^@media *([^{]+)/);

    if (!m) return;
    const media = m[1].trim();

    if (!open()) {
      error("@media missing '{'");
      return;
    }

    const style: StylesheetChild[] = comments().concat(rules());

    if (!close()) {
      error("@media missing '}'");
      return;
    }

    return pos({
      type: "media",
      media: media,
      rules: style,
    });
  }

  /**
   * Parse custom-media.
   */
  function atcustommedia(): CustomMedia | undefined {
    const pos = position();
    const m = match(/^@custom-media\s+(--[^\s]+)\s*([^{;]+);/);
    if (!m) return;

    return pos({
      type: "custom-media",
      name: m[1].trim(),
      media: m[2].trim(),
    });
  }

  /**
   * Parse paged media.
   */
  function atpage(): Page | undefined {
    const pos = position();
    const m = match(/^@page */);
    if (!m) return;

    const sel = selector() || [];

    if (!open()) {
      error("@page missing '{'");
      return;
    }
    let decls: DeclChild[] = commentsForDecls();

    // declarations
    let decl: Declaration | undefined;
    while ((decl = declaration())) {
      decls.push(decl);
      decls = decls.concat(commentsForDecls());
    }

    if (!close()) {
      error("@page missing '}'");
      return;
    }

    return pos({
      type: "page",
      selectors: sel,
      declarations: decls,
    });
  }

  /**
   * Parse document.
   */
  function atdocument(): Document | undefined {
    const pos = position();
    const m = match(/^@([-\w]+)?document *([^{]+)/);
    if (!m) return;

    const vendor = m[1].trim();
    const doc = m[2].trim();

    if (!open()) {
      error("@document missing '{'");
      return;
    }

    const style: StylesheetChild[] = comments().concat(rules());

    if (!close()) {
      error("@document missing '}'");
      return;
    }

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
  function atfontface(): FontFace | undefined {
    const pos = position();
    const m = match(/^@font-face\s*/);
    if (!m) return;

    if (!open()) {
      error("@font-face missing '{'");
      return;
    }
    let decls: DeclChild[] = commentsForDecls();

    // declarations
    let decl: Declaration | undefined;
    while ((decl = declaration())) {
      decls.push(decl);
      decls = decls.concat(commentsForDecls());
    }

    if (!close()) {
      error("@font-face missing '}'");
      return;
    }

    return pos({
      type: "font-face",
      declarations: decls,
    });
  }

  /**
   * Parse import
   */
  const atimport = _compileAtrule("import") as () => Import | undefined;

  /**
   * Parse charset
   */
  const atcharset = _compileAtrule("charset") as () => Charset | undefined;

  /**
   * Parse namespace
   */
  const atnamespace = _compileAtrule("namespace") as () => Namespace | undefined;

  /**
   * Parse non-block at-rules
   */
  function _compileAtrule(name: string): () => ParseResult<Import | Charset | Namespace> {
    const re = new RegExp("^@" + name + "\\s*([^;]+);");
    return function () {
      const pos = position();
      const m = match(re);
      if (!m) return;
      const ret = { type: name } as Record<string, string>;
      ret[name] = m[1].trim();
      return pos(ret as unknown as Import | Charset | Namespace);
    };
  }

  /**
   * Parse at rule.
   */
  function atrule(): AtRuleNode | undefined {
    if (_css[0] !== "@") return;

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
  function rule(): Rule | undefined {
    const pos = position();
    const sel = selector();

    if (!sel) {
      error("selector missing");
      return;
    }
    comments();

    return pos({
      type: "rule",
      selectors: sel,
      declarations: declarations(),
    });
  }

  // Wire up the position object's content field now that we're inside parse().
  Position.prototype.content = css;

  return addParent(stylesheet()) as Stylesheet;
}

/**
 * Adds non-enumerable parent node reference to each node.
 */

export function addParent(obj: unknown, parent?: Node | null): unknown {
  const isNode =
    obj && typeof obj === "object" && typeof (obj as Record<string, unknown>).type === "string";
  const childParent = isNode ? (obj as Node) : parent;

  for (const k in obj as Record<string, unknown>) {
    const value = (obj as Record<string, unknown>)[k];
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
  indentation: string;
  level: number = 1;

  constructor(options: StringifyOptions = {}) {
    this.indentation = typeof options.indent === "string" ? options.indent : "  ";
  }

  emit(str: string, _pos?: { start?: { line?: number; column?: number } }): string {
    return str;
  }

  visit(node: Node | Comment): string {
    const v = this[node.type as keyof this] as (n: Node | Comment) => string;
    return v.call(this, node);
  }

  mapVisit(nodes: (Node | Comment)[], delim?: string): string {
    let buf = "";
    delim ||= "";

    for (let i = 0, length = nodes.length; i < length; i++) {
      buf += this.visit(nodes[i]);
      if (delim && i < length - 1) buf += this.emit(delim);
    }

    return buf;
  }

  compile(node: Stylesheet): string {
    return this.stylesheet(node);
  }

  stylesheet(node: Stylesheet): string {
    return this.mapVisit(node.stylesheet.rules, "\n\n");
  }

  comment(node: Comment): string {
    return this.emit(this.indent() + "/*" + (node.comment ?? "") + "*/");
  }

  import(node: Import): string {
    return this.emit("@import " + (node.import ?? "") + ";");
  }

  media(node: Media): string {
    return (
      this.emit("@media " + (node.media ?? "")) +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(node.rules ?? [], "\n\n") +
      this.emit(this.indent(-1) + "\n}")
    );
  }

  document(node: Document): string {
    const doc = "@" + (node.vendor ?? "") + "document " + (node.document ?? "");

    return (
      this.emit(doc) +
      this.emit(" " + " {\n" + this.indent(1)) +
      this.mapVisit(node.rules ?? [], "\n\n") +
      this.emit(this.indent(-1) + "\n}")
    );
  }

  charset(node: Charset): string {
    return this.emit("@charset " + (node.charset ?? "") + ";");
  }

  namespace(node: Namespace): string {
    return this.emit("@namespace " + (node.namespace ?? "") + ";");
  }

  supports(node: Supports): string {
    return (
      this.emit("@supports " + (node.supports ?? "")) +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(node.rules ?? [], "\n\n") +
      this.emit(this.indent(-1) + "\n}")
    );
  }

  keyframes(node: KeyFrames): string {
    return (
      this.emit("@" + (node.vendor ?? "") + "keyframes " + (node.name ?? "")) +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(node.keyframes ?? [], "\n") +
      this.emit(this.indent(-1) + "}")
    );
  }

  keyframe(node: KeyFrame): string {
    const decls = node.declarations ?? [];

    return (
      this.emit(this.indent()) +
      this.emit((node.values ?? []).join(", ")) +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(decls, "\n") +
      this.emit(this.indent(-1) + "\n" + this.indent() + "}\n")
    );
  }

  page(node: Page): string {
    const sel = (node.selectors ?? []).length ? node.selectors!.join(", ") + " " : "";

    return (
      this.emit("@page " + sel) +
      this.emit("{\n") +
      this.emit(this.indent(1)) +
      this.mapVisit(node.declarations ?? [], "\n") +
      this.emit(this.indent(-1)) +
      this.emit("\n}")
    );
  }

  "font-face"(node: FontFace): string {
    return (
      this.emit("@font-face ") +
      this.emit("{\n") +
      this.emit(this.indent(1)) +
      this.mapVisit(node.declarations ?? [], "\n") +
      this.emit(this.indent(-1)) +
      this.emit("\n}")
    );
  }

  host(node: Host): string {
    return (
      this.emit("@host") +
      this.emit(" {\n" + this.indent(1)) +
      this.mapVisit(node.rules ?? [], "\n\n") +
      this.emit(this.indent(-1) + "\n}")
    );
  }

  "custom-media"(node: CustomMedia): string {
    return this.emit("@custom-media " + (node.name ?? "") + " " + (node.media ?? "") + ";");
  }

  rule(node: Rule): string {
    const indent = this.indent();
    const decls = node.declarations ?? [];
    if (!decls.length) return "";

    return (
      this.emit(
        (node.selectors ?? [])
          .map(function (s: string) {
            return indent + s;
          })
          .join(",\n")
      ) +
      this.emit(" {\n") +
      this.emit(this.indent(1)) +
      this.mapVisit(decls, "\n") +
      this.emit(this.indent(-1)) +
      this.emit("\n" + this.indent() + "}")
    );
  }

  declaration(node: Declaration): string {
    return (
      this.emit(this.indent()) +
      this.emit((node.property ?? "") + ": " + (node.value ?? "")) +
      this.emit(";")
    );
  }

  indent(level?: number | null): string {
    this.level = this.level || 1;

    if (level != null) {
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

export function stringify(stylesheet: Stylesheet, options?: StringifyOptions): string {
  const compiler = new Compiler(options ?? {});
  return compiler.compile(stylesheet);
}
