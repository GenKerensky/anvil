import GLib from "gi://GLib";

export type ScheduledEvent = {
  name: string;
  callback: () => void;
};

export interface EventSchedulerPort {
  readonly pendingCount: number;
  enqueue(event: ScheduledEvent, intervalMs?: number): void;
}

export interface EventSchedulerClock {
  schedule(intervalMs: number, callback: () => boolean): number;
  cancel(sourceId: number): void;
}

const glibClock: EventSchedulerClock = {
  schedule(intervalMs, callback) {
    return GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, callback);
  },
  cancel(sourceId) {
    GLib.Source.remove(sourceId);
  },
};

/**
 * FIFO scheduler for the short, named runtime events shared by tiling owners.
 * The first event starts the GLib source and therefore chooses its interval,
 * preserving the historical AnvilRuntime queue semantics.
 */
export class EventScheduler implements EventSchedulerPort {
  private readonly _clock: EventSchedulerClock;
  private readonly _events: ScheduledEvent[] = [];
  private _sourceId = 0;
  private _disposed = false;

  constructor(clock: EventSchedulerClock = glibClock) {
    this._clock = clock;
  }

  get pendingCount(): number {
    return this._events.length;
  }

  enqueue(event: ScheduledEvent, intervalMs = 220): void {
    if (this._disposed) throw new Error("EventScheduler used after dispose");
    this._events.push(event);
    if (this._sourceId) return;

    this._sourceId = this._clock.schedule(intervalMs, () => {
      const current = this._events.shift();
      current?.callback();
      if (this._events.length > 0) return true;
      this._sourceId = 0;
      return false;
    });
  }

  dispose(): void {
    if (this._sourceId) {
      this._clock.cancel(this._sourceId);
      this._sourceId = 0;
    }
    this._events.length = 0;
    this._disposed = true;
  }
}
