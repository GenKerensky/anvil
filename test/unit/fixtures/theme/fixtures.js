import { readFileSync } from "node:fs";
import { URL } from "node:url";

function fixture(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

export const BYTE_SENSITIVE = fixture("custom-byte-sensitive.css");
export const MALFORMED = fixture("malformed.css.txt");
export const CUSTOM = fixture("v38-custom.css");
export const OLD_DEFAULT = fixture("v38-default.css");
export const NEW_DEFAULT = fixture("v39-default.css");
