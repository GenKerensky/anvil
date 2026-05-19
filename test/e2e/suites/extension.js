/**
 * Extension lifecycle tests.
 */

import { isExtensionActive, getExtensionErrors } from "../../lib/shared-commands.js";

describe("Extension Lifecycle", function () {
  it("Extension loads without errors", function () {
    expect(isExtensionActive()).toBe(true);
    const errors = getExtensionErrors();
    expect(errors.length).toBe(0);
  });
});
