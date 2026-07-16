/*
 * This file is part of the Anvil extension for GNOME
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

// Gnome imports
import Gio from "gi://Gio";
import GObject from "gi://GObject";

// Application imports
import { stringify, parse } from "../css/index.js";
import type { Stylesheet, Rule, Declaration } from "../css/types.js";
import { Logger } from "./logger.js";
import type { ConfigManager } from "./settings.js";
import {
  StylesheetMigrationService,
  type StylesheetMigrationResult,
} from "./stylesheet-migration.js";

interface PaletteColor {
  color: string;
  "border-width": string;
  opacity: string;
}

interface Palette {
  tiled: PaletteColor;
  split: PaletteColor;
  floated: PaletteColor;
  stacked: PaletteColor;
  tabbed: PaletteColor;
}

export class ThemeManagerBase extends GObject.Object {
  static {
    GObject.registerClass(this);
  }

  configMgr!: ConfigManager;
  settings!: Gio.Settings;
  lastMigrationResult: StylesheetMigrationResult | null = null;

  private _migrationService: Pick<StylesheetMigrationService, "initialize">;
  private _defaultPalette: Palette | null = null;
  private _cssAst: Stylesheet | null = null;
  private _defaultCssAst: Stylesheet | null = null;
  private _userCssAst: Stylesheet | null = null;
  private _userStylesheetEtag: string | null = null;

  constructor({
    configMgr,
    settings,
    migrationService,
  }: {
    configMgr: ConfigManager;
    settings: Gio.Settings;
    migrationService?: Pick<StylesheetMigrationService, "initialize">;
  }) {
    super();
    this.configMgr = configMgr;
    this.settings = settings;
    this._migrationService =
      migrationService ?? new StylesheetMigrationService({ configMgr, settings });
  }

  get isStylesheetEditable() {
    return Boolean(this._userCssAst && this.lastMigrationResult?.overrideFile);
  }

  get defaultPalette() {
    if (!this._defaultPalette) {
      throw new Error("Stylesheet palette accessed before successful initialization");
    }
    return this._defaultPalette;
  }

  get cssAst() {
    if (!this._cssAst) {
      throw new Error("Stylesheet AST accessed before successful initialization");
    }
    return this._cssAst;
  }

  /**
   * Selects/migrates stylesheet files and imports their editor state.
   * Construction intentionally performs no file IO.
   */
  initializeStylesheet() {
    const result = this._migrationService.initialize();
    this.lastMigrationResult = result;
    this._defaultPalette = null;
    this._cssAst = null;
    this._defaultCssAst = null;
    this._userCssAst = null;
    this._userStylesheetEtag = null;

    if (result.baseFile) {
      const loaded = this._loadCssAst(result.baseFile, "shipped stylesheet");
      this._defaultCssAst = loaded?.ast ?? null;
    }

    if (result.overrideFile) {
      const loaded = this._loadCssAst(result.overrideFile, "user stylesheet");
      this._userCssAst = loaded?.ast ?? null;
      this._userStylesheetEtag = loaded?.etag ?? null;
    }

    this._cssAst = this._userCssAst ?? this._defaultCssAst;
    if (this._cssAst) this._defaultPalette = this.getDefaultPalette();
    return result;
  }

  addPx(value: string) {
    return `${value}px`;
  }

  removePx(value: string) {
    return value.replace("px", "");
  }

  getDefaultPalette(): Palette {
    return {
      tiled: this.getDefaults("tiled"),
      split: this.getDefaults("split"),
      floated: this.getDefaults("floated"),
      stacked: this.getDefaults("stacked"),
      tabbed: this.getDefaults("tabbed"),
    };
  }

  /**
   * The scheme name is in between the CSS selector name
   * E.g. window-tiled-color should return `tiled`
   */
  getColorSchemeBySelector(selector: string) {
    if (!selector.includes("-")) return null;
    const firstDash = selector.indexOf("-");
    const secondDash = selector.indexOf("-", firstDash + 1);
    const scheme = selector.substr(firstDash + 1, secondDash - firstDash - 1);
    return scheme;
  }

  getDefaults(color: string): PaletteColor {
    return {
      color: this._getCssProperty(`.${color}`, "color", this._defaultCssAst)?.value ?? "",
      "border-width": this.removePx(
        this._getCssProperty(`.${color}`, "border-width", this._defaultCssAst)?.value ?? "0px"
      ),
      opacity: this._getCssProperty(`.${color}`, "opacity", this._defaultCssAst)?.value ?? "1",
    };
  }

  getCssRule(selector: string): Rule | null {
    return (
      this._getCssRule(selector, this._userCssAst) ??
      this._getCssRule(selector, this._defaultCssAst)
    );
  }

  getCssProperty(selector: string, propertyName: string): Declaration | null {
    return (
      this._getCssProperty(selector, propertyName, this._userCssAst) ??
      this._getCssProperty(selector, propertyName, this._defaultCssAst)
    );
  }

  setCssProperty(selector: string, propertyName: string, propertyValue: string) {
    if (!this._userCssAst || !this.lastMigrationResult?.overrideFile) return false;

    const previousCss = stringify(this._userCssAst, undefined);
    let cssRule = this._getCssRule(selector, this._userCssAst);
    if (!cssRule) {
      cssRule = { type: "rule", selectors: [selector], declarations: [] };
      this._userCssAst.stylesheet.rules.push(cssRule);
    }
    let cssProperty = this._getDeclaration(cssRule, propertyName);
    if (!cssProperty) {
      cssProperty = { type: "declaration", property: propertyName, value: propertyValue };
      (cssRule.declarations ??= []).push(cssProperty);
    } else {
      cssProperty.value = propertyValue;
    }

    if (this._updateCss()) return true;

    try {
      this._userCssAst = parse(previousCss, undefined);
      this._cssAst = this._userCssAst;
    } catch (error) {
      Logger.error(`Could not restore stylesheet editor state: ${error}`);
    }
    return false;
  }

  /**
   * Writes the user override with an etag precondition and reloads only after success.
   */
  _updateCss() {
    const cssFile = this.lastMigrationResult?.overrideFile;
    if (!this._userCssAst || !cssFile) return false;

    try {
      const cssContents = stringify(this._userCssAst, undefined);
      const [success, tag] = cssFile.replace_contents(
        cssContents,
        this._userStylesheetEtag,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
      );
      if (success) {
        this._userStylesheetEtag = tag;
        if (!this.reloadStylesheet()) {
          Logger.warn("User stylesheet was saved, but the Shell reload request failed");
        }
        return true;
      }
    } catch (error) {
      Logger.warn(`Could not write user stylesheet: ${error}`);
    }
    return false;
  }

  private _loadCssAst(file: Gio.File, label: string) {
    try {
      const [success, contents, etag] = file.load_contents(null);
      if (!success) return null;
      const cssContents = new TextDecoder().decode(contents as Uint8Array);
      return { ast: parse(cssContents, undefined), etag };
    } catch (error) {
      Logger.warn(`Could not parse ${label}; preserving it without editor writes: ${error}`);
      return null;
    }
  }

  private _getCssRule(selector: string, ast: Stylesheet | null): Rule | null {
    if (!ast) return null;
    const rule = ast.stylesheet.rules.find(
      (candidate) =>
        candidate.type === "rule" &&
        (candidate as Rule).selectors?.some((candidateSelector) => candidateSelector === selector)
    );
    return rule?.type === "rule" ? (rule as Rule) : null;
  }

  private _getDeclaration(rule: Rule, propertyName: string): Declaration | null {
    const declaration = (rule.declarations ?? []).find(
      (candidate) =>
        candidate.type === "declaration" && (candidate as Declaration).property === propertyName
    );
    return declaration?.type === "declaration" ? (declaration as Declaration) : null;
  }

  private _getCssProperty(
    selector: string,
    propertyName: string,
    ast: Stylesheet | null
  ): Declaration | null {
    const rule = this._getCssRule(selector, ast);
    return rule ? this._getDeclaration(rule, propertyName) : null;
  }

  /** Credits: ExtensionSystem.js:_callExtensionEnable(). */
  reloadStylesheet(): boolean {
    throw new Error("Must implement reloadStylesheet");
  }
}

/**
 * Credits: Color Space conversion functions from CSS Tricks
 * https://css-tricks.com/converting-color-spaces-in-javascript/
 */
export function RGBAToHexA(rgba: string) {
  const sep = rgba.indexOf(",") > -1 ? "," : " ";
  const vals: (string | number)[] = rgba.substr(5).split(")")[0].split(sep);

  // Strip the slash if using space-separated syntax
  if (vals.indexOf("/") > -1) vals.splice(3, 1);

  for (let R = 0; R < vals.length; R++) {
    const r = vals[R];
    if (typeof r === "string" && r.indexOf("%") > -1) {
      const p = Number(r.substring(0, r.length - 1)) / 100;

      if (R < 3) {
        vals[R] = Math.round(p * 255);
      } else {
        vals[R] = p;
      }
    }
  }
  let r = (+vals[0]).toString(16),
    g = (+vals[1]).toString(16),
    b = (+vals[2]).toString(16),
    a = Math.round(+vals[3] * 255).toString(16);

  if (r.length == 1) r = "0" + r;
  if (g.length == 1) g = "0" + g;
  if (b.length == 1) b = "0" + b;
  if (a.length == 1) a = "0" + a;

  return "#" + r + g + b + a;
}

export function hexAToRGBA(h: string) {
  let r = 0,
    g = 0,
    b = 0,
    a = 1;

  if (h.length == 5) {
    r = Number("0x" + h[1] + h[1]);
    g = Number("0x" + h[2] + h[2]);
    b = Number("0x" + h[3] + h[3]);
    a = Number("0x" + h[4] + h[4]);
  } else if (h.length == 9) {
    r = Number("0x" + h[1] + h[2]);
    g = Number("0x" + h[3] + h[4]);
    b = Number("0x" + h[5] + h[6]);
    a = Number("0x" + h[7] + h[8]);
  }
  a = +(a / 255).toFixed(3);

  return "rgba(" + r + "," + g + "," + b + "," + a + ")";
}
