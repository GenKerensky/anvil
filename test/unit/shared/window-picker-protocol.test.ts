import { describe, expect, it } from "vitest";

import {
  formatWindowPickerRequest,
  formatWindowPickerResult,
  parseWindowPickerRequest,
  parseWindowPickerResult,
} from "../../../src/lib/shared/window-picker-protocol.js";

describe("window picker protocol", () => {
  it("round-trips pick, cancel, selected, and cancelled messages", () => {
    expect(
      parseWindowPickerRequest(
        formatWindowPickerRequest({ version: 1, id: "request-1", action: "pick" })
      )
    ).toEqual({ version: 1, id: "request-1", action: "pick" });
    expect(
      parseWindowPickerRequest(
        formatWindowPickerRequest({ version: 1, id: "request-1", action: "cancel" })
      )
    ).toEqual({ version: 1, id: "request-1", action: "cancel" });
    expect(
      parseWindowPickerResult(
        formatWindowPickerResult({
          version: 1,
          id: "request-1",
          status: "selected",
          wmClass: "org.example.App",
          wmTitle: "Example",
        })
      )
    ).toEqual({
      version: 1,
      id: "request-1",
      status: "selected",
      wmClass: "org.example.App",
      wmTitle: "Example",
    });
    expect(
      parseWindowPickerResult(
        formatWindowPickerResult({ version: 1, id: "request-1", status: "cancelled" })
      )
    ).toEqual({ version: 1, id: "request-1", status: "cancelled" });
  });

  it.each([
    "",
    "not json",
    "[]",
    JSON.stringify({ version: 2, id: "request-1", action: "pick" }),
    JSON.stringify({ version: 1, id: "", action: "pick" }),
    JSON.stringify({ version: 1, id: "request-1", action: "launch" }),
  ])("rejects malformed requests: %s", (value) => {
    expect(parseWindowPickerRequest(value)).toBeNull();
  });

  it("rejects selected results without a usable class", () => {
    expect(
      parseWindowPickerResult(
        JSON.stringify({ version: 1, id: "request-1", status: "selected", wmClass: "" })
      )
    ).toBeNull();
  });
});
