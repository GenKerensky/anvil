/**
 * Extension lifecycle tests.
 */

import { describe, it, assert } from "../lib/framework.js";
import { isExtensionActive, getExtensionErrors } from "../lib/commands.js";

describe("Extension Lifecycle", function () {
  it("Extension loads without errors", function () {
    assert(isExtensionActive(), "Extension is not ACTIVE");
    const errors = getExtensionErrors();
    assert(errors.length === 0, "Extension has errors: " + JSON.stringify(errors));
  });
});
