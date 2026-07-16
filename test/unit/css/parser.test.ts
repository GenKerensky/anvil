/*
 * CSS parser tests
 *
 * Tests for the third-party CSS parser (reworkcss/css).
 */

import { describe, it, expect } from "vitest";
import { parse, stringify, addParent, Compiler } from "../../../src/lib/css/index.js";
import type {
  Rule,
  Comment,
  AtRule,
  Declaration,
  Media,
  KeyFrames,
  Import,
  Supports,
  FontFace,
} from "../../../src/lib/css/types.js";

function asRule(node: Rule | Comment | AtRule): Rule {
  return node as Rule;
}

function asComment(node: Rule | Comment | AtRule): Comment {
  return node as Comment;
}

function asDeclaration(node: Declaration | Comment): Declaration {
  return node as Declaration;
}

function asMedia(node: Rule | Comment | AtRule): Media {
  return node as Media;
}

function asKeyframes(node: Rule | Comment | AtRule): KeyFrames {
  return node as KeyFrames;
}

function asImport(node: Rule | Comment | AtRule): Import {
  return node as Import;
}

function asSupports(node: Rule | Comment | AtRule): Supports {
  return node as Supports;
}

function asFontFace(node: Rule | Comment | AtRule): FontFace {
  return node as FontFace;
}

describe("CSS Parser", () => {
  describe("parse - basic selectors", () => {
    it("should parse a simple class selector", () => {
      const ast = parse(".foo { color: red; }");
      expect(ast.type).toBe("stylesheet");
      expect(ast.stylesheet.rules).toHaveLength(1);
      expect(ast.stylesheet.rules[0].type).toBe("rule");
      expect(asRule(ast.stylesheet.rules[0]).selectors).toEqual([".foo"]);
    });

    it("should parse an ID selector", () => {
      const ast = parse("#bar { margin: 0; }");
      expect(asRule(ast.stylesheet.rules[0]).selectors).toEqual(["#bar"]);
    });

    it("should parse element selector", () => {
      const ast = parse("div { display: block; }");
      expect(asRule(ast.stylesheet.rules[0]).selectors).toEqual(["div"]);
    });

    it("should parse multiple selectors", () => {
      const ast = parse(".a, .b { color: blue; }");
      expect(asRule(ast.stylesheet.rules[0]).selectors).toEqual([".a", ".b"]);
    });

    it("should parse attribute selectors", () => {
      const ast = parse('input[type="text"] { border: 1px; }');
      expect(asRule(ast.stylesheet.rules[0]).selectors).toEqual(['input[type="text"]']);
    });

    it("should parse pseudo-class selectors", () => {
      const ast = parse("a:hover { text-decoration: underline; }");
      expect(asRule(ast.stylesheet.rules[0]).selectors).toEqual(["a:hover"]);
    });
  });

  describe("parse - declarations", () => {
    it("should parse property and value", () => {
      const ast = parse("a { color: red; }");
      const decl = asDeclaration(asRule(ast.stylesheet.rules[0]).declarations![0]);
      expect(decl.property).toBe("color");
      expect(decl.value).toBe("red");
    });

    it("should parse multiple declarations", () => {
      const ast = parse("a { color: red; margin: 10px; }");
      expect(asRule(ast.stylesheet.rules[0]).declarations!).toHaveLength(2);
    });

    it("should parse numeric values with units", () => {
      const ast = parse("a { width: 100px; height: 50%; }");
      expect(asDeclaration(asRule(ast.stylesheet.rules[0]).declarations![0]).value).toBe("100px");
      expect(asDeclaration(asRule(ast.stylesheet.rules[0]).declarations![1]).value).toBe("50%");
    });

    it("should parse shorthand properties", () => {
      const ast = parse("a { background: url(bg.png) no-repeat center; }");
      expect(asDeclaration(asRule(ast.stylesheet.rules[0]).declarations![0]).value).toBe(
        "url(bg.png) no-repeat center"
      );
    });

    it("should parse quoted string values", () => {
      const ast = parse('a { font-family: "Helvetica Neue", sans-serif; }');
      const val = asDeclaration(asRule(ast.stylesheet.rules[0]).declarations![0]).value;
      expect(val).toContain("Helvetica Neue");
    });

    it("should parse CSS custom properties", () => {
      const ast = parse(":root { --main-color: #333; }");
      const decl = asDeclaration(asRule(ast.stylesheet.rules[0]).declarations![0]);
      expect(decl.property).toBe("--main-color");
    });
  });

  describe("parse - comments", () => {
    it("should parse CSS comments", () => {
      const ast = parse("/* header */ a { color: red; }");
      expect(ast.stylesheet.rules).toHaveLength(2);
      expect(ast.stylesheet.rules[0].type).toBe("comment");
      expect(asComment(ast.stylesheet.rules[0]).comment).toBe(" header ");
    });

    it("should parse empty comments and treat as comment node", () => {
      const ast = parse("/**/ a { color: red; }");
      // Empty comment /**/ is still parsed as a comment node
      const hasComment = ast.stylesheet.rules.some((r) => r.type === "comment");
      expect(hasComment).toBe(true);
    });
  });

  describe("parse - @media", () => {
    it("should parse @media rule with screen", () => {
      const ast = parse("@media screen { .foo { color: red; } }");
      expect(ast.stylesheet.rules[0].type).toBe("media");
      expect(asMedia(ast.stylesheet.rules[0]).media).toBe("screen");
      expect(asMedia(ast.stylesheet.rules[0]).rules).toHaveLength(1);
    });

    it("should parse @media with min-width", () => {
      const ast = parse("@media (min-width: 768px) { .foo { width: 50%; } }");
      expect(asMedia(ast.stylesheet.rules[0]).media).toBe("(min-width: 768px)");
    });

    it("should parse nested rules inside @media", () => {
      const ast = parse("@media print { body { font-size: 12pt; } .no-print { display: none; } }");
      expect(asMedia(ast.stylesheet.rules[0]).rules).toHaveLength(2);
    });
  });

  describe("parse - @keyframes", () => {
    it("should parse @keyframes with from/to", () => {
      const ast = parse("@keyframes slide { from { left: 0; } to { left: 100px; } }");
      const kf = asKeyframes(ast.stylesheet.rules[0]);
      expect(kf.type).toBe("keyframes");
      expect(kf.name).toBe("slide");
      expect(kf.keyframes).toHaveLength(2);
    });

    it("should parse @keyframes with percentage values", () => {
      const ast = parse(
        "@keyframes fade { 0% { opacity: 0; } 50% { opacity: 0.5; } 100% { opacity: 1; } }"
      );
      expect(asKeyframes(ast.stylesheet.rules[0]).keyframes).toHaveLength(3);
    });

    it("should parse vendor-prefixed @keyframes", () => {
      const ast = parse("@-webkit-keyframes spin { to { transform: rotate(360deg); } }");
      expect(asKeyframes(ast.stylesheet.rules[0]).vendor).toBe("-webkit-");
    });
  });

  describe("parse - @font-face", () => {
    it("should parse @font-face rule", () => {
      const ast = parse("@font-face { font-family: 'MyFont'; src: url(myfont.woff2); }");
      const ff = asFontFace(ast.stylesheet.rules[0]);
      expect(ff.type).toBe("font-face");
      expect(ff.declarations!).toHaveLength(2);
    });
  });

  describe("parse - @import", () => {
    it("should parse @import rule", () => {
      const ast = parse('@import url("style.css");');
      expect(ast.stylesheet.rules[0].type).toBe("import");
      expect(asImport(ast.stylesheet.rules[0]).import).toContain("style.css");
    });
  });

  describe("parse - @supports", () => {
    it("should parse @supports rule", () => {
      const ast = parse("@supports (display: grid) { .grid { display: grid; } }");
      expect(ast.stylesheet.rules[0].type).toBe("supports");
      expect(asSupports(ast.stylesheet.rules[0]).supports).toBe("(display: grid)");
    });
  });

  describe("parse - @page", () => {
    it("should parse @page rule", () => {
      const ast = parse("@page { margin: 2cm; }");
      expect(ast.stylesheet.rules[0].type).toBe("page");
    });
  });

  describe("parse - error handling", () => {
    it("should throw on malformed CSS", () => {
      expect(() => parse("a { color: red;")).toThrow();
    });

    it("should parse empty CSS", () => {
      const ast = parse("");
      expect(ast.stylesheet).toBeDefined();
    });

    it("should parse whitespace-only CSS", () => {
      const ast = parse("   \n  ");
      expect(ast.stylesheet.rules).toHaveLength(0);
    });

    it("should throw when selector is missing", () => {
      expect(() => parse("{ color: red; }")).toThrow();
    });
  });

  describe("stringify", () => {
    it("should round-trip simple CSS", () => {
      const css = ".foo { color: red; }";
      const ast = parse(css);
      const output = stringify(ast);
      expect(output).toContain(".foo");
      expect(output).toContain("color: red");
    });

    it("should round-trip @media rules", () => {
      const css = "@media screen { .foo { color: red; } }";
      const ast = parse(css);
      const output = stringify(ast);
      expect(output).toContain("@media screen");
    });

    it("should produce valid CSS with selectors and declarations", () => {
      const css = "a { color: blue; }\n\na:hover { color: red; }";
      const ast = parse(css);
      const output = stringify(ast);
      expect(output).toContain("a {");
      expect(output).toContain("color: blue");
    });
  });

  describe("addParent", () => {
    it("should add parent references to nodes", () => {
      const ast = parse(".foo { color: red; }");
      addParent(ast);
      const rule = ast.stylesheet.rules[0];
      expect(rule.parent).toBeDefined();
      // Parent is the stylesheet-level node (type: "stylesheet"),
      // not the .stylesheet property sub-object
      expect(rule.parent!.type).toBe("stylesheet");
    });
  });

  describe("Compiler", () => {
    it("should create compiler with custom indentation", () => {
      const compiler = new Compiler({ indent: "    " });
      expect(compiler.indentation).toBe("    ");
    });

    it("should use default two-space indentation", () => {
      const compiler = new Compiler();
      expect(compiler.indentation).toBe("  ");
    });
  });
});
