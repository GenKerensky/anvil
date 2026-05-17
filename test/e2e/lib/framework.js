/**
 * Minimal test framework for GJS inside GNOME Shell.
 *
 * Provides describe/it/assert/runAll similar to mocha/jasmine.
 * Results are collected and can be serialized to JSON.
 */

import GLib from "gi://GLib";

const suites = [];
let currentSuite = null;
let beforeEachFn = null;
let afterEachFn = null;

export function describe(name, fn) {
  currentSuite = { name, tests: [] };
  fn();
  suites.push(currentSuite);
  currentSuite = null;
}

export function it(name, fn) {
  if (!currentSuite) throw new Error("'it' must be called inside 'describe'");
  currentSuite.tests.push({ name, fn });
}

export function beforeEach(fn) {
  beforeEachFn = fn;
}

export function afterEach(fn) {
  afterEachFn = fn;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message || "Assertion failed");
}

export function assertEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error((message || "Values not equal") + ": expected " + e + ", got " + a);
}

export function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  const max = Math.max(Math.abs(actual), Math.abs(expected), 1);
  const ratio = diff / max;
  if (ratio > tolerance)
    throw new Error(
      (message || "Values not approximately equal") +
        ": got " +
        actual +
        ", expected ~" +
        expected +
        " (diff " +
        (ratio * 100).toFixed(1) +
        "%)"
    );
}

export function sleep(ms) {
  return new Promise(function (resolve) {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, function () {
      resolve();
      return GLib.SOURCE_REMOVE;
    });
  });
}

export async function runAll(filterTag) {
  const results = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const suite of suites) {
    if (filterTag && !suite.name.toLowerCase().includes(filterTag.toLowerCase())) continue;

    const suiteResult = {
      name: suite.name,
      tests: [],
      passed: 0,
      failed: 0,
      duration: 0,
    };

    const suiteStart = Date.now();

    for (const test of suite.tests) {
      const testResult = {
        name: test.name,
        passed: false,
        error: null,
        duration: 0,
      };

      const testStart = Date.now();

      try {
        if (beforeEachFn) await beforeEachFn();
        await test.fn();
        if (afterEachFn) await afterEachFn();
        testResult.passed = true;
        suiteResult.passed++;
        totalPassed++;
      } catch (e) {
        testResult.passed = false;
        testResult.error = e.message || String(e);
        suiteResult.failed++;
        totalFailed++;
        if (afterEachFn) {
          try {
            await afterEachFn();
          } catch (_) {}
        }
      }

      testResult.duration = Date.now() - testStart;
      suiteResult.tests.push(testResult);
    }

    suiteResult.duration = Date.now() - suiteStart;
    results.push(suiteResult);
  }

  return {
    results,
    totalPassed,
    totalFailed,
    timestamp: new Date().toISOString(),
  };
}
