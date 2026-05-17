/*
 * Queue unit tests
 *
 * Tests for the FIFO Queue class used in tree traversal and event queuing.
 * Ported from jcrussell/forge
 */

import { describe, it, expect } from "vitest";
import { Queue } from "../../../src/lib/extension/tree.js";

describe("Queue", () => {
  describe("empty queue", () => {
    it("should have length 0 when created", () => {
      const q = new Queue();
      expect(q.length).toBe(0);
    });

    it("should return undefined on dequeue", () => {
      const q = new Queue();
      expect(q.dequeue()).toBeUndefined();
    });

    it("should remain empty after dequeue", () => {
      const q = new Queue();
      q.dequeue();
      expect(q.length).toBe(0);
    });
  });

  describe("single item", () => {
    it("should have length 1 after enqueue", () => {
      const q = new Queue();
      q.enqueue(42);
      expect(q.length).toBe(1);
    });

    it("should return the item on dequeue", () => {
      const q = new Queue();
      q.enqueue("hello");
      expect(q.dequeue()).toBe("hello");
    });

    it("should have length 0 after dequeue", () => {
      const q = new Queue();
      q.enqueue(42);
      q.dequeue();
      expect(q.length).toBe(0);
    });

    it("should support a second enqueue after dequeue", () => {
      const q = new Queue();
      q.enqueue("first");
      expect(q.dequeue()).toBe("first");
      q.enqueue("second");
      expect(q.dequeue()).toBe("second");
      expect(q.length).toBe(0);
    });
  });

  describe("multiple items - FIFO order", () => {
    it("should maintain FIFO order for numbers", () => {
      const q = new Queue<number>();
      q.enqueue(1);
      q.enqueue(2);
      q.enqueue(3);
      expect(q.dequeue()).toBe(1);
      expect(q.dequeue()).toBe(2);
      expect(q.dequeue()).toBe(3);
    });

    it("should maintain FIFO order for strings", () => {
      const q = new Queue<string>();
      q.enqueue("a");
      q.enqueue("b");
      q.enqueue("c");
      expect(q.dequeue()).toBe("a");
      expect(q.dequeue()).toBe("b");
      expect(q.dequeue()).toBe("c");
    });

    it("should maintain FIFO order for objects", () => {
      const q = new Queue<{ id: number }>();
      const a = { id: 1 };
      const b = { id: 2 };
      const c = { id: 3 };
      q.enqueue(a);
      q.enqueue(b);
      q.enqueue(c);
      expect(q.dequeue()).toBe(a);
      expect(q.dequeue()).toBe(b);
      expect(q.dequeue()).toBe(c);
    });

    it("should track length correctly with multiple items", () => {
      const q = new Queue();
      expect(q.length).toBe(0);
      q.enqueue(1);
      expect(q.length).toBe(1);
      q.enqueue(2);
      expect(q.length).toBe(2);
      q.enqueue(3);
      expect(q.length).toBe(3);
    });

    it("should decrease length on dequeue", () => {
      const q = new Queue();
      q.enqueue(1);
      q.enqueue(2);
      q.enqueue(3);
      q.dequeue();
      expect(q.length).toBe(2);
      q.dequeue();
      expect(q.length).toBe(1);
      q.dequeue();
      expect(q.length).toBe(0);
    });
  });

  describe("mixed operations", () => {
    it("should handle interleaved enqueue and dequeue", () => {
      const q = new Queue();
      q.enqueue("a");
      expect(q.dequeue()).toBe("a");
      q.enqueue("b");
      q.enqueue("c");
      expect(q.dequeue()).toBe("b");
      q.enqueue("d");
      expect(q.dequeue()).toBe("c");
      expect(q.dequeue()).toBe("d");
    });

    it("should drain to empty correctly", () => {
      const q = new Queue();
      q.enqueue(1);
      q.enqueue(2);
      q.enqueue(3);
      expect(q.dequeue()).toBe(1);
      expect(q.dequeue()).toBe(2);
      expect(q.dequeue()).toBe(3);
      expect(q.dequeue()).toBeUndefined();
      expect(q.length).toBe(0);
    });

    it("should support enqueue after drain", () => {
      const q = new Queue();
      q.enqueue("x");
      q.dequeue();
      expect(q.length).toBe(0);
      q.enqueue("y");
      expect(q.dequeue()).toBe("y");
    });
  });

  describe("type flexibility", () => {
    it("should store numbers", () => {
      const q = new Queue<number>();
      q.enqueue(0);
      q.enqueue(-1);
      q.enqueue(3.14);
      q.enqueue(Number.MAX_SAFE_INTEGER);
      expect(q.dequeue()).toBe(0);
      expect(q.dequeue()).toBe(-1);
      expect(q.dequeue()).toBe(3.14);
      expect(q.dequeue()).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("should store boolean values", () => {
      const q = new Queue<boolean>();
      q.enqueue(true);
      q.enqueue(false);
      expect(q.dequeue()).toBe(true);
      expect(q.dequeue()).toBe(false);
    });

    it("should store null and undefined", () => {
      const q = new Queue<null | undefined>();
      q.enqueue(null);
      q.enqueue(undefined);
      expect(q.dequeue()).toBeNull();
      expect(q.dequeue()).toBeUndefined();
    });

    it("should store arrays", () => {
      const q = new Queue<number[]>();
      q.enqueue([1, 2]);
      q.enqueue([3, 4]);
      expect(q.dequeue()).toEqual([1, 2]);
      expect(q.dequeue()).toEqual([3, 4]);
    });

    it("should store mixed types without generic constraint", () => {
      const q = new Queue();
      q.enqueue(42);
      q.enqueue("string");
      q.enqueue({ key: "value" });
      q.enqueue(null);
      expect(q.length).toBe(4);
      expect(q.dequeue()).toBe(42);
      expect(q.dequeue()).toBe("string");
      expect(q.dequeue()).toEqual({ key: "value" });
      expect(q.dequeue()).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle empty after partial operations", () => {
      const q = new Queue();
      q.enqueue(1);
      q.dequeue();
      q.enqueue(2);
      q.dequeue();
      expect(q.length).toBe(0);
    });

    it("should return undefined after partial drain", () => {
      const q = new Queue();
      q.enqueue("only");
      q.dequeue();
      expect(q.dequeue()).toBeUndefined();
    });

    it("should handle large number of items", () => {
      const q = new Queue<number>();
      const count = 1000;
      for (let i = 0; i < count; i++) {
        q.enqueue(i);
      }
      expect(q.length).toBe(count);
      for (let i = 0; i < count; i++) {
        expect(q.dequeue()).toBe(i);
      }
      expect(q.length).toBe(0);
    });

    it("should handle enqueuing the same object multiple times", () => {
      const q = new Queue();
      const obj = { value: 1 };
      q.enqueue(obj);
      q.enqueue(obj);
      q.enqueue(obj);
      expect(q.length).toBe(3);
      expect(q.dequeue()).toBe(obj);
      expect(q.dequeue()).toBe(obj);
      expect(q.dequeue()).toBe(obj);
    });

    it("should remain usable after error handling pattern", () => {
      const q = new Queue();
      q.enqueue("a");
      q.enqueue("b");
      expect(q.dequeue()).toBe("a");
      expect(q.length).toBe(1);
      q.enqueue("c");
      expect(q.dequeue()).toBe("b");
      expect(q.dequeue()).toBe("c");
    });

    it("should store functions (as used in event queue)", () => {
      const q = new Queue<() => string>();
      const fn1 = () => "first";
      const fn2 = () => "second";
      q.enqueue(fn1);
      q.enqueue(fn2);
      expect(q.length).toBe(2);
      expect(q.dequeue()!()).toBe("first");
      expect(q.dequeue()!()).toBe("second");
    });
  });
});
