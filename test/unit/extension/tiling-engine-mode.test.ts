import { describe, expect, it } from "vitest";

import { selectTilingEngineMode } from "../../../src/lib/extension/tiling-engine-mode.js";

describe("selectTilingEngineMode", () => {
  it("enables core only for the explicit development value", () => {
    expect(selectTilingEngineMode("core")).toBe("core");
    expect(selectTilingEngineMode("CORE")).toBe("shadow");
    expect(selectTilingEngineMode("legacy")).toBe("shadow");
    expect(selectTilingEngineMode(null)).toBe("shadow");
  });
});
