import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";

import { CURRENT_STYLESHEET_MANIFEST } from "../../../src/lib/shared/stylesheet-migration.js";

describe("stylesheet migration manifest", () => {
  it("identifies the exact stylesheet shipped by this source tree", () => {
    const bytes = readFileSync(new URL("../../../src/stylesheet.css", import.meta.url));
    const digest = createHash("sha256").update(bytes).digest("hex");

    expect(CURRENT_STYLESHEET_MANIFEST.currentDigest).toBe(digest);
    expect(CURRENT_STYLESHEET_MANIFEST.knownDefaultDigests).toContain(digest);
  });
});
