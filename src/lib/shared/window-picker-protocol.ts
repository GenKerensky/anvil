export const WINDOW_PICKER_REQUEST_KEY = "window-picker-request";
export const WINDOW_PICKER_RESULT_KEY = "window-picker-result";

const WINDOW_PICKER_PROTOCOL_VERSION = 1;

export type WindowPickerRequest =
  | { version: 1; id: string; action: "pick" }
  | { version: 1; id: string; action: "cancel" };

export type WindowPickerResult =
  | {
      version: 1;
      id: string;
      status: "selected";
      wmClass: string;
      wmTitle?: string;
    }
  | { version: 1; id: string; status: "cancelled" };

export function formatWindowPickerRequest(request: WindowPickerRequest): string {
  return JSON.stringify(request);
}

export function formatWindowPickerResult(result: WindowPickerResult): string {
  return JSON.stringify(result);
}

export function parseWindowPickerRequest(value: string): WindowPickerRequest | null {
  const parsed = parseObject(value);
  if (
    !parsed ||
    parsed.version !== WINDOW_PICKER_PROTOCOL_VERSION ||
    !isNonEmptyString(parsed.id) ||
    (parsed.action !== "pick" && parsed.action !== "cancel")
  ) {
    return null;
  }

  return {
    version: WINDOW_PICKER_PROTOCOL_VERSION,
    id: parsed.id,
    action: parsed.action,
  };
}

export function parseWindowPickerResult(value: string): WindowPickerResult | null {
  const parsed = parseObject(value);
  if (
    !parsed ||
    parsed.version !== WINDOW_PICKER_PROTOCOL_VERSION ||
    !isNonEmptyString(parsed.id)
  ) {
    return null;
  }

  if (parsed.status === "cancelled") {
    return { version: WINDOW_PICKER_PROTOCOL_VERSION, id: parsed.id, status: "cancelled" };
  }

  if (parsed.status !== "selected" || !isNonEmptyString(parsed.wmClass)) return null;
  if (parsed.wmTitle !== undefined && typeof parsed.wmTitle !== "string") return null;

  return {
    version: WINDOW_PICKER_PROTOCOL_VERSION,
    id: parsed.id,
    status: "selected",
    wmClass: parsed.wmClass,
    ...(parsed.wmTitle ? { wmTitle: parsed.wmTitle } : {}),
  };
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
