import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnvilRuntime } from "../../../src/lib/extension/anvil-runtime.js";
import { createMockExtension, installGnomeGlobals } from "../mocks/helpers/index.js";

function runtimeFixture() {
  installGnomeGlobals();
  return new AnvilRuntime(createMockExtension() as any) as any;
}

function installActivationStubs(runtime: any) {
  const subject = runtime;
  subject._tree = { initialize: vi.fn(), dispose: vi.fn() };
  subject._signalManager = { bindAll: vi.fn(), unbindAll: vi.fn() };
  subject._tilingShadow = { bootstrap: vi.fn() };
  vi.spyOn(runtime, "reloadTree").mockImplementation(() => {});
}

describe("AnvilRuntime lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs inertly with no runtime graph", () => {
    const runtime = runtimeFixture();
    expect(runtime.state).toBe("disabled");
    expect(runtime.disabled).toBe(true);
    expect(() => runtime.tree).toThrow("AnvilRuntime tree unavailable while disabled");
  });

  it("activates the graph once and treats repeated enable as a no-op", () => {
    const runtime = runtimeFixture();
    const initializeGraph = vi
      .spyOn(runtime as any, "_initializeGraph")
      .mockImplementation(() => installActivationStubs(runtime));

    runtime.enable();
    runtime.enable();

    expect(initializeGraph).toHaveBeenCalledOnce();
    expect((runtime as any)._tree.initialize).toHaveBeenCalledOnce();
    expect((runtime as any)._signalManager.bindAll).toHaveBeenCalledOnce();
    expect((runtime as any)._tilingShadow.bootstrap).toHaveBeenCalledOnce();
    expect((runtime as any)._signalManager.bindAll.mock.invocationCallOrder[0]).toBeLessThan(
      (runtime as any)._tilingShadow.bootstrap.mock.invocationCallOrder[0]
    );
    expect(runtime.state).toBe("enabled");
    expect(runtime.disabled).toBe(false);
  });

  it("rolls back a partial activation and allows a retry", () => {
    const runtime = runtimeFixture();
    const disposeGraph = vi.spyOn(runtime as any, "_disposeGraph").mockImplementation(() => {});
    const initializeGraph = vi
      .spyOn(runtime as any, "_initializeGraph")
      .mockImplementationOnce(() => {
        throw new Error("activation failed");
      })
      .mockImplementationOnce(() => installActivationStubs(runtime));

    expect(() => runtime.enable()).toThrow("activation failed");
    expect(disposeGraph).toHaveBeenCalledOnce();
    expect(runtime.state).toBe("disabled");
    expect(runtime.disabled).toBe(true);

    runtime.enable();
    expect(initializeGraph).toHaveBeenCalledTimes(2);
    expect(runtime.state).toBe("enabled");
  });

  it("disposes owners assigned before graph construction fails", () => {
    const runtime = runtimeFixture();
    const schedulerDispose = vi.fn();
    const treeDispose = vi.fn();
    const signalUnbind = vi.fn();
    vi.spyOn(runtime, "_initializeGraph").mockImplementation(() => {
      runtime._eventScheduler = { dispose: schedulerDispose };
      runtime._tree = { dispose: treeDispose };
      runtime._signalManager = { unbindAll: signalUnbind };
      throw new Error("owner construction failed");
    });

    expect(() => runtime.enable()).toThrow("owner construction failed");
    expect(schedulerDispose).toHaveBeenCalled();
    expect(signalUnbind).toHaveBeenCalled();
    expect(treeDispose).toHaveBeenCalled();
    expect(runtime._eventScheduler).toBeNull();
    expect(runtime._tree).toBeNull();
    expect(runtime._signalManager).toBeNull();
  });

  it.each(["tree", "signals", "initial render"])("rolls back when %s activation fails", (step) => {
    const runtime = runtimeFixture();
    let treeDispose = vi.fn();
    let signalUnbind = vi.fn();
    vi.spyOn(runtime, "reloadTree").mockImplementation(() => {
      if (step === "initial render") throw new Error("initial render failed");
    });
    vi.spyOn(runtime, "_initializeGraph").mockImplementation(() => {
      treeDispose = vi.fn();
      signalUnbind = vi.fn();
      runtime._tree = {
        initialize: vi.fn(() => {
          if (step === "tree") throw new Error("tree failed");
        }),
        dispose: treeDispose,
      };
      runtime._signalManager = {
        bindAll: vi.fn(() => {
          if (step === "signals") throw new Error("signals failed");
        }),
        unbindAll: signalUnbind,
      };
    });

    expect(() => runtime.enable()).toThrow();
    expect(runtime.state).toBe("disabled");
    expect(runtime.disabled).toBe(true);
    expect(treeDispose).toHaveBeenCalled();
    expect(signalUnbind).toHaveBeenCalled();
    expect(runtime._tree).toBeNull();
    expect(runtime._signalManager).toBeNull();
  });

  it("stops scheduled work before signals and tree state during teardown", () => {
    const runtime = runtimeFixture();
    const schedulerDispose = vi.fn();
    const signalUnbind = vi.fn();
    const treeDispose = vi.fn();
    vi.spyOn(runtime, "_initializeGraph").mockImplementation(() => {
      installActivationStubs(runtime);
      runtime._eventScheduler = { dispose: schedulerDispose };
      runtime._signalManager.unbindAll = signalUnbind;
      runtime._tree.dispose = treeDispose;
    });
    runtime.enable();

    runtime.disable();

    expect(schedulerDispose).toHaveBeenCalled();
    expect(signalUnbind).toHaveBeenCalled();
    expect(treeDispose).toHaveBeenCalled();
    expect(schedulerDispose.mock.invocationCallOrder[0]).toBeLessThan(
      signalUnbind.mock.invocationCallOrder[0]
    );
    expect(signalUnbind.mock.invocationCallOrder[0]).toBeLessThan(
      treeDispose.mock.invocationCallOrder[0]
    );
  });

  it("rejects commands before runtime activation", () => {
    const runtime = runtimeFixture();
    expect(() => runtime.command({ name: "WindowClose" })).toThrow(
      "AnvilRuntime.command used while disabled"
    );
  });

  it("caches shadow comparison only when a settle boundary records it", () => {
    const runtime = runtimeFixture();
    const comparison = {
      mismatchCount: 0,
      mismatches: [],
      rejectedEventCount: 0,
      rejectedEvents: [],
    };
    runtime._tilingShadow = { compareObservedGeometry: vi.fn(() => comparison) };

    expect(runtime._tilingShadowComparison).toBeNull();
    runtime._recordSettledTilingComparison();

    expect(runtime._tilingShadowComparison).toBe(comparison);
  });

  it("disposes an enabled graph once and treats repeated disable as a no-op", () => {
    const runtime = runtimeFixture();
    vi.spyOn(runtime as any, "_initializeGraph").mockImplementation(() =>
      installActivationStubs(runtime)
    );
    const disposeGraph = vi.spyOn(runtime as any, "_disposeGraph").mockImplementation(() => {});
    runtime.enable();

    runtime.disable();
    runtime.disable();

    expect(disposeGraph).toHaveBeenCalledOnce();
    expect(runtime.state).toBe("disabled");
    expect(runtime.disabled).toBe(true);
  });
});
