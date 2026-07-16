import { readFileSync } from "node:fs";

const testingWorkflow = readFileSync(".github/workflows/testing.yml", "utf8");
const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");

describe("release workflow", () => {
  it("calls a reusable test workflow at the requested release ref", () => {
    expect(testingWorkflow).toMatch(/on:\n\s+workflow_call:\n\s+inputs:\n\s+ref:/);
    expect(testingWorkflow).toMatch(
      /actions\/checkout@v4\n\s+with:\n\s+ref: \$\{\{ inputs\.ref \}\}/
    );
    expect(releaseWorkflow).toMatch(
      /uses: \.\/\.github\/workflows\/testing\.yml\n\s+with:\n\s+ref: \$\{\{ inputs\.ref \}\}/
    );
  });

  it("keeps the called test run in a distinct concurrency group", () => {
    const concurrencyGroup = /concurrency:\n\s+group:\s+(.+)/;
    const releaseGroup = releaseWorkflow.match(concurrencyGroup)?.[1];
    const testingGroup = testingWorkflow.match(concurrencyGroup)?.[1];

    expect(releaseGroup).toBe("${{ github.workflow }}-${{ github.ref }}");
    expect(testingGroup).toBe("${{ github.workflow }}-testing-${{ github.ref }}");
    expect(testingGroup).not.toBe(releaseGroup);
  });
});
