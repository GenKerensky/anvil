/**
 * Sidecar types for `lib/css/index.ts` — a vendored CSS parser (reworkcss/css).
 *
 * These mirror the `@types/css` AST node shapes exactly so that both the
 * parser and its consumers have proper types without relying on ambient
 * declaration packages (which don't resolve under moduleResolution: NodeNext).
 */

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

/** Options accepted by parse() */
export interface ParseOptions {
  /** Identifier used in error messages, e.g. a filename. */
  source?: string;
  /** Collect parse errors into `parsingErrors` instead of throwing. */
  silent?: boolean;
}

/** A source location point (1-based line/column). */
export interface SourcePoint {
  line: number;
  column: number;
}

/** A parsing error — an Error augmented with CSS source context. */
export interface ParseError extends Error {
  reason: string;
  filename: string | undefined;
  line: number;
  column: number;
  source: string;
}

// ---------------------------------------------------------------------------
// AST Node types (mirroring @types/css shape exactly)
// ---------------------------------------------------------------------------

/** 1-based source position.  Both coordinates are always set by the parser. */
export interface Position {
  line: number;
  column: number;
}

/** Base AST Tree Node. */
export interface BaseNode {
  /** Discriminator — every concrete node type narrows this to a literal. */
  type: string;
  /** A reference to the parent node set by addParent(). */
  parent?: Node;
  /** Source position information. */
  position?: {
    start: Position;
    end: Position;
    source?: string;
    content?: string;
  };
}

// -----------------------------------------------------------------------
// Leaf / rule nodes
// -----------------------------------------------------------------------

export interface Rule extends BaseNode {
  type: "rule";
  selectors?: string[];
  declarations?: Array<Declaration | Comment>;
}

export interface Declaration extends BaseNode {
  type: "declaration";
  property?: string;
  value?: string;
}

export interface Comment extends BaseNode {
  type: "comment";
  comment?: string;
}

// -----------------------------------------------------------------------
// At-rules
// -----------------------------------------------------------------------

export interface Charset extends BaseNode {
  type: "charset";
  charset?: string;
}

export interface CustomMedia extends BaseNode {
  type: "custom-media";
  name?: string;
  media?: string;
}

export interface Document extends BaseNode {
  type: "document";
  document?: string;
  vendor?: string;
  rules?: Array<Rule | Comment | AtRule>;
}

export interface FontFace extends BaseNode {
  type: "font-face";
  declarations?: Array<Declaration | Comment>;
}

export interface Host extends BaseNode {
  type: "host";
  rules?: Array<Rule | Comment | AtRule>;
}

export interface Import extends BaseNode {
  type: "import";
  import?: string;
}

export interface KeyFrames extends BaseNode {
  type: "keyframes";
  name?: string;
  vendor?: string;
  keyframes?: Array<KeyFrame | Comment>;
}

export interface KeyFrame extends BaseNode {
  type: "keyframe";
  values?: string[];
  declarations?: Array<Declaration | Comment>;
}

export interface Media extends BaseNode {
  type: "media";
  media?: string;
  rules?: Array<Rule | Comment | AtRule>;
}

export interface Namespace extends BaseNode {
  type: "namespace";
  namespace?: string;
}

export interface Page extends BaseNode {
  type: "page";
  selectors?: string[];
  declarations?: Array<Declaration | Comment>;
}

export interface Supports extends BaseNode {
  type: "supports";
  supports?: string;
  rules?: Array<Rule | Comment | AtRule>;
}

// -----------------------------------------------------------------------
// Union types
// -----------------------------------------------------------------------

/** All at-rule node types. */
export type AtRule =
  | Charset
  | CustomMedia
  | Document
  | FontFace
  | Host
  | Import
  | KeyFrames
  | Media
  | Namespace
  | Page
  | Supports;

/** All possible AST node types. */
export type Node = Rule | Declaration | Comment | AtRule | KeyFrame | Stylesheet;

/** A collection of rules inside a stylesheet. */
export interface StyleRules {
  /** The source identifier, e.g. a filename. */
  source?: string;
  rules: Array<Rule | Comment | AtRule>;
  parsingErrors?: ParseError[];
}

/** The root node returned by parse(). */
export interface Stylesheet extends BaseNode {
  type: "stylesheet";
  stylesheet: StyleRules;
}

// -----------------------------------------------------------------------
// Stringify options (mirrors @types/css StringifyOptions)
// -----------------------------------------------------------------------

export interface StringifyOptions {
  indent?: string;
  compress?: boolean;
  sourcemap?: string;
  inputSourcemaps?: boolean;
}
