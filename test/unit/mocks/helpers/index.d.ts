export function createMockWindow(overrides?: Record<string, unknown>): any;
export function createAnvilRuntimeFixture(options?: Record<string, unknown>): any;
export function createMockExtension(options?: Record<string, unknown>): any;
export function createMockSettings(options?: Record<string, unknown>): any;
export function installGnomeGlobals(options?: Record<string, unknown>): any;
export function createTreeFixture(options?: Record<string, unknown>): any;
export function getWorkspaceAndMonitor(
  source: any,
  wsIndex?: number,
  monIndex?: number
): { wsNode: any; monitor: any };
