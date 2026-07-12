import { describe, expect, it, vi } from "vitest";
import {
  EventScheduler,
  type EventSchedulerClock,
} from "../../../src/lib/extension/event-scheduler.js";

function fixture() {
  let callback: (() => boolean) | null = null;
  const clock: EventSchedulerClock = {
    schedule: vi.fn((_interval, cb) => {
      callback = cb;
      return 42;
    }),
    cancel: vi.fn(),
  };
  const scheduler = new EventScheduler(clock);
  return { scheduler, clock, tick: () => callback?.() };
}

describe("EventScheduler", () => {
  it("drains named events in FIFO order through one source", () => {
    const { scheduler, clock, tick } = fixture();
    const calls: string[] = [];
    scheduler.enqueue({ name: "first", callback: () => calls.push("first") }, 50);
    scheduler.enqueue({ name: "second", callback: () => calls.push("second") }, 10);

    expect(clock.schedule).toHaveBeenCalledExactlyOnceWith(50, expect.any(Function));
    expect(scheduler.pendingCount).toBe(2);
    expect(tick()).toBe(true);
    expect(tick()).toBe(false);
    expect(calls).toEqual(["first", "second"]);
    expect(scheduler.pendingCount).toBe(0);
  });

  it("allows callbacks to enqueue more work", () => {
    const { scheduler, tick } = fixture();
    const calls: string[] = [];
    scheduler.enqueue({
      name: "first",
      callback: () => {
        calls.push("first");
        scheduler.enqueue({ name: "second", callback: () => calls.push("second") });
      },
    });

    expect(tick()).toBe(true);
    expect(tick()).toBe(false);
    expect(calls).toEqual(["first", "second"]);
  });

  it("cancels the source, clears work, and rejects reuse on dispose", () => {
    const { scheduler, clock } = fixture();
    scheduler.enqueue({ name: "pending", callback: vi.fn() });
    scheduler.dispose();

    expect(clock.cancel).toHaveBeenCalledWith(42);
    expect(scheduler.pendingCount).toBe(0);
    expect(() => scheduler.enqueue({ name: "late", callback: vi.fn() })).toThrow(
      "EventScheduler used after dispose"
    );
  });

  it("is safe to dispose repeatedly", () => {
    const { scheduler, clock } = fixture();
    scheduler.dispose();
    scheduler.dispose();
    expect(clock.cancel).not.toHaveBeenCalled();
  });
});
