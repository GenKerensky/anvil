import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/lib/shared/settings.js", () => ({
  production: false,
}));

import { Logger } from "../../../src/lib/shared/logger.js";

interface MockSettings {
  get_boolean: ReturnType<typeof vi.fn>;
  get_uint: ReturnType<typeof vi.fn>;
}

describe("Logger", () => {
  describe("LOG_LEVELS", () => {
    it("should have correct numeric values for all levels", () => {
      expect(Logger.LOG_LEVELS.OFF).toBe(0);
      expect(Logger.LOG_LEVELS.FATAL).toBe(1);
      expect(Logger.LOG_LEVELS.ERROR).toBe(2);
      expect(Logger.LOG_LEVELS.WARN).toBe(3);
      expect(Logger.LOG_LEVELS.INFO).toBe(4);
      expect(Logger.LOG_LEVELS.DEBUG).toBe(5);
      expect(Logger.LOG_LEVELS.TRACE).toBe(6);
      expect(Logger.LOG_LEVELS.ALL).toBe(7);
    });

    it("should have levels in ascending order", () => {
      expect(Logger.LOG_LEVELS.OFF).toBeLessThan(Logger.LOG_LEVELS.FATAL);
      expect(Logger.LOG_LEVELS.FATAL).toBeLessThan(Logger.LOG_LEVELS.ERROR);
      expect(Logger.LOG_LEVELS.ERROR).toBeLessThan(Logger.LOG_LEVELS.WARN);
      expect(Logger.LOG_LEVELS.WARN).toBeLessThan(Logger.LOG_LEVELS.INFO);
      expect(Logger.LOG_LEVELS.INFO).toBeLessThan(Logger.LOG_LEVELS.DEBUG);
      expect(Logger.LOG_LEVELS.DEBUG).toBeLessThan(Logger.LOG_LEVELS.TRACE);
      expect(Logger.LOG_LEVELS.TRACE).toBeLessThan(Logger.LOG_LEVELS.ALL);
    });
  });

  describe("logging methods with settings", () => {
    let mockSettings: MockSettings;

    beforeEach(() => {
      globalThis.log = vi.fn();
      mockSettings = {
        get_boolean: vi.fn(),
        get_uint: vi.fn(),
      };
    });

    afterEach(() => {
      Logger.init(null as any);
    });

    describe("when logging is enabled and level is ALL", () => {
      beforeEach(() => {
        mockSettings.get_boolean.mockReturnValue(true);
        mockSettings.get_uint.mockReturnValue(Logger.LOG_LEVELS.ALL);
        Logger.init(mockSettings as any);
      });

      it("should call global log for fatal", () => {
        Logger.fatal("fatal message");
        expect(globalThis.log).toHaveBeenCalledWith("[Anvil] [FATAL]", "fatal message");
      });

      it("should call global log for error", () => {
        Logger.error("error message");
        expect(globalThis.log).toHaveBeenCalledWith("[Anvil] [ERROR]", "error message");
      });

      it("should call global log for warn", () => {
        Logger.warn("warn message");
        expect(globalThis.log).toHaveBeenCalledWith("[Anvil] [WARN]", "warn message");
      });

      it("should call global log for info", () => {
        Logger.info("info message");
        expect(globalThis.log).toHaveBeenCalledWith("[Anvil] [INFO]", "info message");
      });

      it("should call global log for debug", () => {
        Logger.debug("debug message");
        expect(globalThis.log).toHaveBeenCalledWith("[Anvil] [DEBUG]", "debug message");
      });

      it("should call global log for trace", () => {
        Logger.trace("trace message");
        expect(globalThis.log).toHaveBeenCalledWith("[Anvil] [TRACE]", "trace message");
      });

      it("should call global log for log", () => {
        Logger.log("log message");
        expect(globalThis.log).toHaveBeenCalledWith("[Anvil] [LOG]", "log message");
      });
    });

    describe("when logging is enabled and level is WARN", () => {
      beforeEach(() => {
        mockSettings.get_boolean.mockReturnValue(true);
        mockSettings.get_uint.mockReturnValue(Logger.LOG_LEVELS.WARN);
        Logger.init(mockSettings as any);
      });

      it("should call global log for fatal (level > OFF)", () => {
        Logger.fatal("fatal message");
        expect(globalThis.log).toHaveBeenCalled();
      });

      it("should call global log for error (level > FATAL)", () => {
        Logger.error("error message");
        expect(globalThis.log).toHaveBeenCalled();
      });

      it("should call global log for warn (level > ERROR)", () => {
        Logger.warn("warn message");
        expect(globalThis.log).toHaveBeenCalled();
      });

      it("should NOT call global log for info (level <= WARN)", () => {
        Logger.info("info message");
        expect(globalThis.log).not.toHaveBeenCalled();
      });

      it("should NOT call global log for debug (level <= WARN)", () => {
        Logger.debug("debug message");
        expect(globalThis.log).not.toHaveBeenCalled();
      });

      it("should NOT call global log for trace (level <= WARN)", () => {
        Logger.trace("trace message");
        expect(globalThis.log).not.toHaveBeenCalled();
      });
    });

    describe("when logging is enabled and level is FATAL", () => {
      beforeEach(() => {
        mockSettings.get_boolean.mockReturnValue(true);
        mockSettings.get_uint.mockReturnValue(Logger.LOG_LEVELS.FATAL);
        Logger.init(mockSettings as any);
      });

      it("should call global log for fatal (level > OFF)", () => {
        Logger.fatal("fatal message");
        expect(globalThis.log).toHaveBeenCalled();
      });

      it("should NOT call global log for error (level <= FATAL)", () => {
        Logger.error("error message");
        expect(globalThis.log).not.toHaveBeenCalled();
      });

      it("should NOT call global log for warn", () => {
        Logger.warn("warn message");
        expect(globalThis.log).not.toHaveBeenCalled();
      });
    });

    describe("when logging is disabled", () => {
      beforeEach(() => {
        mockSettings.get_boolean.mockReturnValue(false);
        mockSettings.get_uint.mockReturnValue(Logger.LOG_LEVELS.ALL);
        Logger.init(mockSettings as any);
      });

      it("should NOT call global log for any level", () => {
        Logger.fatal("msg");
        Logger.error("msg");
        Logger.warn("msg");
        Logger.info("msg");
        Logger.debug("msg");
        Logger.trace("msg");
        Logger.log("msg");
        expect(globalThis.log).not.toHaveBeenCalled();
      });
    });

    describe("when settings is null (not initialized)", () => {
      beforeEach(() => {
        Logger.init(null as any);
      });

      it("should NOT call global log for any level", () => {
        Logger.fatal("msg");
        Logger.error("msg");
        Logger.warn("msg");
        Logger.info("msg");
        Logger.debug("msg");
        Logger.trace("msg");
        Logger.log("msg");
        expect(globalThis.log).not.toHaveBeenCalled();
      });
    });
  });

  describe("logging methods when production is true", () => {
    let mockSettings: MockSettings;

    beforeEach(() => {
      globalThis.log = vi.fn();
      mockSettings = {
        get_boolean: vi.fn().mockReturnValue(true),
        get_uint: vi.fn().mockReturnValue(Logger.LOG_LEVELS.ALL),
      };
    });

    afterEach(() => {
      Logger.init(null as any);
      vi.restoreAllMocks();
    });

    it("calls global log when production is false (our mock default)", () => {
      // The top-level vi.mock sets production = false, so logging is active.
      Logger.init(mockSettings as any);
      Logger.fatal("test");
      expect(globalThis.log).toHaveBeenCalled();
    });
  });
});
